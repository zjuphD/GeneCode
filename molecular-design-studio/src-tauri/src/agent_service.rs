use serde::Serialize;
use std::{
    env,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

use crate::agent_settings;

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:18764";
const HEALTH_TIMEOUT: Duration = Duration::from_millis(700);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const STARTUP_POLL: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct AgentServiceState {
    owned_child: Mutex<Option<Child>>,
    launch_lock: Mutex<()>,
    api_token: Mutex<Option<String>>,
}

/// A-API-001: 256-bit bearer token for the local API. Generated once at
/// startup, passed to the Python sidecar via GENE_CODE_API_TOKEN, and handed
/// to the webview through `get_agent_api_token` so every Agent request can
/// present it in the X-GeneCode-Token header.
pub fn api_token(state: &AgentServiceState) -> Result<String, String> {
    let mut guard = state
        .api_token
        .lock()
        .map_err(|_| "API token state is unavailable".to_string())?;
    if let Some(token) = guard.as_deref() {
        return Ok(token.to_string());
    }
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| "Cannot generate the API token (no entropy)".to_string())?;
    let token = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    *guard = Some(token.clone());
    Ok(token)
}

#[tauri::command]
pub fn get_agent_api_token(state: tauri::State<'_, AgentServiceState>) -> Result<String, String> {
    api_token(&state)
}

impl Drop for AgentServiceState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl AgentServiceState {
    pub fn shutdown(&self) {
        if let Ok(mut child_ref) = self.owned_child.lock() {
            if let Some(mut child) = child_ref.take() {
                terminate_child_tree(&mut child);
            }
        }
    }
}

fn configure_child_process(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

fn terminate_child_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        unsafe {
            libc::kill(process_group, libc::SIGTERM);
        }
        for _ in 0..20 {
            let group_exists = unsafe { libc::kill(process_group, 0) == 0 };
            if !group_exists {
                let _ = child.wait();
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        unsafe {
            libc::kill(process_group, libc::SIGKILL);
        }
        let _ = child.wait();
    }

    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentServiceEnsureResult {
    status: AgentServiceEnsureStatus,
    owned: bool,
    message: String,
    base_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum AgentServiceEnsureStatus {
    Reused,
    Started,
    Starting,
    Unavailable,
}

#[tauri::command]
pub fn ensure_agent_service(
    state: tauri::State<'_, AgentServiceState>,
    app: tauri::AppHandle,
    base_url: Option<String>,
) -> Result<AgentServiceEnsureResult, String> {
    let _launch_guard = state
        .launch_lock
        .lock()
        .map_err(|_| "Agent service launcher is unavailable".to_string())?;
    let target = LocalAgentTarget::parse(base_url.as_deref().unwrap_or(DEFAULT_BASE_URL))
        .map_err(|err| err.to_string())?;

    if health_check(&target).is_ok() {
        return Ok(AgentServiceEnsureResult {
            status: AgentServiceEnsureStatus::Reused,
            owned: false,
            message: "Using existing Agent service".to_string(),
            base_url: target.base_url(),
        });
    }

    {
        let mut guard = state
            .owned_child
            .lock()
            .map_err(|_| "Agent service state is unavailable".to_string())?;

        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    guard.take();
                }
                Ok(None) => {
                    return Ok(AgentServiceEnsureResult {
                        status: AgentServiceEnsureStatus::Starting,
                        owned: true,
                        message: "Agent service is starting".to_string(),
                        base_url: target.base_url(),
                    });
                }
                Err(_) => {
                    guard.take();
                }
            }
        }
    }

    let resource_dir = app.path().resource_dir().ok();
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot resolve Agent data directory".to_string())?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|_| "Cannot create Agent data directory".to_string())?;

    let bundled_binary = resolve_service_binary(resource_dir.as_deref());
    let runtime_settings = agent_settings::load_runtime_settings(&app)?;
    let (mut command, started_message) = if let Some(binary) = bundled_binary {
        (
            Command::new(binary),
            "Started bundled Agent service".to_string(),
        )
    } else {
        let script = resolve_service_script(resource_dir.as_deref())
            .ok_or_else(|| "Cannot find local Agent service executable or script".to_string())?;
        let python = env::var("MDS_AGENT_PYTHON").unwrap_or_else(|_| "python3".to_string());
        let mut fallback = Command::new(python);
        fallback.arg(script);
        (
            fallback,
            "Started development Agent service".to_string(),
        )
    };

    configure_child_process(&mut command);
    agent_settings::apply_runtime_environment(&mut command, &runtime_settings);
    let token = api_token(&state)?;
    let mut child = command
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(target.port.to_string())
        .current_dir(&data_dir)
        .env("PRIMER_DATA_DIR", &data_dir)
        .env("GENE_CODE_API_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Cannot start local Agent service".to_string())?;

    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if health_check(&target).is_ok() {
            let mut guard = state
                .owned_child
                .lock()
                .map_err(|_| "Agent service state is unavailable".to_string())?;
            *guard = Some(child);
            return Ok(AgentServiceEnsureResult {
                status: AgentServiceEnsureStatus::Started,
                owned: true,
                message: started_message,
                base_url: target.base_url(),
            });
        }

        match child.try_wait() {
            Ok(Some(_)) => {
                return Ok(AgentServiceEnsureResult {
                    status: AgentServiceEnsureStatus::Unavailable,
                    owned: false,
                    message: "Agent service exited before becoming healthy".to_string(),
                    base_url: target.base_url(),
                });
            }
            Ok(None) => {}
            Err(_) => {
                return Ok(AgentServiceEnsureResult {
                    status: AgentServiceEnsureStatus::Unavailable,
                    owned: false,
                    message: "Cannot inspect Agent service process".to_string(),
                    base_url: target.base_url(),
                });
            }
        }

        if Instant::now() >= deadline {
            terminate_child_tree(&mut child);
            return Ok(AgentServiceEnsureResult {
                status: AgentServiceEnsureStatus::Unavailable,
                owned: false,
                message: "Agent service did not become healthy in time".to_string(),
                base_url: target.base_url(),
            });
        }

        thread::sleep(STARTUP_POLL);
    }
}

