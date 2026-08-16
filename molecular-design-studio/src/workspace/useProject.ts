/**
 * useProject — manages multiple sequences/projects.
 *
 * Provides project list CRUD, active project switching, and syncs
 * the active project's doc to the workspace.
 */

import { useState, useCallback, useEffect } from "react";
import type { SequenceDocument } from "../types";
import type { DocumentHistoryEntry } from "./documentHistory";
import {
  loadProjects,
  parsePersistedProjects,
  saveProjects,
  generateProjectId,
  type ProjectEntry,
  type PersistedProjects,
} from "./projectPersistence";
import { readDurable, writeDurable } from "./durablePersistence";

const EMPTY_DOC: SequenceDocument = {
  name: "Untitled",
  sequence: "",
  circular: false,
  features: [],
};

export interface ProjectState {
  projects: ProjectEntry[];
  activeId: string | null;
  activeProject: ProjectEntry | null;
  /** True until the IndexedDB project mirror has either recovered or been ruled out. */
  isRestoring: boolean;
  /** Last autosave failure message, or null when the last save succeeded. */
  saveError: string | null;
  /** Timestamp of the last successful autosave, or null before any save. */
  lastSavedAt: number | null;
}

export interface ProjectActions {
  /** Create a new project and make it active. */
  createProject: (name: string, doc?: SequenceDocument, filePath?: string | null, isDirty?: boolean) => ProjectEntry;
  /** Switch to a different project by id. */
  switchProject: (id: string) => ProjectEntry | null;
  /** Rename a project. */
  renameProject: (id: string, name: string) => void;
  /** Delete a project and choose a fallback active id when needed. */
  deleteProject: (id: string) => void;
  /** Persist the complete active workspace state. */
  updateActiveState: (
    doc: SequenceDocument,
    filePath: string | null,
    isDirty: boolean,
    history?: DocumentHistoryEntry[],
  ) => void;
  /** Build a portable snapshot with the latest workspace state included. */
  getPersistedState: (
    doc: SequenceDocument,
    filePath: string | null,
    isDirty: boolean,
    history: DocumentHistoryEntry[],
  ) => PersistedProjects;
  /** Replace the project library from a validated portable project file. */
  importPersistedState: (value: PersistedProjects) => ProjectEntry | null;
  /** Import one document as a new project. */
  importDoc: (doc: SequenceDocument, filePath?: string | null) => ProjectEntry;
  /** Import multiple documents atomically and activate the first. */
  importDocs: (docs: SequenceDocument[]) => ProjectEntry[];
}

