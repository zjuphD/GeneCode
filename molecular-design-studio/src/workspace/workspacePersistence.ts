import type { SequenceDocument } from "../types";
import { clearDurable } from "./durablePersistence";

const STORAGE_KEY = "molecular-design-studio.workspace.v1";
const WORKSPACE_SCHEMA_VERSION = 1;

export interface PersistedWorkspace {
  schemaVersion: 1;
  version: 1;
  savedAt: number;
  doc: SequenceDocument;
  filePath: string | null;
  isDirty: boolean;
}

/**
 * Result of a localStorage write (A-DATA-001). Never swallowed: the caller
 * decides how to surface the failure.
 */
export type PersistResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: "quota" | "disabled" | "error"; message: string };

function canPersist(): boolean {
  return typeof window !== "undefined" && import.meta.env.MODE !== "test";
}

/**
 * Validate a parsed workspace payload against the schema contract.
 * A payload with an unknown version, missing fields, or a malformed document
 * is rejected outright (returns null) rather than partially trusted.
 */
function isValidWorkspace(value: unknown): value is PersistedWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  // A-DATA-001: reject unknown future schemas, but accept legacy payloads
  // written before schemaVersion existed (they are the v1 layout — version
  // and the doc shape are the real contract).
  if (
    record.schemaVersion !== undefined &&
    record.schemaVersion !== WORKSPACE_SCHEMA_VERSION
  ) {
    return false;
  }
  if (record.version !== 1) return false;
  const doc = record.doc;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const docRecord = doc as Record<string, unknown>;
  const sequence = docRecord.sequence;
  const features = docRecord.features;
  const name = docRecord.name;
  if (typeof sequence !== "string" || !Array.isArray(features)) return false;
  if (typeof name !== "string") return false;
  if (typeof record.savedAt !== "number") return false;
  return true;
}

export function loadWorkspace(): PersistedWorkspace | null {
  if (!canPersist()) return null;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!isValidWorkspace(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Validate a payload recovered from the IndexedDB mirror. */
export function parsePersistedWorkspace(value: unknown): PersistedWorkspace | null {
  return isValidWorkspace(value) ? value : null;
}

export function saveWorkspace(value: PersistedWorkspace): PersistResult {
  if (!canPersist()) return { ok: true, bytes: 0 };
  try {
    const serialized = JSON.stringify(value);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true, bytes: serialized.length };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      return {
        ok: false,
        reason: "quota",
        message: "Autosave: browser storage is full — save a copy to a file to avoid data loss.",
      };
    }
    return {
      ok: false,
      reason: "error",
      message: `Autosave failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function clearWorkspace(): void {
  if (!canPersist()) return;
  window.localStorage.removeItem(STORAGE_KEY);
  void clearDurable("workspace").catch(() => undefined);
}
