import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SequenceDocument } from "../types";
import { useProject } from "./useProject";
import { useWorkspace } from "./useWorkspace";

const failResult = {
  ok: false,
  reason: "quota",
  message: "Autosave: browser storage is full — save a copy to a file to avoid data loss.",
} as const;

vi.mock("./projectPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./projectPersistence")>();
  return {
    ...actual,
    loadProjects: vi.fn(() => null),
    saveProjects: vi.fn(() => failResult),
  };
});

vi.mock("./workspacePersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspacePersistence")>();
  return {
    ...actual,
    loadWorkspace: vi.fn(() => null),
    saveWorkspace: vi.fn(() => failResult),
  };
});

const doc: SequenceDocument = {
  name: "test",
  sequence: "AACCGGTT",
  circular: false,
  features: [],
};

describe("persistence saveError propagation (A-DATA-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("useProject exposes a quota failure instead of reporting a silent save", async () => {
    const { result } = renderHook(() => useProject());
    act(() => {
      result.current.createProject("Vector A", doc);
    });
    // Wait for the persist effect to run and update saveError.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.saveError).toContain("storage is full");
    expect(result.current.lastSavedAt).toBeNull();
  });

  it("useWorkspace exposes an autosave failure through saveError", async () => {
    const { result } = renderHook(() => useWorkspace());
    act(() => {
      result.current.onFileOpen(doc, "/tmp/a.gb");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.saveError).toContain("storage is full");
  });
});
