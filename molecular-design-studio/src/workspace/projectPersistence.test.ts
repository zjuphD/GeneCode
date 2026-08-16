import { describe, expect, it, vi, afterEach } from "vitest";
import type { SequenceDocument } from "../types";
import { createDocumentHistoryEntry } from "./documentHistory";
import {
  parseProjectFile,
  serializeProjectFile,
  saveProjects,
  loadProjects,
  type PersistedProjects,
} from "./projectPersistence";

// canPersist() gates on import.meta.env.MODE — flip it so the localStorage
// paths are exercised in the persistence-specific tests below.
const ORIGINAL_MODE = import.meta.env.MODE;
function enablePersistence() {
  vi.stubEnv("MODE", "development");
}
function restoreMode() {
  vi.stubEnv("MODE", ORIGINAL_MODE);
}

afterEach(() => {
  restoreMode();
  window.localStorage.clear();
  vi.unstubAllEnvs();
});
const vector: SequenceDocument = {
  name: "pTest",
  sequence: "AACCGGTT",
  circular: true,
  features: [
    {
      id: "amp",
      name: "AmpR",
      type: "CDS",
      start: 1,
      end: 7,
      strand: 1,
      qualifiers: { label: ["AmpR"] },
      color: "#4a90d9",
    },
  ],
};

function state(): PersistedProjects {
  const edited = { ...vector, sequence: "AACCGGTTA" };
  const history = createDocumentHistoryEntry(vector, edited, "Added base", "manual", 10);
  return {
    version: 1,
    activeId: "vector-project",
    projects: [
      {
        id: "vector-project",
        name: "pTest project",
        doc: vector,
        filePath: "/Users/example/pTest.gb",
        isDirty: true,
        history: history ? [history] : [],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  };
}

describe("saveProjects result (A-DATA-001)", () => {
  it("returns ok with byte size on a successful write", () => {
    enablePersistence();
    const result = saveProjects(state());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes).toBeGreaterThan(0);
    }
  });

  it("reports a quota failure instead of swallowing it", () => {
    enablePersistence();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    });
    const result = saveProjects(state());
    spy.mockRestore();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("quota");
      expect(result.message).toContain("storage is full");
    }
  });

  it("round-trips compacted delta history through localStorage", () => {
    enablePersistence();
    const before = { ...vector, sequence: "AACCGGTT" };
    const after = { ...vector, sequence: "AACCGGTTA" };
    const history = createDocumentHistoryEntry(before, after, "Added base", "manual", 10);
    const value = {
      ...state(),
      projects: [
        {
          ...state().projects[0]!,
          doc: after,
          history: history ? [history] : [],
        },
      ],
    };
    expect(saveProjects(value).ok).toBe(true);

    const loaded = loadProjects();
    expect(loaded).not.toBeNull();
    expect(loaded!.projects[0]!.doc).toEqual(after);
    expect(loaded!.projects[0]!.history[0]!.after).toEqual(after);
    expect(loaded!.projects[0]!.history[0]!.before).toEqual(before);
  });

  it("returns null for corrupted storage instead of a half-parsed cast", () => {
    enablePersistence();
    window.localStorage.setItem(
      "molecular-design-studio.projects.v1",
      JSON.stringify({ version: 1, activeId: "x", projects: [{ garbage: true }] }),
    );
    expect(loadProjects()).toBeNull();
  });

  it("salvages valid projects when one autosave entry is corrupt", () => {
    enablePersistence();
    const good = state().projects[0]!;
    window.localStorage.setItem(
      "molecular-design-studio.projects.v1",
      JSON.stringify({
        version: 1,
        activeId: "vector-project",
        projects: [good, { id: "corrupt", name: "broken", doc: { garbage: true } }],
      }),
    );
    const loaded = loadProjects();
    expect(loaded).not.toBeNull();
    expect(loaded!.projects).toHaveLength(1);
    expect(loaded!.projects[0]!.id).toBe("vector-project");
  });

  it("returns null for a version mismatch", () => {
    enablePersistence();
    window.localStorage.setItem(
      "molecular-design-studio.projects.v1",
      JSON.stringify({ version: 999, activeId: "x", projects: [] }),
    );
    expect(loadProjects()).toBeNull();
  });

  it("returns null when storage is disabled", () => {
    enablePersistence();
    window.localStorage.getItem = vi.fn(() => {
      throw new Error("Access denied");
    });
    expect(loadProjects()).toBeNull();
  });
});

