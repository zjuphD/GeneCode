/**
 * Minimal ambient declarations for OVE and bio-parsers.
 * These are narrow — each module gets only what the adapter actually uses.
 */

// The project intentionally ships no Node typings (browser code), but vitest
// runs tests under Node; the ABI fixture test reads the committed .ab1 from
// disk. Declare just the two APIs it uses.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}
declare module "node:path" {
  export function resolve(...segments: string[]): string;
}
declare const process: { cwd(): string };

declare module "@teselagen/ove" {
  import type { ComponentType } from "react";

  export interface OveFeature {
    id: string;
    name: string;
    type: string;
    start: number;
    end: number;
    strand: number;
    color?: string;
    forward?: boolean;
    notes?: Record<string, string[]>;
    /**
     * Multi-segment (joined) sub-ranges in OVE's zero-based inclusive
     * convention. The engine renders each location as its own arc / span and
     * a `start > end` range spans the circular origin (A-BIO-004).
     */
    locations?: Array<{ start: number; end: number }>;
  }

  export interface OveSequenceData {
    name: string;
    sequence: string;
    circular: boolean;
    features: OveFeature[];
    stateTrackingId?: string;
  }

  export interface SimpleCircularOrLinearViewProps {
    sequenceData: OveSequenceData;
    annotationVisibility?: Record<string, boolean>;
    width?: number;
    height?: number;
    editorName?: string;
  }

  export const SimpleCircularOrLinearView: ComponentType<SimpleCircularOrLinearViewProps>;
  export const GeneCodeSequencePanel: ComponentType<Record<string, unknown>>;

  /** Return type of createVectorEditor. */
  export interface OveEditorInstance {
    updateEditor: (values: Record<string, unknown>) => void;
    getState: () => Record<string, unknown>;
    getStore: () => OveEditorStore;
    close: () => void;
  }

  /** The Redux store backing a vector editor instance. */
  export interface OveEditorStore {
    getState: () => unknown;
    dispatch: (action: unknown) => unknown;
  }

  /** OVE action creators (engine export: `actions`). */
  export type OveActionCreator = (
    payload?: unknown,
    meta?: Record<string, unknown>,
  ) => unknown;
  /**
   * OVE action creators used by the app layer to open engine tool panels.
   * Named properties stay non-optional so noUncheckedIndexedAccess does not
   * force `| undefined` at every call site.
   */
  export const actions: {
    createNewDigest: OveActionCreator;
    createNewPCR: OveActionCreator;
    upsertAlignmentRun: OveActionCreator;
    createNewAlignment: OveActionCreator;
    [key: string]: OveActionCreator;
  };

  /** Options accepted by the engine's global dialog singleton. */
  export interface OveShowDialogOptions {
    /** Named dialog from the engine's GlobalDialog registry. */
    dialogType?: string;
    /** Props forwarded to the dialog component. */
    props?: Record<string, unknown>;
    /** Custom React component used when dialogType is omitted. */
    ModalComponent?: unknown;
    overrideName?: string;
  }

  /**
   * Open an engine dialog (e.g. EnzymesDialog / CreateCustomEnzyme) against
   * the GlobalDialog mounted by the live editor.
   */
  export function showDialog(options: OveShowDialogOptions): void;

  /** Payload passed by OVE's onSelectionOrCaretChanged callback. */
  export interface OveSelectionEvent {
    selectionLayer?: { start?: number; end?: number; [key: string]: unknown };
    caretPosition?: number;
    [key: string]: unknown;
  }

  export interface OveEditorProps {
    editorName?: string;
    readOnly?: boolean;
    shouldAutosave?: boolean;
    showReadOnly?: boolean;
    showCircularity?: boolean;
    showMoleculeType?: boolean;
    /** Callback for selection or caret changes in the sequence editor. */
    onSelectionOrCaretChanged?: (event: OveSelectionEvent) => void;
    [key: string]: unknown;
  }

  /**
   * Create a full OVE editor instance mounted into the given DOM node.
   * The returned close() will unmount and remove that node.
   */
  export function createVectorEditor(
    node: HTMLElement,
    props?: OveEditorProps,
  ): OveEditorInstance;
}

