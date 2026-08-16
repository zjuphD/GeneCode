import type { SequenceDocument, SequenceFeature } from "../types";
import { featureFromSegments, getFeatureSegments } from "./featureSegments";
import { getTypeIisEnzyme } from "./enzymeData";
import { reverseComplement } from "./sequenceActions";

/** A strand-aware Type IIS recognition hit and its two strand cut coordinates. */
export interface TypeIisCutSite {
  enzyme: string;
  orientation: 1 | -1;
  recognitionStart: number;
  recognitionEnd: number;
  cutTop: number;
  cutBottom: number;
  overhang: string;
}

export interface GoldenGateFragment {
  id: string;
  source: "vector" | "insert";
  start: number;
  end: number;
  orientation: 1 | -1;
  sequence: string;
  leftEnd: string;
  rightEnd: string;
}

export interface GoldenGateGraph {
  validated: boolean;
  enzyme: string;
  vectorSites: [TypeIisCutSite, TypeIisCutSite];
  fragments: GoldenGateFragment[];
  junctions: Array<{
    side: "left" | "right";
    vectorEnd: string;
    insertEnd: string;
    compatible: boolean;
  }>;
  notes: string[];
}

export interface GoldenGateGraphResult {
  graph: GoldenGateGraph | null;
  construct: SequenceDocument | null;
  checks: Array<{ key: string; label: string; status: "passed" | "warning" | "failed" | "info"; detail: string }>;
  errors: string[];
  insertStart: number;
  insertEnd: number;
}

function normalize(value: string): string {
  return value.replace(/[\s\d]/g, "").toUpperCase().replace(/U/g, "T");
}

function normalizeCircular(value: number, length: number): number {
  if (length === 0) return 0;
  return ((value % length) + length) % length;
}

function forwardDistance(start: number, end: number, length: number): number {
  return normalizeCircular(end - start, length);
}

function inForwardPath(position: number, start: number, end: number, length: number): boolean {
  const pathLength = forwardDistance(start, end, length);
  return forwardDistance(start, position, length) < pathLength;
}

function sequencePath(sequence: string, start: number, end: number): string {
  if (!sequence.length) return "";
  if (start <= end) return sequence.slice(start, end);
  return sequence.slice(start) + sequence.slice(0, end);
}

function scanMotif(
  sequence: string,
  motif: string,
  circular: boolean,
): number[] {
  if (!motif || !sequence) return [];
  const limit = sequence.length;
  const search = circular
    ? sequence + sequence.slice(0, Math.max(0, motif.length - 1))
    : sequence;
  const starts: number[] = [];
  for (let start = 0; start + motif.length <= search.length; start += 1) {
    if (start >= limit && circular) break;
    if (search.slice(start, start + motif.length) === motif) starts.push(start);
  }
  return starts;
}

/**
 * Find both forward and reverse recognition orientations and convert their
 * strand cuts into the canonical top-strand coordinate system. The reverse
 * orientation swaps the top/bottom offsets around the motif, which is the
 * detail the old single-cut model lost.
 */
