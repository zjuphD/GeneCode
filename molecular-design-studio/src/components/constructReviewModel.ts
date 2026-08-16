import type { ResultCandidate } from "../agent/responseTypes";

export type ReviewStatus = "passed" | "review" | "blocked";

interface ReviewCheck {
  key: string;
  label: string;
  status: ReviewStatus;
  detail: string;
}

interface JunctionReview {
  side: string;
  label: string;
  overlap: string;
  assembledPreview: string;
}

interface PrimerArchitecture {
  name: string;
  tail: string;
  core: string;
  tailPurpose: string;
}

export interface BackboneLinearization {
  available: boolean;
  status: ReviewStatus;
  method: string;
  vectorTopology: string;
  vectorLength: number | null;
  editMode: string;
  editStart: number | null;
  editEnd: number | null;
  removedLength: number | null;
  ampliconLength: number | null;
  ampliconDigest: string;
  forwardPrimer: string;
  reversePrimer: string;
  forwardCore: string;
  reverseCore: string;
  forwardBinding: Record<string, unknown>;
  reverseBinding: Record<string, unknown>;
  tmForward: number | null;
  tmReverse: number | null;
  gcForward: number | null;
  gcReverse: number | null;
  instructions: string[];
  reason: string;
}

export interface ExpectedConstruct {
  available: boolean;
  length: number | null;
  vectorLength: number | null;
  replacedLength: number | null;
  editMode: string;
  editStart: number | null;
  editEnd: number | null;
  sequenceDigest: string;
}

interface ConstructReviewModel {
  method: "gibson" | "golden_gate";
  status: ReviewStatus;
  summary: string;
  insertLength: number | null;
  fragmentCount: number;
  junctions: JunctionReview[];
  primers: PrimerArchitecture[];
  backboneLinearization: BackboneLinearization | null;
  expectedConstruct: ExpectedConstruct;
  checks: ReviewCheck[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function status(value: unknown): ReviewStatus {
  return value === "blocked" || value === "review" ? value : "passed";
}

export function getConstructReview(candidate: ResultCandidate): ConstructReviewModel | null {
  const raw = candidate.raw;
  const source = isRecord(raw?.construct_review) ? raw.construct_review : null;
  const methodToken = text(source?.method).toLowerCase();
  if (!source || (methodToken !== "gibson" && methodToken !== "golden_gate")) return null;
  const method: "gibson" | "golden_gate" = methodToken;

  const insert = isRecord(source.insert) ? source.insert : {};
  const fragments = Array.isArray(source.fragments) ? source.fragments : [];
  const expected = isRecord(source.expectedConstruct) ? source.expectedConstruct : {};
  const junctions = Array.isArray(source.junctions)
    ? source.junctions.flatMap((item): JunctionReview[] => {
        if (!isRecord(item)) return [];
        const overlap = text(item.overlap);
        const assembledPreview = text(item.assembledPreview);
        if (!overlap && !assembledPreview) return [];
        return [{
          side: text(item.side),
          label: text(item.label) || "Junction",
          overlap,
          assembledPreview,
        }];
      })
    : [];
  const primers = Array.isArray(source.primerArchitecture)
    ? source.primerArchitecture.flatMap((item): PrimerArchitecture[] => {
        if (!isRecord(item)) return [];
        const tail = text(item.tail);
        const core = text(item.core);
        if (!tail && !core) return [];
        return [{
          name: text(item.name) || "Primer",
          tail,
          core,
          tailPurpose: text(item.tailPurpose),
        }];
      })
    : [];
  const rawBackbone = isRecord(source.backboneLinearization) ? source.backboneLinearization : null;
  const backboneLinearization: BackboneLinearization | null = rawBackbone
    ? {
        available: rawBackbone.available === true,
        status: status(rawBackbone.status),
        method: text(rawBackbone.method),
        vectorTopology: text(rawBackbone.vectorTopology),
        vectorLength: numberOrNull(rawBackbone.vectorLength),
        editMode: text(rawBackbone.editMode),
        editStart: numberOrNull(rawBackbone.editStart),
        editEnd: numberOrNull(rawBackbone.editEnd),
        removedLength: numberOrNull(rawBackbone.removedLength),
        ampliconLength: numberOrNull(rawBackbone.ampliconLength),
        ampliconDigest: text(rawBackbone.ampliconDigest),
        forwardPrimer: text(rawBackbone.forwardPrimer),
        reversePrimer: text(rawBackbone.reversePrimer),
        forwardCore: text(rawBackbone.forwardCore),
        reverseCore: text(rawBackbone.reverseCore),
        forwardBinding: isRecord(rawBackbone.forwardBinding) ? rawBackbone.forwardBinding : {},
        reverseBinding: isRecord(rawBackbone.reverseBinding) ? rawBackbone.reverseBinding : {},
        tmForward: numberOrNull(rawBackbone.tmForward),
        tmReverse: numberOrNull(rawBackbone.tmReverse),
        gcForward: numberOrNull(rawBackbone.gcForward),
        gcReverse: numberOrNull(rawBackbone.gcReverse),
        instructions: Array.isArray(rawBackbone.instructions)
          ? rawBackbone.instructions.filter((item): item is string => typeof item === "string")
          : [],
        reason: text(rawBackbone.reason),
      }
    : null;
  const checks = Array.isArray(source.checks)
    ? source.checks.flatMap((item): ReviewCheck[] => {
        if (!isRecord(item)) return [];
        const label = text(item.label);
        if (!label) return [];
        return [{
          key: text(item.key) || label,
          label,
          status: status(item.status),
          detail: text(item.detail),
        }];
      })
    : [];

  return {
    method,
    status: status(source.status),
    summary: text(source.summary),
    insertLength: numberOrNull(insert.length),
    fragmentCount: numberOrNull(source.fragmentCount) ?? numberOrNull(insert.fragmentCount) ?? (fragments.length || 1),
    junctions,
    primers,
    backboneLinearization,
    expectedConstruct: {
      available: expected.available === true,
      length: numberOrNull(expected.length),
      vectorLength: numberOrNull(expected.vectorLength),
      replacedLength: numberOrNull(expected.replacedLength),
      editMode: text(expected.editMode),
      editStart: numberOrNull(expected.editStart),
      editEnd: numberOrNull(expected.editEnd),
      sequenceDigest: text(expected.sequenceDigest),
    },
    checks,
  };
}
