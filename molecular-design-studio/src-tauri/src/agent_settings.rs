use serde::{Deserialize, Serialize};
use std::{fs, io::ErrorKind, path::PathBuf, process::Command};
use tauri::Manager;

const SETTINGS_FILE: &str = "agent-llm.json";
const KEYRING_SERVICE: &str = "studio.molecular-design.agent";
const KEYRING_ACCOUNT_PREFIX: &str = "llm-api-key:";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAgentLlmSettings {
    enabled: bool,
    provider: String,
    model: String,
    base_url: String,
}

impl Default for PersistedAgentLlmSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: "OpenRouter".to_string(),
            model: "nvidia/nemotron-3-ultra-550b-a55b:free".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLlmSettings {
    enabled: bool,
    provider: String,
    model: String,
    base_url: String,
    has_api_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentLlmSettings {
    enabled: bool,
    provider: String,
    model: String,
    base_url: String,
    api_key: Option<String>,
    #[serde(default)]
    clear_api_key: bool,
}

pub struct AgentLlmRuntimeSettings {
    config: PersistedAgentLlmSettings,
    api_key: Option<String>,
}

#[tauri::command]
pub fn get_agent_llm_settings(app: tauri::AppHandle) -> Result<AgentLlmSettings, String> {
    let config = load_persisted_settings(&app)?;
    let api_key = load_api_key(&config.provider)?;
    Ok(to_public_settings(config, api_key.is_some()))
}

#[tauri::command]
pub fn save_agent_llm_settings(
    app: tauri::AppHandle,
    input: SaveAgentLlmSettings,
) -> Result<AgentLlmSettings, String> {
    let config = normalize_settings_input(&input)?;
    let requested_key = input.api_key.as_deref().map(str::trim).unwrap_or("");

    if input.clear_api_key && !requested_key.is_empty() {
        return Err("Cannot save and remove the API key at the same time".to_string());
    }

    if input.clear_api_key {
        delete_api_key(&config.provider)?;
    } else if !requested_key.is_empty() {
        save_api_key(&config.provider, requested_key)?;
    }

    write_persisted_settings(&app, &config)?;
    let has_api_key = load_api_key(&config.provider)?.is_some();
    Ok(to_public_settings(config, has_api_key))
}

pub fn load_runtime_settings(
    app: &tauri::AppHandle,
) -> Result<AgentLlmRuntimeSettings, String> {
    let config = load_persisted_settings(app)?;
    let api_key = load_api_key(&config.provider)?;
    Ok(AgentLlmRuntimeSettings {
        config,
        api_key,
    })
}

pub fn apply_runtime_environment(command: &mut Command, runtime: &AgentLlmRuntimeSettings) {
    for name in [
        "AGENT_LLM_ENABLED",
        "AGENT_LLM_PROVIDER",
        "AGENT_LLM_MODEL",
        "AGENT_LLM_BASE_URL",
        "AGENT_LLM_API_KEY",
        "OPENROUTER_API_KEY",
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "OPENAI_BASE_URL",
    ] {
        command.env_remove(name);
    }

    command
        .env(
            "AGENT_LLM_ENABLED",
            if runtime.config.enabled { "true" } else { "false" },
        )
        .env("AGENT_LLM_PROVIDER", &runtime.config.provider)
        .env("AGENT_LLM_MODEL", &runtime.config.model)
        .env("AGENT_LLM_BASE_URL", &runtime.config.base_url)
        .env("PRIMER_TRUST_CLIENT_LLM", "0");

    if let Some(api_key) = runtime.api_key.as_deref() {
        command.env("AGENT_LLM_API_KEY", api_key);
    }
}

fn normalize_settings_input(
    input: &SaveAgentLlmSettings,
) -> Result<PersistedAgentLlmSettings, String> {
    let provider = input.provider.trim();
    let model = input.model.trim();
    let base_url = input.base_url.trim().trim_end_matches('/');

    if provider.is_empty() || provider.len() > 80 {
        return Err("Provider name is required and must be shorter than 80 characters".to_string());
    }
    if input.enabled && (model.is_empty() || model.len() > 160) {
        return Err("Model name is required and must be shorter than 160 characters".to_string());
    }
    if base_url.is_empty() || base_url.len() > 2048 || base_url.chars().any(char::is_whitespace) {
        return Err("Model endpoint is invalid".to_string());
    }
    let secure_remote = base_url.starts_with("https://");
    let local_http = base_url.starts_with("http://127.0.0.1")
        || base_url.starts_with("http://localhost");
    if !secure_remote && !local_http {
        return Err("Model endpoint must use HTTPS, except for localhost".to_string());
    }

    Ok(PersistedAgentLlmSettings {
        enabled: input.enabled,
        provider: provider.to_string(),
        model: model.to_string(),
        base_url: base_url.to_string(),
    })
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot resolve Agent data directory".to_string())?;
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Cannot create Agent data directory: {error}"))?;
    Ok(data_dir.join(SETTINGS_FILE))
}

fn load_persisted_settings(
    app: &tauri::AppHandle,
) -> Result<PersistedAgentLlmSettings, String> {
    let path = settings_path(app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("Cannot read model settings: {error}")),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            Ok(PersistedAgentLlmSettings::default())
        }
        Err(error) => Err(format!("Cannot read model settings: {error}")),
    }
}