export function findTypeIisCutSites(
  sequenceValue: string,
  enzymeName: string,
  circular = false,
): TypeIisCutSite[] {
  const sequence = normalize(sequenceValue);
  const enzyme = getTypeIisEnzyme(enzymeName);
  if (!enzyme || !sequence) return [];
  const motif = normalize(enzyme.recognitionSite);
  const reverseMotif = reverseComplement(motif);
  const topOffset = enzyme.cutsTop[0];
  const bottomOffset = enzyme.cutsBottom[0];
  if (topOffset === undefined || bottomOffset === undefined || !Number.isFinite(topOffset) || !Number.isFinite(bottomOffset)) return [];
  const hits: TypeIisCutSite[] = [];

  for (const orientation of [1, -1] as const) {
    const searchMotif = orientation === 1 ? motif : reverseMotif;
    for (const rawStart of scanMotif(sequence, searchMotif, circular)) {
      const rawEnd = rawStart + motif.length;
      const cutTop = orientation === 1
        ? rawStart + topOffset
        : rawStart + motif.length - bottomOffset;
      const cutBottom = orientation === 1
        ? rawStart + bottomOffset
        : rawStart + motif.length - topOffset;
      if (!circular && (cutTop < 0 || cutTop > sequence.length || cutBottom < 0 || cutBottom > sequence.length)) {
        continue;
      }
      const start = circular ? normalizeCircular(rawStart, sequence.length) : rawStart;
      const top = circular ? normalizeCircular(cutTop, sequence.length) : cutTop;
      const bottom = circular ? normalizeCircular(cutBottom, sequence.length) : cutBottom;
      const low = Math.min(top, bottom);
      const high = Math.max(top, bottom);
      const overhang = top <= bottom
        ? sequencePath(sequence, low, high)
        : circular
          ? sequence.slice(top) + sequence.slice(0, bottom)
          : reverseComplement(sequencePath(sequence, low, high));
      hits.push({
        enzyme: enzymeName,
        orientation,
        recognitionStart: start,
        recognitionEnd: circular ? normalizeCircular(rawEnd, sequence.length) : rawEnd,
        cutTop: top,
        cutBottom: bottom,
        overhang,
      });
    }
  }

  const unique = new Map<string, TypeIisCutSite>();
  for (const hit of hits) {
    const key = `${hit.recognitionStart}:${hit.orientation}:${hit.cutTop}:${hit.cutBottom}`;
    unique.set(key, hit);
  }
  return [...unique.values()].sort((a, b) => a.cutTop - b.cutTop || a.orientation - b.orientation);
}

function compatibleEnd(left: string, right: string): boolean {
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || a === reverseComplement(b)));
}

function chooseFlankingSites(
  sites: TypeIisCutSite[],
  anchor: number,
  length: number,
  circular: boolean,
): [TypeIisCutSite, TypeIisCutSite] | null {
  if (sites.length < 2) return null;
  if (!circular) {
    const left = [...sites].filter((site) => site.cutTop <= anchor).sort((a, b) => b.cutTop - a.cutTop)[0];
    const right = [...sites].filter((site) => site.cutTop > anchor).sort((a, b) => a.cutTop - b.cutTop)[0];
    return left && right ? [left, right] : null;
  }

  let best: { left: TypeIisCutSite; right: TypeIisCutSite; score: number } | null = null;
  for (const left of sites) {
    for (const right of sites) {
      if (left === right) continue;
      const leftToAnchor = forwardDistance(left.cutTop, anchor, length);
      const leftToRight = forwardDistance(left.cutTop, right.cutTop, length);
      const anchorToRight = forwardDistance(anchor, right.cutTop, length);
      if (leftToRight === 0 || leftToAnchor >= leftToRight || anchorToRight === 0) continue;
      const score = leftToAnchor + anchorToRight;
      if (!best || score < best.score) best = { left, right, score };
    }
  }
  return best ? [best.left, best.right] : null;
}

function mapLinearFeature(
  feature: SequenceFeature,
  sequenceLength: number,
  leftCut: number,
  rightCut: number,
  insertLength: number,
): SequenceFeature | null {
  const mapped: Array<{ start: number; end: number }> = [];
  const delta = insertLength - (rightCut - leftCut);
  for (const segment of getFeatureSegments(feature, sequenceLength)) {
    if (segment.start < leftCut) {
      mapped.push({
        start: segment.start,
        end: Math.min(segment.end, leftCut),
      });
    }
    if (segment.end > rightCut) {
      mapped.push({
        start: Math.max(segment.start, rightCut) + delta,
        end: segment.end + delta,
      });
    }
  }
  return featureFromSegments(feature, mapped, sequenceLength + delta);
}

