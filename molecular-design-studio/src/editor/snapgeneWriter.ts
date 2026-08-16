/**
 * SnapGene (.dna) binary exporter.
 *
 * Writes the version-3 SnapGene document layout that the vendored
 * bio-parsers reader (adapted from IsaacLuo's SnapGeneFileReader) parses:
 *
 *   header:
 *     0x09 | u32be 14 | "SnapGene" | u16be isDna | u16be exportVersion | u16be importVersion
 *   then a sequence of blocks:
 *     u8 blockType | u32be blockSize | payload[blockSize]
 *
 * Block types used here:
 *   0  — DNA sequence (payload = property flags byte + bases; bit 0 = circular)
 *   10 — features XML (attribute style, ranges "start-end" 1-based inclusive)
 *   6  — notes XML (CustomMapLabel carries the document name back to the parser)
 *
 * All integers are big-endian, matching the parser's bufferpack ">" reads.
 * The file must end exactly after the last block.
 */

import { getFeatureSegments } from "./featureSegments";
import type { SequenceDocument, SequenceFeature } from "../types";

/**
 * Escape a string for inclusion in XML text or attribute content.
 * Attribute values are quoted with double quotes, so all five entities are
 * escaped everywhere to stay safe.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * A tiny big-endian byte sink. SnapGene blocks are large enough that a
 * byte-per-push array would be slow for long sequences, so bytes are pushed
 * in chunks and concatenated once at the end.
 */
