/**
 * Updater bridge (A-REL-002 follow-up).
 *
 * Wraps `@tauri-apps/plugin-updater` behind a small discriminated union so the
 * Settings panel can render every outcome without touching the plugin API:
 *
 *   current        — no update available
 *   available      — a newer version exists (version / date / notes, plus a
 *                    size hint when the manifest announces one; the exact size
 *                    is reported live once the download starts)
 *   unavailable    — browser mode (`not-desktop`), placeholder endpoints
 *                    detected on the Rust side (`not-configured`), or a
 *                    network/other failure (`error`)
 *
 * The plugin (and `@tauri-apps/api`) are imported lazily so the web build
 * never pulls them in and browser mode degrades without throwing.
 */

import { isTauriRuntime } from "./launcher";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  /** Bytes, when the update manifest announces a size. */
  sizeHint?: number;
  /** Opaque plugin handle; only meaningful inside this module. */
  raw: unknown;
}

export type UpdateCheckResult =
  | { kind: "current" }
  | { kind: "available"; update: AvailableUpdate }
  | {
      kind: "unavailable";
      reason: "not-desktop" | "not-configured" | "error";
      message: string;
    };

export type UpdateProgress =
  | { phase: "started"; totalBytes?: number }
  | { phase: "progress"; downloadedBytes: number; totalBytes?: number }
  | { phase: "finished" };

/** Reads whether the updater channel is configured (endpoints not placeholders). */
export async function isUpdaterConfigured(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("is_updater_configured");
  } catch {
    return false;
  }
}

/** Current app version from the Tauri runtime, or null in browser mode. */
export async function getAppVersion(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}

export async function checkForUpdates(timeoutMs = 10_000): Promise<UpdateCheckResult> {
  if (!isTauriRuntime()) {
    return {
      kind: "unavailable",
      reason: "not-desktop",
      message: "自动更新仅在桌面应用（Tauri）中可用，浏览器预览不支持。",
    };
  }
  try {
    const configured = await isUpdaterConfigured();
    if (!configured) {
      return {
        kind: "unavailable",
        reason: "not-configured",
        message:
          "当前是未启用自动更新的安全构建。只有发布流程生成真实 HTTPS " +
          "更新端点并完成工件签名后，检查更新才会启用。",
      };
    }
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: timeoutMs });
    if (!update) return { kind: "current" };
    const rawJson = (update as unknown as { rawJson?: Record<string, unknown> }).rawJson;
    const announcedSize = rawJson?.size;
    const sizeHint =
      typeof announcedSize === "number" && announcedSize > 0 ? announcedSize : undefined;
    return {
      kind: "available",
      update: {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body,
        sizeHint,
        raw: update,
      },
    };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    return {
      kind: "unavailable",
      reason: "error",
      message: `无法检查更新：${message || "未知错误"}`,
    };
  }
}

/**
 * Downloads and installs the given update. Reports live progress (cumulative
 * bytes once the total size is known). On success the updater closes/relaunches
 * the app (macOS) or hands over to the installer (Windows NSIS).
 */
export async function downloadAndInstall(
  update: AvailableUpdate,
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  const raw = update.raw as {
    downloadAndInstall: (cb: (event: unknown) => void) => Promise<void>;
    close?: () => Promise<void>;
  };
  let totalBytes: number | undefined;
  let downloadedBytes = 0;
  try {
    await raw.downloadAndInstall((event) => {
      const e = event as { event: string; data?: { contentLength?: number; chunkLength?: number } };
      switch (e.event) {
        case "Started":
          totalBytes = e.data?.contentLength;
          downloadedBytes = 0;
          onProgress({ phase: "started", totalBytes });
          break;
        case "Progress":
          downloadedBytes += e.data?.chunkLength ?? 0;
          onProgress({ phase: "progress", downloadedBytes, totalBytes });
          break;
        case "Finished":
          onProgress({ phase: "finished" });
          break;
      }
    });
  } finally {
    try {
      await raw.close?.();
    } catch {
      // Ignore — the app may already be restarting.
    }
  }
}

/** Human-readable byte size ("12.3 MB"); empty string when unknown. */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
