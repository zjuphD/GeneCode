/**
 * Sequence parser boundary.
 *
 * Converts GenBank, FASTA, or SnapGene input into the canonical
 * SequenceDocument model.
 * Uses @teselagen/bio-parsers for the actual parsing, then maps the result
 * into our canonical types. Fails visibly on invalid input.
 *
 * bio-parsers returns: [{ parsedSequence: { name, sequence, circular, features, ... }, success, messages }]
 * GenBank features use zero-based inclusive coordinates [start, end].
 * Canonical model uses zero-based half-open [start, end).
 * Conversion: canonical end = parser end + 1
 */

import {
  genbankToJson,
  fastaToJson,
  snapgeneToJson,
} from "@teselagen/bio-parsers";
import { segmentsFromInclusive } from "./featureSegments";
import type { SequenceDocument, SequenceFeature } from "../types";

/**
 * Validate and convert a parser feature to canonical form.
 * Throws if the feature has an invalid range — never silently discards.
 *
 * A-BIO-004: an origin-spanning circular location (GenBank `join(91..100,1..10)`
 * arrives from bio-parsers as inclusive `{start: 90, end: 9}`) is no longer
 * rejected — it becomes a canonical `segments` feature with start > end.
 * A `locations` array (explicit join pieces) is honored when present.
 */
export function convertFeature(
  f: { type?: string; name?: string; start: number; end: number; strand?: number; color?: string; notes?: Record<string, string[]>; locations?: Array<{ start: number; end: number }> },
  index: number,
  sequenceLength: number,
  circular = true,
): SequenceFeature {
  const label = f.name ?? f.type ?? `feature_${index}`;

  // Validate: start/end must be finite integers
  if (!Number.isInteger(f.start) || !Number.isInteger(f.end)) {
    throw new Error(
      `Feature "${label}" (index ${index}): start and end must be integers`,
    );
  }
  // Validate: start must not be negative
  if (f.start < 0) {
    throw new Error(
      `Feature "${label}" (index ${index}): start ${f.start} is negative`,
    );
  }
  // A joined / origin-spanning location (inclusive end before start) is only
  // legal on a circular molecule. Linear records keep the strict check.
  const wraps = f.end < f.start;
  if (wraps && !circular) {
    throw new Error(
      `Feature "${label}" (index ${index}): end ${f.end} is before start ${f.start} on a linear sequence`,
    );
  }
  // Validate: start must be inside the sequence
  if (f.start >= sequenceLength) {
    throw new Error(
      `Feature "${label}" (index ${index}): start ${f.start} >= sequence length ${sequenceLength}`,
    );
  }
  // Validate: inclusive end must be inside the sequence
  if (f.end >= sequenceLength) {
    throw new Error(
      `Feature "${label}" (index ${index}): end ${f.end} >= sequence length ${sequenceLength}`,
    );
  }

  // bio-parsers features use zero-based inclusive [start, end].
  // Canonical model uses zero-based half-open [start, end).
  // Conversion: canonical end = inclusive end + 1
  const start = f.start;
  const end = f.end + 1;

  // A-BIO-004: explicit join pieces (when the parser provides them) take
  // precedence; otherwise a wrapping inclusive range becomes the two canonical
  // segments [{start, seqLen}, {0, end}].
  const explicitSegments = segmentsFromInclusive(f.locations ?? [], sequenceLength);
  const segments =
    explicitSegments ??
    (wraps
      ? [{ start, end: sequenceLength }, { start: 0, end }]
      : undefined);

  // Derive name from notes or type
  const name =
    f.name ??
    f.notes?.note?.[0] ??
    f.notes?.gene?.[0] ??
    f.type ??
    `feature_${index}`;

  return {
    id: `feature-${index}`,
    name: name.substring(0, 100),
    type: f.type ?? "misc_feature",
    start,
    end,
    strand: f.strand === -1 ? -1 : 1,
    qualifiers: f.notes ?? {},
    color: f.color,
    ...(segments ? { segments } : {}),
  };
}

/**
 * Parse a GenBank text string into a canonical SequenceDocument.
 *
 * @throws {Error} if the parser fails or returns empty/invalid data.
 */
