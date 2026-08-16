/**
 * Lossy-export detection (A-FILE-001).
 *
 * Before writing a file, Save As shows which document fields the chosen
 * format cannot represent. FASTA drops every annotation; SnapGene .dna keeps
 * features and qualifiers but has no accession/version fields; GenBank keeps
 * the whole canonical model.
 */
import type { SequenceDocument } from "../types";
import type { SequenceFileFormat } from "./fileFormats";

export interface ExportLoss {
  field: string;
  description: string;
}

/**
 * Fields the document actually carries (so empty documents produce no noise).
 * Returns a list of losses for the given format, empty when lossless.
 *
 * Note: qualifiers only ever exist on features, so counting features is
 * sufficient — a document with qualifiers necessarily has features.
 */
export function getExportLosses(
  doc: SequenceDocument,
  format: SequenceFileFormat,
): ExportLoss[] {
  const losses: ExportLoss[] = [];
  const featureCount = doc.features.length;

  if (format === "fasta") {
    if (featureCount > 0) {
      losses.push({
        field: "features",
        description: `${featureCount} 个特征注解（含引物/标签及 qualifiers）不会写入 FASTA`,
      });
    }
    if (doc.circular) {
      losses.push({
        field: "topology",
        description: "环形拓扑信息会丢失，导出后按线性序列读取",
      });
    }
    if (doc.accession || doc.version) {
      losses.push({
        field: "accession",
        description: `accession${doc.version ? ` / version（${doc.accession ?? "—"}/${doc.version}）` : `（${doc.accession}）`}不会写入 FASTA`,
      });
    }
  }

  if (format === "snapgene" && (doc.accession || doc.version)) {
    losses.push({
      field: "accession",
      description: `accession / version（${doc.accession ?? "—"}/${doc.version ?? "—"}）在 SnapGene .dna 中无对应字段`,
    });
  }

  return losses;
}
