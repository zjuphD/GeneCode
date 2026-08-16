import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  ensureLocalAgentService,
  getDefaultAgentLlmSettings,
  isTauriRuntime,
  loadAgentLlmSettings,
  restartLocalAgentService,
  saveAgentLlmSettings,
} from "./launcher";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("agent launcher bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  it("defaults new desktop installs to the OpenRouter free model", () => {
    expect(getDefaultAgentLlmSettings()).toMatchObject({
      provider: "OpenRouter",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      baseUrl: "https://openrouter.ai/api/v1",
    });
  });

  it("skips the Tauri command in browser mode", async () => {
    delete window.__TAURI_INTERNALS__;

    expect(isTauriRuntime()).toBe(false);
    await expect(ensureLocalAgentService()).resolves.toMatchObject({
      status: "skipped",
      owned: false,
      baseUrl: "http://127.0.0.1:8000",
    });
  });

  it("loads desktop model settings without exposing a key", async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.mocked(invoke).mockResolvedValue({
      enabled: true,
      provider: "MiniMax",
      model: "MiniMax-M2.7",
      baseUrl: "https://api.minimaxi.com/v1",
      hasApiKey: true,
    });

    await expect(loadAgentLlmSettings()).resolves.toMatchObject({
      provider: "MiniMax",
      hasApiKey: true,
    });
    expect(invoke).toHaveBeenCalledWith("get_agent_llm_settings", undefined);
  });

  it("saves settings and restarts the desktop Agent", async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        enabled: true,
        provider: "MiniMax",
        model: "MiniMax-M2.7",
        baseUrl: "https://api.minimaxi.com/v1",
        hasApiKey: true,
      })
      .mockResolvedValueOnce({
        status: "started",
        owned: true,
        message: "Started bundled Agent service",
        baseUrl: "http://127.0.0.1:8000",
      });

    await saveAgentLlmSettings({
      enabled: true,
      provider: "MiniMax",
      model: "MiniMax-M2.7",
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "secret",
    });
    await restartLocalAgentService();

    expect(invoke).toHaveBeenNthCalledWith(1, "save_agent_llm_settings", {
      input: {
        enabled: true,
        provider: "MiniMax",
        model: "MiniMax-M2.7",
        baseUrl: "https://api.minimaxi.com/v1",
        apiKey: "secret",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "restart_agent_service", {
      baseUrl: "http://127.0.0.1:8000",
    });
  });

  it("rejects secure settings calls in browser mode", async () => {
    delete window.__TAURI_INTERNALS__;
    await expect(loadAgentLlmSettings()).rejects.toThrow("desktop app");
  });
});
