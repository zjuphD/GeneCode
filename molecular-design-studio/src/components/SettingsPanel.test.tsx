import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";

const bridge = vi.hoisted(() => ({
  desktop: true,
  load: vi.fn(),
  save: vi.fn(),
  restart: vi.fn(),
  testConnection: vi.fn(),
  switchModel: vi.fn(),
}));

const updater = vi.hoisted(() => ({
  getVersion: vi.fn(),
  check: vi.fn(),
  install: vi.fn(),
}));

vi.mock("../agent/launcher", () => ({
  getDefaultAgentLlmSettings: () => ({
    enabled: true,
    provider: "MiniMax",
    model: "MiniMax-M2.7",
    baseUrl: "https://api.minimaxi.com/v1",
    hasApiKey: false,
  }),
  isTauriRuntime: () => bridge.desktop,
  loadAgentLlmSettings: bridge.load,
  saveAgentLlmSettings: bridge.save,
  restartLocalAgentService: bridge.restart,
}));

vi.mock("../agent/service", () => ({
  getAgentBaseUrl: () => "http://127.0.0.1:8000",
  testAgentLlmConnection: bridge.testConnection,
  switchAgentModel: bridge.switchModel,
}));

vi.mock("../agent/updater", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/updater")>();
  return {
    getAppVersion: updater.getVersion,
    checkForUpdates: updater.check,
    downloadAndInstall: updater.install,
    formatBytes: actual.formatBytes,
  };
});

const storedSettings = {
  enabled: true,
  provider: "MiniMax",
  model: "MiniMax-M2.7",
  baseUrl: "https://api.minimaxi.com/v1",
  hasApiKey: true,
};

