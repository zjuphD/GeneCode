/**
 * SettingsPanel — configuration and diagnostics for the Agent service.
 *
 * Sections:
 * - Service status (backend health, connection)
 * - LLM configuration (endpoint, model)
 * - NCBI connectivity
 * - Cache and storage
 * - Default experiment parameters
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Drawer, IconButton, Tooltip } from "@mui/material";
import Check from "@mui/icons-material/CheckCircleRounded";
import Download from "@mui/icons-material/DownloadRounded";
import RefreshCw from "@mui/icons-material/RefreshRounded";
import X from "@mui/icons-material/CloseRounded";
import { getAgentBaseUrl, switchAgentModel, testAgentLlmConnection } from "../agent/service";
import {
  getDefaultAgentLlmSettings,
  isTauriRuntime,
  loadAgentLlmSettings,
  restartLocalAgentService,
  saveAgentLlmSettings,
  type AgentLlmSettings,
} from "../agent/launcher";
import {
  checkForUpdates,
  downloadAndInstall,
  formatBytes,
  getAppVersion,
  type UpdateCheckResult,
  type UpdateProgress,
} from "../agent/updater";

interface HealthStatus {
  status: string;
  label: string;
  model?: string;
  endpoint?: string;
}

interface SettingsPanelProps {
  onClose: () => void;
}

function useDiagnostics() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = getAgentBaseUrl();
      const resp = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const llm = data.llm ?? {};
      const online = data.ok === true;
      setHealth({
        status: online ? "online" : "offline",
        label: llm.message ?? (online ? "Connected" : "Offline"),
        model: llm.model || undefined,
        endpoint: llm.provider || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return { health, loading, error, checkHealth };
}

function StatusDot({ status }: { status: string }) {
  const color = status === "online" || status === "ok"
    ? "var(--color-success, #4caf50)"
    : status === "checking" || status === "starting"
      ? "var(--color-warning, #ff9800)"
      : "var(--color-danger, #f44336)";
  return <span className="settings-dot" style={{ background: color }} />;
}

type ProviderPreset = "openrouter" | "minimax" | "openai" | "deepseek" | "custom";

function detectProviderPreset(settings: AgentLlmSettings): ProviderPreset {
  const base = settings.baseUrl.toLowerCase();
  const provider = settings.provider.toLowerCase();
  const model = settings.model.toLowerCase();
  if (base.includes("openrouter.ai")) return "openrouter";
  if (base.includes("api.minimaxi.com") || provider.includes("minimax")) return "minimax";
  if (base.includes("api.openai.com")) return "openai";
  if (base.includes("opencode") || provider.includes("opencode") || model.startsWith("deepseek-v4")) {
    return "deepseek";
  }
  return "custom";
}

interface ModelPresetOption {
  label: string;
  model: string;
}

const MODEL_PRESETS: Record<Exclude<ProviderPreset, "custom">, ModelPresetOption[]> = {
  deepseek: [
    { label: "DeepSeek V4 flash", model: "deepseek-v4-flash" },
    { label: "DeepSeek V4 pro", model: "deepseek-v4-pro" },
  ],
  minimax: [{ label: "MiniMax M2.7", model: "MiniMax-M2.7" }],
  openrouter: [{ label: "Nemotron 3 Ultra (free)", model: "nvidia/nemotron-3-ultra-550b-a55b:free" }],
  openai: [
    { label: "GPT-4o", model: "gpt-4o" },
    { label: "GPT-4o mini", model: "gpt-4o-mini" },
  ],
};

const DEEPSEEK_PRESET = {
  provider: "opencode-go",
  model: "deepseek-v4-flash",
  baseUrl: "https://opencode.ai/zen/go/v1",
};

/**
 * UpdateSection — check for and install app updates (A-REL-002).
 *
 * States: idle → checking → current | available | unavailable. `unavailable`
 * covers browser mode (`not-desktop`), placeholder endpoints detected on the
 * Rust side (`not-configured`) and network/other failures (`error`). The exact
 * package size is unknown until the download starts, so it appears live on the
 * progress bar (some manifests announce a size upfront, shown as a hint).
 */