#[tauri::command]
pub fn restart_agent_service(
    state: tauri::State<'_, AgentServiceState>,
    app: tauri::AppHandle,
    base_url: Option<String>,
) -> Result<AgentServiceEnsureResult, String> {
    state.shutdown();
    ensure_agent_service(state, app, base_url)
}

fn resolve_service_binary(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Ok(path) = env::var("MDS_AGENT_BINARY") {
        let candidate = PathBuf::from(path);
        if is_service_binary(&candidate) {
            return candidate.canonicalize().ok().or(Some(candidate));
        }
    }

    let binary_name = if cfg!(windows) {
        "agent-server.exe"
    } else {
        "agent-server"
    };
    let mut candidates = Vec::new();
    if let Some(resources) = resource_dir {
        candidates.push(resources.join(binary_name));
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(binary_name));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| is_service_binary(candidate))
        .and_then(|candidate| candidate.canonicalize().ok().or(Some(candidate)))
}

fn is_service_binary(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "agent-server" || name == "agent-server.exe")
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalAgentTarget {
    host: String,
    port: u16,
}

impl LocalAgentTarget {
    fn parse(raw: &str) -> Result<Self, &'static str> {
        let trimmed = raw.trim().trim_end_matches('/');
        let without_scheme = trimmed
            .strip_prefix("http://")
            .ok_or("Agent base URL must use http:// localhost")?;

        let authority = without_scheme
            .split('/')
            .next()
            .ok_or("Agent base URL is invalid")?;
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port_raw)) => {
                let port = port_raw
                    .parse::<u16>()
                    .map_err(|_| "Agent base URL port is invalid")?;
                (host, port)
            }
            None => (authority, 80),
        };

        if host != "127.0.0.1" && host != "localhost" {
            return Err("Agent service launcher only supports localhost");
        }

        Ok(Self {
            host: "127.0.0.1".to_string(),
            port,
        })
    }

    fn base_url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }
}