function mapCircularFeature(
  feature: SequenceFeature,
  sequenceLength: number,
  leftCut: number,
  rightCut: number,
  insertLength: number,
): SequenceFeature | null {
  const removedLength = forwardDistance(leftCut, rightCut, sequenceLength);
  const retainedLength = sequenceLength - removedLength;
  const mapped: Array<{ start: number; end: number }> = [];
  const breakpoints = [...new Set([0, sequenceLength, leftCut, rightCut])]
    .filter((point) => point >= 0 && point <= sequenceLength)
    .sort((a, b) => a - b);
  for (const segment of getFeatureSegments(feature, sequenceLength)) {
    const points = [...new Set([segment.start, segment.end, ...breakpoints])]
      .filter((point) => point >= segment.start && point <= segment.end)
      .sort((a, b) => a - b);
    for (let index = 0; index + 1 < points.length; index += 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      if (end <= start) continue;
      const midpoint = start + (end - start) / 2;
      const retained = !inForwardPath(midpoint, leftCut, rightCut, sequenceLength);
      if (!retained) continue;
      const startOffset = forwardDistance(rightCut, start, sequenceLength);
      const endOffset = startOffset + (end - start);
      mapped.push({
        start: insertLength + startOffset,
        end: insertLength + endOffset,
      });
    }
  }
  if (mapped.length === 0 && retainedLength === 0) return null;
  return featureFromSegments(feature, mapped, insertLength + retainedLength);
}

function mapFeatures(
  vector: SequenceDocument,
  leftCut: number,
  rightCut: number,
  insertLength: number,
): { features: SequenceFeature[]; dropped: number; constructLength: number } {
  const features: SequenceFeature[] = [];
  let dropped = 0;
  const removedLength = vector.circular
    ? forwardDistance(leftCut, rightCut, vector.sequence.length)
    : rightCut - leftCut;
  const constructLength = insertLength + vector.sequence.length - removedLength;
  for (const feature of vector.features) {
    const next = vector.circular
      ? mapCircularFeature(feature, vector.sequence.length, leftCut, rightCut, insertLength)
      : mapLinearFeature(feature, vector.sequence.length, leftCut, rightCut, insertLength);
    if (!next) dropped += 1;
    else features.push(next);
  }
  return { features, dropped, constructLength };
}

/**
 * Strict, deterministic Golden Gate model. It only returns a construct when
 * the vector has exactly two in-scope Type IIS sites, both cut coordinates are
 * representable, the insert has no internal site, and the requested ends are
 * compatible with the actual enzyme-derived ends. The old string-splice
 * preview remains available through `simulateGoldenGate` without `strict`.
 */
