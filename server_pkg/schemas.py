"""schemas — GeneCode agent backend module (A-MAINT-001 split from server.py)."""
from __future__ import annotations

from typing import Any
from dataclasses import dataclass

# ── Coordinate system conventions ─────────────────────────────────────────────
#
# This file uses TWO coordinate systems internally, by subsystem:
#
#   Restriction enzyme / primer subsystems:  1-based inclusive
#     - "start" = 1-based start position (first base of the site/primer = 1)
#     - "end"   = 1-based inclusive end position
#     - "cut"   = 0-based absolute coordinate (phosphodiester bond index)
#     These fields appear in the SAME dict (e.g. find_restriction_site_hits).
#     Consumers must treat "start"/"end" as 1-based and "cut" as 0-based.
#
#   Agent context tools (read_open_sequence, list_features, etc.):  0-based half-open
#     - Input from frontend featureSummary: 0-based half-open [start, end)
#     - GenBank parsing: 1-based inclusive → converted to 0-based half-open
#     - All context tool output: 0-based half-open [start, end)
#
#   Circular topology:
#     - Positions wrap around: norm_start = raw_start % seq_len
#     - "wraps_origin" flag indicates the site spans the sequence origin
#     - digest_fragment_lengths handles circular wrapping correctly
#
# This is documented here as the single source of truth.  Do not change
# one subsystem without checking the other.
#
# API Contract:
#   All API responses that include positional data MUST carry:
#     coordinate_system: "zero_based_half_open" | "one_based_inclusive"
#     topology: "linear" | "circular"
#     strand: "+" | "-" | "both"
#   The canonical internal representation is zero_based_half_open [start, end).
#   The RE/primer subsystem uses 1-based inclusive internally and converts
#   to 0-based half-open in API output via _to_zbho().
# ──────────────────────────────────────────────────────────────────────────────

# Canonical coordinate system constant
COORDINATE_SYSTEM = "zero_based_half_open"
def _to_zbho(start_1based: int, end_1based_inclusive: int) -> tuple[int, int]:
    """Convert 1-based inclusive [start, end] to 0-based half-open [start, end)."""
    return (start_1based - 1, end_1based_inclusive)
def coordinate_metadata(
    topology: str = "linear",
    strand: str = "+",
    coordinate_system: str = COORDINATE_SYSTEM,
) -> dict[str, str]:
    """Build the standard coordinate metadata block for API responses."""
    return {
        "coordinate_system": coordinate_system,
        "topology": topology,
        "strand": strand,
    }
class ApiError(Exception):
    pass
@dataclass
class SequenceFeature:
    type: str
    location: str
    qualifiers: dict[str, str]
@dataclass
class SequenceDocument:
    name: str
    sequence: str
    format: str = "plain"
    description: str = ""
    accession: str | None = None
    version: str | None = None
    topology: str = "linear"
    molecule_type: str = "DNA"
    source: str | None = None
    organism: str | None = None
    date: str | None = None
    features: list[SequenceFeature] | None = None
@dataclass
class SequencePayload:
    sequence: str
    accession: str | None
    source_label: str
    note: str
    junctions: list[int]
    transcript_options: list[dict[str, Any]] | None = None
    species: str = "Homo sapiens"
    gene_symbol: str | None = None
    strain: str | None = None
    document: SequenceDocument | None = None
    cds_summary: dict[str, Any] | None = None
    variant_sequences: list[dict[str, Any]] | None = None
