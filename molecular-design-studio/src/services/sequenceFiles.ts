/**
 * Sequence file service.
 *
 * Thin wrappers around Tauri dialog and filesystem plugin APIs.
 * Keeps native APIs out of React components so tests can mock this module.
 */

import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import {
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const SEQUENCE_FILTERS = [
  { name: "GenBank", extensions: ["gb", "gbk"] },
  { name: "FASTA", extensions: ["fasta", "fa", "fna"] },
  { name: "SnapGene", extensions: ["dna"] },
  { name: "ABI Trace", extensions: ["ab1", "abi"] },
];

const BROWSER_SEQUENCE_ACCEPT = [
  ".gb",
  ".gbk",
  ".fasta",
  ".fa",
  ".fna",
  ".dna",
  ".ab1",
  ".abi",
].join(",");

const browserFiles = new Map<string, File>();

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function chooseBrowserSequenceFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = BROWSER_SEQUENCE_ACCEPT;
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const finish = (path: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      input.remove();
      resolve(path);
    };
    const handleWindowFocus = () => {
      // File inputs do not emit a cancel event. Wait until the selected file
      // has been attached before treating the restored focus as cancellation.
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
      browserFiles.set(file.name, file);
      finish(file.name);
    });
    window.addEventListener("focus", handleWindowFocus);
    input.click();
  });
}

function downloadBrowserFile(
  path: string,
  contents: string | Uint8Array,
): void {
  const filename = path.split(/[\\/]/).pop() || "sequence.gb";
  const blob =
    contents instanceof Uint8Array
      ? new Blob([contents], { type: "application/octet-stream" })
      : new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function readBrowserFile(
  file: File,
  binary: boolean,
): Promise<string | Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      if (binary) {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new Error("Failed to read binary sequence file"));
          return;
        }
        resolve(new Uint8Array(reader.result));
        return;
      }
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    if (binary) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });
}

function isBinarySequencePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".dna") || lower.endsWith(".ab1") || lower.endsWith(".abi");
}

/**
 * Open a native file picker for sequence files.
 * Returns the selected path, or null if the user cancelled.
 */
export async function chooseSequenceFile(): Promise<string | null> {
  if (!isDesktopRuntime()) return chooseBrowserSequenceFile();
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Sequence Files",
        extensions: ["gb", "gbk", "fasta", "fa", "fna", "dna", "ab1", "abi"],
      },
    ],
  });
  if (selected === null) return null;
  return selected as string;
}

/**
 * Read text formats as strings and SnapGene files as binary bytes.
 */
export async function readSequenceFile(
  path: string,
): Promise<string | Uint8Array> {
  if (!isDesktopRuntime()) {
    const file = browserFiles.get(path);
    if (!file) throw new Error("The selected browser file is no longer available");
    return readBrowserFile(file, isBinarySequencePath(path));
  }
  if (isBinarySequencePath(path)) {
    return readFile(path);
  }
  return readTextFile(path);
}

/**
 * Open a native save dialog with GenBank and FASTA filters.
 * Returns the chosen path, or null if the user cancelled.
 */
export async function chooseSavePath(
  defaultName: string,
  currentPath?: string,
): Promise<string | null> {
  // Browser: there is no native dialog, so the Save As name chosen in the
  // in-app dialog (defaultName) is what gets downloaded. Using currentPath
  // here would silently ignore the user's new file name and re-download the
  // old one.
  if (!isDesktopRuntime()) return defaultName;
  const selected = await save({
    defaultPath: currentPath ?? defaultName,
    filters: SEQUENCE_FILTERS,
  });
  return selected ?? null;
}

/**
 * Write content to a file at the given path.
 *
 * Text (GenBank/FASTA) goes through writeTextFile; binary SnapGene (.dna)
 * bytes go through writeFile so they are never corrupted by text encoding.
 */
export async function writeSequenceFile(
  path: string,
  contents: string | Uint8Array,
): Promise<void> {
  if (!isDesktopRuntime()) {
    downloadBrowserFile(path, contents);
    return;
  }
  if (contents instanceof Uint8Array) {
    await writeFile(path, contents);
    return;
  }
  await writeTextFile(path, contents);
}

/**
 * Show a confirmation dialog asking whether to discard unsaved changes.
 * Returns true if the user confirms, false if they cancel.
 */
export async function confirmDiscardChanges(): Promise<boolean> {
  if (!isDesktopRuntime()) {
    return window.confirm("You have unsaved changes. Discard them?");
  }
  return confirm("You have unsaved changes. Discard them?", {
    title: "Unsaved Changes",
    kind: "warning",
  });
}
