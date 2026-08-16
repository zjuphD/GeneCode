import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import {
  chooseSequenceFile,
  readSequenceFile,
  chooseSavePath,
  writeSequenceFile,
  confirmDiscardChanges,
} from "./sequenceFiles";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import {
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

describe("sequenceFiles service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("chooseSequenceFile returns path from open dialog", async () => {
    vi.mocked(open).mockResolvedValue("/path/to/file.gb" as never);
    const result = await chooseSequenceFile();
    expect(result).toBe("/path/to/file.gb");
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [
        {
          name: "Sequence Files",
          extensions: ["gb", "gbk", "fasta", "fa", "fna", "dna", "ab1", "abi"],
        },
      ],
    });
  });

  it("chooseSequenceFile returns null when user cancels", async () => {
    vi.mocked(open).mockResolvedValue(null as never);
    const result = await chooseSequenceFile();
    expect(result).toBeNull();
  });

  it("readSequenceFile calls readTextFile", async () => {
    vi.mocked(readTextFile).mockResolvedValue("file contents");
    const result = await readSequenceFile("/path/to/file.gb");
    expect(result).toBe("file contents");
    expect(readTextFile).toHaveBeenCalledWith("/path/to/file.gb");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("readSequenceFile reads .dna files as binary", async () => {
    const bytes = new Uint8Array([9, 0, 0, 0, 14]);
    vi.mocked(readFile).mockResolvedValue(bytes);
    const result = await readSequenceFile("/path/to/file.DNA");
    expect(result).toEqual(bytes);
    expect(readFile).toHaveBeenCalledWith("/path/to/file.DNA");
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("readSequenceFile reads .ab1 files as binary", async () => {
    const bytes = new Uint8Array([65, 66, 73, 70]);
    vi.mocked(readFile).mockResolvedValue(bytes);
    const result = await readSequenceFile("/path/to/read.ab1");
    expect(result).toEqual(bytes);
    expect(readFile).toHaveBeenCalledWith("/path/to/read.ab1");
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("chooseSavePath returns path from save dialog", async () => {
    vi.mocked(save).mockResolvedValue("/path/to/output.gb" as never);
    const result = await chooseSavePath("default.gb");
    expect(result).toBe("/path/to/output.gb");
  });

  it("chooseSavePath returns null when user cancels", async () => {
    vi.mocked(save).mockResolvedValue(null as never);
    const result = await chooseSavePath("default.gb");
    expect(result).toBeNull();
  });

  it("chooseSavePath uses currentPath as defaultPath when provided", async () => {
    vi.mocked(save).mockResolvedValue(null as never);
    await chooseSavePath("default.gb", "/existing/path/file.gb");
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/existing/path/file.gb",
      }),
    );
  });

  it("writeSequenceFile calls writeTextFile", async () => {
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await writeSequenceFile("/path/to/file.gb", "contents");
    expect(writeTextFile).toHaveBeenCalledWith("/path/to/file.gb", "contents");
  });

  it("writeSequenceFile writes .dna bytes with writeFile", async () => {
    vi.mocked(writeFile).mockResolvedValue(undefined);
    const bytes = new Uint8Array([9, 0, 0, 0, 14]);
    await writeSequenceFile("/path/to/output.dna", bytes);
    expect(writeFile).toHaveBeenCalledWith("/path/to/output.dna", bytes);
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("confirmDiscardChanges returns true when user confirms", async () => {
    vi.mocked(confirm).mockResolvedValue(true as never);
    const result = await confirmDiscardChanges();
    expect(result).toBe(true);
  });

  it("confirmDiscardChanges returns false when user cancels", async () => {
    vi.mocked(confirm).mockResolvedValue(false as never);
    const result = await confirmDiscardChanges();
    expect(result).toBe(false);
  });
});

describe("sequenceFiles browser fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a browser file input and reads a selected text file", async () => {
    const file = new File([">browser-file\nACGT"], "browser-file.fasta", {
      type: "text/plain",
    });
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, "files", { value: [file], configurable: true });
      this.dispatchEvent(new Event("change"));
    });

    const path = await chooseSequenceFile();

    expect(path).toBe("browser-file.fasta");
    expect(await readSequenceFile(path!)).toBe(">browser-file\nACGT");
    expect(open).not.toHaveBeenCalled();
  });

  it("uses the browser confirmation dialog for unsaved changes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await expect(confirmDiscardChanges()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