describe("SettingsPanel", () => {
  beforeEach(() => {
    bridge.desktop = true;
    bridge.load.mockReset().mockResolvedValue(storedSettings);
    bridge.save.mockReset().mockResolvedValue(storedSettings);
    bridge.restart.mockReset().mockResolvedValue({
      status: "started",
      owned: true,
      message: "Started bundled Agent service",
      baseUrl: "http://127.0.0.1:8000",
    });
    bridge.testConnection.mockReset().mockResolvedValue({
      connected: true,
      message: "连接成功：MiniMax · MiniMax-M2.7",
    });
    bridge.switchModel.mockReset().mockResolvedValue({
      ok: true,
      llm: {
        provider: "opencode-go",
        model: "deepseek-v4-flash",
        mode: "llm",
        message: "已配置 opencode-go · deepseek-v4-flash",
      },
    });
    updater.getVersion.mockReset().mockResolvedValue("0.1.0");
    updater.check.mockReset();
    updater.install.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      llm: {
        message: "Connected",
        model: "MiniMax-M2.7",
        provider: "MiniMax",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("switches the running service's model in browser mode", async () => {
    bridge.desktop = false;
    render(<SettingsPanel onClose={vi.fn()} />);

    // Browser mode renders the editable form (no desktop keychain), and the
    // API key field stays hidden — the key lives on the local service.
    expect(await screen.findByRole("button", { name: "立即切换模型" })).toBeTruthy();
    expect(bridge.load).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("API 密钥")).toBeNull();

    fireEvent.change(screen.getByLabelText("模型"), {
      target: { value: "deepseek-v4-pro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即切换模型" }));

    await waitFor(() => expect(bridge.switchModel).toHaveBeenCalledWith({
      model: "deepseek-v4-pro",
      baseUrl: "https://api.minimaxi.com/v1",
      provider: "MiniMax",
    }));
    expect(await screen.findByText(/Switched to deepseek-v4-flash/i)).toBeTruthy();
  });

  it("hydrates the browser form from the running model status", async () => {
    bridge.desktop = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      llm: {
        message: "已配置 opencode-go · deepseek-v4-flash",
        model: "deepseek-v4-flash",
        provider: "opencode-go",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    render(<SettingsPanel onClose={vi.fn()} />);

    expect(await screen.findByDisplayValue("deepseek-v4-flash")).toBeTruthy();
    expect((screen.getByLabelText("服务商名称") as HTMLInputElement).value).toBe("opencode-go");
    expect((screen.getByLabelText("API 地址") as HTMLInputElement).value)
      .toBe("https://opencode.ai/zen/go/v1");
  });

  it("fills the DeepSeek (opencode-go) preset", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    const provider = await screen.findByLabelText("服务商");
    fireEvent.change(provider, { target: { value: "deepseek" } });

    expect((screen.getByLabelText("服务商名称") as HTMLInputElement).value).toBe("opencode-go");
    expect((screen.getByLabelText("模型") as HTMLInputElement).value).toBe("deepseek-v4-flash");
    expect((screen.getByLabelText("API 地址") as HTMLInputElement).value)
      .toBe("https://opencode.ai/zen/go/v1");
  });

  it("quick-switches to the pro model preset", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    const provider = await screen.findByLabelText("服务商");
    fireEvent.change(provider, { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("快捷模型"), {
      target: { value: "deepseek-v4-pro" },
    });

    expect((screen.getByLabelText("模型") as HTMLInputElement).value).toBe("deepseek-v4-pro");
  });

  it("activates and focuses the editable model field for a custom model", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    const provider = await screen.findByLabelText("服务商");
    fireEvent.change(provider, { target: { value: "minimax" } });
    fireEvent.change(screen.getByLabelText("快捷模型"), {
      target: { value: "__custom__" },
    });

    const model = screen.getByLabelText("模型") as HTMLInputElement;
    expect(model.value).toBe("");
    expect(document.activeElement).toBe(model);
  });

  it("saves the key and restarts the bundled Agent", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("API key stored securely")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并重启 Agent" }));

    await waitFor(() => expect(bridge.save).toHaveBeenCalledWith({
      enabled: true,
      provider: "MiniMax",
      model: "MiniMax-M2.7",
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "new-secret",
      clearApiKey: false,
    }));
    expect(bridge.restart).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Agent restarted with the new model/i)).toBeTruthy();
  });

  it("fills the supported OpenRouter preset", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    const provider = await screen.findByLabelText("服务商");
    fireEvent.change(provider, { target: { value: "openrouter" } });

    expect((screen.getByLabelText("服务商名称") as HTMLInputElement).value).toBe("OpenRouter");
    expect((screen.getByLabelText("模型") as HTMLInputElement).value)
      .toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect((screen.getByLabelText("API 地址") as HTMLInputElement).value)
      .toBe("https://openrouter.ai/api/v1");
  });

  it("shows real provider connection errors", async () => {
    bridge.testConnection.mockRejectedValue(new Error("大模型 API 返回 429：额度不足"));
    render(<SettingsPanel onClose={vi.fn()} />);

    const testButton = await screen.findByRole("button", { name: "测试连接" });
    fireEvent.click(testButton);

    expect(await screen.findByText(/429：额度不足/)).toBeTruthy();
  });

  it("shows the current version and reports when up to date", async () => {
    updater.check.mockResolvedValue({ kind: "current" });
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /应用更新/ }));
    expect(await screen.findByText("当前版本 v0.1.0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("已是最新版本。")).toBeTruthy();
    expect(updater.check).toHaveBeenCalledTimes(1);
  });

  it("shows an available update with version and installs it", async () => {
    updater.check.mockResolvedValue({
      kind: "available",
      update: {
        version: "0.2.0",
        currentVersion: "0.1.0",
        date: "2026-08-08",
        body: "Bug fixes",
        sizeHint: 12582912,
        raw: {},
      },
    });
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /应用更新/ }));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByText("发现新版本 v0.2.0")).toBeTruthy();
    expect(screen.getByText("12 MB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "下载并安装" }));
    await waitFor(() => expect(updater.install).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/更新已安装，应用即将重启/)).toBeTruthy();
  });

  it("degrades gracefully when the updater is not configured", async () => {
    updater.check.mockResolvedValue({
      kind: "unavailable",
      reason: "not-configured",
      message: "尚未配置更新服务器：plugins.updater.endpoints 仍是占位符。",
    });
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /应用更新/ }));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByText(/尚未配置更新服务器/)).toBeTruthy();
  });

  it("disables checking in browser mode with a graceful notice", async () => {
    bridge.desktop = false;
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /应用更新/ }));
    expect(await screen.findByText(/自动更新仅在桌面应用中可用/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "检查更新" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});