export function useProject(): ProjectState & ProjectActions {
  const [initial] = useState(() => {
    const loaded = loadProjects();
    return {
      state: loaded ?? { version: 1 as const, activeId: null, projects: [] },
      fromLocalStorage: loaded !== null || import.meta.env.MODE === "test",
    };
  });
  const [library, setLibrary] = useState<PersistedProjects>(initial.state);
  const [durableHydrated, setDurableHydrated] = useState(initial.fromLocalStorage);
  // A-DATA-001: surface the autosave result instead of swallowing it, so the
  // UI can refuse to show "Saved locally" and offer a recovery export.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // If the synchronous cache was lost or corrupted, recover the last atomic
  // IndexedDB snapshot before allowing autosave to write an empty library over
  // it. A user-created project wins over a late recovery result.
  useEffect(() => {
    if (durableHydrated) return;
    let cancelled = false;
    void readDurable<PersistedProjects>("projects").then((record) => {
      if (cancelled) return;
      const recovered = parsePersistedProjects(record?.payload);
      if (recovered) {
        setLibrary((current) => current.projects.length === 0 ? recovered : current);
      }
      setDurableHydrated(true);
    });
    return () => { cancelled = true; };
  }, [durableHydrated]);

  // Persist on every change
  useEffect(() => {
    if (!durableHydrated) return;
    const result = saveProjects(library);
    if (result.ok) {
      if (import.meta.env.MODE !== "test") {
        setSaveError(null);
        setLastSavedAt(Date.now());
      }
    } else {
      setSaveError(result.message);
    }
    if (result.ok) {
      void writeDurable("projects", library).catch((error: unknown) => {
        setSaveError(`Durable autosave failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }, [durableHydrated, library]);

  const activeProject = library.projects.find((p) => p.id === library.activeId) ?? null;

  const createProject = useCallback((
    name: string,
    doc?: SequenceDocument,
    filePath: string | null = null,
    isDirty = false,
  ): ProjectEntry => {
    const id = generateProjectId();
    const now = Date.now();
    const entry: ProjectEntry = {
      id,
      name,
      doc: doc ?? { ...EMPTY_DOC, name },
      filePath,
      isDirty,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    setLibrary((prev) => ({
      ...prev,
      activeId: id,
      projects: [...prev.projects, entry],
    }));
    return entry;
  }, []);

  const switchProject = useCallback((id: string): ProjectEntry | null => {
    // Read current state synchronously to return the doc
    const project = library.projects.find((p) => p.id === id);
    if (!project) return null;
    setLibrary((prev) => ({ ...prev, activeId: id }));
    return project;
  }, [library.projects]);

  const renameProject = useCallback((id: string, name: string) => {
    setLibrary((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === id ? { ...p, name, updatedAt: Date.now() } : p
      ),
    }));
  }, []);

  const deleteProject = useCallback((id: string): void => {
    setLibrary((prev) => {
      const remaining = prev.projects.filter((p) => p.id !== id);
      const nextId = prev.activeId === id ? (remaining[0]?.id ?? null) : prev.activeId;
      return { ...prev, activeId: nextId, projects: remaining };
    });
  }, []);

  const updateActiveState = useCallback((
    doc: SequenceDocument,
    filePath: string | null,
    isDirty: boolean,
    history?: DocumentHistoryEntry[],
  ) => {
    setLibrary((prev) => {
      if (!prev.activeId) return prev;
      const active = prev.projects.find((p) => p.id === prev.activeId);
      const shouldAdoptDocumentName = Boolean(
        active &&
        doc.sequence.length > 0 &&
        /^(Sequence \d+|Untitled|Empty)$/.test(active.name),
      );
      const nextName = shouldAdoptDocumentName ? doc.name || active?.name : active?.name;
      if (
        active &&
        active.doc === doc &&
        active.filePath === filePath &&
        active.isDirty === isDirty &&
        (history === undefined || active.history === history) &&
        active.name === nextName
      ) {
        return prev;
      }
      return {
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === prev.activeId
            ? {
                ...p,
                name: p.id === active?.id ? nextName ?? p.name : p.name,
                doc,
                filePath,
                isDirty,
                history: history ?? p.history,
                updatedAt: Date.now(),
              }
            : p
        ),
      };
    });
  }, []);

  const getPersistedState = useCallback((
    doc: SequenceDocument,
    filePath: string | null,
    isDirty: boolean,
    history: DocumentHistoryEntry[],
  ): PersistedProjects => {
    const projects = library.projects.map((project) =>
      project.id === library.activeId
        ? {
            ...project,
            doc,
            filePath,
            isDirty,
            history,
            updatedAt: Date.now(),
          }
        : project,
    );
    return { version: 1, activeId: library.activeId, projects };
  }, [library]);

  const importPersistedState = useCallback((value: PersistedProjects): ProjectEntry | null => {
    const activeId = value.projects.some((project) => project.id === value.activeId)
      ? value.activeId
      : (value.projects[0]?.id ?? null);
    const nextState: PersistedProjects = { version: 1, activeId, projects: value.projects };
    setLibrary(nextState);
    return nextState.projects.find((project) => project.id === activeId) ?? null;
  }, []);

  const importDoc = useCallback((doc: SequenceDocument, filePath: string | null = null): ProjectEntry => {
    return createProject(doc.name || "Imported sequence", doc, filePath, false);
  }, [createProject]);

  const importDocs = useCallback((docs: SequenceDocument[]): ProjectEntry[] => {
    const now = Date.now();
    const entries = docs.map((doc, index): ProjectEntry => ({
      id: generateProjectId(),
      name: doc.name || `Imported sequence ${index + 1}`,
      doc,
      filePath: null,
      isDirty: false,
      history: [],
      createdAt: now + index,
      updatedAt: now + index,
    }));
    const first = entries[0];
    if (!first) return [];
    setLibrary((prev) => ({
      ...prev,
      activeId: first.id,
      projects: [...prev.projects, ...entries],
    }));
    return entries;
  }, []);

  return {
    projects: library.projects,
    activeId: library.activeId,
    activeProject,
    isRestoring: !durableHydrated,
    saveError,
    lastSavedAt,
    createProject,
    switchProject,
    renameProject,
    deleteProject,
    updateActiveState,
    getPersistedState,
    importPersistedState,
    importDoc,
    importDocs,
  };
}
