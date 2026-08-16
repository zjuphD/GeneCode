/**
 * Project persistence — manages multiple sequences/projects in localStorage
 * and provides a portable GeneCode project-file format.
 *
 * Each project has a unique id, display name, and a SequenceDocument.
 * The active project's doc is synced to the workspace.
 */

import type { FeatureSegment, SequenceDocument, SequenceFeature } from "../types";
import { isWrappingFeature } from "../editor/featureSegments";
import type { DocumentHistoryEntry } from "./documentHistory";
import {
  fromPersistedHistoryEntry,
  toPersistedHistoryEntry,
  type PersistedHistoryEntry,
} from "./documentHistory";
import { clearDurable } from "./durablePersistence";

function normalizeSegments(value: unknown, start: number, end: number, sequenceLength: number): FeatureSegment[] | undefined {
  if (value === undefined || value === null) {
    // Legacy single-span feature. A stored start > end implies a wrap location.
    if (isWrappingFeature({ start, end })) {
      if (end <= 0 || end >= sequenceLength || start >= sequenceLength) {
        // Degenerate wrap (empty head/tail piece) — treat as invalid rather
        // than persisting a zero-width segment.
        return undefined;
      }
      return [{ start, end: sequenceLength }, { start: 0, end }];
    }
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const segments: FeatureSegment[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return undefined;
    const segStart = Number(raw.start);
    const segEnd = Number(raw.end);
    if (
      !Number.isInteger(segStart) || !Number.isInteger(segEnd) ||
      segStart < 0 || segEnd <= segStart || segEnd > sequenceLength
    ) {
      return undefined;
    }
    segments.push({ start: segStart, end: segEnd });
  }
  return segments.length > 1 ? segments : undefined;
}

const PROJECT_STORAGE_KEY = "molecular-design-studio.projects.v1";
const MAX_PERSISTED_HISTORY = 10;

export const PROJECT_FILE_FORMAT = "genecode.project";
export const PROJECT_FILE_VERSION = 1;

/**
 * Result of a localStorage write (A-DATA-001). A failure is never swallowed:
 * the caller must decide how to surface it (block "saved", offer recovery
 * export) instead of assuming the write succeeded.
 */
export type PersistResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: "quota" | "disabled" | "error"; message: string };

function persistResultFromError(error: unknown, context: string): PersistResult {
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return {
      ok: false,
      reason: "quota",
      message: `${context}: browser storage is full — save a copy to a file to avoid data loss.`,
    };
  }
  return {
    ok: false,
    reason: "error",
    message: `${context}: storage write failed — ${error instanceof Error ? error.message : String(error)}`,
  };
}

export interface ProjectEntry {
  id: string;
  name: string;
  doc: SequenceDocument;
  filePath: string | null;
  isDirty: boolean;
  history: DocumentHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface PersistedProjects {
  version: 1;
  activeId: string | null;
  projects: ProjectEntry[];
}

export interface ProjectFileEnvelope {
  format: typeof PROJECT_FILE_FORMAT;
  version: typeof PROJECT_FILE_VERSION;
  savedAt: string;
  state: PersistedProjects;
}

const HISTORY_SOURCES = new Set<DocumentHistoryEntry["source"]>([
  "manual",
  "agent",
  "annotation",
  "selection",
  "history",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeQualifiers(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, rawValues]) => {
      if (Array.isArray(rawValues)) {
        return [[key, rawValues.filter((item): item is string => typeof item === "string")]];
      }
      if (typeof rawValues === "string") return [[key, [rawValues]]];
      return [];
    }),
  );
}

function normalizeDocument(value: unknown, label: string): SequenceDocument {
  if (!isRecord(value) || typeof value.sequence !== "string") {
    throw new Error(`${label} does not contain a valid sequence document.`);
  }

  const sequence = value.sequence.replace(/\s+/g, "").toUpperCase();
  const rawFeatures = Array.isArray(value.features) ? value.features : [];
  const features = rawFeatures.map((rawFeature, index) => {
    if (!isRecord(rawFeature)) {
      throw new Error(`${label} contains an invalid annotation at index ${index}.`);
    }
    const start = Number(rawFeature.start);
    const end = Number(rawFeature.end);
    // A-BIO-004: origin-spanning features are stored with start > end and an
    // explicit segments list; both must be validated, never rejected outright.
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > sequence.length) {
      throw new Error(`${label} contains an annotation outside the sequence bounds.`);
    }
    const wrapping = isWrappingFeature({ start, end });
    if (!wrapping && end < start) {
      // defensive: a linear-style feature with end < start and no segments is invalid
      throw new Error(`${label} contains an annotation outside the sequence bounds.`);
    }
    const segments = normalizeSegments(rawFeature.segments, start, end, sequence.length);
    if (segments === undefined && wrapping) {
      throw new Error(`${label} contains an invalid origin-spanning annotation.`);
    }
    if (wrapping && end >= sequence.length) {
      throw new Error(`${label} contains an annotation outside the sequence bounds.`);
    }
    const strand: SequenceFeature["strand"] = rawFeature.strand === -1 ? -1 : 1;
    return {
      id: typeof rawFeature.id === "string" && rawFeature.id.trim() ? rawFeature.id : `feature_${index + 1}`,
      name: typeof rawFeature.name === "string" ? rawFeature.name : "Untitled feature",
      type: typeof rawFeature.type === "string" ? rawFeature.type : "misc_feature",
      start,
      end,
      strand,
      qualifiers: normalizeQualifiers(rawFeature.qualifiers),
      ...(typeof rawFeature.color === "string" ? { color: rawFeature.color } : {}),
      ...(segments ? { segments } : {}),
    };
  });

  return {
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Untitled",
    sequence,
    circular: value.circular === true,
    features,
    ...(typeof value.accession === "string" ? { accession: value.accession } : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
  };
}