fn health_check(target: &LocalAgentTarget) -> Result<(), &'static str> {
    let addr = SocketAddr::from(([127, 0, 0, 1], target.port));
    let mut stream =
        TcpStream::connect_timeout(&addr, HEALTH_TIMEOUT).map_err(|_| "connect failed")?;
    stream
        .set_read_timeout(Some(HEALTH_TIMEOUT))
        .map_err(|_| "timeout failed")?;
    stream
        .set_write_timeout(Some(HEALTH_TIMEOUT))
        .map_err(|_| "timeout failed")?;

    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        target.host, target.port
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|_| "write failed")?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|_| "read failed")?;

    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        return Err("health returned non-200");
    }

    let body = response.split("\r\n\r\n").nth(1).ok_or("missing body")?;
    serde_json::from_str::<serde_json::Value>(body).map_err(|_| "health returned non-json")?;
    Ok(())
}

fn resolve_service_script(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Ok(path) = env::var("MDS_AGENT_SERVER_PATH") {
        let candidate = PathBuf::from(path);
        if is_server_script(&candidate) {
            return candidate.canonicalize().ok().or(Some(candidate));
        }
    }

    let mut candidates = Vec::new();
    if let Some(resources) = resource_dir {
        candidates.push(resources.join("server.py"));
    }
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join("server.py"));
        candidates.push(current_dir.join("../server.py"));
        candidates.push(current_dir.join("../../server.py"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("../server.py"));
    candidates.push(manifest_dir.join("../../server.py"));
    candidates.push(manifest_dir.join("../../../server.py"));

    candidates
        .into_iter()
        .find(|candidate| is_server_script(candidate))
        .and_then(|candidate| candidate.canonicalize().ok().or(Some(candidate)))
}

fn is_server_script(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "server.py")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_request_uses_authority_not_url_in_host_header() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let request = String::from_utf8(request).unwrap();
            assert!(request.contains(&format!("\r\nHost: 127.0.0.1:{port}\r\n")));
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}").unwrap();
        });
        assert!(health_check(&LocalAgentTarget { host: "127.0.0.1".into(), port }).is_ok());
        server.join().unwrap();
    }

    #[test]
    fn parses_default_localhost_target() {
        let target = LocalAgentTarget::parse("http://127.0.0.1:8000").unwrap();
        assert_eq!(target.port, 8000);
        assert_eq!(target.base_url(), "http://127.0.0.1:8000");
    }

    #[test]
    fn parses_localhost_with_trailing_slash() {
        let target = LocalAgentTarget::parse(" http://localhost:8123/ ").unwrap();
        assert_eq!(target.host, "127.0.0.1");
        assert_eq!(target.port, 8123);
    }

    #[test]
    fn rejects_remote_hosts() {
        let err = LocalAgentTarget::parse("http://0.0.0.0:8000").unwrap_err();
        assert_eq!(err, "Agent service launcher only supports localhost");
    }

    #[test]
    fn api_token_is_256_bit_hex_and_stable() {
        let state = AgentServiceState::default();
        let first = api_token(&state).unwrap();
        let second = api_token(&state).unwrap();
        assert_eq!(first.len(), 64, "token must be 64 hex chars (256 bits)");
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(first, second, "token must be stable for the process lifetime");
    }

    #[test]
    fn recognizes_bundled_binary_names() {
        let fixture_dir = env::temp_dir().join(format!("mds-agent-test-{}", std::process::id()));
        std::fs::create_dir_all(&fixture_dir).unwrap();
        let binary_name = if cfg!(windows) { "agent-server.exe" } else { "agent-server" };
        let binary = fixture_dir.join(binary_name);
        std::fs::write(&binary, b"fixture").unwrap();
        let script = fixture_dir.join("server.py");
        std::fs::write(&script, b"fixture").unwrap();

        assert!(is_service_binary(&binary));
        assert!(!is_service_binary(&script));

        std::fs::remove_dir_all(fixture_dir).unwrap();
    }
}