describe("project file persistence", () => {
  it("round-trips projects, annotations, and history in a portable bundle", () => {
    const serialized = serializeProjectFile(state());
    const parsed = parseProjectFile(serialized);

    expect(JSON.parse(serialized)).toMatchObject({
      format: "genecode.project",
      version: 1,
    });
    expect(parsed.activeId).toBe("vector-project");
    expect(parsed.projects[0]).toMatchObject({
      name: "pTest project",
      filePath: null,
      isDirty: false,
    });
    expect(parsed.projects[0]?.doc).toEqual(vector);
    expect(parsed.projects[0]?.history[0]?.label).toBe("Added base");
  });

  // A-DATA-001: the portable file carries history as before + delta (one full
  // snapshot per entry), and parseProjectFile reconstructs the `after` doc.
  it("compacts history to delta in the portable file and restores it", () => {
    const before = { ...vector, sequence: "AACCGGTT" };
    const after = { ...vector, sequence: "AACCGGTTA" };
    const history = createDocumentHistoryEntry(before, after, "Added base", "manual", 10);
    const serialized = serializeProjectFile({
      ...state(),
      projects: [
        {
          ...state().projects[0]!,
          doc: after,
          history: history ? [history] : [],
        },
      ],
    });

    // The persisted history entry must be before + delta, not two full docs.
    const raw = JSON.parse(serialized) as { state: PersistedProjects };
    const persistedHistory = raw.state.projects[0]!.history as unknown as Array<Record<string, unknown>>;
    expect(persistedHistory[0]).toMatchObject({ before: before });
    expect((persistedHistory[0]!.delta as { sequence: unknown }).sequence).toBeDefined();
    expect((persistedHistory[0]! as { after?: unknown }).after).toBeUndefined();

    const parsed = parseProjectFile(serialized);
    expect(parsed.projects[0]!.doc).toEqual(after);
    expect(parsed.projects[0]!.history[0]!.after).toEqual(after);
    expect(parsed.projects[0]!.history[0]!.before).toEqual(before);
  });

  it("still parses legacy history entries with full before/after docs", () => {
    const legacy = {
      format: "genecode.project",
      version: 1,
      savedAt: new Date().toISOString(),
      state: {
        version: 1,
        activeId: "vector-project",
        projects: [
          {
            ...state().projects[0]!,
            history: [
              {
                id: "h1",
                label: "Legacy edit",
                source: "manual",
                timestamp: 1,
                before: vector,
                after: { ...vector, sequence: "AACCGGTTA" },
                beforeHash: "b",
                afterHash: "a",
              },
            ],
          },
        ],
      },
    };
    const parsed = parseProjectFile(JSON.stringify(legacy));
    expect(parsed.projects[0]!.history[0]!.after.sequence).toBe("AACCGGTTA");
    expect(parsed.projects[0]!.history[0]!.label).toBe("Legacy edit");
  });

  it("normalizes sequence whitespace and repairs a missing active id", () => {
    const serialized = serializeProjectFile(state());
    const raw = JSON.parse(serialized) as { state: PersistedProjects };
    raw.state.activeId = "missing";
    raw.state.projects[0]!.doc.sequence = " aac cggt ";

    const parsed = parseProjectFile(JSON.stringify({
      format: "genecode.project",
      version: 1,
      savedAt: new Date().toISOString(),
      state: raw.state,
    }));

    expect(parsed.activeId).toBe("vector-project");
    expect(parsed.projects[0]?.doc.sequence).toBe("AACCGGT");
  });

  it("rejects malformed or unsupported project files", () => {
    expect(() => parseProjectFile("not json")).toThrow("not valid JSON");
    expect(() => parseProjectFile(JSON.stringify({ format: "other", version: 1 }))).toThrow("supported GeneCode project");
    expect(() => parseProjectFile(JSON.stringify({
      format: "genecode.project",
      version: 1,
      state: { version: 1, activeId: null, projects: [] },
    }))).toThrow("does not contain any sequences");
  });

  it("rejects annotations outside the sequence bounds", () => {
    const raw = JSON.parse(serializeProjectFile(state())) as { state: PersistedProjects };
    raw.state.projects[0]!.doc.features[0]!.end = 999;
    expect(() => parseProjectFile(JSON.stringify({
      format: "genecode.project",
      version: 1,
      savedAt: new Date().toISOString(),
      state: raw.state,
    }))).toThrow("outside the sequence bounds");
  });

  // A-BIO-004: an origin-spanning feature (start > end + segments) survives
  // the project-file round-trip with its segments intact.
  it("preserves origin-spanning feature segments in a round-trip", () => {
    const wrapDoc: SequenceDocument = {
      name: "pWrap",
      sequence: "A".repeat(100),
      circular: true,
      features: [
        {
          id: "wrapGene",
          name: "wrapGene",
          type: "gene",
          start: 90,
          end: 10,
          strand: 1,
          qualifiers: {},
          segments: [
            { start: 90, end: 100 },
            { start: 0, end: 10 },
          ],
        },
      ],
    };
    const serialized = serializeProjectFile({
      version: 1,
      activeId: "wrap-project",
      projects: [
        {
          id: "wrap-project",
          name: "wrap project",
          doc: wrapDoc,
          filePath: null,
          isDirty: true,
          history: [],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    const parsed = parseProjectFile(serialized);
    const feature = parsed.projects[0]?.doc.features[0];
    expect(feature).toBeDefined();
    expect(feature!.start).toBe(90);
    expect(feature!.end).toBe(10);
    expect(feature!.segments).toEqual([
      { start: 90, end: 100 },
      { start: 0, end: 10 },
    ]);
  });
});