function normalizeHistoryEntry(value: unknown): DocumentHistoryEntry | null {
  if (!isRecord(value) || !isRecord(value.before)) return null;
  try {
    const before = normalizeDocument(value.before, "History entry");
    const source = HISTORY_SOURCES.has(value.source as DocumentHistoryEntry["source"])
      ? value.source as DocumentHistoryEntry["source"]
      : "manual";
    const base = {
      id: typeof value.id === "string" && value.id.trim() ? value.id : `history_${Date.now()}`,
      label: typeof value.label === "string" ? value.label : "Document change",
      source,
      timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : Date.now(),
      beforeHash: typeof value.beforeHash === "string" ? value.beforeHash : "",
      afterHash: typeof value.afterHash === "string" ? value.afterHash : "",
    };
    // A-DATA-001: persisted entries are compacted to before + delta (and
    // legacy entries with both full docs are still accepted).
    if (isRecord(value.delta)) {
      const expanded = fromPersistedHistoryEntry({
        ...base,
        before,
        delta: value.delta as PersistedHistoryEntry["delta"],
      });
      return {
        ...base,
        before: expanded.before,
        after: expanded.after,
      };
    }
    if (!isRecord(value.after)) return null;
    const after = normalizeDocument(value.after, "History entry");
    return { ...base, before, after };
  } catch {
    return null;
  }
}

function normalizeProjectState(value: unknown, allowEmpty = false): PersistedProjects {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects)) {
    throw new Error("This is not a valid GeneCode project file.");
  }

  const usedIds = new Set<string>();
  const projects = value.projects.map((rawProject, index): ProjectEntry => {
    if (!isRecord(rawProject)) {
      throw new Error(`Project ${index + 1} is invalid.`);
    }
    const doc = normalizeDocument(rawProject.doc, `Project ${index + 1}`);
    let id = typeof rawProject.id === "string" && rawProject.id.trim()
      ? rawProject.id
      : generateProjectId();
    while (usedIds.has(id)) id = generateProjectId();
    usedIds.add(id);
    const rawHistory = Array.isArray(rawProject.history) ? rawProject.history : [];
    const history = rawHistory
      .map(normalizeHistoryEntry)
      .filter((entry): entry is DocumentHistoryEntry => entry !== null)
      .slice(-MAX_PERSISTED_HISTORY);
    const now = Date.now();
    return {
      id,
      name: typeof rawProject.name === "string" && rawProject.name.trim()
        ? rawProject.name
        : doc.name || `Sequence ${index + 1}`,
      doc,
      // Source files are not portable. The project file contains the document itself.
      filePath: null,
      isDirty: false,
      history,
      createdAt: Number.isFinite(Number(rawProject.createdAt)) ? Number(rawProject.createdAt) : now,
      updatedAt: Number.isFinite(Number(rawProject.updatedAt)) ? Number(rawProject.updatedAt) : now,
    };
  });

  if (!allowEmpty && projects.length === 0) {
    throw new Error("This GeneCode project file does not contain any sequences.");
  }
  const requestedActiveId = typeof value.activeId === "string" ? value.activeId : null;
  const activeId = projects.some((project) => project.id === requestedActiveId)
    ? requestedActiveId
    : (projects[0]?.id ?? null);
  return { version: 1, activeId, projects };
}

/**
 * A-DATA-001: salvage-mode reader for localStorage. Unlike parseProjectFile
 * (strict — a corrupt imported file should fail loudly), a corrupt autosave
 * entry must not wipe the whole library: per-project validation drops only the
 * invalid project and keeps the rest. Returns null only when nothing survives.
 */
