/**
 * A-PERF-001 SLO baseline benchmark (vitest bench).
 *
 * Matrix: sequence length 10kb / 100kb / 1Mb × feature count 100 / 1k / 10k.
 * Operations measured (the real open / view-switch / save computation paths):
 *
 *   open        — GenBank text → parseGenBank (app parser) → toOveData (adapter)
 *                 → tidyUpSequenceData (engine open normalization)
 *                 → getCutsitesFromSequence (engine cutsite scan, representative
 *                   Common-cloning enzyme set)
 *   view switch — Sequence view: prepareRowData(60 bp/row) — the SequencePanel
 *                 row computation (feature rows + per-row sequence slices)
 *                 Map view: IntervalTree build + getYOffset per feature +
 *                 relaxLabelAngles — the CircularView label-layout core
 *   save        — serializeProjectFile (JSON.stringify of the project bundle),
 *                 exportToGenbank (text), exportToSnapGene (binary writer)
 *
 * Data is deterministic (mulberry32 PRNG with fixed seeds) so runs are
 * comparable across machines and regressions are detectable.
 *
 * Run:  npx vitest bench src/performance/slo-bench.bench.ts
 * (Bench files are only collected by `vitest bench`, never by `vitest run`.)
 */
import { bench, describe } from "vitest";
import { parseGenBank } from "../editor/parser";
import { toOveData } from "../editor/adapter";
import { exportToGenbank, exportToSnapGene } from "../editor/fileFormats";
import {
  getCutsitesFromSequence,
  tidyUpSequenceData,
} from "@teselagen/sequence-utils";
import prepareRowData from "@teselagen/ove/src/utils/prepareRowData";
import IntervalTree from "node-interval-tree";
import getYOffset from "@teselagen/ove/src/CircularView/getYOffset";
import relaxLabelAngles from "@teselagen/ove/src/CircularView/Labels/relaxLabelAngles";
import { jsonToGenbank } from "@teselagen/bio-parsers";
import { serializeProjectFile } from "../workspace/projectPersistence";
import type { SequenceDocument, SequenceFeature } from "../types";

/* ── deterministic data generation ──────────────────────────────────────── */

/** Normalize an angle into [0, 2π) — mirrors the engine's normalizeAngle. */
function normalizeAngle(angle: number): number {
  if (angle > Math.PI * 2) return angle - Math.PI * 2;
  if (angle < 0) return angle + Math.PI * 2;
  return angle;
}

/** mulberry32 — deterministic PRNG so benchmarks are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUCLEOTIDES = ["A", "C", "G", "T"] as const;

function randomSequence(length: number, rand: () => number): string {
  let out = "";
  let chunk = "";
  for (let i = 0; i < length; i++) {
    chunk += NUCLEOTIDES[Math.floor(rand() * 4)];
    if (chunk.length >= 10000) {
      out += chunk;
      chunk = "";
    }
  }
  return out + chunk;
}

function randomFeatures(
  sequenceLength: number,
  count: number,
  rand: () => number,
): SequenceFeature[] {
  const features: SequenceFeature[] = [];
  for (let i = 0; i < count; i++) {
    const maxLen = Math.min(2000, Math.max(20, sequenceLength / Math.max(1, count * 3)));
    const length = Math.max(1, Math.floor(rand() * maxLen) + 1);
    const start = Math.floor(rand() * Math.max(1, sequenceLength - length));
    features.push({
      id: `feature_${i}`,
      name: `feature_${i}`,
      type: i % 3 === 0 ? "CDS" : i % 3 === 1 ? "gene" : "misc_feature",
      start,
      end: Math.min(start + length, sequenceLength),
      strand: i % 2 === 0 ? 1 : -1,
      qualifiers: { label: [`feature_${i}`], note: ["synthetic benchmark feature"] },
      color: ["#4a7fb5", "#5e8c6a", "#c17c3e"][i % 3],
    });
  }
  return features;
}

function makeDocument(seqLen: number, featureCount: number, seed: number): SequenceDocument {
  const rand = mulberry32(seed);
  return {
    name: `bench_${seqLen}_${featureCount}`,
    sequence: randomSequence(seqLen, rand),
    circular: true,
    features: randomFeatures(seqLen, featureCount, mulberry32(seed + 1)),
  };
}

/** Representative "Common cloning" enzyme set (name + recognition regex). */
const BENCH_ENZYMES = [
  "gaattc", // EcoRI
  "ggatcc", // BamHI
  "aagctt", // HindIII
  "ctcgag", // XhoI
  "gtcgac", // SalI
  "ctgcag", // PstI
  "ggtacc", // KpnI
  "gagctc", // SacI
  "ccatgg", // NcoI
  "catatg", // NdeI
  "tctaga", // XbaI
  "actagt", // SpeI
  "gcggccgc", // NotI
  "cctgcagg", // SbfI
  "cctaagg", // AflII
  "accggt", // AgeI
  "cctagg", // AvrII
  "agatct", // BglII
  "atcgat", // ClaI
  "gatatc", // EcoRV
  "gctagc", // NheI
  "cagctg", // PvuII
  "cccggg", // SmaI/XmaI
].map((site, i) => ({
  name: `BENCH${i}`,
  site,
  forwardRegex: site,
  reverseRegex: site,
}));

