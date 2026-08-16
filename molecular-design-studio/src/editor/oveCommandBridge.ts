/**
 * Framework-independent command bridge for a GeneCode OVE editor instance.
 *
 * The bridge deliberately keeps OVE as a rendering/interaction surface. The
 * canonical document remains the source of truth: previews are calculated
 * against a snapshot, and confirmed changes are handed to the canonical
 * callback instead of mutating OVE directly.
 */

import type { OveSequenceData } from "@teselagen/ove";
import { parseAndValidatePatch, validatePatch } from "../agent/patchEngine";
import { fingerprintDocument } from "../agent/fingerprint";
import { buildPreview } from "../agent/preview";
import type {
  PatchPreview,
  SequencePatch,
  SequencePatchOperation,
} from "../agent/patchTypes";
import { fromOveData } from "./adapter";
import { fromOveSelection } from "./selection";
import type { SequenceDocument, SequenceSelection } from "../types";

export type DocumentRevision = string | number;

export type OveView = "map" | "sequence" | "both";

/** Canonical half-open range used by Agent commands. */
export interface OveFocusRange {
  start: number;
  end: number;
  /** A range with start > end crosses the origin of a circular molecule. */
  wrapsOrigin?: boolean;
}

/** The small structural surface required from createVectorEditor(). */
export interface OveLikeEditorInstance {
  getState: () => unknown;
  updateEditor: (values: Record<string, unknown>) => void;
}

/** OVE state exposed to the bridge's revision resolver. */
export type OveEditorState = Readonly<Record<string, unknown>>;

export type OveCommandHook = () => void | Promise<void>;

export interface OveCommandBridgeOptions {
  editor: OveLikeEditorInstance;
  /**
   * Canonical write boundary. The bridge never commits a proposed document
   * anywhere else.
   */
  applyCanonicalDocument: (
    document: SequenceDocument,
    context: OveApplyContext,
  ) => void | Promise<void>;
  /** Optional document revision supplied by the canonical workspace. */
  getDocumentRevision?: (
    state: OveEditorState,
    document: SequenceDocument,
  ) => DocumentRevision | null | undefined;
  onUndo?: OveCommandHook;
  onRedo?: OveCommandHook;
}

export interface OveCommandState {
  readonly rawState: OveEditorState;
  readonly document: SequenceDocument;
  readonly selection: SequenceSelection | null;
  readonly caretPosition: number | null;
  readonly revision: DocumentRevision | null;
  readonly sequenceHash: string;
}

/** A PatchPreview carrying the source snapshot used by this bridge. */
export interface OveCommandPreview extends PatchPreview {
  readonly baseRevision: DocumentRevision | null;
  /** Hash of the document read when this preview was created. */
  readonly sourceHash: string;
}

export interface OveApplyContext {
  readonly patch: SequencePatch;
  readonly preview: OveCommandPreview;
  readonly baseDocument: SequenceDocument;
  readonly baseRevision: DocumentRevision | null;
  readonly currentDocument: SequenceDocument;
  readonly currentRevision: DocumentRevision | null;
}

export type OveApplyResult =
  | {
      ok: true;
      document: SequenceDocument;
      preview: OveCommandPreview;
    }
  | {
      ok: false;
      reason:
        | "preview_required"
        | "invalid_preview"
        | "stale_preview"
        | "apply_failed";
      errors: readonly string[];
    };

export type OveBridgeErrorCode = "invalid_state" | "invalid_range" | "command_unavailable";

export class OveCommandBridgeError extends Error {
  readonly code: OveBridgeErrorCode;

  constructor(code: OveBridgeErrorCode, message: string) {
    super(message);
    this.name = "OveCommandBridgeError";
    this.code = code;
  }
}

interface StoredPreview {
  readonly patch: SequencePatch;
  readonly base: OveCommandState;
  readonly valid: boolean;
}

