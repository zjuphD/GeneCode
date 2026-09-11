/**
 * Deterministic local assembly simulation for the interactive cloning wizard.
 *
 * Both methods produce the same top-strand construct:
 *
 *     construct = vecLeft + insert + vecRight
 *
 * - Gibson: the insert's PCR product carries homology arms that match the
 *   vector ends (bases appear once); junction overlap = the arm sequence.
 * - Golden Gate: the vector cut by a Type IIS enzyme exposes sticky overhangs
 *   O_L / O_R; the insert product carries their reverse complements. After
 *   ligation the top strand still reads vecLeft + insert + vecRight and each
 *   junction's overlap is the overhang sequence.
 *
 * The engine is a pure function: no IO, no store, fully unit-testable.
 */

import type {
  SequenceDocument,
  SequenceFeature,
  Strand,
} from "../types";
import {
  featureFromSegments,
  getFeatureSegments,
} from "./featureSegments";
import { reverseComplement } from "./sequenceActions";
// A-ALG-002: recognition sites and cut metadata come from the single
// enzyme-data.json source.
import { getTypeIisEnzyme, TYPE_IIS_SITES } from "./enzymeData";
import {
  buildGoldenGateGraph,
  findTypeIisCutSites,
  type GoldenGateGraph,
} from "./goldenGateGraph";
export { TYPE_IIS_SITES };
export { findTypeIisCutSites };

export type AssemblyMethod = "gibson" | "golden_gate";

export interface AssemblyJunction {
  side: "left" | "right";
  label: string;
  /** The homology arm (Gibson) or overhang (Golden Gate) shared at this junction. */
  overlap: string;
  /** Junction region of the final construct (overlap + a few flanking bases). */
  assembledPreview: string;
}

export type CheckTone = "passed" | "warning" | "failed" | "info";

export interface AssemblyCheck {
  key: string;
  label: string;
  status: CheckTone;
  detail: string;
}

export interface AssemblyInput {
  vector: SequenceDocument;
  insert: SequenceDocument;
  method: AssemblyMethod;
  /** Zero-based cut/insertion position. For circular vectors this is the rotation point. */
  insertAt?: number;
  gibson?: {
    /** Optional user arms. When omitted, they are auto-derived from the vector ends. */
    leftArm?: string;
    rightArm?: string;
  };
  goldenGate?: {
    enzyme: string;
    /** Sticky overhang exposed on the vector's left cut end (read 5'→3'). */
    leftOverhang: string;
    /** Sticky overhang exposed on the vector's right cut end (read 5'→3'). */
    rightOverhang: string;
    /** Extra flanking bases kept outside the recognition sites (0–8). */
    clampLength?: number;
    /** Require actual strand-aware vector sites and fragment remapping. */
    strict?: boolean;
  };
}

export interface AssemblyResult {
  ok: boolean;
  construct: SequenceDocument | null;
  junctions: AssemblyJunction[];
  checks: AssemblyCheck[];
  errors: string[];
  /** Present when a strict, strand-aware Golden Gate graph was derived. */
  goldenGateGraph?: GoldenGateGraph;
}

const VALID_BASES = /^[ACGTUNRYSWKMBDHV]*$/;
const GIBSON_ARM_MIN = 15;
const GIBSON_ARM_TARGET_MIN = 20;
const GIBSON_ARM_TARGET_MAX = 40;
const OVERHANG_MIN = 2;
const OVERHANG_MAX = 8;
const CLAMP_MAX = 8;

function clampPosition(value: number | undefined, length: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length, Math.floor(value)));
}

function normalize(value: string): string {
  return value.replace(/[\s\d]/g, "").toUpperCase();
}

function gcPercent(sequence: string): number {
  if (!sequence.length) return 0;
  let gc = 0;
  for (const base of sequence) {
    if (base === "G" || base === "C") gc += 1;
  }
  return (gc / sequence.length) * 100;
}

/** Count sliding-window occurrences of `site` in `sequence` (case-insensitive).
 *
 * A-BIO-003: overlapping occurrences count separately — tandem BsaI sites
 * (GGTCTCGGTCTC) are two sites, not one. This matches the engine's
 * `countRestrictionSites` semantics used by the Digest panel.
 */
function countSites(sequence: string, site: string): number {
  if (!site) return 0;
  const needle = site.toUpperCase();
  let count = 0;
  for (let index = 0; index + needle.length <= sequence.length; index += 1) {
    if (sequence.slice(index, index + needle.length).toUpperCase() === needle) {
      count += 1;
    }
  }
  return count;
}