export function parseGenBank(text: string): SequenceDocument {
  if (!text || text.trim().length === 0) {
    throw new Error("GenBank input is empty");
  }

  const results = genbankToJson(text);

  if (!results || results.length === 0) {
    throw new Error("GenBank parser returned no results");
  }

  const result = results[0];

  if (!result) {
    throw new Error("GenBank parser returned empty first result");
  }

  if (!result.success) {
    const msgs = result.messages?.join("; ") ?? "unknown error";
    throw new Error(`GenBank parser failed: ${msgs}`);
  }

  const ps = result.parsedSequence;

  if (!ps) {
    throw new Error("GenBank parser result has no parsedSequence");
  }

  if (!ps.sequence || ps.sequence.length === 0) {
    throw new Error(
      `GenBank record "${ps.name ?? "(unnamed)"}" has no sequence data`,
    );
  }

  const sequenceLength = ps.sequence.length;

  const features: SequenceFeature[] = [];
  const circular = ps.circular ?? false;
  for (let i = 0; i < (ps.features ?? []).length; i++) {
    const f = (ps.features ?? [])[i]!;
    features.push(convertFeature(f, i, sequenceLength, circular));
  }

  return {
    name: ps.name ?? "Unnamed",
    sequence: ps.sequence.toUpperCase(),
    circular: ps.circular ?? false,
    features,
    accession: ps.accession,
    version: ps.version,
  };
}

/**
 * Parse a single-record FASTA text string into a canonical SequenceDocument.
 *
 * Rejects empty input, multi-record FASTA, and parsing failures with clear errors.
 * FASTA sequences are always linear with zero annotations.
 *
 * @throws {Error} if the parser fails, returns no data, or contains multiple records.
 */
export function parseFasta(text: string): SequenceDocument {
  if (!text || text.trim().length === 0) {
    throw new Error("FASTA input is empty");
  }

  const results = fastaToJson(text);

  if (!results || results.length === 0) {
    throw new Error("FASTA parser returned no results");
  }

  if (results.length > 1) {
    throw new Error(
      "Multiple FASTA records found. Only single-record FASTA files are supported.",
    );
  }

  const result = results[0];

  if (!result) {
    throw new Error("FASTA parser returned empty first result");
  }

  if (!result.success) {
    const msgs = result.messages?.join("; ") ?? "unknown error";
    throw new Error(`FASTA parser failed: ${msgs}`);
  }

  const ps = result.parsedSequence;

  if (!ps) {
    throw new Error("FASTA parser result has no parsedSequence");
  }

  if (!ps.sequence || ps.sequence.length === 0) {
    throw new Error(
      `FASTA record "${ps.name ?? "(unnamed)"}" has no sequence data`,
    );
  }

  return {
    name: ps.name ?? "Unnamed",
    sequence: ps.sequence.toUpperCase(),
    circular: false,
    features: [],
  };
}

/**
 * Parse a SnapGene binary document into the canonical sequence model.
 *
 * SnapGene files are binary, so the parser receives bytes rather than text.
 * The installed bio-parser runs through FileReader in the Tauri webview.
 *
 * @throws {Error} if the file is empty, invalid, or contains no sequence.
 */
/**
 * Decode the five XML entities escaped by the SnapGene writer.
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Locate the features XML block (type 10) inside a SnapGene binary file.
 *
 * The block layout mirrors the writer: a header ending after "SnapGene" plus
 * three u16 fields, then repeated `type | u32be size | payload` blocks. The
 * vendored bio-parsers reader already parses feature coordinates but drops
 * qualifiers, so the binary is scanned again here for the qualifier payload.
 */
function extractSnapGeneFeaturesXml(bytes: Uint8Array): string | null {
  const magic = new TextEncoder().encode("SnapGene");
  let headerEnd = -1;
  outer: for (let i = 0; i + magic.length <= bytes.length; i++) {
    for (let j = 0; j < magic.length; j++) {
      if (bytes[i + j] !== magic[j]) continue outer;
    }
    headerEnd = i + magic.length + 6; // "SnapGene" + u16 isDna + u16 exportVersion + u16 importVersion
    break;
  }
  if (headerEnd < 0) return null;
  let offset = headerEnd;
  while (offset + 5 <= bytes.length) {
    const type = bytes[offset]!;
    // Unsigned u32 big-endian read (multiplication, not bit shifts — the
    // latter are signed 32-bit and would go negative for large blocks).
    const size =
      bytes[offset + 1]! * 0x1000000 +
      bytes[offset + 2]! * 0x10000 +
      bytes[offset + 3]! * 0x100 +
      bytes[offset + 4]!;
    offset += 5;
    if (offset + size > bytes.length) return null;
    if (type === 10) {
      return new TextDecoder().decode(bytes.slice(offset, offset + size));
    }
    offset += size;
  }
  return null;
}

/**
 * Parse `<Q name=".."><V>..</V></Q>` qualifier blocks out of one feature's
 * XML body, grouping repeated values under the same name (A-BIO-001).
 */
function parseSnapGeneQualifiers(xml: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  // Matches both `<Q name=".."><V>..</V></Q>` and self-closing `<Q name=".."/>`.
  const qRe = /<Q\s+name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/Q>)/g;
  let m: RegExpExecArray | null;
  while ((m = qRe.exec(xml)) !== null) {
    const name = decodeXmlEntities(m[1]!);
    if (!name) continue;
    const values: string[] = [];
    if (m[3] !== undefined) {
      const vRe = /<V>([\s\S]*?)<\/V>/g;
      let v: RegExpExecArray | null;
      while ((v = vRe.exec(m[3])) !== null) {
        values.push(decodeXmlEntities(v[1]!));
      }
    }
    out[name] = [...(out[name] ?? []), ...values];
  }
  return out;
}

