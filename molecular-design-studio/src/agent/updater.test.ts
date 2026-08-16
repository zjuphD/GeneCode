import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdates,
  downloadAndInstall,
  formatBytes,
  getAppVersion,
  isUpdaterConfigured,
} from "./updater";

const bridge = vi.hoisted(() => ({
  desktop: true,
  invoke: vi.fn(),
  getVersion: vi.fn(),
  check: vi.fn(),
}));

vi.mock("./launcher", () => ({ isTauriRuntime: () => bridge.desktop }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: bridge.getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: bridge.check }));

function fakeUpdate(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.2.0",
    currentVersion: "0.1.0",
    date: "2026-08-08",
    body: "New features",
    rawJson: { size: 1048576 },
    downloadAndInstall: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

describe("updater bridge", () => {
  beforeEach(() => {
    bridge.desktop = true;
    bridge.invoke.mockReset().mockResolvedValue(true);
    bridge.getVersion.mockReset().mockResolvedValue("0.1.0");
    bridge.check.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getAppVersion returns null in browser mode", async () => {
    bridge.desktop = false;
    expect(await getAppVersion()).toBeNull();
  });

  it("getAppVersion resolves from the Tauri runtime", async () => {
    expect(await getAppVersion()).toBe("0.1.0");
  });

  it("isUpdaterConfigured returns false in browser mode", async () => {
    bridge.desktop = false;
    expect(await isUpdaterConfigured()).toBe(false);
  });

  it("isUpdaterConfigured forwards the Rust answer in desktop mode", async () => {
    bridge.invoke.mockResolvedValue(false);
    expect(await isUpdaterConfigured()).toBe(false);
    expect(bridge.invoke).toHaveBeenCalledWith("is_updater_configured");
  });

  it("checkForUpdates degrades in browser mode without calling the plugin", async () => {
    bridge.desktop = false;
    const result = await checkForUpdates();
    expect(result).toMatchObject({ kind: "unavailable", reason: "not-desktop" });
    expect(bridge.check).not.toHaveBeenCalled();
  });

  it("checkForUpdates fails closed when no release endpoint was injected", async () => {
    bridge.invoke.mockResolvedValue(false);
    const result = await checkForUpdates();
    expect(result).toMatchObject({ kind: "unavailable", reason: "not-configured" });
    expect(bridge.check).not.toHaveBeenCalled();
  });

  it("checkForUpdates reports current when no update exists", async () => {
    bridge.check.mockResolvedValue(null);
    expect(await checkForUpdates()).toEqual({ kind: "current" });
    expect(bridge.check).toHaveBeenCalledWith({ timeout: 10000 });
  });

  it("checkForUpdates surfaces an available update with its size hint", async () => {
    bridge.check.mockResolvedValue(fakeUpdate());
    const result = await checkForUpdates();
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    expect(result.update).toMatchObject({
      version: "0.2.0",
      currentVersion: "0.1.0",
      date: "2026-08-08",
      body: "New features",
      sizeHint: 1048576,
    });
  });

  it("checkForUpdates falls back to a readable error on plugin failure", async () => {
    bridge.check.mockRejectedValue(new Error("network unreachable"));
    const result = await checkForUpdates();
    expect(result).toMatchObject({ kind: "unavailable", reason: "error" });
    expect((result as { message: string }).message).toContain("network unreachable");
  });

  it("downloadAndInstall accumulates progress bytes and closes the handle", async () => {
    const update = fakeUpdate();
    update.downloadAndInstall.mockImplementation((cb: (e: unknown) => void) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 40 } });
      cb({ event: "Progress", data: { chunkLength: 60 } });
      cb({ event: "Finished" });
      return Promise.resolve();
    });
    bridge.check.mockResolvedValue(update);

    const result = await checkForUpdates();
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;

    const events: unknown[] = [];
    await downloadAndInstall(result.update, (progress) => events.push(progress));
    expect(events).toEqual([
      { phase: "started", totalBytes: 100 },
      { phase: "progress", downloadedBytes: 40, totalBytes: 100 },
      { phase: "progress", downloadedBytes: 100, totalBytes: 100 },
      { phase: "finished" },
    ]);
    expect(update.close).toHaveBeenCalledTimes(1);
  });

  it("formatBytes renders human-readable sizes", () => {
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(12582912)).toBe("12 MB");
  });
});