function UpdateSection() {
  const desktop = isTauriRuntime();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    getAppVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => {
        if (!cancelled) setAppVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const handleCheck = async () => {
    setChecking(true);
    setResult(null);
    setInstalled(false);
    setProgress(null);
    setInstallError(null);
    try {
      setResult(await checkForUpdates());
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    if (!result || result.kind !== "available") return;
    setInstalling(true);
    setInstalled(false);
    setInstallError(null);
    try {
      await downloadAndInstall(result.update, setProgress);
      setInstalling(false);
      setInstalled(true);
    } catch (reason) {
      setInstallError(reason instanceof Error ? reason.message : String(reason));
      setInstalling(false);
    }
  };

  const percent =
    progress?.phase === "progress" && progress.totalBytes && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
      : null;

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">应用更新</h3>
      {!desktop && (
        <p className="settings-notice">自动更新仅在桌面应用中可用，浏览器预览不提供。</p>
      )}
      <div className="settings-row">
        <span>{appVersion ? `当前版本 v${appVersion}` : "桌面应用"}</span>
        <button
          type="button"
          className="settings-btn"
          onClick={handleCheck}
          disabled={checking || installing || !desktop}
        >
          {checking ? "检查中…" : "检查更新"}
        </button>
      </div>

      {result?.kind === "current" && (
        <p className="settings-feedback settings-feedback--success">已是最新版本。</p>
      )}

      {result?.kind === "available" && (
        <div className="settings-update-card">
          <div className="settings-update-card__head">
            <Download aria-hidden="true" />
            <span>发现新版本 v{result.update.version}</span>
            <Check className="settings-update-card__check" aria-hidden="true" />
          </div>
          <div className="settings-detail">
            <div className="settings-detail__row">
              <span>当前版本</span>
              <code>v{result.update.currentVersion}</code>
            </div>
            {result.update.date && (
              <div className="settings-detail__row">
                <span>发布日期</span>
                <code>{result.update.date}</code>
              </div>
            )}
            {result.update.sizeHint !== undefined && (
              <div className="settings-detail__row">
                <span>包大小</span>
                <code>{formatBytes(result.update.sizeHint)}</code>
              </div>
            )}
          </div>
          {result.update.body && (
            <p className="settings-update-card__notes">{result.update.body}</p>
          )}
          {installed ? (
            <p className="settings-feedback settings-feedback--success">
              更新已安装，应用即将重启。
            </p>
          ) : installing ? (
            <div className="settings-progress" role="progressbar" aria-valuenow={percent ?? undefined}>
              <div className="settings-progress__track">
                <div className="settings-progress__fill" style={{ width: `${percent ?? 0}%` }} />
              </div>
              <span>
                {progress?.phase === "progress" && progress.totalBytes
                  ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                  : "正在下载并安装…"}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={handleInstall}
            >
              下载并安装
            </button>
          )}
          {installError && (
            <div className="settings-feedback settings-feedback--error">{installError}</div>
          )}
        </div>
      )}

      {result?.kind === "unavailable" && (
        <p
          className={`settings-feedback ${
            result.reason === "error" ? "settings-feedback--error" : ""
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}

function AgentModelSettings({
  onSaved,
  health,
}: {
  onSaved: () => Promise<void>;
  health: HealthStatus | null;
}) {
  const desktop = isTauriRuntime();
  const [settings, setSettings] = useState(getDefaultAgentLlmSettings);
  const [preset, setPreset] = useState<ProviderPreset>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(desktop);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const browserHydratedModelRef = useRef<string | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    loadAgentLlmSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setPreset(detectProviderPreset(loaded));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  // Browser mode has no Tauri settings store. Hydrate the editable form from
  // the running service so the fields do not misleadingly remain on the
  // compile-time OpenRouter defaults while the status card reports another
  // provider/model (for example after a runtime model switch).
  useEffect(() => {
    if (desktop || !health?.model) return;
    const model = health.model;
    const provider = health.endpoint?.trim() || "";
    const hydrationKey = `${provider}\u0000${model}`;
    if (browserHydratedModelRef.current === hydrationKey) return;
    browserHydratedModelRef.current = hydrationKey;
    const baseUrl = model.toLowerCase().startsWith("deepseek-v4")
      ? DEEPSEEK_PRESET.baseUrl
      : "";
    setSettings((current) => ({
      ...current,
      ...(provider ? { provider } : {}),
      model,
      ...(baseUrl ? { baseUrl } : {}),
    }));
    setPreset(detectProviderPreset({
      enabled: true,
      provider,
      model,
      baseUrl: baseUrl || "",
      hasApiKey: false,
    }));
  }, [desktop, health?.endpoint, health?.model]);

  const updatePreset = (next: ProviderPreset) => {
    setPreset(next);
    setApiKey("");
    setClearApiKey(false);
    setConnectionFeedback(null);
    setSettings((current) => {
      if (next === "openrouter") {
        return {
          ...current,
          provider: "OpenRouter",
          model: "nvidia/nemotron-3-ultra-550b-a55b:free",
          baseUrl: "https://openrouter.ai/api/v1",
          hasApiKey: false,
        };
      }
      if (next === "minimax") {
        return {
          ...current,
          provider: "MiniMax",
          model: "MiniMax-M2.7",
          baseUrl: "https://api.minimaxi.com/v1",
          hasApiKey: false,
        };
      }
      if (next === "openai") {
        return {
          ...current,
          provider: "OpenAI",
          model: current.model.startsWith("MiniMax-") || current.model.includes("nemotron-3-ultra")
            ? ""
            : current.model,
          baseUrl: "https://api.openai.com/v1",
          hasApiKey: false,
        };
      }
      if (next === "deepseek") {
        return {
          ...current,
          ...DEEPSEEK_PRESET,
          hasApiKey: false,
        };
      }
      return {
        ...current,
        provider: ["MiniMax", "OpenAI", "OpenRouter"].includes(current.provider)
          ? "OpenAI-compatible"
          : current.provider,
        hasApiKey: false,
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    setConnectionFeedback(null);
    try {
      if (!desktop) {
        // Browser mode: switch the running local service's model directly — no
        // restart needed. The API key stays on the service side (.env.local).
        const result = await switchAgentModel({
          model: settings.model,
          baseUrl: settings.baseUrl,
          provider: settings.provider,
        });
        if (!result.ok) {
          throw new Error("The local service did not confirm the model switch.");
        }
        setApiKey("");
        setMessage(
          `Switched to ${result.llm.model ?? settings.model} — the local Agent service is using it now.`,
        );
        await onSaved();
        return;
      }

      const saved = await saveAgentLlmSettings({
        enabled: settings.enabled,
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiKey,
        clearApiKey,
      });
      setSettings(saved);
      setApiKey("");
      setClearApiKey(false);
      const launch = await restartLocalAgentService();
      if (launch.status === "unavailable") {
        throw new Error(launch.message);
      }
      setMessage(
        launch.owned
          ? "Saved securely. Agent restarted with the new model."
          : "Saved securely. The currently running local service is still in use.",
      );
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionFeedback(null);
    try {
      const result = await testAgentLlmConnection();
      setConnectionFeedback({ kind: "success", message: result.message });
    } catch (reason) {
      setConnectionFeedback({
        kind: "error",
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setTesting(false);
    }
  };

  const knownPresets = preset !== "custom" ? MODEL_PRESETS[preset] : [];
  const inPreset = knownPresets.some((option) => option.model === settings.model);

  return (
    <div className="settings-form" aria-busy={loading || saving}>
      {!desktop && (
        <p className="settings-notice">
          Browser session — changes apply to the running local Agent service immediately, no restart needed.
        </p>
      )}

      {!desktop && (
        <label className="settings-toggle settings-toggle--muted"          title="本地 Agent 服务控制 AI 增强是否启用。">
          <input
            type="checkbox"
            checked
            disabled
          />
          <span>AI 增强由本地 Agent 服务管理</span>
        </label>
      )}

      <label className="settings-field">
        <span>服务商</span>
        <select
          value={preset}
          onChange={(event) => updatePreset(event.target.value as ProviderPreset)}
          disabled={loading || saving}
        >
          <option value="deepseek">DeepSeek (opencode-go)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="minimax">MiniMax</option>
          <option value="openai">OpenAI</option>
          <option value="custom">OpenAI-compatible / local</option>
        </select>
      </label>

      <label className="settings-field">
        <span>服务商名称</span>
        <input
          value={settings.provider}
          onChange={(event) => setSettings((current) => ({
            ...current,
            provider: event.target.value,
            hasApiKey: false,
          }))}
          disabled={loading || saving}
        />
      </label>

      {knownPresets.length > 0 && (
        <label className="settings-field">
          <span>快捷模型</span>
          <select
            value={inPreset ? settings.model : "__custom__"}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__custom__") {
                setSettings((current) => ({ ...current, model: "" }));
                setConnectionFeedback(null);
                modelInputRef.current?.focus();
                return;
              }
              setSettings((current) => ({ ...current, model: value }));
            }}
            disabled={loading || saving}
          >
            {knownPresets.map((option) => (
              <option key={option.model} value={option.model}>{option.label}</option>
            ))}
            <option value="__custom__">Custom model…</option>
          </select>
        </label>
      )}

      <label className="settings-field">
        <span>模型</span>
        <input
          ref={modelInputRef}
          value={settings.model}
          onChange={(event) => setSettings((current) => ({
            ...current,
            model: event.target.value,
          }))}
          placeholder="模型标识符"
          disabled={loading || saving}
        />
      </label>

      <label className="settings-field">
        <span>API 地址</span>
        <input
          value={settings.baseUrl}
          onChange={(event) => setSettings((current) => ({
            ...current,
            baseUrl: event.target.value,
          }))}
          placeholder="https://…/v1"
          disabled={loading || saving}
        />
      </label>

      {desktop && (
        <>
          <label className="settings-field">
            <span>API 密钥</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasApiKey ? "已保存在系统钥匙串" : "输入 API 密钥"}
              autoComplete="off"
              disabled={loading || saving || clearApiKey}
            />
          </label>

          <div className="settings-key-status">
            <StatusDot status={settings.hasApiKey && !clearApiKey ? "ok" : "offline"} />
            <span>{settings.hasApiKey && !clearApiKey ? "API key stored securely" : "No saved API key"}</span>
          </div>

          {settings.hasApiKey && (
            <label className="settings-toggle settings-toggle--muted">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => setClearApiKey(event.target.checked)}
                disabled={loading || saving}
              />
              <span>移除已保存的 API 密钥</span>
            </label>
          )}
        </>
      )}

      <div className="settings-actions">
        <button
          type="button"
          className="settings-btn settings-btn--primary"
          onClick={handleSave}
          disabled={loading || saving}
        >
          {saving
            ? "保存中…"
            : desktop
              ? "保存并重启 Agent"
              : "立即切换模型"}
        </button>
        <button
          type="button"
          className="settings-btn"
          onClick={handleTestConnection}
          disabled={loading || saving || testing || (desktop && (!settings.hasApiKey || clearApiKey))}
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
      </div>
      {message && <div className="settings-feedback settings-feedback--success">{message}</div>}
      {error && <div className="settings-feedback settings-feedback--error">{error}</div>}
      {connectionFeedback && (
        <div className={`settings-feedback settings-feedback--${connectionFeedback.kind}`}>
          {connectionFeedback.message}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { health, loading, error, checkHealth } = useDiagnostics();

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{
        backdrop: { className: "settings-overlay" },
        paper: {
          component: "aside",
          className: "settings-panel",
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": "settings-title",
        },
      }}
    >
        <div className="settings-panel__header">
          <div>
            <span className="settings-panel__title" id="settings-title">设置</span>
            <span className="settings-panel__subtitle">Agent、文件与应用偏好</span>
          </div>
          <Tooltip title="关闭设置">
            <IconButton size="small" className="settings-panel__close" onClick={onClose} aria-label="Close settings">
              <X aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </div>

        <div className="settings-panel__body">
        <section className="settings-section">
          <h3 className="settings-section__title">Agent 服务</h3>
          <div className="settings-status-card">
            <div className="settings-row">
              <StatusDot status={health?.status ?? "offline"} />
              <span>{loading ? "Checking…" : error ?? health?.label ?? "Unknown"}</span>
            </div>
            <button
              type="button"
              className="settings-icon-btn"
              onClick={checkHealth}
              disabled={loading}
              aria-label="Refresh Agent status"
              title="Refresh Agent status"
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section__title">AI 模型</h3>
          <AgentModelSettings onSaved={checkHealth} health={health} />
        </section>

        <UpdateSection />

        <section className="settings-section">
          <h3 className="settings-section__title">键盘快捷键</h3>
          <div className="settings-detail">
            <div className="settings-detail__row">
              <span>打开序列</span>
              <kbd>⌘O</kbd>
            </div>
            <div className="settings-detail__row">
              <span>保存序列</span>
              <kbd>⌘S</kbd>
            </div>
            <div className="settings-detail__row">
              <span>另存为</span>
              <kbd>⌘⇧S</kbd>
            </div>
          </div>
        </section>

        <details className="settings-advanced">
          <summary>高级诊断</summary>
          <div className="settings-advanced__content">
            {health && (
              <div className="settings-detail">
                <div className="settings-detail__row"><span>后端地址</span><code>{getAgentBaseUrl()}</code></div>
                {health.model && <div className="settings-detail__row"><span>模型</span><code>{health.model}</code></div>}
                {health.endpoint && <div className="settings-detail__row"><span>服务商</span><code>{health.endpoint}</code></div>}
              </div>
            )}
            <p className="settings-advanced__note">序列库、Agent 任务与恢复数据都保存在本机。</p>
            <button
              type="button"
              className="settings-btn settings-btn--danger"
              onClick={() => {
                if (confirm("确定要重置所有本地应用数据吗？此操作无法撤销。")) {
                  localStorage.clear();
                  window.location.reload();
                }
              }}
            >
              重置本地应用数据
            </button>
          </div>
        </details>
      </div>
    </Drawer>
  );
}