function salvageProjectState(value: unknown): PersistedProjects | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects)) {
    return null;
  }
  try {
    return normalizeProjectState(value, true);
  } catch {
    // Whole-bundle failure (e.g. activeId/top-level corruption): try to keep
    // whatever individual projects still validate.
    const usedIds = new Set<string>();
    const projects: ProjectEntry[] = [];
    const now = Date.now();
    for (const rawProject of value.projects) {
      try {
        if (!isRecord(rawProject) || !isRecord(rawProject.doc)) continue;
        const doc = normalizeDocument(rawProject.doc, "Saved project");
        let id = typeof rawProject.id === "string" && rawProject.id.trim()
          ? rawProject.id
          : generateProjectId();
        while (usedIds.has(id)) id = generateProjectId();
        usedIds.add(id);
        const history = (Array.isArray(rawProject.history) ? rawProject.history : [])
          .map(normalizeHistoryEntry)
          .filter((entry): entry is DocumentHistoryEntry => entry !== null)
          .slice(-MAX_PERSISTED_HISTORY);
        projects.push({
          id,
          name: typeof rawProject.name === "string" && rawProject.name.trim()
            ? rawProject.name
            : doc.name || `Sequence ${projects.length + 1}`,
          doc,
          filePath: null,
          isDirty: false,
          history,
          createdAt: Number.isFinite(Number(rawProject.createdAt)) ? Number(rawProject.createdAt) : now,
          updatedAt: Number.isFinite(Number(rawProject.updatedAt)) ? Number(rawProject.updatedAt) : now,
        });
      } catch {
        // Drop just this project; keep the rest of the library.
      }
    }
    if (projects.length === 0) return null;
    const requestedActiveId = typeof value.activeId === "string" ? value.activeId : null;
    return {
      version: 1,
      activeId: projects.some((p) => p.id === requestedActiveId)
        ? requestedActiveId
        : (projects[0]?.id ?? null),
      projects,
    };
  }
}

function canPersist(): boolean {
  return typeof window !== "undefined" && import.meta.env.MODE !== "test";
}

export function loadProjects(): PersistedProjects | null {
  if (!canPersist()) return null;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PROJECT_STORAGE_KEY) ?? "null");
    // A-DATA-001: route the raw payload through the full schema validation
    // (versions, document shape, feature ranges, delta history). A corrupt
    // autosave entry salvages the valid projects instead of wiping the library.
    return salvageProjectState(raw);
  } catch {
    return null;
  }
}

/** Validate a payload recovered from the IndexedDB mirror using the same
 * salvage rules as the synchronous localStorage cache. */
export function parsePersistedProjects(value: unknown): PersistedProjects | null {
  return salvageProjectState(value);
}

export function saveProjects(value: PersistedProjects): PersistResult {
  if (!canPersist()) return { ok: true, bytes: 0 };
  try {
    const serialized = serializeForStorage(value);
    window.localStorage.setItem(PROJECT_STORAGE_KEY, serialized);
    return { ok: true, bytes: serialized.length };
  } catch (error) {
    return persistResultFromError(error, "Autosave");
  }
}

/**
 * Serialize a project bundle for localStorage: history entries are compacted
 * to before + delta (A-DATA-001) so quota pressure from repeated snapshots is
 * dramatically reduced. `before` is cloned so later in-memory mutation of the
 * live doc never corrupts the persisted payload.
 */
function serializeForStorage(value: PersistedProjects): string {
  return JSON.stringify({
    version: 1,
    activeId: value.activeId,
    projects: value.projects.map((project) => ({
      id: project.id,
      name: project.name,
      doc: project.doc,
      filePath: project.filePath,
      isDirty: project.isDirty,
      history: project.history
        .slice(-MAX_PERSISTED_HISTORY)
        .map(toPersistedHistoryEntry),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
  });
}

export function clearProjects(): void {
  if (!canPersist()) return;
  window.localStorage.removeItem(PROJECT_STORAGE_KEY);
  void clearDurable("projects").catch(() => undefined);
}

export function generateProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Serialize a portable project bundle. Sequence source paths are intentionally
 * omitted because the documents and their annotations are embedded in the file.
 */
export function serializeProjectFile(value: PersistedProjects): string {
  const state: PersistedProjects = {
    version: 1,
    activeId: value.projects.some((project) => project.id === value.activeId)
      ? value.activeId
      : (value.projects[0]?.id ?? null),
    // History is compacted to before + delta in the portable file too
    // (A-DATA-001), so a busy document with 50 history snapshots stays small.
    projects: value.projects.map((project) => ({
      ...project,
      filePath: null,
      isDirty: false,
      history: project.history
        .slice(-MAX_PERSISTED_HISTORY)
        .map(toPersistedHistoryEntry) as unknown as DocumentHistoryEntry[],
    })),
  };
  const envelope: ProjectFileEnvelope = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    state,
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** Parse and validate a portable GeneCode project bundle. */
export function parseProjectFile(contents: string): PersistedProjects {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error("GeneCode project file is not valid JSON.");
  }
  if (!isRecord(raw) || raw.format !== PROJECT_FILE_FORMAT || raw.version !== PROJECT_FILE_VERSION) {
    throw new Error("This file is not a supported GeneCode project (.genecode.json).");
  }
  return normalizeProjectState(raw.state);
}