class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  private push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  uint8(value: number): void {
    this.push(Uint8Array.of(value & 0xff));
  }

  uint16BE(value: number): void {
    this.push(Uint8Array.of((value >> 8) & 0xff, value & 0xff));
  }

  uint32BE(value: number): void {
    this.push(
      Uint8Array.of(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ),
    );
  }

  /** Append a UTF-8 encoded string. */
  text(value: string): void {
    this.push(new TextEncoder().encode(value));
  }

  /** Append a typed block: type byte + big-endian size + payload. */
  block(type: number, payload: Uint8Array): void {
    this.uint8(type);
    this.uint32BE(payload.length);
    this.push(payload);
  }

  build(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Map a canonical strand onto SnapGene's `directionality` attribute. */
function toDirectionality(strand: SequenceFeature["strand"]): number {
  return strand === -1 ? 2 : 1;
}

function featureXml(feature: SequenceFeature, sequenceLength: number): string {
  const colorAttr = feature.color ? ` color="${xmlEscape(feature.color)}"` : "";
  // A-BIO-004: an origin-spanning feature is written as two 1-based inclusive
  // segments (e.g. `91-100` + `1-10`), mirroring SnapGene's own representation
  // of join locations.
  const segments = getFeatureSegments(feature, sequenceLength)
    .map((segment) => `<Segment range="${segment.start + 1}-${segment.end}"${colorAttr} type="standard"/>`)
    .join("");
  return (
    `<Feature name="${xmlEscape(feature.name)}" ` +
    `directionality="${toDirectionality(feature.strand)}" ` +
    `type="${xmlEscape(feature.type)}" allowSegmentOverlaps="0" ` +
    `consecutiveTranslationNumbering="1">` +
    segments +
    qualifiersXml(feature.qualifiers) +
    `</Feature>`
  );
}

/**
 * Serialize canonical qualifiers into SnapGene's `<Q name=".."><V>..</V></Q>`
 * structure. Each value becomes its own `<V>` element, so multi-value
 * qualifiers (e.g. repeated /note) survive a round-trip (A-BIO-001).
 */
function qualifiersXml(qualifiers: SequenceFeature["qualifiers"]): string {
  if (!qualifiers) return "";
  const parts: string[] = [];
  for (const [name, values] of Object.entries(qualifiers)) {
    if (!name) continue;
    const list = Array.isArray(values) ? values : [values];
    for (const value of list) {
      if (typeof value !== "string" || value.trim() === "") continue;
      parts.push(`<Q name="${xmlEscape(name)}"><V>${xmlEscape(value)}</V></Q>`);
    }
  }
  return parts.join("");
}

function validateFeature(
  feature: SequenceFeature,
  sequenceLength: number,
): void {
  if (!Number.isInteger(feature.start) || !Number.isInteger(feature.end)) {
    throw new Error(
      `Feature "${feature.name}": start and end must be integers`,
    );
  }
  // A-BIO-004: validate the effective segments instead of the raw start/end,
  // so an origin-spanning feature (start > end) is accepted while each of its
  // pieces is still range-checked.
  const segments = getFeatureSegments(feature, sequenceLength);
  for (const segment of segments) {
    if (segment.end > sequenceLength) {
      throw new Error(
        `Feature "${feature.name}": end ${segment.end} exceeds sequence length ${sequenceLength}`,
      );
    }
    if (
      !Number.isInteger(segment.start) ||
      !Number.isInteger(segment.end) ||
      segment.start < 0 ||
      segment.end <= segment.start
    ) {
      throw new Error(
        `Feature "${feature.name}": invalid segment ${segment.start}-${segment.end} (half-open [start, end))`,
      );
    }
  }
}

function newUuid(): string {
  const cryptoApi =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto
      : undefined;
  if (cryptoApi) {
    return cryptoApi.randomUUID();
  }
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/**
 * Serialize a canonical SequenceDocument into SnapGene .dna bytes.
 *
 * The document name is stored in the notes XML as CustomMapLabel so the
 * bio-parsers reader (and SnapGene itself) restores it on import.
 *
 * @throws {Error} for empty sequences or invalid feature ranges.
 */
export function exportToSnapGene(doc: SequenceDocument): Uint8Array {
  if (!doc.sequence || doc.sequence.length === 0) {
    throw new Error(
      "Cannot export an empty sequence to SnapGene (.dna). Add a sequence first.",
    );
  }
  for (const feature of doc.features) {
    validateFeature(feature, doc.sequence.length);
  }

  const writer = new ByteWriter();

  // Header. 0x09 is the leading version byte; "SnapGene" title and the three
  // u16 fields mirror real SnapGene files and satisfy the parser's checks.
  writer.uint8(0x09);
  writer.uint32BE(14);
  writer.text("SnapGene");
  writer.uint16BE(1); // isDna
  writer.uint16BE(13); // exportVersion
  writer.uint16BE(12); // importVersion

  // Sequence block. Bit 0 of the flags byte = circular; bit 1 = double-stranded.
  const sequenceFlags = (doc.circular ? 0x01 : 0x00) | 0x02;
  const encodedSequence = new TextEncoder().encode(doc.sequence);
  if (encodedSequence.length !== doc.sequence.length) {
    throw new Error(
      "Cannot export to SnapGene (.dna): sequence contains non-ASCII characters.",
    );
  }
  const sequencePayload = new Uint8Array(1 + encodedSequence.length);
  sequencePayload[0] = sequenceFlags;
  sequencePayload.set(encodedSequence, 1);
  writer.block(0, sequencePayload);

  // Features block (attribute style, matching real SnapGene exports).
  const featuresXml = doc.features
    .map((feature) => featureXml(feature, doc.sequence.length))
    .join("");
  writer.block(
    10,
    new TextEncoder().encode(
      `<?xml version="1.0"?><Features nextValidID="${doc.features.length + 1}">${featuresXml}</Features>`,
    ),
  );

  // Notes block — CustomMapLabel restores the document name on import.
  const notesXml =
    `<Notes>\n<UUID>${newUuid()}</UUID>\n` +
    `<Type>Synthetic</Type>\n<ConfirmedExperimentally>0</ConfirmedExperimentally>\n` +
    `<CustomMapLabel>${xmlEscape(doc.name)}</CustomMapLabel>\n</Notes>\n`;
  writer.block(6, new TextEncoder().encode(notesXml));

  return writer.build();
}
