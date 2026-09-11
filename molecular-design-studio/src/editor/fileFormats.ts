/**
 * File format detection, parsing dispatch, and export for sequence files.
 *
 * Supports GenBank (.gb, .gbk), FASTA (.fasta, .fa, .fna), and SnapGene
 * (.dna) input and output.
 * Extensions are normalized case-insensitively.
 * Unsupported extensions produce an explicit error — never a silent format change.
 */

import { parseGenBank, parseFasta, parseSnapGene } from "./parser";
import { jsonToGenbank, jsonToFasta } from "@teselagen/bio-parsers";
import { exportToSnapGene } from "./snapgeneWriter";
import { getFeatureSegments } from "./featureSegments";
import { parseAb1File } from "./ab1Parser";
import type { SequenceDocument } from "../types";

export { exportToSnapGene };

export type SequenceFileFormat = "genbank" | "fasta" | "snapgene" | "ab1";
export type SequenceFileContents = string | Uint8Array;

const EXTENSION_FORMAT: Record<string, SequenceFileFormat> = {
  gb: "genbank",
  gbk: "genbank",
  fasta: "fasta",
  fa: "fasta",
  fna: "fasta",
  dna: "snapgene",
  ab1: "ab1",
  abi: "ab1",
};

function portableBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "sequence.dna";
}

/**
 * Detect the sequence file format from a filename extension.
 * Returns null for unsupported or missing extensions.
 */
export function getFormatFromExtension(
  filename: string,
): SequenceFileFormat | null {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return null;
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return EXTENSION_FORMAT[ext] ?? null;
}

/**
 * Parse a sequence text file into a canonical SequenceDocument.
 * Dispatches to the appropriate parser based on the filename extension.
 *
 * @throws {Error} for unsupported extensions or parsing failures.
 */
export async function parseSequenceFile(
  contents: SequenceFileContents,
  filename: string,
): Promise<SequenceDocument> {
  const format = getFormatFromExtension(filename);
  if (!format) {
    const ext = filename.includes(".")
      ? filename.slice(filename.lastIndexOf("."))
      : "(none)";
    throw new Error(`Unsupported file extension: ${ext}`);
  }
  switch (format) {
    case "genbank": {
      if (typeof contents !== "string") {
        throw new Error("GenBank input must be text");
      }
      return parseGenBank(contents);
    }
    case "fasta": {
      if (typeof contents !== "string") {
        throw new Error("FASTA input must be text");
      }
      return parseFasta(contents);
    }
    case "snapgene": {
      if (typeof contents === "string") {
        throw new Error("SnapGene .dna input must be binary");
      }
      return parseSnapGene(contents, portableBasename(filename));
    }
    case "ab1": {
      if (typeof contents === "string") {
        throw new Error("ABI .ab1 input must be binary");
      }
      return parseAb1Document(contents, portableBasename(filename));
    }
  }
}

/**
 * Parse an ABI/Sanger .ab1 trace into a plain sequence document.
 *
 * Import keeps only the called bases (no chromatogram data) so the read
 * opens as an ordinary new document, on par with GenBank/FASTA imports.
 * The read name falls back to the file name when the ABI tag has no name.
 */
async function parseAb1Document(
  bytes: Uint8Array,
  filename: string,
): Promise<SequenceDocument> {
  // ArrayBuffer.isView (not instanceof) so node Buffers from tests and other
  // realms pass the same binary check as browser Uint8Arrays.
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength === 0) {
    throw new Error("ABI input is empty");
  }
  // Wrap the bytes in a File: the bio-parser's browser path reads through
  // FileReader, which is the reliable route in the Tauri webview and in
  // jsdom tests alike (plain ArrayBuffers are inconsistent across realms).
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const file = new File([buffer], filename, { type: "application/octet-stream" });
  const trace = await parseAb1File(file);
  const fileBase = filename.replace(/\.(ab1|abi)$/i, "").trim();
  return {
    name: fileBase || trace.name || "Sequencing read",
    sequence: trace.sequence,
    circular: false,
    features: [],
  };
}

/**
 * Export a canonical SequenceDocument to GenBank format text.
 *
 * Converts canonical half-open feature coordinates [start, end) to
 * bio-parsers inclusive coordinates [start, end] for export.
 *
 * @throws {Error} if the export fails.
 */
export function exportToGenbank(doc: SequenceDocument): string {
  const features = doc.features.map((f) => {
    // A-BIO-004: a multi-segment feature (join / origin-spanning) is written
    // as a `join(...)` location. bio-parsers expects zero-based inclusive
    // coordinates inside `locations` (same convention as start/end).
    const segments = getFeatureSegments(f, doc.sequence.length);
    const locations =
      segments.length > 1
        ? segments.map((segment) => ({
            start: segment.start,
            end: segment.end - 1,
          }))
        : undefined;
    return {
      type: f.type,
      name: f.name,
      start: f.start,
      end: f.end - 1,
      ...(locations ? { locations } : {}),
      strand: f.strand,
      notes: f.qualifiers,
      color: f.color,
    };
  });

  const result = jsonToGenbank({
    name: doc.name,
    sequence: doc.sequence,
    circular: doc.circular,
    features,
    accession: doc.accession,
    version: doc.version,
  });

  if (!result || typeof result !== "string") {
    throw new Error("GenBank export failed");
  }
  // bio-parsers emits these two headers before column 13. Fixed-column
  // GenBank readers otherwise truncate the accession/version on re-import.
  return result.replace(/^(ACCESSION|VERSION)[ \t]+([^\r\n]*)/gm,
    (_line, key: string, value: string) => `${key.padEnd(12)}${value}`);
}

/**
 * Export a canonical SequenceDocument to FASTA format text.
 */
export function exportToFasta(doc: SequenceDocument): string {
  return jsonToFasta({
    name: doc.name,
    sequence: doc.sequence,
    circular: doc.circular,
  });
}

/**
 * Export a canonical SequenceDocument to the format determined by the filename.
 *
 * SnapGene (.dna) exports return binary bytes; GenBank and FASTA return text.
 * ABI (.ab1) is import-only: exporting a read back to a trace is not
 * supported and throws.
 *
 * @throws {Error} for unsupported extensions, ABI export, or export failures.
 */
export function exportSequenceFile(
  doc: SequenceDocument,
  filename: string,
): string | Uint8Array {
  const format = getFormatFromExtension(filename);
  if (!format) {
    const ext = filename.includes(".")
      ? filename.slice(filename.lastIndexOf("."))
      : "(none)";
    throw new Error(`Unsupported file extension: ${ext}`);
  }
  switch (format) {
    case "genbank":
      return exportToGenbank(doc);
    case "fasta":
      return exportToFasta(doc);
    case "snapgene":
      return exportToSnapGene(doc);
    case "ab1":
      throw new Error("ABI .ab1 trace export is not supported");
  }
}
