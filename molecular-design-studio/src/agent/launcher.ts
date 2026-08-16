import { getAgentBaseUrl } from "./service";

export type AgentLaunchStatus =
  | "skipped"
  | "reused"
  | "started"
  | "starting"
  | "unavailable";

export interface AgentLaunchResult {
  status: AgentLaunchStatus;
  owned: boolean;
  message: string;
  baseUrl: string;
}

export interface AgentLlmSettings {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
}

export interface AgentLlmSettingsInput {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function ensureLocalAgentService(): Promise<AgentLaunchResult> {
  const baseUrl = getAgentBaseUrl();

  if (!isTauriRuntime()) {
    return {
      status: "skipped",
      owned: false,
      message: "Browser mode",
      baseUrl,
    };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AgentLaunchResult>("ensure_agent_service", { baseUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      owned: false,
      message: message || "Cannot start Agent service",
      baseUrl,
    };
  }
}

async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Model settings are available in the desktop app");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function getDefaultAgentLlmSettings(): AgentLlmSettings {
  return {
    enabled: true,
    provider: "OpenRouter",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    baseUrl: "https://openrouter.ai/api/v1",
    hasApiKey: false,
  };
}

export async function loadAgentLlmSettings(): Promise<AgentLlmSettings> {
  return invokeDesktop<AgentLlmSettings>("get_agent_llm_settings");
}

export async function saveAgentLlmSettings(
  input: AgentLlmSettingsInput,
): Promise<AgentLlmSettings> {
  return invokeDesktop<AgentLlmSettings>("save_agent_llm_settings", { input });
}

export async function restartLocalAgentService(): Promise<AgentLaunchResult> {
  const baseUrl = getAgentBaseUrl();
  return invokeDesktop<AgentLaunchResult>("restart_agent_service", { baseUrl });
}
