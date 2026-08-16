import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SequenceDocument } from "../types";
import { createDocumentHistoryEntry } from "./documentHistory";
import { useProject } from "./useProject";

const docA: SequenceDocument = {
  name: "Vector A",
  sequence: "AACCGGTT",
  circular: true,
  features: [],
};

const docB: SequenceDocument = {
  name: "Insert B",
  sequence: "ATGCGTAA",
  circular: false,
  features: [],
};

describe("useProject", () => {
  it("stores file path and dirty state with each project", () => {
    const { result } = renderHook(() => useProject());

    act(() => {
      result.current.createProject("Vector A", docA, "/tmp/vector-a.gb", true);
    });

    expect(result.current.activeProject).toMatchObject({
      name: "Vector A",
      doc: docA,
      filePath: "/tmp/vector-a.gb",
      isDirty: true,
    });
  });

  it("updates the complete active workspace state", () => {
    const { result } = renderHook(() => useProject());
    act(() => {
      result.current.createProject("Vector A", docA);
    });

    const edited = { ...docA, sequence: `${docA.sequence}AA` };
    act(() => {
      result.current.updateActiveState(edited, "/tmp/edited.gb", true);
    });

    expect(result.current.activeProject).toMatchObject({
      doc: edited,
      filePath: "/tmp/edited.gb",
      isDirty: true,
    });
  });

  it("builds a project-file snapshot with the latest workspace state", () => {
    const { result } = renderHook(() => useProject());
    act(() => {
      result.current.createProject("Vector A", docA);
    });

    const edited = { ...docA, sequence: `${docA.sequence}AA` };
    let snapshot!: ReturnType<typeof result.current.getPersistedState>;
    act(() => {
      snapshot = result.current.getPersistedState(edited, "/tmp/vector-a.gb", true, []);
    });

    expect(snapshot.activeId).toBe(result.current.activeId);
    expect(snapshot.projects[0]).toMatchObject({
      doc: edited,
      filePath: "/tmp/vector-a.gb",
      isDirty: true,
    });
  });

  it("replaces the project library when a project file is imported", () => {
    const { result } = renderHook(() => useProject());
    const importedState = {
      version: 1 as const,
      activeId: "imported",
      projects: [{
        id: "imported",
        name: "Imported vector",
        doc: docA,
        filePath: null,
        isDirty: false,
        history: [],
        createdAt: 1,
        updatedAt: 2,
      }],
    };

    let activeId = "";
    act(() => {
      result.current.createProject("Temporary", docB);
      activeId = result.current.importPersistedState(importedState)?.id ?? "";
    });

    expect(activeId).toBe("imported");
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.activeProject?.name).toBe("Imported vector");
  });

  it("keeps a separate document history with each project", () => {
    const { result } = renderHook(() => useProject());
    act(() => {
      result.current.createProject("Vector A", docA);
    });

    const edited = { ...docA, sequence: `${docA.sequence}AA` };
    const entry = createDocumentHistoryEntry(docA, edited, "Added bases", "manual", 10)!;
    act(() => {
      result.current.updateActiveState(edited, null, true, [entry]);
    });

    expect(result.current.activeProject?.history).toHaveLength(1);
    expect(result.current.activeProject?.history[0]?.label).toBe("Added bases");
  });

  it("adopts the first real sequence name for a placeholder entry", () => {
    const { result } = renderHook(() => useProject());
    act(() => {
      result.current.createProject("Sequence 2");
    });

    act(() => {
      result.current.updateActiveState(docA, null, false);
    });

    expect(result.current.activeProject?.name).toBe("Vector A");
  });

  it("preserves a user-defined entry name when the sequence changes", () => {
    const { result } = renderHook(() => useProject());
    act(() => {
      result.current.createProject("My cloning vector");
      result.current.updateActiveState(docA, null, false);
    });

    expect(result.current.activeProject?.name).toBe("My cloning vector");
  });

  it("imports multiple documents atomically and activates the first", () => {
    const { result } = renderHook(() => useProject());
    let imported: ReturnType<typeof result.current.importDocs> = [];

    act(() => {
      imported = result.current.importDocs([docA, docB]);
    });

    expect(imported).toHaveLength(2);
    expect(result.current.activeId).toBe(imported[0]?.id);
    expect(result.current.activeProject?.doc).toEqual(docA);
    expect(result.current.projects[1]?.doc).toEqual(docB);
  });

  it("activates the next project after deleting the active one", () => {
    const { result } = renderHook(() => useProject());
    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = result.current.createProject("Vector A", docA, "/tmp/a.gb").id;
      secondId = result.current.createProject("Insert B", docB, "/tmp/b.fa").id;
    });

    act(() => {
      result.current.deleteProject(secondId);
    });

    expect(result.current.activeId).toBe(firstId);
    expect(result.current.activeProject).toMatchObject({ id: firstId, filePath: "/tmp/a.gb", doc: docA });
  });

  it("keeps the active project when deleting another project", () => {
    const { result } = renderHook(() => useProject());
    let inactiveId = "";
    let activeId = "";
    act(() => {
      inactiveId = result.current.createProject("Vector A", docA).id;
      activeId = result.current.createProject("Insert B", docB).id;
    });

    act(() => {
      result.current.updateActiveState(docB, "/tmp/current.fa", true);
      result.current.deleteProject(inactiveId);
    });

    expect(result.current.activeId).toBe(activeId);
    expect(result.current.activeProject).toMatchObject({
      filePath: "/tmp/current.fa",
      isDirty: true,
      doc: docB,
    });
  });
});