interface OveSequenceDataLike {
  name?: unknown;
  sequence?: unknown;
  circular?: unknown;
  features?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asState(value: unknown): OveEditorState {
  if (!isRecord(value)) {
    throw new OveCommandBridgeError(
      "invalid_state",
      "OVE editor returned a non-object state",
    );
  }
  return value;
}

function readSequenceData(state: OveEditorState): OveSequenceData {
  const candidate = state.sequenceData;
  if (!isRecord(candidate)) {
    throw new OveCommandBridgeError(
      "invalid_state",
      "OVE editor state does not contain sequenceData",
    );
  }

  const sequenceData = candidate as OveSequenceDataLike;
  if (
    typeof sequenceData.sequence !== "string" ||
    typeof sequenceData.circular !== "boolean" ||
    (sequenceData.features !== undefined &&
      !Array.isArray(sequenceData.features) &&
      !isRecord(sequenceData.features))
  ) {
    throw new OveCommandBridgeError(
      "invalid_state",
      "OVE editor state contains invalid sequenceData",
    );
  }

  return {
    name: typeof sequenceData.name === "string" ? sequenceData.name : "Untitled",
    sequence: sequenceData.sequence,
    circular: sequenceData.circular,
    features: sequenceData.features ?? [],
    ...(typeof sequenceData.stateTrackingId === "string"
      ? { stateTrackingId: sequenceData.stateTrackingId }
      : {}),
  } as OveSequenceData;
}

function readRevision(
  state: OveEditorState,
  sequenceData: OveSequenceData,
  document: SequenceDocument,
  resolver?: OveCommandBridgeOptions["getDocumentRevision"],
): DocumentRevision | null {
  if (resolver) {
    const resolved = resolver(state, document);
    return resolved === undefined ? null : resolved;
  }

  // These names cover a canonical workspace revision and OVE's own tracking
  // id without treating selection/view changes as document revisions.
  for (const key of ["documentRevision", "sequenceRevision", "revision"]) {
    const value = state[key];
    if (
      (typeof value === "string" && value.length > 0) ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return value;
    }
  }
  return typeof sequenceData.stateTrackingId === "string"
    ? sequenceData.stateTrackingId
    : null;
}

function readCaretPosition(state: OveEditorState, documentLength: number): number | null {
  const value = state.caretPosition;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > documentLength) return null;
  return value;
}

function clonePatch(patch: SequencePatch): SequencePatch {
  return {
    schemaVersion: patch.schemaVersion,
    id: patch.id,
    title: patch.title,
    summary: patch.summary,
    baseHash: patch.baseHash,
    operations: patch.operations.map((operation): SequencePatchOperation => {
      switch (operation.kind) {
        case "add_feature":
          return {
            ...operation,
            feature: {
              ...operation.feature,
              qualifiers: Object.fromEntries(
                Object.entries(operation.feature.qualifiers).map(([key, values]) => [
                  key,
                  [...values],
                ]),
              ),
            },
          };
        default:
          return { ...operation };
      }
    }),
  };
}

function makeDisplayPatch(patch: SequencePatch): SequencePatch {
  return {
    schemaVersion: 1,
    id: typeof patch.id === "string" ? patch.id : "invalid-patch",
    title: typeof patch.title === "string" ? patch.title : "Invalid patch",
    summary: typeof patch.summary === "string" ? patch.summary : "Patch could not be validated",
    baseHash: typeof patch.baseHash === "string" ? patch.baseHash : "",
    operations: Array.isArray(patch.operations) ? patch.operations : [],
  };
}

function sameRevision(
  first: DocumentRevision | null,
  second: DocumentRevision | null,
): boolean {
  return first === null || second === null || first === second;
}

function makePanels(view: OveView, circular: boolean): Array<Array<{ id: string; name: string; active: boolean }>> {
  const sequencePanel = [{ id: "sequence", name: "Sequence Map", active: true }];
  const mapPanel = [
    { id: "circular", name: "Circular Map", active: circular },
    { id: "rail", name: "Linear Map", active: !circular },
  ];

  if (view === "sequence") return [sequencePanel];
  if (view === "both") return [sequencePanel, mapPanel];
  return [mapPanel];
}

function rangeError(message: string): never {
  throw new OveCommandBridgeError("invalid_range", message);
}

export class OveCommandBridge {
  readonly commands: Readonly<{ undo: () => Promise<void>; redo: () => Promise<void> }>;

  private readonly options: OveCommandBridgeOptions;
  private readonly previews = new WeakMap<object, StoredPreview>();

  constructor(options: OveCommandBridgeOptions) {
    this.options = options;
    this.commands = Object.freeze({
      undo: () => this.undo(),
      redo: () => this.redo(),
    });
  }

  readCurrentState(): OveCommandState {
    const rawState = asState(this.options.editor.getState());
    const sequenceData = readSequenceData(rawState);
    const result = fromOveData(sequenceData);
    if (!result.ok) {
      throw new OveCommandBridgeError(
        "invalid_state",
        result.errors.map((error) => error.message).join("; "),
      );
    }

    const document = result.doc;
    return {
      rawState,
      document,
      selection: fromOveSelection(rawState.selectionLayer, document),
      caretPosition: readCaretPosition(rawState, document.sequence.length),
      revision: readRevision(rawState, sequenceData, document, this.options.getDocumentRevision),
      sequenceHash: fingerprintDocument(document),
    };
  }

  readCurrentDocument(): SequenceDocument {
    return this.readCurrentState().document;
  }