declare module "@teselagen/ove/src/CircularView/getRangeAnglesSpecial" {
  /** Angle geometry for a circular-map range (engine export, pure). */
  export interface OveRangeAngles {
    startAngle: number;
    totalAngle: number;
    endAngle: number;
    centerAngle: number;
    locationAngles?: OveRangeAngles[];
  }

  /**
   * Range-angle helper from the vendored fork, used by the engine smoke CI
   * gate to prove the fork compiles and runs.
   */
  export default function getRangeAnglesSpecial(
    range: { start: number; end: number; locations?: Array<{ start: number; end: number }> },
    rangeMax: number,
  ): OveRangeAngles;
}

declare module "@teselagen/ove/src/AlignmentView/getGaps" {
  /** Gap counts before/inside a range in a gapped alignment. */
  export interface OveGaps {
    gapsBefore?: number;
    gapsInside?: number;
  }

  /** Gap helper from the vendored fork, used by the engine smoke CI gate. */
  export function getGaps(
    rangeOrCaretPosition: number | { start: number; end: number },
    sequence: string,
  ): OveGaps;
}

declare module "@teselagen/ove/src/utils/prepareRowData" {
  /**
   * Sequence-view row computation (engine export, pure). Returns one row per
   * bpsPerRow chunk with feature/annotation rows mapped (A-PERF-001 SLO bench).
   */
  export default function prepareRowData(
    sequenceData: unknown,
    bpsPerRow: number,
  ): Array<Record<string, unknown>>;
}

declare module "@teselagen/ove/src/CircularView/getYOffset" {
  /**
   * Circular-map annotation stacking: searches the interval tree for overlaps
   * and returns the first free y-slot (engine export, pure).
   */
  export default function getYOffset(
    iTree: { search(start: number, end: number): unknown[] },
    start: number,
    end: number,
  ): number;
}

declare module "@teselagen/ove/src/CircularView/Labels/relaxLabelAngles" {
  /**
   * Circular-map label spreading / grouping (engine export, pure).
   */
  export default function relaxLabelAngles(
    labelPoints: Array<Record<string, unknown>>,
    spacing: number,
    maxradius: number,
  ): Array<Record<string, unknown>>;
}

declare module "@teselagen/bio-parsers" {
  export interface GenBankFeature {
    type: string;
    name?: string;
    start: number;
    end: number;
    strand?: number;
    forward?: boolean;
    color?: string;
    notes: Record<string, string[]>;
    locations?: Array<{ start: number; end: number }>;
  }

  export interface ParsedSequence {
    name: string;
    sequence: string;
    circular: boolean;
    features: GenBankFeature[];
    accession?: string;
    version?: string;
    description?: string;
  }

  export interface GenBankParseResult {
    parsedSequence: ParsedSequence;
    success: boolean;
    messages: string[];
  }

  export interface Ab1BaseTrace {
    aTrace: number[];
    tTrace: number[];
    gTrace: number[];
    cTrace: number[];
  }

  export interface Ab1ChromatogramData {
    baseCalls: string[];
    basePos: number[];
    qualNums?: number[];
    baseTraces?: Ab1BaseTrace[];
  }

  export interface Ab1ParseResult {
    parsedSequence: ParsedSequence & {
      chromatogramData?: Ab1ChromatogramData;
    };
    success: boolean;
    messages: unknown[];
  }

  export function ab1ToJson(
    file: File | ArrayBuffer,
    options?: Record<string, unknown>,
  ): Promise<Ab1ParseResult[]>;

  export function convertBasePosTraceToPerBpTrace(
    chromData: Ab1ChromatogramData & { basePos: number[] },
  ): Ab1ChromatogramData & { baseTraces: Ab1BaseTrace[] };

  export function genbankToJson(
    genbankString: string,
    options?: Record<string, unknown>,
  ): GenBankParseResult[];

  export function fastaToJson(
    fileString: string,
    options?: Record<string, unknown>,
  ): GenBankParseResult[];

  export function snapgeneToJson(
    file: Blob,
    options?: Record<string, unknown>,
  ): Promise<GenBankParseResult[]>;

  export function jsonToGenbank(
    sequence: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): string | false;

  export function jsonToFasta(
    sequence: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): string;
}