fn write_persisted_settings(
    app: &tauri::AppHandle,
    settings: &PersistedAgentLlmSettings,
) -> Result<(), String> {
    let path = settings_path(app)?;
    let payload = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Cannot serialize model settings: {error}"))?;
    fs::write(path, payload).map_err(|error| format!("Cannot save model settings: {error}"))
}

fn provider_keyring_account(provider: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_separator = false;
    for character in provider.trim().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !slug.is_empty() && !previous_was_separator {
            slug.push('-');
            previous_was_separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        slug.push_str("custom");
    }
    format!("{KEYRING_ACCOUNT_PREFIX}{slug}")
}

fn credential_entry(provider: &str) -> Result<keyring::Entry, String> {
    let account = provider_keyring_account(provider);
    keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|error| format!("Cannot access secure credential storage: {error}"))
}

#[cfg(target_os = "macos")]
fn load_api_key(provider: &str) -> Result<Option<String>, String> {
    let account = provider_keyring_account(provider);
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            KEYRING_SERVICE,
            "-a",
            &account,
            "-w",
        ])
        .output()
        .map_err(|error| format!("Cannot access secure credential storage: {error}"))?;

    if output.status.success() {
        let value = String::from_utf8(output.stdout)
            .map_err(|_| "Cannot decode API key from secure storage".to_string())?;
        let value = value.trim().to_string();
        return Ok((!value.is_empty()).then_some(value));
    }

    let error = String::from_utf8_lossy(&output.stderr);
    if error.contains("could not be found") {
        return Ok(None);
    }
    Err("Cannot read API key from secure storage".to_string())
}

#[cfg(not(target_os = "macos"))]
fn load_api_key(provider: &str) -> Result<Option<String>, String> {
    match credential_entry(provider)?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Cannot read API key from secure storage: {error}")),
    }
}

fn save_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    credential_entry(provider)?
        .set_password(api_key)
        .map_err(|error| format!("Cannot save API key to secure storage: {error}"))
}

fn delete_api_key(provider: &str) -> Result<(), String> {
    match credential_entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Cannot remove API key from secure storage: {error}")),
    }
}

fn to_public_settings(
    config: PersistedAgentLlmSettings,
    has_api_key: bool,
) -> AgentLlmSettings {
    AgentLlmSettings {
        enabled: config.enabled,
        provider: config.provider,
        model: config.model,
        base_url: config.base_url,
        has_api_key,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_openrouter_free_model() {
        let settings = PersistedAgentLlmSettings::default();
        assert_eq!(settings.provider, "OpenRouter");
        assert_eq!(settings.model, "nvidia/nemotron-3-ultra-550b-a55b:free");
        assert_eq!(settings.base_url, "https://openrouter.ai/api/v1");
    }

    #[test]
    fn stores_credentials_per_provider() {
        assert_eq!(provider_keyring_account("OpenRouter"), "llm-api-key:openrouter");
        assert_eq!(provider_keyring_account("MiniMax API"), "llm-api-key:minimax-api");
        assert_eq!(provider_keyring_account("  "), "llm-api-key:custom");
    }

    fn input(base_url: &str) -> SaveAgentLlmSettings {
        SaveAgentLlmSettings {
            enabled: true,
            provider: " MiniMax ".to_string(),
            model: " MiniMax-M2.7 ".to_string(),
            base_url: base_url.to_string(),
            api_key: None,
            clear_api_key: false,
        }
    }

    #[test]
    fn normalizes_model_settings() {
        let settings = normalize_settings_input(&input("https://api.minimaxi.com/v1/")).unwrap();
        assert_eq!(settings.provider, "MiniMax");
        assert_eq!(settings.model, "MiniMax-M2.7");
        assert_eq!(settings.base_url, "https://api.minimaxi.com/v1");
    }

    #[test]
    fn allows_local_http_endpoints() {
        assert!(normalize_settings_input(&input("http://127.0.0.1:11434/v1")).is_ok());
        assert!(normalize_settings_input(&input("http://localhost:11434/v1")).is_ok());
    }

    #[test]
    fn rejects_insecure_remote_endpoints() {
        let error = normalize_settings_input(&input("http://example.com/v1")).unwrap_err();
        assert!(error.contains("HTTPS"));
    }
}
