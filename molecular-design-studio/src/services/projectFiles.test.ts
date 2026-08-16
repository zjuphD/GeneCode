import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openProjectFile, saveProjectFile } from "./projectFiles";

describe("projectFiles service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__TAURI_INTERNALS__ = {};
  });

  it("opens a project bundle through the native picker", async () => {
    vi.mocked(open).mockResolvedValue("/tmp/demo.genecode.json" as never);
    vi.mocked(readTextFile).mockResolvedValue('{"format":"genecode.project"}');

    await expect(openProjectFile()).resolves.toEqual({
      path: "/tmp/demo.genecode.json",
      contents: '{"format":"genecode.project"}',
    });
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "GeneCode Project", extensions: ["json"] }],
    });
    expect(readTextFile).toHaveBeenCalledWith("/tmp/demo.genecode.json");
  });

  it("returns null when opening is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null as never);
    await expect(openProjectFile()).resolves.toBeNull();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("saves a project bundle to the native picker path", async () => {
    vi.mocked(save).mockResolvedValue("/tmp/demo.genecode.json" as never);
    vi.mocked(writeTextFile).mockResolvedValue(undefined);

    await expect(saveProjectFile("demo", "contents")).resolves.toBe("/tmp/demo.genecode.json");
    expect(save).toHaveBeenCalledWith({
      defaultPath: "demo.genecode.json",
      filters: [{ name: "GeneCode Project", extensions: ["json"] }],
    });
    expect(writeTextFile).toHaveBeenCalledWith("/tmp/demo.genecode.json", "contents");
  });

  it("uses the existing project path when saving again", async () => {
    vi.mocked(save).mockResolvedValue(null as never);
    await expect(saveProjectFile("demo", "contents", "/tmp/existing.genecode.json")).resolves.toBeNull();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "/tmp/existing.genecode.json",
    }));
  });
});