/* ── build the dataset once per size×feature matrix ─────────────────────── */

const SIZES = [10_000, 100_000, 1_000_000];
const FEATURE_COUNTS = [100, 1_000, 10_000];
const BPS_PER_ROW = 60;

interface Dataset {
  seqLen: number;
  featureCount: number;
  doc: SequenceDocument;
  gbText: string;
  oveData: ReturnType<typeof toOveData>;
}

const datasets: Dataset[] = [];
for (const seqLen of SIZES) {
  for (const featureCount of FEATURE_COUNTS) {
    const doc = makeDocument(seqLen, featureCount, seqLen + featureCount * 7919);
    const oveData = toOveData(doc);
    const gbText = jsonToGenbank({
      name: doc.name,
      sequence: doc.sequence,
      circular: doc.circular,
      features: doc.features.map((f) => ({
        type: f.type,
        name: f.name,
        start: f.start,
        end: f.end - 1,
        strand: f.strand,
        notes: f.qualifiers,
        color: f.color,
      })),
    }) as string;
    datasets.push({ seqLen, featureCount, doc, gbText, oveData });
  }
}

for (const d of datasets) {
  const { seqLen, featureCount } = d;
  const label = `${seqLen >= 1_000_000 ? "1Mb" : seqLen >= 100_000 ? "100kb" : "10kb"}/${featureCount >= 1000 ? featureCount / 1000 + "k" : featureCount}f`;

  /* ── 打开 (open): parse → adapt → engine open normalization + cutsites ── */
  describe(`open ${label}`, () => {
    bench("parseGenBank", () => {
      parseGenBank(d.gbText);
    });
    bench("toOveData", () => {
      toOveData(d.doc);
    });
    bench("tidyUpSequenceData", () => {
      tidyUpSequenceData(d.oveData);
    });
    bench("getCutsitesFromSequence (23 enzymes)", () => {
      getCutsitesFromSequence(d.doc.sequence, d.doc.circular, BENCH_ENZYMES);
    });
  });

  /* ── 切视图 (view switch): Sequence rows + Map label layout ───────────── */
  describe(`view-switch ${label}`, () => {
    bench("prepareRowData (Sequence view, 60bp/row)", () => {
      prepareRowData(d.oveData, BPS_PER_ROW);
    });
    bench("map-layout (IntervalTree + getYOffset + relaxLabelAngles)", () => {
      const tree = new IntervalTree();
      const outerRadius = Math.max(400, seqLen / 500);
      const labeled: Array<{ start: number; end: number; yOffset: number }> = [];
      for (const f of d.oveData.features) {
        const start = Math.min(f.start, f.end);
        const end = Math.max(f.start, f.end);
        const yOffset = getYOffset(tree, start, end);
        tree.insert(start, end, { start, end, yOffset });
        labeled.push({ start, end, yOffset });
      }
      // Build engine-shaped label points (relaxLabelAngles reads angle/y/x and
      // mutates labelAndSublabels/labelIds). Without x/y/angle/labelIds the
      // function crashes on the first label whose |y| exceeds maxradius+80.
      const labelPoints = labeled.map((l, i) => {
        const angle = normalizeAngle((2 * Math.PI * (l.start + l.end) / 2) / seqLen);
        const y = Math.sin(angle) * outerRadius * -1;
        const x = Math.cos(angle) * outerRadius;
        const base = {
          id: `l${i}`,
          angle,
          x,
          y,
          name: "feature",
          // annotationCenterAngle is what combineLabels buckets on — without it
          // every label falls into buckets[NaN] and the real bucketing cost is
          // skipped (all labels collapse into one bucket).
          annotationCenterAngle: angle,
        };
        return {
          ...base,
          labelAndSublabels: [base] as unknown[],
          labelIds: { [`l${i}`]: true },
        };
      });
      relaxLabelAngles(labelPoints, 12, outerRadius);
    });
  });

  /* ── 保存 (save): project bundle + GenBank text + SnapGene binary ─────── */
  describe(`save ${label}`, () => {
    const projects = {
      version: 1 as const,
      activeId: "proj_1",
      projects: [
        {
          id: "proj_1",
          name: d.doc.name,
          doc: d.doc,
          filePath: null,
          isDirty: true,
          history: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    };
    bench("serializeProjectFile", () => {
      serializeProjectFile(projects);
    });
    bench("exportToGenbank", () => {
      exportToGenbank(d.doc);
    });
    bench("exportToSnapGene", () => {
      exportToSnapGene(d.doc);
    });
  });
}