export function buildGoldenGateGraph(input: {
  vector: SequenceDocument;
  insert: SequenceDocument;
  insertAt: number;
  enzyme: string;
  leftOverhang: string;
  rightOverhang: string;
}): GoldenGateGraphResult {
  const checks: GoldenGateGraphResult["checks"] = [];
  const errors: string[] = [];
  const vectorSequence = normalize(input.vector.sequence);
  const insertSequence = normalize(input.insert.sequence);
  const enzyme = getTypeIisEnzyme(input.enzyme);
  if (!enzyme) {
    errors.push(`Unknown Type IIS enzyme: ${input.enzyme}`);
    return { graph: null, construct: null, checks, errors, insertStart: 0, insertEnd: 0 };
  }
  if (!insertSequence) errors.push("Add an insert sequence to assemble.");
  if (!/^[ACGTN]*$/.test(insertSequence)) errors.push("The insert sequence contains unsupported characters.");
  if (errors.length) return { graph: null, construct: null, checks, errors, insertStart: 0, insertEnd: 0 };

  const sites = findTypeIisCutSites(vectorSequence, input.enzyme, input.vector.circular);
  if (sites.length !== 2) {
    errors.push(`${input.enzyme} strict Golden Gate mode requires exactly two recognition sites in the vector; found ${sites.length}.`);
    checks.push({
      key: "gg-vector-site-count",
      label: "Vector Type IIS site count",
      status: "failed",
      detail: `Expected exactly 2 strand-aware sites, found ${sites.length}. The sequence-only preview cannot be treated as an executable construct.`,
    });
    const expectedLength = enzyme.overhangLength;
    for (const [label, overhang] of [["Left", normalize(input.leftOverhang)], ["Right", normalize(input.rightOverhang)]] as const) {
      checks.push({
        key: `gg-${label.toLowerCase()}-overhang-length`,
        label: `${label} overhang length`,
        status: overhang.length === expectedLength ? "passed" : "failed",
        detail: overhang.length === expectedLength
          ? `${label} overhang has the expected ${expectedLength} bp length.`
          : `${input.enzyme} exposes ${expectedLength} bp, but ${label.toLowerCase()} is ${overhang.length} bp.`,
      });
    }
    return { graph: null, construct: null, checks, errors, insertStart: 0, insertEnd: 0 };
  }
  const anchor = input.vector.circular
    ? normalizeCircular(input.insertAt, vectorSequence.length)
    : Math.max(0, Math.min(vectorSequence.length, Math.floor(input.insertAt)));
  const pair = chooseFlankingSites(sites, anchor, vectorSequence.length, input.vector.circular);
  if (!pair) {
    errors.push("The insertion anchor is not bracketed by two usable Type IIS cuts.");
    return { graph: null, construct: null, checks, errors, insertStart: 0, insertEnd: 0 };
  }
  const [leftSite, rightSite] = pair;
  if (leftSite.orientation !== -1 || rightSite.orientation !== 1) {
    errors.push("The two Type IIS sites are not in canonical outward-facing (Reverse → Forward) orientation.");
    checks.push({
      key: "gg-vector-site-orientation",
      label: "Outward-facing Type IIS site orientation",
      status: "failed",
      detail: "A same-direction or inward-facing pair does not prove the intended dropout boundary; keep this design review-only.",
    });
    return {
      graph: null,
      construct: null,
      checks,
      errors,
      insertStart: 0,
      insertEnd: 0,
    };
  }
  const expectedLength = enzyme.overhangLength;
  const leftOverhang = normalize(input.leftOverhang);
  const rightOverhang = normalize(input.rightOverhang);
  for (const [label, overhang] of [["Left", leftOverhang], ["Right", rightOverhang]] as const) {
    if (overhang.length !== expectedLength) {
      checks.push({
        key: `gg-${label.toLowerCase()}-overhang-length`,
        label: `${label} overhang length`,
        status: "failed",
        detail: `${input.enzyme} exposes ${expectedLength} bp, but ${label.toLowerCase()} is ${overhang.length} bp.`,
      });
    }
  }
  const leftCompatible = compatibleEnd(leftOverhang, leftSite.overhang);
  const rightCompatible = compatibleEnd(rightOverhang, rightSite.overhang);
  checks.push({
    key: "gg-left-end",
    label: "Left vector/insert end compatibility",
    status: leftCompatible ? "passed" : "failed",
    detail: leftCompatible
      ? `The configured left end is compatible with the ${input.enzyme} cut (${leftSite.overhang}).`
      : `Configured ${leftOverhang || "(empty)"} does not match the enzyme-derived left end ${leftSite.overhang}.`,
  });
  checks.push({
    key: "gg-right-end",
    label: "Right vector/insert end compatibility",
    status: rightCompatible ? "passed" : "failed",
    detail: rightCompatible
      ? `The configured right end is compatible with the ${input.enzyme} cut (${rightSite.overhang}).`
      : `Configured ${rightOverhang || "(empty)"} does not match the enzyme-derived right end ${rightSite.overhang}.`,
  });

  const insertSites = findTypeIisCutSites(insertSequence, input.enzyme, false);
  if (insertSites.length > 0) {
    errors.push(`The insert contains ${insertSites.length} internal ${input.enzyme} recognition site${insertSites.length === 1 ? "" : "s"}.`);
    checks.push({
      key: "gg-insert-internal-sites",
      label: "Internal Type IIS sites in insert",
      status: "failed",
      detail: "The enzyme would cut the insert during assembly; remove or domesticate these sites before ordering.",
    });
  } else {
    checks.push({
      key: "gg-insert-internal-sites",
      label: "Internal Type IIS sites in insert",
      status: "passed",
      detail: `No ${input.enzyme} recognition sites were found in the insert core.`,
    });
  }

  const leftCut = leftSite.cutTop;
  const rightCut = rightSite.cutTop;
  const removedLength = input.vector.circular
    ? forwardDistance(leftCut, rightCut, vectorSequence.length)
    : rightCut - leftCut;
  if (removedLength <= 0 || removedLength >= vectorSequence.length) {
    errors.push("The Type IIS cut pair does not leave a non-empty vector backbone.");
  }

  const mapped = mapFeatures(input.vector, leftCut, rightCut, insertSequence.length);
  let constructSequence: string;
  let insertStart: number;
  if (input.vector.circular) {
    const rotated = vectorSequence.slice(leftCut) + vectorSequence.slice(0, leftCut);
    const rightCutRelative = forwardDistance(leftCut, rightCut, vectorSequence.length);
    constructSequence = insertSequence + rotated.slice(rightCutRelative);
    insertStart = 0;
  } else {
    constructSequence = vectorSequence.slice(0, leftCut) + insertSequence + vectorSequence.slice(rightCut);
    insertStart = leftCut;
  }
  let construct = errors.length || checks.some((check) => check.status === "failed")
    ? null
    : {
        name: `${input.vector.name || "Vector"} + ${input.insert.name || "insert"}`,
        sequence: constructSequence,
        circular: input.vector.circular,
        features: [
          ...mapped.features,
          {
            id: `insert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: `Insert: ${input.insert.name || "insert"}`,
            type: "misc_feature",
            start: insertStart,
            end: insertStart + insertSequence.length,
            strand: 1,
            qualifiers: {},
          },
        ],
      } satisfies SequenceDocument;
  if (mapped.dropped > 0) {
    checks.push({
      key: "gg-features-dropped",
      label: "Features intersecting the excised vector segment",
      status: "warning",
      detail: `${mapped.dropped} feature${mapped.dropped === 1 ? "" : "s"} could not be remapped without clipping and was omitted from the construct.`,
    });
  }
  const retainedSites = findTypeIisCutSites(constructSequence, input.enzyme, input.vector.circular);
  if (retainedSites.length > 0) {
    checks.push({
      key: "gg-retained-sites",
      label: "Recognition sites absent from final construct",
      status: "failed",
      detail: `The predicted construct still contains ${retainedSites.length} ${input.enzyme} site${retainedSites.length === 1 ? "" : "s"}; it would be recut in the assembly reaction.`,
    });
  }
  if (checks.some((check) => check.status === "failed") || errors.length > 0) {
    construct = null;
  }

  const fragments: GoldenGateFragment[] = input.vector.circular
    ? [
        {
          id: "vector-backbone",
          source: "vector",
          start: rightCut,
          end: leftCut,
          orientation: 1,
          sequence: sequencePath(vectorSequence, rightCut, leftCut),
          leftEnd: rightSite.overhang,
          rightEnd: leftSite.overhang,
        },
        {
          id: "insert",
          source: "insert",
          start: 0,
          end: insertSequence.length,
          orientation: 1,
          sequence: insertSequence,
          leftEnd: leftOverhang,
          rightEnd: rightOverhang,
        },
      ]
    : [
        {
          id: "vector-backbone",
          source: "vector",
          start: rightCut,
          end: leftCut + vectorSequence.length,
          orientation: 1,
          sequence: vectorSequence.slice(rightCut) + vectorSequence.slice(0, leftCut),
          leftEnd: rightSite.overhang,
          rightEnd: leftSite.overhang,
        },
        {
          id: "insert",
          source: "insert",
          start: 0,
          end: insertSequence.length,
          orientation: 1,
          sequence: insertSequence,
          leftEnd: leftOverhang,
          rightEnd: rightOverhang,
        },
      ];
  const graph: GoldenGateGraph = {
    validated: construct !== null,
    enzyme: input.enzyme,
    vectorSites: [leftSite, rightSite],
    fragments,
    junctions: [
      { side: "left", vectorEnd: leftSite.overhang, insertEnd: leftOverhang, compatible: leftCompatible },
      { side: "right", vectorEnd: rightSite.overhang, insertEnd: rightOverhang, compatible: rightCompatible },
    ],
    notes: [
      "Coordinates are zero-based half-open on the canonical top strand.",
      "Type IIS recognition sites and both strand cuts were used to derive the retained backbone.",
      "This is an in-silico construct; enzyme lot, methylation, star activity and wet-lab assembly efficiency remain experimental variables.",
    ],
  };
  return {
    graph,
    construct,
    checks,
    errors,
    insertStart,
    insertEnd: insertStart + insertSequence.length,
  };
}