function isSelfComplementary(overhang: string): boolean {
  return reverseComplement(overhang) === overhang.toUpperCase();
}

function makeInsertFeature(insert: SequenceDocument, start: number, end: number): SequenceFeature {
  return {
    id: `insert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `Insert: ${insert.name || "insert"}`,
    type: "misc_feature",
    start,
    end,
    strand: 1 as Strand,
    qualifiers: {},
  };
}

function shiftFeatures(
  features: SequenceFeature[],
  offset: number,
  windowLength: number,
): { shifted: SequenceFeature[]; dropped: number } {
  const shifted: SequenceFeature[] = [];
  let dropped = 0;
  for (const feature of features) {
    // A-BIO-004: shift each effective segment so multi-segment (join / wrap)
    // features stay coherent; the feature is rebuilt from the moved pieces.
    const segments = getFeatureSegments(feature, windowLength).map((segment) => ({
      start: segment.start + offset,
      end: segment.end + offset,
    }));
    const next = featureFromSegments(feature, segments, windowLength);
    if (!next) {
      dropped += 1;
      continue;
    }
    shifted.push(next);
  }
  return { shifted, dropped };
}

function rotateVector(
  vector: SequenceDocument,
  insertAt: number,
): { sequence: string; offset: number } {
  if (!vector.circular) {
    return { sequence: vector.sequence, offset: 0 };
  }
  const length = vector.sequence.length;
  const cut = clampPosition(insertAt, length);
  if (length === 0) return { sequence: "", offset: 0 };
  return {
    sequence: vector.sequence.slice(cut) + vector.sequence.slice(0, cut),
    offset: -cut,
  };
}

/**
 * Compute the construct layout for a vector + insert splice.
 *
 * - Circular: rotate at the cut so the insert lands at the cut junction (the
 *   end of the linearized molecule). Features fully contained in the pre-cut
 *   region [0, cut) map to the molecule tail; only features crossing the cut
 *   are dropped.
 * - Linear: the insert splices at `insertAt`; features fully after the
 *   insertion point shift right by `insertLength` (A-BIO-003), features
 *   spanning the insertion point grow to contain the insert bases, and
 *   features fully before it keep their coordinates.
 */
function buildConstructLayout(
  vector: SequenceDocument,
  insertAt: number,
  insertLength = 0,
): {
  vectorSequence: string;
  insertStart: number;
  vectorFeatures: SequenceFeature[];
  dropped: number;
} {
  if (!vector.circular) {
    const cut = clampPosition(insertAt, vector.sequence.length);
    const constructLength = vector.sequence.length + insertLength;
    const vectorFeatures: SequenceFeature[] = [];
    let dropped = 0;
    for (const feature of vector.features) {
      // A-BIO-004: remap each effective segment so multi-segment features stay
      // coherent through a linear insertion.
      const segments = getFeatureSegments(feature, vector.sequence.length).map((segment) => {
        if (segment.start >= cut) {
          // Fully after the insertion point: shift past the insert.
          return {
            start: segment.start + insertLength,
            end: segment.end + insertLength,
          };
        }
        if (segment.end > cut) {
          // Spans the insertion point: the insert bases now lie inside it.
          return { start: segment.start, end: segment.end + insertLength };
        }
        return { ...segment };
      });
      const next = featureFromSegments(feature, segments, constructLength);
      if (!next) {
        dropped += 1;
        continue;
      }
      vectorFeatures.push(next);
    }
    return {
      vectorSequence: vector.sequence,
      insertStart: cut,
      vectorFeatures,
      dropped,
    };
  }

  const length = vector.sequence.length;
  const cut = clampPosition(insertAt, length);
  const rotated = length === 0
    ? ""
    : vector.sequence.slice(cut) + vector.sequence.slice(0, cut);
  const vectorFeatures: SequenceFeature[] = [];
  let dropped = 0;
  for (const feature of vector.features) {
    // A-BIO-004: map each segment through the rotation (tail wrap for pieces
    // before the cut) and rebuild the feature from the mapped pieces.
    const mappedSegments: Array<{ start: number; end: number }> = [];
    let crossesCut = false;
    for (const segment of getFeatureSegments(feature, length)) {
      if (segment.end <= cut) {
        // Fully before the cut → appears at the molecule tail after rotation.
        mappedSegments.push({
          start: length - cut + segment.start,
          end: length - cut + segment.end,
        });
      } else if (segment.start >= cut) {
        mappedSegments.push({
          start: segment.start - cut,
          end: segment.end - cut,
        });
      } else {
        crossesCut = true;
        break;
      }
    }
    if (crossesCut) {
      dropped += 1;
      continue;
    }
    const next = featureFromSegments(feature, mappedSegments, rotated.length);
    if (!next) {
      dropped += 1;
      continue;
    }
    vectorFeatures.push(next);
  }
  return {
    vectorSequence: rotated,
    insertStart: rotated.length,
    vectorFeatures,
    dropped,
  };
}

function buildJunctionPreview(
  construct: string,
  insertStart: number,
  insertEnd: number,
  side: "left" | "right",
  overlap: string,
  circular = false,
): string {
  const windowLength = 24;
  if (side === "left") {
    const start = Math.max(0, insertStart - windowLength);
    return construct.slice(start, insertStart + Math.min(overlap.length, 8));
  }
  const end = Math.min(construct.length, insertEnd + windowLength);
  const downstreamLength = end - insertEnd;
  // A circular Gibson construct ends with the insert in linear coordinates.
  // Its right junction must also show the vector bases across the origin.
  const wrapped = circular
    ? construct.slice(0, Math.min(insertStart, windowLength - downstreamLength))
    : "";
  return construct.slice(Math.max(0, insertEnd - Math.min(overlap.length, 8)), end) + wrapped;
}

// ── Gibson ───────────────────────────────────────────────────

export function simulateGibson(
  vector: SequenceDocument,
  insert: SequenceDocument,
  insertAt = 0,
  arms: { leftArm?: string; rightArm?: string } = {},
): AssemblyResult {
  const errors: string[] = [];
  const checks: AssemblyCheck[] = [];
  const insertSequence = normalize(insert.sequence);
  if (!vector.sequence || !VALID_BASES.test(vector.sequence.toUpperCase())) {
    errors.push("载体序列为空或包含不支持的字符。");
  }
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > vector.sequence.length) {
    errors.push("插入位置必须是载体范围内的整数坐标。");
  }
  if (!insertSequence) errors.push("Add an insert sequence to assemble.");
  if (!VALID_BASES.test(insertSequence)) {
    errors.push("The insert sequence contains unsupported characters.");
  }

  const layout = buildConstructLayout(vector, insertAt, insertSequence.length);
  const vectorSequence = layout.vectorSequence.toUpperCase();
  const insertStart = layout.insertStart;
  const leftArm = normalize(arms.leftArm ?? "");
  const rightArm = normalize(arms.rightArm ?? "");
  for (const [label, raw, normalized] of [
    ["左", arms.leftArm, leftArm], ["右", arms.rightArm, rightArm],
  ]) {
    if (raw?.trim() && !normalized) errors.push(`${label}同源臂未包含有效 DNA 碱基。`);
  }

  // Auto arms match the vector bases adjacent to the insertion junction: the
  // sequence immediately before (left arm) and after (right arm) the cut. For
  // a circular vector the junction sits at the end/start of the linearized
  // molecule, so the right arm wraps to the start.
  const autoLeft = vectorSequence.slice(
    Math.max(0, insertStart - GIBSON_ARM_TARGET_MIN),
    insertStart,
  ) || vectorSequence;
  const autoRight = vector.circular
    ? (vectorSequence.slice(0, GIBSON_ARM_TARGET_MIN) || vectorSequence)
    : (vectorSequence.slice(insertStart, insertStart + GIBSON_ARM_TARGET_MIN) || vectorSequence);

  const leftOverlap = leftArm || autoLeft;
  const rightOverlap = rightArm || autoRight;

  const armChecks = (side: "left" | "right", arm: string, custom: string) => {
    const key = side;
    const label = side === "left" ? "左" : "右";
    if (!arm) return;
    if (!/^[ACGT]+$/.test(arm)) {
      const detail = `${label}同源臂含有非 A/C/G/T 碱基，无法验证与载体的精确匹配。`;
      checks.push({ key: `${key}-bases`, label: `${label}同源臂序列`, status: "failed", detail });
      errors.push(detail);
      return;
    }
    if (arm.length < GIBSON_ARM_MIN) {
      checks.push({
        key: `${key}-short`,
        label: `${label}同源臂偏短`,
        status: "warning",
        detail: `${arm.length} bp；当前模拟建议至少 ${GIBSON_ARM_MIN} bp，请结合实验条件复核。`,
      });
    } else if (arm.length < GIBSON_ARM_TARGET_MIN || arm.length > GIBSON_ARM_TARGET_MAX) {
      checks.push({
        key: `${key}-range`,
        label: `${label}同源臂长度`,
        status: "warning",
        detail: `${arm.length} bp；当前模拟建议范围为 ${GIBSON_ARM_TARGET_MIN}–${GIBSON_ARM_TARGET_MAX} bp。`,
      });
    }
    const gc = gcPercent(arm);
    if (gc < 40 || gc > 60) {
      checks.push({
        key: `${key}-gc`,
        label: `${label}同源臂 GC 含量`,
        status: "warning",
        detail: `GC ${gc.toFixed(1)}%，超出当前模拟建议的 40–60% 范围。`,
      });
    }
    if (custom) {
      const before = vectorSequence.slice(
        Math.max(0, insertStart - arm.length),
        insertStart,
      );
      const after = vector.circular
        ? vectorSequence.slice(0, arm.length)
        : vectorSequence.slice(insertStart, insertStart + arm.length);
      // Matching the opposite end is not sufficient: it changes the proposed
      // junction. Each custom arm must match its own side in top-strand order.
      const matches = (side === "left" ? before : after) === arm;
      const detail = matches
        ? `${label}同源臂与插入位置${side === "left" ? "上游" : "下游"}的载体序列一致。`
        : `${label}同源臂与对应载体末端不匹配，请修正序列或使用自动同源臂。`;
      checks.push({
        key: `${key}-match`,
        label: `${label}同源臂与载体末端匹配`,
        status: matches ? "passed" : "failed",
        detail,
      });
      if (!matches) errors.push(detail);
    }
  };
  armChecks("left", leftOverlap, leftArm);
  armChecks("right", rightOverlap, rightArm);

  if (errors.length) {
    return { ok: false, construct: null, junctions: [], checks, errors };
  }

  const constructSequence =
    vectorSequence.slice(0, insertStart) + insertSequence + vectorSequence.slice(insertStart);
  const construct: SequenceDocument = {
    name: `${vector.name || "Vector"} + ${insert.name || "insert"}`,
    sequence: constructSequence,
    circular: vector.circular,
    features: [],
  };

  const { dropped } = layout;
  if (dropped > 0) {
    checks.push({
      key: "features-cross-cut",
      label: "Vector features across the insertion site",
      status: "warning",
      detail: `${dropped} vector feature${dropped === 1 ? "" : "s"} crossed the insertion site and were not carried into the construct.`,
    });
  }
  const insertFeatures = shiftFeatures(
    insert.features,
    insertStart,
    constructSequence.length,
  ).shifted;
  construct.features = [
    ...layout.vectorFeatures,
    makeInsertFeature(insert, insertStart, insertStart + insertSequence.length),
    ...insertFeatures,
  ];

  return {
    ok: true,
    construct,
    junctions: [
      {
        side: "left",
        label: "载体 → 插入片段",
        overlap: leftOverlap,
        assembledPreview: buildJunctionPreview(constructSequence, insertStart, insertStart + insertSequence.length, "left", leftOverlap),
      },
      {
        side: "right",
        label: "插入片段 → 载体",
        overlap: rightOverlap,
        assembledPreview: buildJunctionPreview(constructSequence, insertStart, insertStart + insertSequence.length, "right", rightOverlap, vector.circular),
      },
    ],
    checks,
    errors,
  };
}

// ── Golden Gate ──────────────────────────────────────────────

export function simulateGoldenGate(
  vector: SequenceDocument,
  insert: SequenceDocument,
  insertAt = 0,
  config: { enzyme: string; leftOverhang: string; rightOverhang: string; clampLength?: number; strict?: boolean } = {
    enzyme: "BsaI",
    leftOverhang: "",
    rightOverhang: "",
  },
): AssemblyResult {
  if (config.strict) {
    const strict = buildGoldenGateGraph({
      vector,
      insert,
      insertAt,
      enzyme: config.enzyme,
      leftOverhang: config.leftOverhang,
      rightOverhang: config.rightOverhang,
    });
    const strictChecks: AssemblyCheck[] = strict.checks;
    if (!strict.construct) {
      const insertSequence = normalize(insert.sequence);
      const left = config.leftOverhang.replace(/[\s\d]/g, "").toUpperCase();
      const right = config.rightOverhang.replace(/[\s\d]/g, "").toUpperCase();
      // Keep a clearly-labelled sequence-only junction preview available for
      // review, while keeping construct null so callers cannot export it.
      const previewInsertStart = Math.max(0, Math.min(vector.sequence.length, Math.floor(insertAt)));
      const previewSequence = normalize(vector.sequence).slice(0, previewInsertStart)
        + insertSequence
        + normalize(vector.sequence).slice(previewInsertStart);
      const previewJunctions = insertSequence
        ? [
            {
              side: "left" as const,
              label: "Vector → Insert",
              overlap: `${left} / ${reverseComplement(left)}`,
              assembledPreview: buildJunctionPreview(
                previewSequence,
                previewInsertStart,
                previewInsertStart + insertSequence.length,
                "left",
                left,
              ),
            },
            {
              side: "right" as const,
              label: "Insert → Vector",
              overlap: `${right} / ${reverseComplement(right)}`,
              assembledPreview: buildJunctionPreview(
                previewSequence,
                previewInsertStart,
                previewInsertStart + insertSequence.length,
                "right",
                right,
              ),
            },
          ]
        : [];
      return {
        ok: false,
        construct: null,
        junctions: previewJunctions,
        checks: strictChecks,
        errors: strict.errors.length > 0
          ? strict.errors
          : ["Strict Golden Gate validation did not produce a construct."],
        goldenGateGraph: strict.graph ?? undefined,
      };
    }
    const left = config.leftOverhang.replace(/[\s\d]/g, "").toUpperCase();
    const right = config.rightOverhang.replace(/[\s\d]/g, "").toUpperCase();
    return {
      ok: true,
      construct: strict.construct,
      checks: strictChecks,
      errors: strict.errors,
      goldenGateGraph: strict.graph ?? undefined,
      junctions: [
        {
          side: "left",
          label: "Vector → Insert",
          overlap: `${left} / ${reverseComplement(left)}`,
          assembledPreview: buildJunctionPreview(
            strict.construct.sequence,
            strict.insertStart,
            strict.insertEnd,
            "left",
            left,
          ),
        },
        {
          side: "right",
          label: "Insert → Vector",
          overlap: `${right} / ${reverseComplement(right)}`,
          assembledPreview: buildJunctionPreview(
            strict.construct.sequence,
            strict.insertStart,
            strict.insertEnd,
            "right",
            right,
          ),
        },
      ],
    };
  }
  const errors: string[] = [];
  const checks: AssemblyCheck[] = [];
  const insertSequence = normalize(insert.sequence);
  if (!insertSequence) errors.push("Add an insert sequence to assemble.");
  if (!VALID_BASES.test(insertSequence)) {
    errors.push("The insert sequence contains unsupported characters.");
  }

  const leftOverhang = normalize(config.leftOverhang);
  const rightOverhang = normalize(config.rightOverhang);
  const enzymeInfo = getTypeIisEnzyme(config.enzyme);
  const clampLength = Math.max(
    0,
    Math.min(CLAMP_MAX, Math.floor(config.clampLength ?? 0)),
  );
  if (clampLength > 0) {
    checks.push({
      key: "gg-clamp",
      label: "Clamp length",
      status: "info",
      detail: `${clampLength} bp retained outside the ${config.enzyme} recognition sites on the fragment ends.`,
    });
  }

  const overhangChecks = (label: string, overhang: string) => {
    const key = label.toLowerCase();
    if (!overhang) {
      checks.push({
        key: `${key}-missing`,
        label: `${label} overhang`,
        status: "failed",
        detail: "Enter the vector's sticky-end overhang sequence.",
      });
      return;
    }
    if (overhang.length < OVERHANG_MIN || overhang.length > OVERHANG_MAX) {
      checks.push({
        key: `${key}-length`,
        label: `${label} overhang length`,
        status: "warning",
        detail: `${overhang.length} bp — typical overhangs are 2–8 bp (4 bp is standard for BsaI).`,
      });
    }
    if (enzymeInfo && overhang.length !== enzymeInfo.overhangLength) {
      checks.push({
        key: `${key}-enzyme-length`,
        label: `${label} overhang does not match ${config.enzyme}`,
        status: "failed",
        detail: `${config.enzyme} exposes a ${enzymeInfo.overhangLength} bp overhang, but this end is configured as ${overhang.length} bp. Change the overhang or choose a compatible enzyme before treating this as a Golden Gate design.`,
      });
    }
    if (isSelfComplementary(overhang)) {
      checks.push({
        key: `${key}-selfcomp`,
        label: `${label} overhang self-complementary`,
        status: "warning",
        detail: `${overhang} is self-complementary — risk of hairpin or self-ligation.`,
      });
    }
  };
  overhangChecks("Left", leftOverhang);
  overhangChecks("Right", rightOverhang);

  const site = TYPE_IIS_SITES[config.enzyme] ?? "";
  if (site) {
    const inInsert = countSites(insertSequence, site);
    if (inInsert > 0) {
      checks.push({
        key: "gg-internal-site",
        label: `${config.enzyme} sites inside the insert`,
        status: "warning",
        detail: `${inInsert} internal ${site} site${inInsert === 1 ? "" : "s"} — the enzyme would also cut the insert during assembly.`,
      });
    }
    const inVector = countSites(rotatedSequenceForCheck(vector, insertAt), site);
    if (inVector > 0) {
      checks.push({
        key: "gg-vector-sites",
        label: `${config.enzyme} sites in the vector`,
        status: "info",
        detail: `${inVector} additional ${site} site${inVector === 1 ? "" : "s"} in the vector backbone.`,
      });
    }
  } else {
    checks.push({
      key: "gg-enzyme-unknown",
      label: "Type IIS enzyme",
      status: "info",
      detail: `${config.enzyme} is not in the built-in recognition table; internal-site checks are skipped.`,
    });
  }

  if (errors.length) {
    return { ok: false, construct: null, junctions: [], checks, errors };
  }

  const layout = buildConstructLayout(vector, insertAt, insertSequence.length);
  const vectorSequence = layout.vectorSequence;
  const insertStart = layout.insertStart;
  const constructSequence =
    vectorSequence.slice(0, insertStart) + insertSequence + vectorSequence.slice(insertStart);
  const construct: SequenceDocument = {
    name: `${vector.name || "Vector"} + ${insert.name || "insert"}`,
    sequence: constructSequence,
    circular: vector.circular,
    features: [],
  };

  const { dropped } = layout;
  if (dropped > 0) {
    checks.push({
      key: "features-cross-cut",
      label: "Vector features across the insertion site",
      status: "warning",
      detail: `${dropped} vector feature${dropped === 1 ? "" : "s"} crossed the insertion site and were not carried into the construct.`,
    });
  }
  const insertFeatures = shiftFeatures(
    insert.features,
    insertStart,
    constructSequence.length,
  ).shifted;
  construct.features = [
    ...layout.vectorFeatures,
    makeInsertFeature(insert, insertStart, insertStart + insertSequence.length),
    ...insertFeatures,
  ];

  const leftOverlapLabel = `${leftOverhang} / ${reverseComplement(leftOverhang)}`;
  const rightOverlapLabel = `${rightOverhang} / ${reverseComplement(rightOverhang)}`;
  return {
    ok: true,
    construct,
    junctions: [
      {
        side: "left",
        label: "Vector → Insert",
        overlap: leftOverlapLabel,
        assembledPreview: buildJunctionPreview(constructSequence, insertStart, insertStart + insertSequence.length, "left", leftOverhang),
      },
      {
        side: "right",
        label: "Insert → Vector",
        overlap: rightOverlapLabel,
        assembledPreview: buildJunctionPreview(constructSequence, insertStart, insertStart + insertSequence.length, "right", rightOverhang),
      },
    ],
    checks,
    errors,
  };
}

function rotatedSequenceForCheck(vector: SequenceDocument, insertAt: number): string {
  return rotateVector(vector, insertAt).sequence;
}

// ── Unified API ──────────────────────────────────────────────

export function simulateAssembly(input: AssemblyInput): AssemblyResult {
  const insertAt = clampPosition(input.insertAt, input.vector.sequence.length);
  if (input.method === "golden_gate") {
    return simulateGoldenGate(
      input.vector,
      input.insert,
      insertAt,
      input.goldenGate ?? { enzyme: "BsaI", leftOverhang: "", rightOverhang: "" },
    );
  }
  return simulateGibson(input.vector, input.insert, insertAt, input.gibson);
}
