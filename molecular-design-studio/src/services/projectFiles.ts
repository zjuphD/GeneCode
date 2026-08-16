/**
 * Native/browser file access for portable GeneCode project bundles.
 * React components only deal with text and paths; platform details stay here.
 */

import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const PROJECT_FILTERS = [
  { name: "GeneCode Project", extensions: ["json"] },
];

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}
function browserFileInput(): Promise<{ path: string | null; contents: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".genecode.json,.json,application/json";
    let settled = false;

    const finish = (result: { path: string | null; contents: string } | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      resolve(result);
    };
    const handleWindowFocus = () => {
      // Browsers do not expose a cancel event for file inputs. Give the picker
      // a moment to populate `files` before treating focus as cancellation.
      window.setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 350);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      void file.text().then(
        (contents) => finish({ path: null, contents }),
        () => finish(null),
      );
    });
    window.addEventListener("focus", handleWindowFocus, { once: false });
    input.click();
  });
}

/** Open a GeneCode project bundle and return its contents. */
export async function openProjectFile(): Promise<{
  path: string | null;
  contents: string;
} | null> {
  if (!isDesktopRuntime()) return browserFileInput();
  const selected = await open({ multiple: false, filters: PROJECT_FILTERS });
  if (selected === null) return null;
  const path = selected as string;
  return { path, contents: await readTextFile(path) };
}

function ensureProjectExtension(name: string): string {
  const trimmed = name.trim() || "GeneCode project";
  return /\.genecode\.json$/i.test(trimmed) ? trimmed : `${trimmed}.genecode.json`;
}

/** Save a GeneCode project bundle and return its path, or null on cancellation. */
export async function saveProjectFile(
  defaultName: string,
  contents: string,
  currentPath?: string | null,
): Promise<string | null> {
  if (isDesktopRuntime()) {
    const selected = await save({
      defaultPath: currentPath ?? ensureProjectExtension(defaultName),
      filters: PROJECT_FILTERS,
    });
    if (selected === null) return null;
    const path = selected as string;
    await writeTextFile(path, contents);
    return path;
  }

  const filename = ensureProjectExtension(defaultName);
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}