/**
 * Align per-feature qualifier maps with the feature order in the XML.
 */
function parsePerFeatureQualifiers(xml: string): Array<Record<string, string[]>> {
  const result: Array<Record<string, string[]>> = [];
  const featRe = /<Feature\b[^>]*>([\s\S]*?)<\/Feature>/g;
  let m: RegExpExecArray | null;
  while ((m = featRe.exec(xml)) !== null) {
    result.push(parseSnapGeneQualifiers(m[1]!));
  }
  return result;
}

export async function parseSnapGene(
  bytes: Uint8Array,
  filename = "sequence.dna",
): Promise<SequenceDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error("SnapGene input is empty");
  }

  const binary = Uint8Array.from(bytes).buffer;
  const file = new Blob([binary], { type: "application/octet-stream" });
  const results = await snapgeneToJson(file, { fileName: filename });

  if (!results || results.length === 0) {
    throw new Error("SnapGene parser returned no results");
  }

  const result = results[0];
  if (!result) {
    throw new Error("SnapGene parser returned empty first result");
  }
  if (!result.success) {
    const msgs = result.messages?.join("; ") ?? "unknown error";
    throw new Error(`SnapGene parser failed: ${msgs}`);
  }

  const ps = result.parsedSequence;
  if (!ps) {
    throw new Error("SnapGene parser result has no parsedSequence");
  }
  if (!ps.sequence || ps.sequence.length === 0) {
    throw new Error(
      `SnapGene record "${ps.name ?? "(unnamed)"}" has no sequence data`,
    );
  }

  const sequenceLength = ps.sequence.length;
  // bio-parsers drops feature qualifiers; re-extract them from the binary's
  // features XML block so .dna round-trips preserve gene/translation/note/….
  const featuresXml = extractSnapGeneFeaturesXml(bytes);
  const perFeatureQualifiers = featuresXml
    ? parsePerFeatureQualifiers(featuresXml)
    : [];
  const features: SequenceFeature[] = [];
  const circular = ps.circular ?? false;
  for (let i = 0; i < (ps.features ?? []).length; i++) {
    const feature = (ps.features ?? [])[i]!;
    const converted = convertFeature(feature, i, sequenceLength, circular);
    const qualifiers = perFeatureQualifiers[i];
    if (qualifiers && Object.keys(qualifiers).length > 0) {
      converted.qualifiers = { ...converted.qualifiers, ...qualifiers };
    }
    features.push(converted);
  }

  const normalizedFilename = filename.replace(/\\/g, "/");
  const fallbackName =
    normalizedFilename
      .slice(normalizedFilename.lastIndexOf("/") + 1)
      .replace(/\.dna$/i, "") || "Unnamed";
  // Coerce to string: bio-parsers' notes XML goes through fast-xml-parser,
  // whose parseTagValue coerces purely numeric names (e.g. "123", "0") to
  // numbers — optional chaining would then crash or silently drop them.
  const parsedName = String(ps.name ?? "").trim();
  const safeName =
    parsedName && !parsedName.includes("/") && !parsedName.includes("\\")
      ? parsedName
      : fallbackName;

  return {
    name: safeName,
    sequence: ps.sequence.toUpperCase(),
    circular: ps.circular ?? false,
    features,
    accession: ps.accession,
    version: ps.version,
  };
}

/**
 * Parse a multi-record FASTA text into an array of SequenceDocuments.
 *
 * Each record becomes a separate document. Useful for batch import
 * of primer lists, target sequences, or multi-gene panels.
 *
 * @throws {Error} if the parser fails or returns no data.
 */
export function parseMultiFasta(text: string): SequenceDocument[] {
  if (!text || text.trim().length === 0) {
    throw new Error("FASTA input is empty");
  }

  const results = fastaToJson(text);

  if (!results || results.length === 0) {
    throw new Error("FASTA parser returned no results");
  }

  const docs: SequenceDocument[] = [];
  for (const result of results) {
    if (!result || !result.success || !result.parsedSequence) continue;
    const ps = result.parsedSequence;
    if (!ps.sequence || ps.sequence.length === 0) continue;
    docs.push({
      name: ps.name ?? `Sequence ${docs.length + 1}`,
      sequence: ps.sequence.toUpperCase(),
      circular: false,
      features: [],
    });
  }

  if (docs.length === 0) {
    throw new Error("No valid sequences found in FASTA input");
  }

  return docs;
}