  setView(view: OveView): void {
    const current = this.readCurrentState();
    this.options.editor.updateEditor({
      panelsShown: makePanels(view, current.document.circular),
    });
  }

  setFocusRange(range: OveFocusRange | null): void {
    const current = this.readCurrentState();
    if (range === null) {
      this.options.editor.updateEditor({
        selectionLayer: { start: -1, end: -1 },
        caretPosition: -1,
      });
      return;
    }

    const length = current.document.sequence.length;
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < 0 ||
      range.start > length ||
      range.end > length
    ) {
      rangeError(`Focus range [${range.start}, ${range.end}) is outside sequence length ${length}`);
    }

    if (range.start === range.end) {
      this.options.editor.updateEditor({
        selectionLayer: { start: -1, end: -1 },
        caretPosition: range.start,
      });
      return;
    }

    if (range.start >= length) {
      rangeError(`A selected range must start before sequence position ${length}`);
    }

    const wrapsOrigin = range.wrapsOrigin === true;
    if (wrapsOrigin) {
      if (!current.document.circular || range.start <= range.end) {
        rangeError("An origin-spanning focus range requires a circular sequence and start > end");
      }
    } else if (range.start >= range.end) {
      rangeError("A non-wrapping focus range must have start < end");
    }

    this.options.editor.updateEditor({
      selectionLayer: {
        start: range.start,
        // OVE uses an inclusive end; the bridge API is half-open.
        // A canonical wrapping range ending at zero contains only the tail of
        // the molecule, so OVE receives the last base as its inclusive end.
        end: wrapsOrigin && range.end === 0 ? length - 1 : range.end - 1,
      },
      caretPosition: -1,
    });
  }

  focusRange(range: OveFocusRange | null): void {
    this.setFocusRange(range);
  }

  previewPatch(patch: SequencePatch): OveCommandPreview {
    const base = this.readCurrentState();
    const parsed = parseAndValidatePatch(patch, base.document);
    const displayPatch = parsed.ok ? parsed.patch : makeDisplayPatch(patch);
    const validation = parsed.ok
      ? parsed.result
      : { ok: false as const, errors: parsed.errors };
    const built = buildPreview(displayPatch, base.document, validation);
    const preview = Object.freeze({
      ...built,
      baseRevision: base.revision,
      sourceHash: base.sequenceHash,
    }) as OveCommandPreview;

    this.previews.set(preview, {
      patch: parsed.ok ? clonePatch(parsed.patch) : clonePatch(displayPatch),
      base,
      valid: parsed.ok && validation.ok,
    });
    return preview;
  }

  async applyConfirmedPatch(preview: OveCommandPreview): Promise<OveApplyResult> {
    const stored = isRecord(preview)
      ? this.previews.get(preview)
      : undefined;
    if (!stored) {
      return {
        ok: false,
        reason: "preview_required",
        errors: ["Apply requires a preview created by this bridge instance"],
      };
    }
    if (!stored.valid || !preview.proposedDocument) {
      return {
        ok: false,
        reason: "invalid_preview",
        errors: preview.errors.length > 0 ? preview.errors : ["Preview is not applicable"],
      };
    }

    const current = this.readCurrentState();
    if (
      current.sequenceHash !== stored.base.sequenceHash ||
      !sameRevision(stored.base.revision, current.revision)
    ) {
      this.previews.delete(preview);
      return {
        ok: false,
        reason: "stale_preview",
        errors: ["Preview is stale: the document changed after it was created"],
      };
    }

    const revalidated = validatePatch({ patch: stored.patch, document: current.document });
    if (!revalidated.ok) {
      this.previews.delete(preview);
      return {
        ok: false,
        reason: "stale_preview",
        errors: revalidated.errors,
      };
    }

    const context: OveApplyContext = {
      patch: stored.patch,
      preview,
      baseDocument: stored.base.document,
      baseRevision: stored.base.revision,
      currentDocument: current.document,
      currentRevision: current.revision,
    };

    try {
      await this.options.applyCanonicalDocument(revalidated.document, context);
    } catch (error) {
      return {
        ok: false,
        reason: "apply_failed",
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    this.previews.delete(preview);
    return { ok: true, document: revalidated.document, preview };
  }

  async undo(): Promise<void> {
    if (!this.options.onUndo) {
      throw new OveCommandBridgeError("command_unavailable", "Undo command is not configured");
    }
    await this.options.onUndo();
  }

  async redo(): Promise<void> {
    if (!this.options.onRedo) {
      throw new OveCommandBridgeError("command_unavailable", "Redo command is not configured");
    }
    await this.options.onRedo();
  }
}

export function createOveCommandBridge(options: OveCommandBridgeOptions): OveCommandBridge {
  return new OveCommandBridge(options);
}
