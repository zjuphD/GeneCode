"""bio — GeneCode agent backend module (A-MAINT-001 split from server.py)."""
from __future__ import annotations

from typing import Any
import xml.etree.ElementTree as ET
from dataclasses import asdict
import hashlib
import json
import math
import os
from urllib.parse import quote
import re
import time
from urllib.parse import urlencode

from .schemas import ApiError, COORDINATE_SYSTEM, SequenceDocument, SequenceFeature, SequencePayload, _to_zbho
from .config import ACCESSION_RE, BLAST_BASE, BLAST_CACHE_TTL, CLONING_COMMON_INSERT_ALIASES, ENSEMBL_BASE, ENSEMBL_CACHE_TTL, MAX_SEQUENCE_LENGTH, NCBI_BASE, cache_fetch, cache_get, cache_key, cache_set, record_remote_cache_hit, record_remote_error, remote_text_request

PAM_LIBRARY = {
    "spcas9_ngg": {
        "label": "SpCas9 NGG",
        "patterns": ["NGG"],
        "pam_bias": {"NGG": 0},
    },
    "spcas9_relaxed": {
        "label": "SpCas9 NGG/NAG/NGA",
        "patterns": ["NGG", "NAG", "NGA"],
        "pam_bias": {"NGG": 0, "NAG": -5, "NGA": -8},
    },
}
GENETIC_CODE = {
    "TTT": "F", "TTC": "F", "TTA": "L", "TTG": "L",
    "TCT": "S", "TCC": "S", "TCA": "S", "TCG": "S",
    "TAT": "Y", "TAC": "Y", "TAA": "*", "TAG": "*",
    "TGT": "C", "TGC": "C", "TGA": "*", "TGG": "W",
    "CTT": "L", "CTC": "L", "CTA": "L", "CTG": "L",
    "CCT": "P", "CCC": "P", "CCA": "P", "CCG": "P",
    "CAT": "H", "CAC": "H", "CAA": "Q", "CAG": "Q",
    "CGT": "R", "CGC": "R", "CGA": "R", "CGG": "R",
    "ATT": "I", "ATC": "I", "ATA": "I", "ATG": "M",
    "ACT": "T", "ACC": "T", "ACA": "T", "ACG": "T",
    "AAT": "N", "AAC": "N", "AAA": "K", "AAG": "K",
    "AGT": "S", "AGC": "S", "AGA": "R", "AGG": "R",
    "GTT": "V", "GTC": "V", "GTA": "V", "GTG": "V",
    "GCT": "A", "GCC": "A", "GCA": "A", "GCG": "A",
    "GAT": "D", "GAC": "D", "GAA": "E", "GAG": "E",
    "GGT": "G", "GGC": "G", "GGA": "G", "GGG": "G",
}
AA_ALIASES = {
    "A": "A", "ALA": "A", "ALANINE": "A",
    "R": "R", "ARG": "R", "ARGININE": "R",
    "N": "N", "ASN": "N", "ASPARAGINE": "N",
    "D": "D", "ASP": "D", "ASPARTATE": "D", "ASPARTICACID": "D",
    "C": "C", "CYS": "C", "CYSTEINE": "C",
    "Q": "Q", "GLN": "Q", "GLUTAMINE": "Q",
    "E": "E", "GLU": "E", "GLUTAMATE": "E", "GLUTAMICACID": "E",
    "G": "G", "GLY": "G", "GLYCINE": "G",
    "H": "H", "HIS": "H", "HISTIDINE": "H",
    "I": "I", "ILE": "I", "ISOLEUCINE": "I",
    "L": "L", "LEU": "L", "LEUCINE": "L",
    "K": "K", "LYS": "K", "LYSINE": "K",
    "M": "M", "MET": "M", "METHIONINE": "M",
    "F": "F", "PHE": "F", "PHENYLALANINE": "F",
    "P": "P", "PRO": "P", "PROLINE": "P",
    "S": "S", "SER": "S", "SERINE": "S",
    "T": "T", "THR": "T", "THREONINE": "T",
    "W": "W", "TRP": "W", "TRYPTOPHAN": "W",
    "Y": "Y", "TYR": "Y", "TYROSINE": "Y",
    "V": "V", "VAL": "V", "VALINE": "V",
    "*": "*", "STOP": "*", "TER": "*", "TERMINATION": "*",
}
CODONS_BY_AA: dict[str, list[str]] = {}
for _codon, _aa in GENETIC_CODE.items():
    CODONS_BY_AA.setdefault(_aa, []).append(_codon)
COMMON_RESTRICTION_SITES = {
    "EcoRI": "GAATTC",
    "BamHI": "GGATCC",
    "XhoI": "CTCGAG",
    "NotI": "GCGGCCGC",
    "KpnI": "GGTACC",
    "HindIII": "AAGCTT",
    "NheI": "GCTAGC",
    "XbaI": "TCTAGA",
    "SalI": "GTCGAC",
    "AgeI": "ACCGGT",
    "BglII": "AGATCT",
    "SpeI": "ACTAGT",
}
IUPAC_CODES = {
    "A": {"A"},
    "C": {"C"},
    "G": {"G"},
    "T": {"T"},
    "R": {"A", "G"},
    "Y": {"C", "T"},
    "S": {"G", "C"},
    "W": {"A", "T"},
    "K": {"G", "T"},
    "M": {"A", "C"},
    "B": {"C", "G", "T"},
    "D": {"A", "G", "T"},
    "H": {"A", "C", "T"},
    "V": {"A", "C", "G"},
    "N": {"A", "C", "G", "T"},
}
IUPAC_COMPLEMENT = {
    "A": "T",
    "C": "G",
    "G": "C",
    "T": "A",
    "R": "Y",
    "Y": "R",
    "S": "S",
    "W": "W",
    "K": "M",
    "M": "K",
    "B": "V",
    "D": "H",
    "H": "D",
    "V": "B",
    "N": "N",
}
RESTRICTION_ENZYME_LIBRARY = {
    # dam: GATC methylation; dcm: CC(A/T)GG methylation.
    # star_activity_conditions: non-standard conditions causing relaxed specificity.
    "EcoRI": {"optimal_temp": 37, "site": "GAATTC", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "BamHI": {"optimal_temp": 37, "site": "GGATCC", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": True, "dcm_sensitive": False, "star_activity_conditions": "low salt, high glycerol, high pH"},
    "XhoI": {"optimal_temp": 37, "site": "CTCGAG", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    # Type IIS (A-BIO-002): `cuts_top`/`cuts_bottom` are the cut positions on
    # each strand measured from the motif start (0-based, forward orientation).
    # NEB defines BsaI as GGTCTC(1/5) and BsmBI as CGTCTC(N1/N5): the top
    # strand cuts 1 nt past the motif end and the bottom strand 5 nt past it.
    # A single cut_index cannot express this asymmetric double-strand cut.
    "BsaI": {"optimal_temp": 50,
        "site": "GGTCTC",
        "cut_index": 7,
        "cuts_top": [7],
        "cuts_bottom": [11],
        "overhang": "5'",
        "aliases": ["Eco31I"],
        "enzyme_type": "type_iis",
        "primer_spacer_length": 1,
        "assembly_overhang_length": 4,
        "dam_sensitive": False,
        "dcm_sensitive": False,
    },
    "BsmBI": {"optimal_temp": 55,
        "site": "CGTCTC",
        "cut_index": 7,
        "cuts_top": [7],
        "cuts_bottom": [11],
        "overhang": "5'",
        "aliases": ["Esp3I"],
        "enzyme_type": "type_iis",
        "primer_spacer_length": 1,
        "assembly_overhang_length": 4,
        "dam_sensitive": False,
        "dcm_sensitive": False,
    },
    "SapI": {"optimal_temp": 37,
        "site": "GCTCTTC",
        "cut_index": 8,
        "cuts_top": [8],
        "cuts_bottom": [11],
        "overhang": "3'",
        "aliases": ["LguI"],
        "enzyme_type": "type_iis",
        "primer_spacer_length": 1,
        "assembly_overhang_length": 3,
        "dam_sensitive": False,
        "dcm_sensitive": False,
    },
    # A-ALG-002: BbsI/AarI added to match enzyme-data.json (the single source
    # of truth); NEB notation BbsI GAAGAC(2/6), AarI CACCTGC(5/9) — cut
    # positions are 0-based from motif start, i.e. len(site) + overhang nt.
    "BbsI": {"optimal_temp": 37,
        "site": "GAAGAC",
        "cut_index": 8,
        "cuts_top": [8],
        "cuts_bottom": [12],
        "overhang": "5'",
        "enzyme_type": "type_iis",
        "primer_spacer_length": 1,
        "assembly_overhang_length": 4,
        "dam_sensitive": False,
        "dcm_sensitive": False,
    },
    "AarI": {"optimal_temp": 37,
        "site": "CACCTGC",
        "cut_index": 12,
        "cuts_top": [12],
        "cuts_bottom": [16],
        "overhang": "5'",
        "enzyme_type": "type_iis",
        "primer_spacer_length": 1,
        "assembly_overhang_length": 4,
        "dam_sensitive": False,
        "dcm_sensitive": False,
    },
    "NotI": {"optimal_temp": 37, "site": "GCGGCCGC", "cut_index": 2, "cuts_top": [2], "cuts_bottom": [6], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "KpnI": {"optimal_temp": 37, "site": "GGTACC", "cut_index": 5, "cuts_top": [5], "cuts_bottom": [1], "overhang": "3'", "dam_sensitive": False, "dcm_sensitive": True, "star_activity_conditions": "high glycerol"},
    "Acc65I": {"optimal_temp": 37, "site": "GGTACC", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": True},
    "HindIII": {"optimal_temp": 37, "site": "AAGCTT", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False, "star_activity_conditions": "low salt, high glycerol"},
    "NheI": {"optimal_temp": 37, "site": "GCTAGC", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "XbaI": {"optimal_temp": 37, "site": "TCTAGA", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": True, "dcm_sensitive": False},
    "SalI": {"optimal_temp": 37, "site": "GTCGAC", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False, "star_activity_conditions": "high glycerol"},
    "AgeI": {"optimal_temp": 37, "site": "ACCGGT", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "BglII": {"optimal_temp": 37, "site": "AGATCT", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": True, "dcm_sensitive": False},
    "SpeI": {"optimal_temp": 37, "site": "ACTAGT", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "PstI": {"optimal_temp": 37, "site": "CTGCAG", "cut_index": 5, "cuts_top": [5], "cuts_bottom": [1], "overhang": "3'", "dam_sensitive": False, "dcm_sensitive": False, "star_activity_conditions": "high glycerol"},
    "SacI": {"optimal_temp": 37, "site": "GAGCTC", "cut_index": 5, "cuts_top": [5], "cuts_bottom": [1], "overhang": "3'", "dam_sensitive": False, "dcm_sensitive": False},
    "ApaI": {"optimal_temp": 37, "site": "GGGCCC", "cut_index": 5, "cuts_top": [5], "cuts_bottom": [1], "overhang": "3'", "dam_sensitive": False, "dcm_sensitive": True},
    "EcoRV": {"optimal_temp": 37, "site": "GATATC", "cut_index": 3, "cuts_top": [3], "cuts_bottom": [3], "overhang": "blunt", "dam_sensitive": True, "dcm_sensitive": False},
    "SmaI": {"optimal_temp": 25, "site": "CCCGGG", "cut_index": 3, "cuts_top": [3], "cuts_bottom": [3], "overhang": "blunt", "dam_sensitive": False, "dcm_sensitive": False, "star_activity_conditions": "high glycerol, elevated temperature"},
    "PvuII": {"optimal_temp": 37, "site": "CAGCTG", "cut_index": 3, "cuts_top": [3], "cuts_bottom": [3], "overhang": "blunt", "dam_sensitive": False, "dcm_sensitive": False},
    "NcoI": {"optimal_temp": 37, "site": "CCATGG", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "NdeI": {"optimal_temp": 37, "site": "CATATG", "cut_index": 2, "cuts_top": [2], "cuts_bottom": [4], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "ClaI": {"optimal_temp": 37, "site": "ATCGAT", "cut_index": 2, "cuts_top": [2], "cuts_bottom": [4], "overhang": "5'", "dam_sensitive": True, "dcm_sensitive": False},
    "MluI": {"optimal_temp": 37, "site": "ACGCGT", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "BsiWI": {"optimal_temp": 37, "site": "CGTACG", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "BspEI": {"optimal_temp": 37, "site": "TCCGGA", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "BsrGI": {"optimal_temp": 37, "site": "TGTACA", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "AvrII": {"optimal_temp": 37, "site": "CCTAGG", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "ApoI": {"optimal_temp": 50, "site": "RAATTY", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": False, "dcm_sensitive": False},
    "BstYI": {"optimal_temp": 60, "site": "RGATCY", "cut_index": 1, "cuts_top": [1], "cuts_bottom": [5], "overhang": "5'", "dam_sensitive": True, "dcm_sensitive": False},
}
def calculate_gc_window(sequence: str, window_size: int = 50) -> list[float]:
    sequence = clean_sequence_letters(sequence).upper()
    if not sequence:
        return []
    length = len(sequence)
    if length < window_size:
        gc_count = sequence.count("G") + sequence.count("C")
        return [round(gc_count / length, 3)] * length

    results: list[float] = []
    # Sliding window
    current_gc = sequence[:window_size].count("G") + sequence[:window_size].count("C")
    results.append(round(current_gc / window_size, 3))

    for i in range(1, length - window_size + 1):
        # Subtract outgoing, add incoming
        outgoing = sequence[i - 1]
        incoming = sequence[i + window_size - 1]
        if outgoing in "GC":
            current_gc -= 1
        if incoming in "GC":
            current_gc += 1
        results.append(round(current_gc / window_size, 3))

    # Pad to match sequence length
    if len(results) < length:
        last_val = results[-1]
        results.extend([last_val] * (length - len(results)))

    return results
def calculate_bio_params(sequence: str) -> dict[str, Any]:
    sequence = clean_sequence_letters(sequence).upper()
    length = len(sequence)
    if length == 0:
        return {}

    an = sequence.count("A")
    cn = sequence.count("C")
    gn = sequence.count("G")
    tn = sequence.count("T")

    # MW (dsDNA approximation: daltons)
    mw_ds = (an + tn) * 617.4 + (gn + cn) * 618.4 + 158.0

    # Extinction Coefficient (ssDNA at 260nm)
    # Nearest-neighbor or simple summation
    e260_ss = (an * 15400) + (cn * 7400) + (gn * 11500) + (tn * 8700)

    # 1 OD260 equivalent (µg/mL) for dsDNA is typically 50
    # Concentration (mg/mL) = OD260 * 50 / 1000

    return {
        "mw": round(mw_ds, 1),
        "e260": e260_ss,
        "gc_content": round((gn + cn) / length * 100, 1) if length > 0 else 0,
        "counts": {"A": an, "C": cn, "G": gn, "T": tn, "N": sequence.count("N")},
    }
def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
def normalize_species(species: str) -> str:
    return re.sub(r"\s+", " ", species.strip().lower().replace("_", " ").replace("-", " "))
def is_human_species(species: str) -> bool:
    return normalize_species(species) in {"homo sapiens", "human", "h sapiens"}
def ensembl_species_slug(species: str) -> str:
    return normalize_species(species).replace(" ", "_") or "homo_sapiens"
def normalize_accession(accession: str) -> str:
    return accession.strip().upper()
def accession_base(accession: str) -> str:
    return normalize_accession(accession).split(".", 1)[0]
def normalized_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.strip().lower())
def strain_matches_title(title: str, strain: str) -> bool:
    if not strain:
        return False
    normalized_title = normalized_text(title)
    normalized_strain = normalized_text(strain)
    if not normalized_title or not normalized_strain:
        return False
    if normalized_strain in normalized_title:
        return True
    tokens = [token for token in normalized_strain.split() if len(token) >= 2]
    return bool(tokens) and all(token in normalized_title for token in tokens)
def sequence_entry_rank(accession: str, title: str) -> int:
    lower = title.lower()
    if accession.startswith(("NM_", "XM_", "NR_", "XR_")):
        return 0
    if "mrna" in lower or "transcript" in lower or "complete cds" in lower or lower.endswith(" cds"):
        return 0
    if "gene" in lower and "complete genome" not in lower:
        return 1
    if "segment" in lower or "region" in lower or "locus" in lower:
        return 2
    if "complete genome" in lower or accession.startswith(("NC_", "NZ_")):
        return 4
    return 3
def clean_sequence_letters(raw: str) -> str:
    return re.sub(r"[^ACGTN]", "", raw.upper().replace("U", "T"))
def clean_iupac_sequence(raw: str) -> str:
    return re.sub(r"[^ACGTRYSWKMBDHVN]", "", raw.upper().replace("U", "T"))
def wrap_text(value: str, width: int) -> list[str]:
    text = " ".join(value.split())
    if not text:
        return [""]
    words = text.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines
def normalize_sequence_name(value: str, fallback: str = "Imported_Sequence") -> str:
    cleaned = re.sub(r"[^\w.\-]+", "_", (value or "").strip()).strip("_")
    return cleaned[:24] or fallback
def detect_sequence_format(raw: str) -> str:
    text = raw.lstrip()
    if not text:
        return "plain"
    if re.search(r"^\s*LOCUS\s+", raw, re.MULTILINE) and re.search(r"^\s*ORIGIN\b", raw, re.MULTILINE):
        return "genbank"
    if re.search(r"^\s*>", raw, re.MULTILINE):
        return "fasta"
    return "plain"
def parse_fasta_document(raw: str, fallback_name: str = "Imported Sequence") -> SequenceDocument:
    header = ""
    chunks: list[str] = []
    in_first_record = False
    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            if in_first_record:
                break
            in_first_record = True
            header = line[1:].strip()
            continue
        if in_first_record:
            chunks.append(line)
    sequence = clean_sequence_letters("".join(chunks))
    if not sequence:
        raise ApiError("FASTA 文件里没有解析到有效 DNA 序列。")
    header = header or fallback_name
    token, _, remainder = header.partition(" ")
    return SequenceDocument(
        name=normalize_sequence_name(token or fallback_name),
        sequence=sequence,
        format="fasta",
        description=header,
        accession=token if ACCESSION_RE.match(token.upper()) else None,
        features=[],
    )
def parse_genbank_header_value(lines: list[str], key: str) -> str:
    value = ""
    collecting = False
    for line in lines:
        if line.startswith(key):
            value = line[12:].strip()
            collecting = True
            continue
        if collecting:
            if line.startswith(" " * 12) and line[:12].strip() == "":
                value = f"{value} {line[12:].strip()}".strip()
                continue
            break
    return value
def parse_genbank_document(raw: str, fallback_name: str = "Imported Sequence") -> SequenceDocument:
    lines = raw.splitlines()
    locus_name = fallback_name
    topology = "linear"
    molecule_type = "DNA"
    date = None
    accession = None
    version = None
    definition = ""
    source = None
    organism = None
    features: list[SequenceFeature] = []
    sequence_parts: list[str] = []

    for line in lines:
        if line.startswith("LOCUS"):
            tokens = line.split()
            if len(tokens) >= 2:
                locus_name = tokens[1]
            if any(token.lower() == "circular" for token in tokens):
                topology = "circular"
            if any(token.upper() == "RNA" for token in tokens):
                molecule_type = "RNA"
            date_match = re.search(r"(\d{2}-[A-Z]{3}-\d{4})", line.upper())
            if date_match:
                date = date_match.group(1)
            break

    definition = parse_genbank_header_value(lines, "DEFINITION")
    accession = parse_genbank_header_value(lines, "ACCESSION") or None
    version_line = parse_genbank_header_value(lines, "VERSION")
    if version_line:
        version = version_line.split()[0]
    source = parse_genbank_header_value(lines, "SOURCE") or None

    for index, line in enumerate(lines):
        if line.startswith("  ORGANISM"):
            organism = line[12:].strip() or None
            extra: list[str] = []
            cursor = index + 1
            while cursor < len(lines) and lines[cursor].startswith(" " * 12):
                extra.append(lines[cursor][12:].strip())
                cursor += 1
            if extra and not source:
                source = " ".join(extra)
            break

    in_features = False
    in_origin = False
    current_feature: SequenceFeature | None = None
    current_qualifier: str | None = None
    for line in lines:
        if line.startswith("FEATURES"):
            in_features = True
            in_origin = False
            continue
        if line.startswith("ORIGIN"):
            in_origin = True
            in_features = False
            current_feature = None
            current_qualifier = None
            continue
        if line.startswith("//"):
            break

        if in_features:
            if re.match(r"^     \S", line):
                feature_type = line[5:21].strip()
                location = line[21:].strip()
                current_feature = SequenceFeature(feature_type, location, {})
                features.append(current_feature)
                current_qualifier = None
            elif current_feature and line.startswith(" " * 21):
                payload = line[21:].strip()
                if payload.startswith("/"):
                    qualifier = payload[1:]
                    if "=" in qualifier:
                        key, value = qualifier.split("=", 1)
                        current_feature.qualifiers[key] = value.strip().strip('"')
                        current_qualifier = key
                    else:
                        current_feature.qualifiers[qualifier] = "true"
                        current_qualifier = qualifier
                elif current_feature and current_qualifier and payload:
                    existing = current_feature.qualifiers.get(current_qualifier, "")
                    stripped_p = payload.strip().strip('"')
                    current_feature.qualifiers[current_qualifier] = f"{existing} {stripped_p}".strip()
                elif current_feature and payload:
                    # GenBank locations can wrap onto continuation lines before qualifiers begin.
                    current_feature.location = f"{current_feature.location}{payload}".replace(" ", "")
            continue

        if in_origin:
            sequence_parts.append(clean_sequence_letters(line))

    sequence = "".join(sequence_parts)
    if not sequence:
        raise ApiError("GenBank 文件里没有解析到 ORIGIN 序列。")

    return SequenceDocument(
        name=normalize_sequence_name(accession or version or locus_name or fallback_name),
        sequence=sequence,
        format="genbank",
        description=definition or source or fallback_name,
        accession=accession,
        version=version,
        topology=topology,
        molecule_type=molecule_type,
        source=source,
        organism=organism,
        date=date,
        features=features,
    )
def parse_plain_sequence_document(raw: str, fallback_name: str = "Imported Sequence") -> SequenceDocument:
    sequence = clean_sequence_letters(raw)
    if not sequence:
        raise ApiError("没有识别到有效 DNA 序列，请粘贴 plain / FASTA / GenBank 内容。")
    return SequenceDocument(
        name=normalize_sequence_name(fallback_name),
        sequence=sequence,
        format="plain",
        description=fallback_name,
        features=[],
    )
def parse_sequence_document(raw: str, fallback_name: str = "Imported Sequence") -> SequenceDocument:
    format_name = detect_sequence_format(raw)
    if format_name == "genbank":
        return parse_genbank_document(raw, fallback_name=fallback_name)
    if format_name == "fasta":
        return parse_fasta_document(raw, fallback_name=fallback_name)
    return parse_plain_sequence_document(raw, fallback_name=fallback_name)
def sequence_document_to_dict(document: SequenceDocument | None) -> dict[str, Any] | None:
    if document is None:
        return None
    payload = asdict(document)
    payload["length"] = len(document.sequence)
    payload["featureCount"] = len(document.features or [])
    payload["features"] = payload.get("features") or []
    return payload
def build_sequence_document(
    sequence: str,
    *,
    name: str,
    description: str = "",
    accession: str | None = None,
    format_name: str = "fasta",
    topology: str = "linear",
    molecule_type: str = "DNA",
    source: str | None = None,
    organism: str | None = None,
    features: list[SequenceFeature] | None = None,
) -> SequenceDocument:
    return SequenceDocument(
        name=normalize_sequence_name(accession or name),
        sequence=sequence,
        format=format_name,
        description=description or name,
        accession=accession,
        version=accession,
        topology=topology,
        molecule_type=molecule_type,
        source=source,
        organism=organism,
        features=features or [],
    )
def fetch_genbank_document(nuccore_id: str, fallback_name: str = "Imported Sequence") -> SequenceDocument:
    text = ncbi_request(
        "efetch.fcgi",
        {"db": "nuccore", "id": nuccore_id, "rettype": "gb", "retmode": "text"},
        text=True,
    )
    return parse_genbank_document(text, fallback_name=fallback_name)
def hydrate_document_from_ncbi(identifier: str, fallback_document: SequenceDocument) -> SequenceDocument:
    try:
        document = fetch_genbank_document(identifier, fallback_name=fallback_document.name or identifier)
    except Exception:
        return fallback_document
    if clean_sequence_letters(document.sequence) != clean_sequence_letters(fallback_document.sequence):
        return fallback_document
    return document
def parse_location_spans(location: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for match in re.finditer(r"([<>]?\d+)(?:\.\.([<>]?\d+))?", location or ""):
        start = int(match.group(1).lstrip("<>"))
        end = int((match.group(2) or match.group(1)).lstrip("<>"))
        if start > end:
            start, end = end, start
        spans.append((start, end))
    return spans
def merge_coordinate_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not spans:
        return []
    ordered = sorted(spans)
    merged: list[list[int]] = [[ordered[0][0], ordered[0][1]]]
    for start, end in ordered[1:]:
        current = merged[-1]
        if start <= current[1] + 1:
            current[1] = max(current[1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]
def extract_cds_summary(document: SequenceDocument | None) -> dict[str, Any] | None:
    if document is None:
        return None
    spans: list[tuple[int, int]] = []
    for feature in document.features or []:
        if feature.type.upper() == "CDS":
            spans.extend(parse_location_spans(feature.location))
    merged = merge_coordinate_spans(spans)
    if not merged:
        return None
    start = min(item[0] for item in merged)
    end = max(item[1] for item in merged)
    coding_length = sum(right - left + 1 for left, right in merged)
    return {
        "start": start,
        "end": end,
        "length": coding_length,
        "spans": [{"start": left, "end": right} for left, right in merged],
    }
def format_fasta_document(document: SequenceDocument) -> str:
    header = document.name or document.accession or "sequence"
    if document.description and document.description != header:
        header = f"{header} {document.description}"
    chunks = [document.sequence[index : index + 70] for index in range(0, len(document.sequence), 70)]
    return f">{header}\n" + "\n".join(chunks) + "\n"
def format_genbank_field(key: str, value: str) -> list[str]:
    wrapped = wrap_text(value, 67)
    lines = [f"{key:<12}{wrapped[0]}"]
    lines.extend(f"{' ' * 12}{item}" for item in wrapped[1:])
    return lines
def format_genbank_features(document: SequenceDocument) -> list[str]:
    lines = ["FEATURES             Location/Qualifiers"]
    features = list(document.features or [])
    if not any(item.type == "source" for item in features):
        features.insert(
            0,
            SequenceFeature(
                "source",
                f"1..{len(document.sequence)}",
                {
                    "organism": document.organism or document.source or "synthetic construct",
                    "mol_type": "other DNA",
                },
            ),
        )
    for feature in features:
        lines.append(f"     {feature.type:<15}{feature.location}")
        for key, value in (feature.qualifiers or {}).items():
            qualifier = f'/{key}="{value}"' if value != "true" else f"/{key}"
            for index, item in enumerate(wrap_text(qualifier, 58)):
                prefix = " " * 21
                if index == 0:
                    lines.append(f"{prefix}{item}")
                else:
                    lines.append(f"{prefix}{item}")
    return lines
def format_genbank_origin(sequence: str) -> list[str]:
    lines = ["ORIGIN"]
    lowered = sequence.lower()
    for start in range(0, len(lowered), 60):
        chunk = lowered[start : start + 60]
        groups = " ".join(chunk[index : index + 10] for index in range(0, len(chunk), 10))
        lines.append(f"{start + 1:>9} {groups}")
    lines.append("//")
    return lines
def format_genbank_document(document: SequenceDocument) -> str:
    date = (document.date or time.strftime("%d-%b-%Y")).upper()
    topology = "circular" if str(document.topology).lower().startswith("cir") else "linear"
    molecule_type = (document.molecule_type or "DNA").upper()
    locus_name = normalize_sequence_name(document.accession or document.name or "SEQUENCE", fallback="SEQUENCE")[:16]
    definition = document.description or f"{document.name} exported from Primer Design Studio"
    accession = document.accession or locus_name
    version = document.version or accession
    source = document.source or document.organism or "synthetic construct"
    organism = document.organism or source
    header = [
        f"LOCUS       {locus_name:<16}{len(document.sequence):>11} bp    {molecule_type:<6}{topology:<9}SYN {date}",
        *format_genbank_field("DEFINITION", definition),
        f"ACCESSION   {accession}",
        f"VERSION     {version}",
        *format_genbank_field("SOURCE", source),
        f"  ORGANISM  {organism}",
    ]
    return "\n".join(header + format_genbank_features(document) + format_genbank_origin(document.sequence)) + "\n"
def sanitize_sequence(raw: str) -> str:
    if not raw:
        return ""
    try:
        return parse_sequence_document(raw, fallback_name="Sequence").sequence
    except ApiError:
        return clean_sequence_letters(raw)
def validate_sequence_length(sequence: str, workspace: str, label: str = "序列") -> None:
    """v2: raise ApiError if sequence exceeds the per-workspace upper bound."""
    limit = MAX_SEQUENCE_LENGTH.get(workspace, MAX_SEQUENCE_LENGTH["default"])
    if len(sequence) > limit:
        raise ApiError(f"{label}长度 {len(sequence)} bp 超过当前上限 {limit} bp，请裁剪后重试。")
def looks_like_sequence(raw: str) -> bool:
    cleaned = sanitize_sequence(raw)
    if len(cleaned) < 40:
        return False
    if detect_sequence_format(raw) in {"fasta", "genbank"}:
        return True
    meaningful = re.sub(r"\s|>", "", raw.upper())
    return bool(meaningful) and len(cleaned) / len(meaningful) >= 0.75
def looks_like_sequence_literal(raw: str, min_len: int = 10) -> bool:
    """Detect short pasted nucleotide strings so Agent does not treat them as gene names."""
    text = re.sub(r"\s|>|\\d", "", str(raw or "").upper())
    if len(text) < min_len:
        return False
    return bool(re.fullmatch(r"[ACGTRYSWKMBDHVNU]+", text))
def reverse_complement(seq: str) -> str:
    table = str.maketrans("ACGTN", "TGCAN")
    return seq.translate(table)[::-1]
def dna_to_rna(seq: str) -> str:
    return seq.upper().replace("T", "U")
def reverse_complement_iupac(seq: str) -> str:
    return "".join(IUPAC_COMPLEMENT.get(base, "N") for base in reversed(seq.upper()))
def normalize_enzyme_token(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", value or "").upper()
def restriction_enzyme_catalog() -> dict[str, dict[str, Any]]:
    catalog: dict[str, dict[str, Any]] = {}
    for name, data in RESTRICTION_ENZYME_LIBRARY.items():
        token = normalize_enzyme_token(name)
        item = {
            "name": name,
            "site": data["site"],
            "cut_index": int(data.get("cut_index", max(1, len(data["site"]) // 2))),
            "cuts_top": [int(item) for item in (data.get("cuts_top") or [data.get("cut_index", max(1, len(data["site"]) // 2))])],
            "cuts_bottom": [int(item) for item in (data.get("cuts_bottom") or [len(data["site"]) - int(data.get("cut_index", max(1, len(data["site"]) // 2)))])],
            "overhang": data.get("overhang", "unknown"),
            "source": "library",
            "enzyme_type": data.get("enzyme_type", "type_ii"),
            "primer_spacer_length": int(data.get("primer_spacer_length", 0)),
            "assembly_overhang_length": int(data.get("assembly_overhang_length", 0)),
        }
        catalog[token] = item
        aliases = data.get("aliases") or []
        for alias in aliases:
            catalog[normalize_enzyme_token(alias)] = item
    return catalog
RESTRICTION_ENZYME_CATALOG = restriction_enzyme_catalog()
def resolve_restriction_enzyme(value: str) -> dict[str, Any]:
    token = (value or "").strip()
    if not token:
        raise ApiError("请输入限制性内切酶名称或识别序列。")

    normalized = normalize_enzyme_token(token)
    if normalized in RESTRICTION_ENZYME_CATALOG:
        return dict(RESTRICTION_ENZYME_CATALOG[normalized])

    site = clean_iupac_sequence(token)
    if len(site) < 4:
        raise ApiError("酶切位点至少需要 4 bp；也可以直接输入常见酶名，例如 EcoRI、XhoI。")
    return {
        "name": token.upper(),
        "site": site,
        "cut_index": max(1, len(site) // 2),
        "overhang": "custom",
        "source": "custom",
        "enzyme_type": "custom",
        "primer_spacer_length": 0,
        "assembly_overhang_length": 0,
    }
def resolve_type_iis_enzyme(value: str) -> dict[str, Any]:
    enzyme = resolve_restriction_enzyme(value)
    if enzyme.get("enzyme_type") != "type_iis":
        raise ApiError("Golden Gate / Type IIS 模式当前支持内置 Type IIS 酶，例如 BsaI、BsmBI(Esp3I)、SapI。")
    return enzyme
def restriction_site_overhang_label(value: str) -> str:
    if value == "5'":
        return "5' overhang"
    if value == "3'":
        return "3' overhang"
    if value == "blunt":
        return "blunt"
    return "custom / unknown"
def iupac_base_matches(base: str, code: str) -> bool:
    return base in "ACGT" and base in IUPAC_CODES.get(code, {code})
def enzyme_strand_cuts(enzyme: dict[str, Any]) -> tuple[int, int]:
    """Return (top_strand, bottom_strand) cut offsets from the motif start.

    Type IIS enzymes declare explicit `cuts_top`/`cuts_bottom` (e.g. BsaI
    GGTCTC(1/5) -> top 7, bottom 11). Palindromic cutters only carry the
    legacy single `cut_index`: the bottom strand cut mirrors the top across
    the motif axis (len - cut_index), which is exact for symmetric sites
    (EcoRI 1/5, PstI 5/1, EcoRV blunt 3/3).
    """
    site_len = len(enzyme["site"])
    top = int((enzyme.get("cuts_top") or [enzyme.get("cut_index", 0)])[0])
    bottom = int((enzyme.get("cuts_bottom") or [site_len - top])[0])
    return top, bottom
def find_restriction_site_hits(
    sequence: str,
    site: str,
    cut_index: int,
    topology: str = "linear",
    *,
    cuts_top: list[int] | None = None,
    cuts_bottom: list[int] | None = None,
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    pattern = clean_iupac_sequence(site)
    if not pattern:
        return hits
    sequence = clean_sequence_letters(sequence)
    seq_len = len(sequence)
    pattern_len = len(pattern)
    patterns = [("Forward", pattern)]
    reverse_pattern = reverse_complement_iupac(pattern)
    if reverse_pattern != pattern:
        patterns.append(("Reverse", reverse_pattern))

    # Strand cut offsets relative to the motif start, forward orientation.
    fwd_top = int(cuts_top[0]) if cuts_top else cut_index
    fwd_bottom = int(cuts_bottom[0]) if cuts_bottom else (pattern_len - fwd_top)

    # For circular sequences, extend by pattern_len - 1 to catch origin-spanning sites.
    search_seq = sequence
    if topology == "circular" and seq_len >= pattern_len:
        search_seq = sequence + sequence[: pattern_len - 1]

    for direction, candidate in patterns:
        for start in range(0, len(search_seq) - pattern_len + 1):
            window = search_seq[start : start + pattern_len]
            if all(iupac_base_matches(base, code) for base, code in zip(window, candidate)):
                # Normalize position to within the original sequence length.
                # Positions are 1-based inclusive; cuts are 0-based absolute.
                norm_start = start % seq_len
                if direction == "Reverse":
                    # The enzyme recognises the motif on the bottom strand, so
                    # the strand roles swap and both cuts lie BEFORE the motif
                    # on the forward (top) strand coordinate frame. The mirror
                    # rule (top = len - forward_bottom, bottom = len -
                    # forward_top) is the same one Biopython applies via its
                    # scd5/scd3 mirroring; the absolute positions (start-5 /
                    # start-1 for BsaI) match NEB's GAGACC(5/1) layout.
                    rel_top = pattern_len - fwd_bottom
                    rel_bottom = pattern_len - fwd_top
                else:
                    rel_top = fwd_top
                    rel_bottom = fwd_bottom
                if topology == "circular" and seq_len:
                    cut_top = (norm_start + rel_top) % seq_len
                    cut_bottom = (norm_start + rel_bottom) % seq_len
                else:
                    cut_top = max(0, norm_start + rel_top)
                    cut_bottom = max(0, norm_start + rel_bottom)
                hits.append(
                    {
                        "start": norm_start + 1,
                        "end": (norm_start + pattern_len - 1) % seq_len + 1,
                        "direction": direction,
                        "match": window,
                        "cut": (norm_start + cut_index) % seq_len,  # legacy single cut (top strand)
                        "cut_top": cut_top,
                        "cut_bottom": cut_bottom,
                        "overhang_polarity": fwd_top - fwd_bottom,
                        "wraps_origin": start + pattern_len > seq_len,
                    }
                )

    # Deduplicate: a circular wrap hit and its linear twin at the same cut position.
    seen: set[tuple[int, str]] = set()
    unique_hits: list[dict[str, Any]] = []
    for hit in hits:
        key = (hit["cut"], hit["direction"])
        if key not in seen:
            seen.add(key)
            unique_hits.append(hit)

    unique_hits.sort(key=lambda item: (item["cut"], item["start"], item["direction"]))
    return unique_hits
def digest_fragment_lengths(sequence_length: int, cut_positions: list[int], topology: str = "linear") -> list[int]:
    if sequence_length <= 0:
        return []
    normalized = sorted({max(0, min(sequence_length, int(position))) for position in cut_positions})
    if not normalized:
        return [sequence_length]
    if topology == "circular":
        if len(normalized) == 1:
            return [sequence_length]
        fragments: list[int] = []
        for index, position in enumerate(normalized):
            next_position = normalized[(index + 1) % len(normalized)]
            if index == len(normalized) - 1:
                fragments.append(sequence_length - position + normalized[0])
            else:
                fragments.append(next_position - position)
        return [length for length in fragments if length > 0]
    boundaries = [0, *normalized, sequence_length]
    return [boundaries[index + 1] - boundaries[index] for index in range(len(boundaries) - 1) if boundaries[index + 1] - boundaries[index] > 0]
def scan_restriction_enzyme_on_sequence(sequence: str, enzyme: dict[str, Any], topology: str = "linear") -> dict[str, Any]:
    hits = find_restriction_site_hits(
        sequence,
        enzyme["site"],
        int(enzyme["cut_index"]),
        topology=topology,
        cuts_top=enzyme.get("cuts_top"),
        cuts_bottom=enzyme.get("cuts_bottom"),
    )
    # Fragment boundaries follow the top-strand cut; for Type IIS this is the
    # physically correct strand for the fragment that terminates at the site.
    cut_positions = [hit.get("cut_top", hit["cut"]) for hit in hits]
    fragment_lengths = digest_fragment_lengths(len(sequence), cut_positions, topology=topology)
    # Methylation sensitivity: flag if site contains GATC (dam) or CC(A/T)GG (dcm).
    dam_sensitive = bool(enzyme.get("dam_sensitive"))
    dcm_sensitive = bool(enzyme.get("dcm_sensitive"))
    methylation_warning = ""
    if dam_sensitive:
        methylation_warning = "Dam-sensitive: blocked by GATC methylation"
    if dcm_sensitive:
        methylation_warning = ("Dam+Dcm-sensitive: " if dam_sensitive else "Dcm-sensitive: ") + "blocked by CC(A/T)GG methylation"
    star_activity = enzyme.get("star_activity_conditions", "")
    return {
        "name": enzyme["name"],
        "site": enzyme["site"],
        "overhang": enzyme["overhang"],
        "overhang_label": restriction_site_overhang_label(enzyme["overhang"]),
        "source": enzyme["source"],
        "hit_count": len(hits),
        "is_unique": len(hits) == 1,
        "positions": [hit["start"] for hit in hits],
        "cuts": cut_positions,
        "hits": hits[:8],
        "fragment_lengths": fragment_lengths,
        "topology": topology,
        "dam_sensitive": dam_sensitive,
        "dcm_sensitive": dcm_sensitive,
        "methylation_warning": methylation_warning,
        "star_activity_conditions": star_activity,
        "wraps_origin": any(hit.get("wraps_origin") for hit in hits),
    }


def _type_iis_sticky_end(sequence: str, hit: dict[str, Any], topology: str) -> str:
    """Return the canonical top-strand sticky sequence between two cuts.

    Restriction hits expose both strand cuts as zero-based bond coordinates.
    Keeping this conversion next to the strict construct builder prevents the
    old single ``cut_index`` field from silently becoming the assembly end.
    """
    sequence = clean_sequence_letters(sequence).upper()
    if not sequence:
        return ""
    top = int(hit.get("cut_top", hit.get("cut", 0)))
    bottom = int(hit.get("cut_bottom", top))
    if topology == "circular":
        top %= len(sequence)
        bottom %= len(sequence)
        if top <= bottom:
            return sequence[top:bottom]
        # A top cut after the bottom cut on a circular molecule means the
        # overhang crosses the origin; preserve the forward top-strand path.
        return sequence[top:] + sequence[:bottom]
    if top < 0 or bottom < 0 or top > len(sequence) or bottom > len(sequence):
        return ""
    if top <= bottom:
        return sequence[top:bottom]
    return reverse_complement_iupac(sequence[bottom:top])


def build_strict_type_iis_construct(
    vector_document: SequenceDocument | None,
    insert_documents: list[SequenceDocument],
    enzyme: dict[str, Any],
    overhangs: list[str],
) -> dict[str, Any]:
    """Build an exact in-silico Type IIS dropout construct when safe.

    This is deliberately fail-closed.  ``available`` is true only when the
    vector has exactly two representable, outward-facing sites, the insert
    fragments contain no internal site, configured ends match the actual
    strand cuts, and the final construct is not re-cut.  The returned digest
    is evidence for deterministic identity, not a wet-lab validation claim.
    """
    fragments = [clean_sequence_letters(item.sequence).upper() for item in insert_documents]
    insert_sequence = "".join(fragments)
    topology = str(getattr(vector_document, "topology", "linear") or "linear").lower()
    if topology not in {"linear", "circular"}:
        topology = "linear"
    expected_length = int(enzyme.get("assembly_overhang_length") or 0)
    base: dict[str, Any] = {
        "available": False,
        "length": None,
        "vectorLength": len(vector_document.sequence) if vector_document else None,
        "replacedLength": None,
        "editMode": "type_iis_dropout",
        "editStart": None,
        "editEnd": None,
        "sequenceDigest": "",
        "topology": topology,
        "enzyme": str(enzyme.get("name") or "Type IIS"),
        "recognitionSite": str(enzyme.get("site") or ""),
        "vectorCutPositions": [],
        "vectorSiteDirections": [],
        "actualOverhangs": [],
        "fragmentLengths": [len(fragment) for fragment in fragments],
        "fragmentCount": len(fragments),
        "insertLength": len(insert_sequence),
        "reason": "",
    }

    def unavailable(reason: str) -> dict[str, Any]:
        base["reason"] = reason
        return base

    if vector_document is None:
        return unavailable("未提供 backbone 序列，无法从真实 Type IIS 双链切点构建精确构建体。")
    vector_sequence = clean_sequence_letters(vector_document.sequence).upper()
    if not vector_sequence:
        return unavailable("backbone 序列为空，无法构建 Type IIS 构建体。")
    if not insert_sequence:
        return unavailable("insert 为空，无法构建 Type IIS 构建体。")
    if expected_length <= 0:
        return unavailable("当前 Type IIS 酶没有可靠的 assembly overhang 长度定义。")
    if len(overhangs) != 2 or any(len(item) != expected_length for item in overhangs):
        return unavailable(f"需要两个长度为 {expected_length} bp 的 overhang 才能建立确定性连接。")

    hits = find_restriction_site_hits(
        vector_sequence,
        str(enzyme.get("site") or ""),
        int(enzyme.get("cut_index") or 0),
        topology=topology,
        cuts_top=enzyme.get("cuts_top"),
        cuts_bottom=enzyme.get("cuts_bottom"),
    )
    if len(hits) != 2:
        return unavailable(
            f"{enzyme.get('name') or 'Type IIS'} 在 backbone 中检测到 {len(hits)} 个位点；严格构建体要求恰好两个。"
        )
    ordered = sorted(hits, key=lambda item: (int(item.get("cut_top", item.get("cut", 0))), item.get("direction", "")))
    left_hit, right_hit = ordered
    left_cut = int(left_hit.get("cut_top", left_hit.get("cut", 0)))
    right_cut = int(right_hit.get("cut_top", right_hit.get("cut", 0)))
    if left_cut < 0 or right_cut <= left_cut or right_cut > len(vector_sequence):
        return unavailable("两个 Type IIS top-strand 切点不构成有效的非空 dropout 区间。")
    # Outward-facing acceptor pair in canonical top-strand order.  A same-
    # direction pair can have two cuts but does not prove the intended Golden
    # Gate dropout orientation, so it remains review-only.
    if (left_hit.get("direction"), right_hit.get("direction")) != ("Reverse", "Forward"):
        return unavailable("两个位点不是 canonical outward-facing (Reverse → Forward) 方向，无法自动确定 dropout。")

    actual_left = _type_iis_sticky_end(vector_sequence, left_hit, topology)
    actual_right = _type_iis_sticky_end(vector_sequence, right_hit, topology)
    base.update({
        "vectorCutPositions": [left_cut, right_cut],
        "vectorSiteDirections": [left_hit.get("direction"), right_hit.get("direction")],
        "actualOverhangs": [actual_left, actual_right],
    })
    if not actual_left or not actual_right or len(actual_left) != expected_length or len(actual_right) != expected_length:
        return unavailable("从两个 strand cut 坐标无法得到完整的预期长度突出端。")

    def compatible(configured: str, actual: str) -> bool:
        return configured == actual or configured == reverse_complement_iupac(actual)

    if not compatible(overhangs[0], actual_left) or not compatible(overhangs[1], actual_right):
        return unavailable(
            f"配置 overhang ({overhangs[0]} / {overhangs[1]}) 与酶切产生的 overhang ({actual_left} / {actual_right}) 不兼容。"
        )

    internal_hits = [
        hit
        for document in insert_documents
        for hit in find_restriction_site_hits(
            document.sequence,
            str(enzyme.get("site") or ""),
            int(enzyme.get("cut_index") or 0),
            topology="linear",
            cuts_top=enzyme.get("cuts_top"),
            cuts_bottom=enzyme.get("cuts_bottom"),
        )
    ]
    if internal_hits:
        return unavailable(
            f"insert 内仍有 {len(internal_hits)} 个 {enzyme.get('name') or 'Type IIS'} 识别位点，不能视为稳定的 Golden Gate 片段。"
        )

    replaced_length = right_cut - left_cut
    if topology == "circular":
        retained_backbone = vector_sequence[right_cut:] + vector_sequence[:left_cut]
        construct_sequence = insert_sequence + retained_backbone
    else:
        retained_backbone = vector_sequence[:left_cut] + vector_sequence[right_cut:]
        construct_sequence = retained_backbone[:left_cut] + insert_sequence + vector_sequence[right_cut:]
    remaining_hits = find_restriction_site_hits(
        construct_sequence,
        str(enzyme.get("site") or ""),
        int(enzyme.get("cut_index") or 0),
        topology=topology,
        cuts_top=enzyme.get("cuts_top"),
        cuts_bottom=enzyme.get("cuts_bottom"),
    )
    if remaining_hits:
        return unavailable(
            f"预测构建体仍保留 {len(remaining_hits)} 个 {enzyme.get('name') or 'Type IIS'} 位点，反应中可能再次被切开。"
        )

    base.update({
        "available": True,
        "length": len(construct_sequence),
        "replacedLength": replaced_length,
        "editStart": left_cut,
        "editEnd": right_cut,
        "sequenceDigest": hashlib.sha256(construct_sequence.encode("ascii")).hexdigest(),
        "reason": "已由真实识别位点、双链切点、outward-facing 方向和内部位点扫描确定；仍未经过湿实验验证。",
    })
    return base
def summarize_restriction_scan(
    insert_document: SequenceDocument,
    vector_document: SequenceDocument | None,
    chosen_tokens: list[str] | None = None,
    vector_topology: str = "circular",
) -> dict[str, Any]:
    chosen_tokens = chosen_tokens or []
    chosen_enzymes: list[dict[str, Any]] = []
    seen_chosen: set[str] = set()
    for token in chosen_tokens:
        enzyme = resolve_restriction_enzyme(token)
        key = f"{enzyme['name']}::{enzyme['site']}"
        if key in seen_chosen:
            continue
        seen_chosen.add(key)
        chosen_enzymes.append(enzyme)

    library_scans: list[dict[str, Any]] = []
    recommended: list[dict[str, Any]] = []
    insert_safe_cutters = 0
    vector_single_cutters = 0
    pair_candidates = 0

    for name in RESTRICTION_ENZYME_LIBRARY:
        enzyme = dict(RESTRICTION_ENZYME_CATALOG[normalize_enzyme_token(name)])
        insert_scan = scan_restriction_enzyme_on_sequence(insert_document.sequence, enzyme, topology=insert_document.topology)
        vector_scan = (
            scan_restriction_enzyme_on_sequence(vector_document.sequence, enzyme, topology=vector_topology)
            if vector_document
            else None
        )
        entry = {
            "name": enzyme["name"],
            "site": enzyme["site"],
            "site_length": len(enzyme["site"]),
            "cut_index": int(enzyme["cut_index"]),
            "overhang": enzyme["overhang"],
            "overhang_label": restriction_site_overhang_label(enzyme["overhang"]),
            "enzyme_type": enzyme.get("enzyme_type", "type_ii"),
            "insert_hits": insert_scan["hit_count"],
            "insert_unique": insert_scan["is_unique"],
            "insert_positions": insert_scan["positions"][:6],
            "insert_cuts": insert_scan["cuts"][:6],
            "insert_fragments": insert_scan["fragment_lengths"][:8],
            "vector_hits": vector_scan["hit_count"] if vector_scan else None,
            "vector_unique": vector_scan["is_unique"] if vector_scan else None,
            "vector_positions": (vector_scan["positions"][:6] if vector_scan else []),
            "vector_cuts": (vector_scan["cuts"][:6] if vector_scan else []),
            "vector_fragments": (vector_scan["fragment_lengths"][:8] if vector_scan else []),
        }
        library_scans.append(entry)
        if insert_scan["hit_count"] == 0:
            insert_safe_cutters += 1
        if vector_scan and vector_scan["hit_count"] == 1:
            vector_single_cutters += 1
        if vector_scan and vector_scan["hit_count"] == 1 and insert_scan["hit_count"] == 0:
            recommended.append(entry)

    if len(recommended) >= 2:
        pair_candidates = min(20, (len(recommended) * (len(recommended) - 1)) // 2)

    chosen_analysis: list[dict[str, Any]] = []
    for enzyme in chosen_enzymes:
        insert_scan = scan_restriction_enzyme_on_sequence(insert_document.sequence, enzyme, topology=insert_document.topology)
        vector_scan = (
            scan_restriction_enzyme_on_sequence(vector_document.sequence, enzyme, topology=vector_topology)
            if vector_document
            else None
        )
        chosen_analysis.append(
            {
                "name": enzyme["name"],
                "site": enzyme["site"],
                "site_length": len(enzyme["site"]),
                "cut_index": int(enzyme["cut_index"]),
                "overhang": enzyme["overhang"],
                "overhang_label": restriction_site_overhang_label(enzyme["overhang"]),
                "source": enzyme["source"],
                "enzyme_type": enzyme.get("enzyme_type", "type_ii"),
                "insert": insert_scan,
                "vector": vector_scan,
                "insert_conflict": insert_scan["hit_count"] > 0,
                "vector_unique": vector_scan["is_unique"] if vector_scan else None,
                "ideal_for_cloning": bool(vector_scan and vector_scan["hit_count"] == 1 and insert_scan["hit_count"] == 0),
            }
        )

    recommended.sort(key=lambda item: (0 if item["vector_hits"] == 1 else 1, item["insert_hits"], item["name"]))
    library_scans.sort(key=lambda item: (item["insert_hits"], 0 if item["vector_hits"] == 1 else 1 if item["vector_hits"] else 2, item["name"]))

    def pair_candidate_payload(item: dict[str, Any]) -> dict[str, Any]:
        if "insert" in item:
            return {
                "name": item["name"],
                "site": item["site"],
                "site_length": item.get("site_length", len(item["site"])),
                "cut_index": int(item.get("cut_index", max(1, len(item["site"]) // 2))),
                "overhang": item.get("overhang", "unknown"),
                "overhang_label": item.get("overhang_label", restriction_site_overhang_label(item.get("overhang", "unknown"))),
                "enzyme_type": item.get("enzyme_type", "type_ii"),
                "insert_hits": item["insert"]["hit_count"],
                "insert_positions": item["insert"]["positions"][:6],
                "insert_cuts": item["insert"]["cuts"][:6],
                "vector_hits": item["vector"]["hit_count"] if item.get("vector") else None,
                "vector_positions": item["vector"]["positions"][:6] if item.get("vector") else [],
                "vector_cuts": item["vector"]["cuts"][:6] if item.get("vector") else [],
                "vector_fragments": item["vector"]["fragment_lengths"][:8] if item.get("vector") else [],
            }
        return item

    def assess_restriction_pair(left_raw: dict[str, Any], right_raw: dict[str, Any]) -> dict[str, Any]:
        left = dict(pair_candidate_payload(left_raw))
        right = dict(pair_candidate_payload(right_raw))
        left_cut = left["vector_cuts"][0] if left.get("vector_cuts") else None
        right_cut = right["vector_cuts"][0] if right.get("vector_cuts") else None
        if left_cut is not None and right_cut is not None and left_cut > right_cut:
            left, right = right, left
            left_cut, right_cut = right_cut, left_cut
        elif left["name"] > right["name"]:
            left, right = right, left
            left_cut, right_cut = right_cut, left_cut

        same_site = left["site"] == right["site"]
        both_blunt = left.get("overhang") == "blunt" and right.get("overhang") == "blunt"
        mixed_end_types = left.get("overhang") != right.get("overhang")
        directional = not same_site and not both_blunt
        vector_unique_both = left.get("vector_hits") == 1 and right.get("vector_hits") == 1
        insert_safe_both = left.get("insert_hits") == 0 and right.get("insert_hits") == 0
        auto_pick_eligible = bool(vector_document and vector_unique_both and insert_safe_both and directional)

        if same_site:
            status = "Non-directional"
            summary = "两端使用同一限制酶位点，insert 方向不会被锁定，更适合需要后续筛克隆方向的场景。"
            rank = 2
        elif both_blunt:
            status = "Review"
            summary = "当前是双 blunt-end 组合；理论上可做，但连接效率和方向性通常都不如双 sticky-end。"
            rank = 1
        elif mixed_end_types:
            status = "Directional"
            summary = "当前是双酶切定向克隆；两端切口类型不同，方向性可以锁定，但酶切与纯化步骤建议更谨慎。"
            rank = 1
        else:
            status = "Recommended"
            summary = "当前是双 sticky-end 定向克隆组合；insert 不含内部位点且载体双端唯一切开时，通常是更稳的自动化候选。"
            rank = 0

        return {
            "forwardName": left["name"],
            "reverseName": right["name"],
            "forwardSite": left["site"],
            "reverseSite": right["site"],
            "forwardVectorCut": left_cut,
            "reverseVectorCut": right_cut,
            "directionality": "Directional" if directional else "Non-directional",
            "status": status,
            "status_rank": rank,
            "same_site": same_site,
            "both_blunt": both_blunt,
            "mixed_end_types": mixed_end_types,
            "insert_safe_both": insert_safe_both,
            "vector_unique_both": vector_unique_both,
            "auto_pick_eligible": auto_pick_eligible,
            "summary": summary,
        }

    recommended_pairs: list[dict[str, Any]] = []
    pair_sources = [
        item for item in recommended
        if item.get("enzyme_type") != "type_iis"
    ]
    for left_index in range(len(pair_sources)):
        for right_index in range(left_index + 1, len(pair_sources)):
            recommended_pairs.append(assess_restriction_pair(pair_sources[left_index], pair_sources[right_index]))
    recommended_pairs.sort(
        key=lambda item: (
            item["status_rank"],
            0 if item["auto_pick_eligible"] else 1,
            0 if item["directionality"] == "Directional" else 1,
            0
            if (
                item["forwardVectorCut"] is not None
                and item["reverseVectorCut"] is not None
                and item["forwardVectorCut"] != item["reverseVectorCut"]
            )
            else 1,
            0
            if (
                re.fullmatch(r"[ACGT]+", item["forwardSite"] or "")
                and re.fullmatch(r"[ACGT]+", item["reverseSite"] or "")
            )
            else 1,
            item["forwardVectorCut"] if item["forwardVectorCut"] is not None else 10**9,
            item["reverseVectorCut"] if item["reverseVectorCut"] is not None else 10**9,
            item["forwardName"],
            item["reverseName"],
        )
    )

    chosen_pair_assessment = None
    nonempty_chosen_tokens = [str(item).strip() for item in chosen_tokens if str(item).strip()]
    if len(chosen_analysis) >= 2:
        chosen_pair_assessment = assess_restriction_pair(chosen_analysis[0], chosen_analysis[1])
    elif len(chosen_analysis) == 1 and len(nonempty_chosen_tokens) >= 2:
        chosen_pair_assessment = assess_restriction_pair(chosen_analysis[0], chosen_analysis[0])
    biophysics = calculate_bio_params(insert_document.sequence)
    gc_window = calculate_gc_window(insert_document.sequence, window_size=50)

    return {
        "insertLength": len(insert_document.sequence),
        "insertTopology": insert_document.topology,
        "vectorLength": len(vector_document.sequence) if vector_document else None,
        "vectorTopology": vector_topology if vector_document else None,
        "chosenEnzymes": chosen_analysis,
        "recommendedEnzymes": recommended[:10],
        "recommendedPairs": recommended_pairs[:10],
        "chosenPairAssessment": chosen_pair_assessment,
        "libraryPreview": library_scans[:18],
        "summary": {
            "librarySize": len(RESTRICTION_ENZYME_LIBRARY),
            "insertSafeCutters": insert_safe_cutters,
            "vectorSingleCutters": vector_single_cutters if vector_document else None,
            "recommendedPairs": len(recommended_pairs) if vector_document else None,
        },
        "vectorProvided": vector_document is not None,
        "biophysics": biophysics,
        "gcWindow": gc_window,
    }
def normalize_amino_acid(value: str) -> str:
    token = re.sub(r"[^A-Za-z*]", "", value.strip().upper())
    if not token:
        return ""
    return AA_ALIASES.get(token, "")
def translate_codon(codon: str) -> str:
    return GENETIC_CODE.get(codon.upper(), "X")
def choose_target_codon(wildtype_codon: str, target_aa: str) -> str:
    options = CODONS_BY_AA.get(target_aa, [])
    if not options:
        raise ApiError(f"不支持的目标氨基酸：{target_aa}")

    def score(option: str) -> tuple[int, float, int, str]:
        mismatches = sum(1 for left, right in zip(option, wildtype_codon) if left != right)
        center_change = 0 if option[1] != wildtype_codon[1] else 1
        gc_delta = abs(gc_percent(option) - gc_percent(wildtype_codon))
        return mismatches, gc_delta, center_change, option

    return min(options, key=score)
def resolve_restriction_site(value: str) -> tuple[str, str]:
    enzyme = resolve_restriction_enzyme(value)
    return enzyme["name"], enzyme["site"]
def build_gc_clamp(length: int) -> str:
    if length <= 0:
        return ""
    pattern = "GCGCGA"
    return (pattern * ((length // len(pattern)) + 2))[:length]
def parse_type_iis_overhang(value: str, expected_length: int, label: str) -> str:
    overhang = sanitize_sequence(value)
    if len(overhang) != expected_length:
        raise ApiError(f"{label} 需要提供 {expected_length} bp 的组装 overhang。")
    if "N" in overhang:
        raise ApiError(f"{label} 目前只支持明确的 A/C/G/T overhang，不支持 N 或简并碱基。")
    return overhang
def build_type_iis_tail(enzyme: dict[str, Any], overhang: str, clamp_length: int, reverse: bool = False) -> tuple[str, int]:
    spacer_length = max(0, int(enzyme.get("primer_spacer_length") or 0))
    spacer = "A" * spacer_length
    payload = reverse_complement(overhang) if reverse else overhang
    return f"{build_gc_clamp(clamp_length)}{enzyme['site']}{spacer}{payload}", spacer_length
def gc_percent(seq: str) -> float:
    if not seq:
        return 0.0
    gc = seq.count("G") + seq.count("C")
    return round(gc * 100 / len(seq), 1)
def melting_temp(seq: str) -> float:
    if len(seq) < 14:
        return float((seq.count("A") + seq.count("T")) * 2 + (seq.count("G") + seq.count("C")) * 4)
    gc = seq.count("G") + seq.count("C")
    tm = 64.9 + 41 * (gc - 16.4) / len(seq)
    return round(tm, 1)
def max_homopolymer(seq: str) -> int:
    longest = 1
    current = 1
    for idx in range(1, len(seq)):
        if seq[idx] == seq[idx - 1]:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest
def has_self_dimer(seq: str, min_match: int = 4) -> bool:
    rc = reverse_complement(seq)
    for length in range(min_match, min(8, len(seq)) + 1):
        for start in range(len(seq) - length + 1):
            fragment = seq[start : start + length]
            if fragment in rc:
                return True
    return False
def has_cross_dimer(a: str, b: str, min_match: int = 5) -> bool:
    rc = reverse_complement(b)
    for length in range(min_match, min(8, len(a), len(b)) + 1):
        for start in range(len(a) - length + 1):
            if a[start : start + length] in rc:
                return True
    return False
def three_prime_gc_count(seq: str) -> int:
    tail = seq[-5:]
    return tail.count("G") + tail.count("C")
def estimate_hairpin_stem(seq: str, min_stem: int = 4, max_stem: int = 6, min_loop: int = 3, max_loop: int = 8) -> int:
    best = 0
    for stem in range(min_stem, max_stem + 1):
        max_left = len(seq) - (stem * 2 + min_loop) + 1
        for left in range(max_left):
            for loop in range(min_loop, max_loop + 1):
                right = left + stem + loop
                if right + stem > len(seq):
                    continue
                left_arm = seq[left : left + stem]
                right_arm = seq[right : right + stem]
                if reverse_complement(right_arm) == left_arm:
                    best = max(best, stem)
    return best
# Nearest-neighbor ΔG approximation for hairpin stability (kcal/mol, 37°C).
# Uses unified parameters from SantaLucia 1998.
_NN_DELTA_H = {
    "AA": -7.9, "TT": -7.9, "AT": -7.2, "TA": -7.2,
    "CA": -8.5, "TG": -8.5, "GT": -8.4, "AC": -8.4,
    "CT": -7.8, "AG": -7.8, "GA": -8.2, "TC": -8.2,
    "CG": -10.6, "GC": -9.8, "GG": -8.0, "CC": -8.0,
}
_NN_DELTA_S = {
    "AA": -22.2, "TT": -22.2, "AT": -20.4, "TA": -21.3,
    "CA": -22.7, "TG": -22.7, "GT": -22.4, "AC": -22.4,
    "CT": -21.0, "AG": -21.0, "GA": -22.2, "TC": -22.2,
    "CG": -27.2, "GC": -24.4, "GG": -19.9, "CC": -19.9,
}
def _hairpin_delta_g(stem_seq: str, loop_len: int) -> float:
    """Estimate ΔG (kcal/mol) for a hairpin with the given stem and loop.

    Uses nearest-neighbor parameters for the stem duplex plus a loop penalty.
    Positive ΔG = unstable (good for primer design).
    """
    # Loop penalty: empirical ~1.4 * ln(loop_len) + 1.0 kcal/mol
    loop_penalty = -1.4 * math.log(max(loop_len, 3)) - 1.0
    # Stem stacking energy
    stem_dg = 0.0
    rc_stem = reverse_complement(stem_seq)
    for i in range(len(stem_seq) - 1):
        pair = rc_stem[i : i + 2]  # read 5'→3' on the complementary strand
        dh = _NN_DELTA_H.get(pair, -7.0)
        ds = _NN_DELTA_S.get(pair, -20.0)
        stem_dg += dh - 310.15 * ds / 1000.0
    # Initiation penalty for terminal base pair
    stem_dg += 0.0  # simplified: no separate initiation term
    return round(stem_dg + loop_penalty, 2)
def estimate_hairpin_delta_g(seq: str, min_stem: int = 4, max_stem: int = 6, min_loop: int = 3, max_loop: int = 8) -> float:
    """Return the most negative (most stable) hairpin ΔG in kcal/mol.

    Positive values indicate no stable hairpin; negative values indicate
    increasing stability.  Values > -3 kcal/mol are generally safe for primers.
    """
    best_dg = 0.0  # no hairpin = 0 kcal/mol
    for stem in range(min_stem, max_stem + 1):
        max_left = len(seq) - (stem * 2 + min_loop) + 1
        for left in range(max_left):
            for loop in range(min_loop, max_loop + 1):
                right = left + stem + loop
                if right + stem > len(seq):
                    continue
                left_arm = seq[left : left + stem]
                right_arm = seq[right : right + stem]
                if reverse_complement(right_arm) == left_arm:
                    dg = _hairpin_delta_g(left_arm, loop)
                    best_dg = min(best_dg, dg)
    return best_dg
def primer_metrics(seq: str) -> dict[str, Any]:
    return {
        "gc": gc_percent(seq),
        "tm": melting_temp(seq),
        "homopolymer": max_homopolymer(seq),
        "three_prime_gc": three_prime_gc_count(seq),
        "hairpin_stem": estimate_hairpin_stem(seq),
        "hairpin_delta_g": estimate_hairpin_delta_g(seq),
        "self_dimer": has_self_dimer(seq),
    }
def primer_ok(seq: str) -> bool:
    if "N" in seq:
        return False
    metrics = primer_metrics(seq)
    gc = metrics["gc"]
    tm = metrics["tm"]
    end_gc = metrics["three_prime_gc"]
    if metrics["homopolymer"] > 4:
        return False
    if gc < 38 or gc > 62:
        return False
    if tm < 57.5 or tm > 63.5:
        return False
    if end_gc > 3:
        return False
    if metrics["hairpin_stem"] >= 6:
        return False
    if metrics["self_dimer"]:
        return False
    return True
def primer_quality(seq: str) -> float:
    metrics = primer_metrics(seq)
    return (
        abs(metrics["tm"] - 60.0)
        + abs(metrics["gc"] - 50.0) / 12
        + max(0, metrics["homopolymer"] - 3) * 1.5
        + max(0, metrics["hairpin_stem"] - 4) * 1.4
        + abs(metrics["three_prime_gc"] - 2) * 0.6
    )
def terminal_primer_candidates(sequence: str, reverse: bool = False) -> list[dict[str, Any]]:
    max_length = min(32, len(sequence))
    min_length = 16 if len(sequence) < 80 else 18
    strict: list[dict[str, Any]] = []
    relaxed: list[dict[str, Any]] = []

    for length in range(min_length, max_length + 1):
        if reverse:
            core_template = sequence[-length:]
            primer_seq = reverse_complement(core_template)
            binding_start = len(sequence) - length + 1
            binding_end = len(sequence)
        else:
            core_template = sequence[:length]
            primer_seq = core_template
            binding_start = 1
            binding_end = length

        if "N" in primer_seq:
            continue
        metrics = primer_metrics(primer_seq)
        score = (
            abs(metrics["tm"] - 60.0)
            + abs(metrics["gc"] - 50.0) / 12
            + max(0, metrics["homopolymer"] - 4) * 1.6
            + max(0, metrics["hairpin_stem"] - 4) * 1.5
            + abs(metrics["three_prime_gc"] - 2) * 0.7
            + (2.0 if metrics["self_dimer"] else 0.0)
        )
        item = {
            "core": primer_seq,
            "tm": metrics["tm"],
            "gc": metrics["gc"],
            "binding_start": binding_start,
            "binding_end": binding_end,
            "quality": metrics,
            "score": round(score, 3),
            "strict": False,
        }
        relaxed.append(item)
        if (
            38 <= metrics["gc"] <= 65
            and 58 <= metrics["tm"] <= 66
            and metrics["homopolymer"] <= 4
            and metrics["hairpin_stem"] < 6
            and not metrics["self_dimer"]
            and 1 <= metrics["three_prime_gc"] <= 3
        ):
            item["strict"] = True
            strict.append(item)

    chosen = strict or relaxed
    chosen.sort(key=lambda item: (item["score"], abs(len(item["core"]) - 22), -item["tm"]))
    return chosen[:8]
def spans_exon_junction(start: int, end: int, junctions: list[int]) -> bool:
    for junction in junctions:
        if start + 3 <= junction <= end - 3:
            return True
    return False
def pair_spans_multiple_exons(f_end: int, r_start: int, junctions: list[int]) -> bool:
    return any(f_end < junction < r_start for junction in junctions)
def ncbi_request(endpoint: str, params: dict[str, Any], text: bool = True) -> str | bytes:
    key = cache_key("ncbi", {"endpoint": endpoint, "params": params, "text": text})
    found, cached, is_stale = cache_fetch(key, allow_stale=True)
    if found and not is_stale:
        record_remote_cache_hit("ncbi")
        return cached
    if found and is_stale and os.environ.get("PRIMER_PREFER_STALE_CACHE") == "1":
        record_remote_cache_hit("ncbi", stale=True)
        return cached

    query = urlencode({key: value for key, value in params.items() if value not in (None, "")})
    url = f"{NCBI_BASE}/{endpoint}?{query}"
    try:
        payload = remote_text_request(
            url,
            headers={"User-Agent": "PrimerDesignStudio/0.1"},
            timeout=20,
            service="ncbi",
            rate_limit_message="NCBI 当前限流，请稍后重试；如果你已经有 accession，建议直接输入 accession 继续设计。",
            http_error_label="NCBI 请求失败",
            connection_message="无法连接到 NCBI，请稍后重试。",
        )
    except ApiError as exc:
        if found and is_stale:
            record_remote_cache_hit("ncbi", stale=True)
            record_remote_error("ncbi", str(exc))
            return cached
        raise
    value = payload if text else payload.encode("utf-8")
    return cache_set(key, value)
def ncbi_xml(endpoint: str, params: dict[str, Any]) -> ET.Element:
    raw = ncbi_request(endpoint, params, text=True)
    return ET.fromstring(raw)
def ensembl_json(path: str, params: dict[str, Any] | None = None) -> Any:
    params = params or {}
    merged = {"content-type": "application/json", **params}
    key = cache_key("ensembl", {"path": path, "params": merged})
    found, cached, is_stale = cache_fetch(key, allow_stale=True)
    if found and not is_stale:
        record_remote_cache_hit("ensembl")
        return cached

    query = urlencode({key: value for key, value in merged.items() if value not in (None, "")})
    url = f"{ENSEMBL_BASE}{path}"
    if query:
        url = f"{url}?{query}"

    try:
        raw = remote_text_request(
            url,
            headers={"User-Agent": "PrimerDesignStudio/0.1", "Accept": "application/json"},
            timeout=20,
            service="ensembl",
            rate_limit_message="Ensembl 当前限流，请稍后重试。",
            http_error_label="Ensembl 请求失败",
            connection_message="无法连接到 Ensembl，请稍后重试。",
        )
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        if found and is_stale:
            record_remote_cache_hit("ensembl", stale=True)
            record_remote_error("ensembl", "Ensembl 返回了无法解析的 JSON。")
            return cached
        raise ApiError("Ensembl 返回了无法解析的 JSON。") from exc
    except ApiError as exc:
        if found and is_stale:
            record_remote_cache_hit("ensembl", stale=True)
            record_remote_error("ensembl", str(exc))
            return cached
        raise
    return cache_set(key, payload, ttl=ENSEMBL_CACHE_TTL)
def blast_request(params: dict[str, Any]) -> str:
    query = urlencode({key: value for key, value in params.items() if value not in (None, "")})
    url = f"{BLAST_BASE}?{query}"
    return remote_text_request(
        url,
        headers={"User-Agent": "PrimerDesignStudio/0.1", "Accept": "*/*"},
        timeout=60,
        service="blast",
        rate_limit_message="NCBI BLAST 当前限流，请稍后重试。",
        http_error_label="NCBI BLAST 请求失败",
        connection_message="无法连接到 NCBI BLAST，请稍后重试。",
    )
def submit_blast_job(query: str, database: str, entrez_query: str = "") -> tuple[str, int]:
    response = blast_request(
        {
            "CMD": "Put",
            "PROGRAM": "blastn",
            "DATABASE": database,
            "QUERY": query,
            "SHORT_QUERY": "true",
            "ENTREZ_QUERY": entrez_query,
        }
    )
    rid_match = re.search(r"RID = ([A-Z0-9-]+)", response)
    rtoe_match = re.search(r"RTOE = (\d+)", response)
    if not rid_match or not rtoe_match:
        raise ApiError("NCBI BLAST 没有返回有效 RID，请稍后重试。")
    return rid_match.group(1), int(rtoe_match.group(1))
def fetch_blast_xml(rid: str) -> str:
    return blast_request({"CMD": "Get", "RID": rid, "FORMAT_TYPE": "XML"})
def parse_blast_hits(xml_text: str) -> dict[str, Any]:
    root = ET.fromstring(xml_text)
    query_len = int(root.findtext("BlastOutput_query-len", "0") or 0)
    hits: list[dict[str, Any]] = []
    best_by_accession: dict[str, dict[str, Any]] = {}

    for hit in root.findall(".//Hit"):
        accession = hit.findtext("Hit_accession") or ""
        title = hit.findtext("Hit_def") or accession
        for hsp in hit.findall(".//Hsp"):
            align_len = int(hsp.findtext("Hsp_align-len", "0") or 0)
            identity = int(hsp.findtext("Hsp_identity", "0") or 0)
            gaps = int(hsp.findtext("Hsp_gaps", "0") or 0)
            query_from = int(hsp.findtext("Hsp_query-from", "0") or 0)
            query_to = int(hsp.findtext("Hsp_query-to", "0") or 0)
            if query_len <= 0 or align_len <= 0:
                continue
            coverage = round((query_to - query_from + 1) / query_len, 3)
            mismatch_count = max(0, align_len - identity)
            item = {
                "accession": accession,
                "title": title,
                "identity": identity,
                "align_len": align_len,
                "gaps": gaps,
                "mismatches": mismatch_count,
                "coverage": coverage,
                "query_from": query_from,
                "query_to": query_to,
                "hit_from": int(hsp.findtext("Hsp_hit-from", "0") or 0),
                "hit_to": int(hsp.findtext("Hsp_hit-to", "0") or 0),
                "query_seq": hsp.findtext("Hsp_qseq") or "",
                "hit_seq": hsp.findtext("Hsp_hseq") or "",
            }
            previous = best_by_accession.get(accession)
            rank = (item["mismatches"], -item["coverage"], item["gaps"])
            if previous is None or rank < (previous["mismatches"], -previous["coverage"], previous["gaps"]):
                best_by_accession[accession] = item

    hits = sorted(best_by_accession.values(), key=lambda item: (item["mismatches"], item["gaps"], -item["coverage"], item["accession"]))
    return {"query_len": query_len, "hits": hits}
def run_blast_sync(query: str, database: str, entrez_query: str = "", max_wait_sec: int = 90) -> dict[str, Any]:
    key = cache_key(
        "blast",
        {"query": query, "database": database, "entrez_query": entrez_query, "max_wait_sec": max_wait_sec},
    )
    found, cached, is_stale = cache_fetch(key, allow_stale=True)
    if found and not is_stale:
        record_remote_cache_hit("blast")
        return cached

    try:
        rid, rtoe = submit_blast_job(query, database, entrez_query)
        time.sleep(max(1, min(rtoe, 10)))
        deadline = time.time() + max_wait_sec
        last_response = ""

        while time.time() < deadline:
            last_response = fetch_blast_xml(rid)
            stripped = last_response.lstrip()
            if stripped.startswith("<?xml"):
                parsed = parse_blast_hits(last_response)
                parsed["database"] = database
                parsed["entrez_query"] = entrez_query
                parsed["rid"] = rid
                return cache_set(key, parsed, ttl=BLAST_CACHE_TTL)
            if "Status=FAILED" in last_response or "Status=UNKNOWN" in last_response:
                raise ApiError("NCBI BLAST 任务执行失败，请稍后重试。")
            time.sleep(5)
    except ApiError as exc:
        if found and is_stale:
            record_remote_cache_hit("blast", stale=True)
            record_remote_error("blast", str(exc))
            return cached
        raise

    if found and is_stale:
        record_remote_cache_hit("blast", stale=True)
        record_remote_error("blast", "NCBI BLAST 查询超时，请稍后重试。")
        return cached
    raise ApiError("NCBI BLAST 查询超时，请稍后重试。")
def organism_entrez_query(species: str, strain: str = "") -> str:
    if not species:
        return ""
    if strain:
        return f"({species}[Organism]) AND ({strain}[All Fields])"
    return f"{species}[Organism]"
def candidate_hit_quality(hit: dict[str, Any], query_len: int, max_mismatches: int) -> bool:
    return hit["coverage"] >= 0.9 and hit["mismatches"] <= max_mismatches and hit["query_from"] == 1 and hit["query_to"] == query_len
def summarize_primer_blast(blast_data: dict[str, Any], target_accession: str | None) -> dict[str, Any]:
    query_len = blast_data["query_len"]
    target_base = accession_base(target_accession) if target_accession else None
    exact_hits = [hit for hit in blast_data["hits"] if candidate_hit_quality(hit, query_len, max_mismatches=0)]
    near_hits = [hit for hit in blast_data["hits"] if candidate_hit_quality(hit, query_len, max_mismatches=1)]
    off_target_exact = [hit for hit in exact_hits if accession_base(hit["accession"]) != target_base] if target_base else exact_hits
    off_target_near = [hit for hit in near_hits if accession_base(hit["accession"]) != target_base] if target_base else near_hits
    return {
        "database": blast_data.get("database", "nt"),
        "exact_hits": len(exact_hits),
        "near_hits": len(near_hits),
        "off_target_exact": len(off_target_exact),
        "off_target_near": len(off_target_near),
        "top_hits": (off_target_near or near_hits)[:5],
    }
def classify_rt_specificity(forward_summary: dict[str, Any], reverse_summary: dict[str, Any]) -> str:
    exact_total = forward_summary["off_target_exact"] + reverse_summary["off_target_exact"]
    near_total = forward_summary["off_target_near"] + reverse_summary["off_target_near"]
    if exact_total == 0 and near_total <= 2:
        return "High"
    if exact_total <= 2 and near_total <= 8:
        return "Medium"
    return "Low"
def classify_genome_offtarget(exact_hits: int, one_mismatch_hits: int, two_mismatch_hits: int) -> str:
    if exact_hits > 0:
        return "High"
    if one_mismatch_hits > 0 or two_mismatch_hits >= 5:
        return "Medium"
    return "Low"
def classify_sirna_transcriptome_offtarget(exact_hits: int, one_mismatch_hits: int, two_mismatch_hits: int) -> str:
    if exact_hits > 0 or one_mismatch_hits >= 3 or (one_mismatch_hits >= 1 and two_mismatch_hits >= 10):
        return "High"
    if one_mismatch_hits >= 1 or two_mismatch_hits >= 4:
        return "Medium"
    return "Low"
def allowed_accession_bases(result: dict[str, Any], target_accession: str | None) -> set[str]:
    allowed: set[str] = set()
    if target_accession:
        allowed.add(accession_base(target_accession))
    for accession in result.get("shared_accessions") or []:
        if accession:
            allowed.add(accession_base(accession))
    return {item for item in allowed if item}
def gene_search(gene: str, species: str) -> str:
    root = ncbi_xml(
        "esearch.fcgi",
        {
            "db": "gene",
            "retmode": "xml",
            "retmax": 1,
            "term": f"{gene}[Gene Name] AND {species}[Organism]",
        },
    )
    ids = [node.text for node in root.findall(".//Id") if node.text]
    if not ids:
        raise ApiError(f"没有在 NCBI 里找到 {species} 的基因 {gene}。")
    return ids[0]
def elink_ids(gene_id: str, linknames: list[str], limit: int = 8) -> list[str]:
    for linkname in linknames:
        root = ncbi_xml(
            "elink.fcgi",
            {
                "dbfrom": "gene",
                "db": "nuccore",
                "id": gene_id,
                "linkname": linkname,
                "retmode": "xml",
            },
        )
        ids = [node.text for node in root.findall(".//Link/Id") if node.text]
        if ids:
            return ids[:limit]
    return []
def fetch_fasta(nuccore_id: str) -> tuple[str, str]:
    text = ncbi_request(
        "efetch.fcgi",
        {"db": "nuccore", "id": nuccore_id, "rettype": "fasta", "retmode": "text"},
        text=True,
    )
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines or not lines[0].startswith(">"):
        raise ApiError("NCBI 没有返回有效序列。")
    header = lines[0][1:]
    accession = header.split()[0]
    sequence = sanitize_sequence("\n".join(lines[1:]))
    if not sequence:
        raise ApiError("NCBI 返回了空序列。")
    return accession, sequence
def fetch_fasta_with_title(nuccore_id: str) -> tuple[str, str, str]:
    text = ncbi_request(
        "efetch.fcgi",
        {"db": "nuccore", "id": nuccore_id, "rettype": "fasta", "retmode": "text"},
        text=True,
    )
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines or not lines[0].startswith(">"):
        raise ApiError("NCBI 没有返回有效序列。")
    header = lines[0][1:]
    accession = header.split()[0]
    title = header[len(accession) :].strip()
    sequence = sanitize_sequence("\n".join(lines[1:]))
    if not sequence:
        raise ApiError("NCBI 返回了空序列。")
    return accession, title, sequence
def fetch_junctions(nuccore_id: str) -> list[int]:
    text = ncbi_request(
        "efetch.fcgi",
        {"db": "nuccore", "id": nuccore_id, "rettype": "gb", "retmode": "text"},
        text=True,
    )
    exons: list[tuple[int, int]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("exon"):
            continue
        match = re.search(r"(\d+)\.\.(\d+)", stripped)
        if match:
            exons.append((int(match.group(1)), int(match.group(2))))
    exons.sort()
    return [left[1] for left, _right in zip(exons, exons[1:])]
def accession_priority(accession: str) -> tuple[int, int]:
    prefixes = {
        "NM_": 0,
        "XM_": 1,
        "NR_": 2,
        "XR_": 3,
        "NG_": 4,
        "NC_": 5,
    }
    for prefix, priority in prefixes.items():
        if accession.startswith(prefix):
            return priority, 0
    return 9, 0
def parse_transcript_variant(title: str) -> str | None:
    match = re.search(r"transcript variant ([^,]+)", title, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None
def transcript_option_from_id(nuccore_id: str) -> dict[str, Any]:
    accession, title, sequence = fetch_fasta_with_title(nuccore_id)
    return {
        "nuccore_id": nuccore_id,
        "accession": accession,
        "title": title,
        "length": len(sequence),
        "variant": parse_transcript_variant(title),
        "is_coding": accession.startswith(("NM_", "XM_")),
        "entry_rank": sequence_entry_rank(accession, title),
        "is_genome": sequence_entry_rank(accession, title) >= 4,
        "sequence": sequence,
    }
def resolve_target_options(gene: str, species: str, strain: str = "", limit: int = 6) -> list[dict[str, Any]]:
    gene_id = gene_search(gene, species)
    linked_ids = elink_ids(gene_id, ["gene_nuccore_refseqrna", "gene_nuccore"], limit=max(limit, 8))
    if not linked_ids:
        raise ApiError(f"没有为 {gene} 找到合适的候选条目。")

    options: list[dict[str, Any]] = []
    seen: set[str] = set()
    for nuccore_id in linked_ids:
        option = transcript_option_from_id(nuccore_id)
        accession = option["accession"]
        if accession in seen:
            continue
        seen.add(accession)
        option["matches_strain"] = strain_matches_title(option["title"], strain)
        options.append(option)

    options.sort(
        key=lambda item: (
            0 if (strain and item.get("matches_strain")) else 1 if strain else 0,
            item.get("entry_rank", 3),
            accession_priority(item["accession"])[0],
            0 if item["variant"] in (None, "1") else 1,
            item["length"],
        )
    )
    if options:
        longest = max(item["length"] for item in options)
        for index, item in enumerate(options):
            item["recommended"] = index == 0
            item["is_longest"] = item["length"] == longest
            tags: list[str] = []
            if item["recommended"]:
                tags.append("Recommended")
            if item.get("matches_strain"):
                tags.append("Strain Match")
            if item["is_coding"]:
                tags.append("Coding")
            elif item.get("entry_rank") == 0:
                tags.append("Gene CDS")
            if item.get("is_genome"):
                tags.append("Genome")
            if item["is_longest"]:
                tags.append("Longest")
            item["tags"] = tags
    return options[:limit]
def resolve_transcript_options(gene: str, species: str, strain: str = "", limit: int = 6) -> list[dict[str, Any]]:
    return resolve_target_options(gene, species, strain=strain, limit=limit)
def choose_best_linked_sequence(linked_ids: list[str]) -> tuple[str, str, str]:
    if not linked_ids:
        raise ApiError("没有找到合适的 NCBI 条目。")

    ranked: list[tuple[tuple[int, int], str, str, str]] = []
    for nuccore_id in linked_ids[:8]:
        accession, sequence = fetch_fasta(nuccore_id)
        rank = (accession_priority(accession)[0], len(sequence))
        ranked.append((rank, nuccore_id, accession, sequence))

    ranked.sort(key=lambda item: item[0])
    _rank, nuccore_id, accession, sequence = ranked[0]
    return nuccore_id, accession, sequence
def build_sequence_note(document: SequenceDocument, *, direct_input: bool = False) -> str:
    format_labels = {"plain": "纯序列", "fasta": "FASTA", "genbank": "GenBank"}
    format_label = format_labels.get(document.format, document.format.upper())
    source = "直接序列输入" if direct_input else "序列来源"
    extras: list[str] = [f"格式：{format_label}"]
    if document.accession:
        extras.append(f"accession：{document.accession}")
    if document.features:
        extras.append(f"feature：{len(document.features)}")
    return f"来源：{source}（{' | '.join(extras)}）"
def resolve_rt_payload(payload: dict[str, Any]) -> tuple[str, SequencePayload]:
    raw_query = (payload.get("query") or "").strip()
    raw_sequence = payload.get("sequence") or ""
    species = (payload.get("species") or "Homo sapiens").strip() or "Homo sapiens"
    strain = (payload.get("strain") or "").strip()
    selected_accession = (payload.get("selectedAccession") or "").strip().upper()

    if raw_sequence:
        label = (payload.get("label") or "自定义序列").strip() or "自定义序列"
        document = parse_sequence_document(raw_sequence, fallback_name=label)
        sequence = document.sequence
        if len(sequence) < 90:
            raise ApiError("自定义序列至少需要 90 bp，才能稳定筛选 RT-qPCR 引物。")
        validate_sequence_length(sequence, "rtqpcr", "RT-qPCR 序列")
        return label, SequencePayload(
            sequence,
            document.accession,
            f"{species} · 直接序列输入 · {document.format.upper()}",
            build_sequence_note(document, direct_input=True),
            [],
            None,
            species=species,
            strain=strain or None,
            document=document,
        )

    if not raw_query:
        raise ApiError("请输入基因名、RefSeq accession，或者粘贴 DNA/cDNA 序列。")

    if looks_like_sequence(raw_query) or looks_like_sequence_literal(raw_query):
        document = parse_sequence_document(raw_query, fallback_name="Direct_Sequence")
        sequence = document.sequence
        if len(sequence) < 90:
            raise ApiError("输入序列太短，至少需要 90 bp。")
        validate_sequence_length(sequence, "rtqpcr", "RT-qPCR 序列")
        return "直接序列", SequencePayload(
            sequence,
            document.accession,
            f"{species} · 直接序列输入 · {document.format.upper()}",
            build_sequence_note(document, direct_input=True),
            [],
            None,
            species=species,
            strain=strain or None,
            document=document,
        )

    if ACCESSION_RE.match(raw_query.upper()):
        accession, title, sequence = fetch_fasta_with_title(raw_query.upper())
        junctions = fetch_junctions(raw_query.upper())
        document = build_sequence_document(
            sequence,
            name=accession,
            description=title or accession,
            accession=accession,
            format_name="fasta",
            source="NCBI nuccore",
            organism=species,
        )
        return raw_query.upper(), SequencePayload(
            sequence,
            accession,
            f"{species} · {accession}",
            f"来源：NCBI accession {accession}",
            junctions,
            None,
            species=species,
            strain=strain or None,
            document=document,
        )

    transcript_options = resolve_transcript_options(raw_query, species, strain=strain)
    chosen = None
    if selected_accession:
        for option in transcript_options:
            if option["accession"].upper() == selected_accession:
                chosen = option
                break
        if chosen is None:
            raise ApiError(f"没有在 {raw_query} 的候选条目中找到 {selected_accession}。")
    else:
        chosen = transcript_options[0]

    nuccore_id = chosen["nuccore_id"]
    accession = chosen["accession"]
    sequence = chosen["sequence"]
    junctions = fetch_junctions(nuccore_id)
    document = build_sequence_document(
        sequence,
        name=accession,
        description=chosen["title"],
        accession=accession,
        format_name="fasta",
        source="NCBI gene search",
        organism=species,
    )
    return raw_query, SequencePayload(
        sequence,
        accession,
        f"{species}{f' · {strain}' if strain else ''} · {accession}",
        f"来源：NCBI 基因检索 -> {accession}",
        junctions,
        [
            {
                "accession": option["accession"],
                "title": option["title"],
                "length": option["length"],
                "variant": option["variant"],
                "tags": option.get("tags", []),
                "selected": option["accession"] == accession,
            }
            for option in transcript_options
        ],
        species=species,
        gene_symbol=raw_query,
        strain=strain or None,
        document=document,
    )
def resolve_sgrna_payload(payload: dict[str, Any]) -> tuple[str, SequencePayload]:
    raw_sequence = payload.get("sequence") or ""
    raw_query = (payload.get("query") or "").strip()
    label = (payload.get("label") or "").strip()
    species = (payload.get("species") or "Homo sapiens").strip() or "Homo sapiens"
    strain = (payload.get("strain") or "").strip()
    selected_accession = (payload.get("selectedAccession") or "").strip().upper()

    if raw_sequence:
        sequence_label = label or "自定义 DNA 片段"
        document = parse_sequence_document(raw_sequence, fallback_name=sequence_label)
        sequence = document.sequence
        if len(sequence) < 23:
            raise ApiError("sgRNA 分析至少需要 23 bp 的 DNA 序列。")
        validate_sequence_length(sequence, "sgrna", "sgRNA 目标序列")
        return sequence_label, SequencePayload(
            sequence,
            document.accession,
            f"直接序列输入 · {len(sequence)} bp · {document.format.upper()}",
            build_sequence_note(document, direct_input=True),
            [],
            species=species,
            strain=strain or None,
            document=document,
        )

    if not raw_query:
        raise ApiError("请输入 DNA 序列，或者输入基因名 / NCBI accession。")
    if ACCESSION_RE.match(raw_query.upper()):
        accession, title, sequence = fetch_fasta_with_title(raw_query.upper())
        sequence_label = label or accession
        document = build_sequence_document(
            sequence,
            name=accession,
            description=title or accession,
            accession=accession,
            format_name="fasta",
            source="NCBI nuccore",
            organism=species,
        )
        return sequence_label, SequencePayload(
            sequence,
            accession,
            f"{accession} · {len(sequence)} bp",
            f"来源：NCBI accession {accession}",
            [],
            species=species,
            strain=strain or None,
            document=document,
        )

    target_options = resolve_target_options(raw_query, species, strain=strain)
    chosen = None
    if selected_accession:
        for option in target_options:
            if option["accession"].upper() == selected_accession:
                chosen = option
                break
        if chosen is None:
            raise ApiError(f"没有在 {raw_query} 的候选条目中找到 {selected_accession}。")
    else:
        chosen = target_options[0]

    accession = chosen["accession"]
    sequence = chosen["sequence"]
    sequence_label = label or raw_query
    document = build_sequence_document(
        sequence,
        name=accession,
        description=chosen["title"],
        accession=accession,
        format_name="fasta",
        source="NCBI gene search",
        organism=species,
    )
    return sequence_label, SequencePayload(
        sequence,
        accession,
        f"{species}{f' · {strain}' if strain else ''} · {accession}",
        f"来源：NCBI 基因检索 -> {accession}",
        [],
        [
            {
                "accession": option["accession"],
                "title": option["title"],
                "length": option["length"],
                "variant": option["variant"],
                "tags": option.get("tags", []),
                "selected": option["accession"] == accession,
            }
            for option in target_options
        ],
        species=species,
        gene_symbol=raw_query,
        strain=strain or None,
        document=document,
    )
def resolve_sirna_payload(payload: dict[str, Any]) -> tuple[str, SequencePayload]:
    raw_query = (payload.get("query") or "").strip()
    raw_sequence = payload.get("sequence") or ""
    label = (payload.get("label") or "").strip()
    species = (payload.get("species") or "Homo sapiens").strip() or "Homo sapiens"
    strain = (payload.get("strain") or "").strip()
    selected_accession = (payload.get("selectedAccession") or "").strip().upper()

    if raw_sequence:
        sequence_label = label or "自定义转录本"
        document = parse_sequence_document(raw_sequence, fallback_name=sequence_label)
        sequence = document.sequence
        if len(sequence) < 30:
            raise ApiError("siRNA 设计至少需要 30 nt 的 mRNA / cDNA 序列。")
        validate_sequence_length(sequence, "sirna", "siRNA 目标序列")
        return sequence_label, SequencePayload(
            sequence,
            document.accession,
            f"{species} · 直接序列输入 · {document.format.upper()}",
            build_sequence_note(document, direct_input=True),
            [],
            None,
            species=species,
            strain=strain or None,
            document=document,
            cds_summary=extract_cds_summary(document),
        )

    if not raw_query:
        raise ApiError("请输入基因名、RefSeq transcript accession，或者粘贴 mRNA / cDNA 序列。")

    if looks_like_sequence(raw_query):
        document = parse_sequence_document(raw_query, fallback_name="Direct_Transcript")
        sequence = document.sequence
        if len(sequence) < 30:
            raise ApiError("输入序列太短，至少需要 30 nt。")
        validate_sequence_length(sequence, "sirna", "siRNA 目标序列")
        return "直接序列", SequencePayload(
            sequence,
            document.accession,
            f"{species} · 直接序列输入 · {document.format.upper()}",
            build_sequence_note(document, direct_input=True),
            [],
            None,
            species=species,
            strain=strain or None,
            document=document,
            cds_summary=extract_cds_summary(document),
        )

    if ACCESSION_RE.match(raw_query.upper()):
        accession, title, sequence = fetch_fasta_with_title(raw_query.upper())
        document = build_sequence_document(
            sequence,
            name=accession,
            description=title or accession,
            accession=accession,
            format_name="fasta",
            source="NCBI nuccore",
            organism=species,
        )
        document = hydrate_document_from_ncbi(accession, document)
        return (label or raw_query.upper()), SequencePayload(
            sequence,
            accession,
            f"{species} · {accession}",
            f"来源：NCBI accession {accession}",
            [],
            None,
            species=species,
            strain=strain or None,
            document=document,
            cds_summary=extract_cds_summary(document),
        )

    transcript_options = resolve_transcript_options(raw_query, species, strain=strain)
    chosen = None
    if selected_accession:
        for option in transcript_options:
            if option["accession"].upper() == selected_accession:
                chosen = option
                break
        if chosen is None:
            raise ApiError(f"没有在 {raw_query} 的候选条目中找到 {selected_accession}。")
    else:
        chosen = transcript_options[0]

    accession = chosen["accession"]
    sequence = chosen["sequence"]
    document = build_sequence_document(
        sequence,
        name=accession,
        description=chosen["title"],
        accession=accession,
        format_name="fasta",
        source="NCBI gene search",
        organism=species,
    )
    document = hydrate_document_from_ncbi(chosen.get("nuccore_id") or accession, document)
    variant_sequences = [
        {
            "accession": option["accession"],
            "title": option["title"],
            "variant": option["variant"],
            "sequence": option["sequence"],
            "selected": option["accession"] == accession,
        }
        for option in transcript_options
        if not option.get("is_genome")
    ] or [
        {
            "accession": option["accession"],
            "title": option["title"],
            "variant": option["variant"],
            "sequence": option["sequence"],
            "selected": option["accession"] == accession,
        }
        for option in transcript_options
    ]
    return (label or raw_query), SequencePayload(
        sequence,
        accession,
        f"{species}{f' · {strain}' if strain else ''} · {accession}",
        f"来源：NCBI transcript 检索 -> {accession}",
        [],
        [
            {
                "accession": option["accession"],
                "title": option["title"],
                "length": option["length"],
                "variant": option["variant"],
                "tags": option.get("tags", []),
                "selected": option["accession"] == accession,
            }
            for option in transcript_options
        ],
        species=species,
        gene_symbol=raw_query,
        strain=strain or None,
        document=document,
        cds_summary=extract_cds_summary(document),
        variant_sequences=variant_sequences,
    )
def generate_primer_candidates(sequence: str, reverse: bool = False) -> dict[int, list[dict[str, Any]]]:
    indexed: dict[int, list[dict[str, Any]]] = {}
    max_start = len(sequence) - 18
    for start in range(max_start):
        for length in range(18, 25):
            fragment = sequence[start : start + length]
            if len(fragment) != length:
                continue
            seq = reverse_complement(fragment) if reverse else fragment
            if not primer_ok(seq):
                continue
            metrics = primer_metrics(seq)
            item = {
                "start": start,
                "end": start + length,
                "length": length,
                "seq": seq,
                "tm": metrics["tm"],
                "gc": metrics["gc"],
                "three_prime_gc": metrics["three_prime_gc"],
                "hairpin_stem": metrics["hairpin_stem"],
                "homopolymer": metrics["homopolymer"],
                "quality": primer_quality(seq),
            }
            indexed.setdefault(start, []).append(item)
    return indexed
def find_probe(sequence: str, left_end: int, right_start: int, primer_tm: float) -> dict[str, Any] | None:
    if right_start - left_end < 30:
        return None
    for start in range(left_end + 5, right_start - 18):
        for length in range(20, 28):
            probe = sequence[start : start + length]
            if len(probe) != length or "N" in probe:
                continue
            if probe.startswith("G") or "GGGG" in probe:
                continue
            gc = gc_percent(probe)
            tm = melting_temp(probe)
            if 35 <= gc <= 80 and primer_tm + 4 <= tm <= primer_tm + 12:
                return {"seq": probe, "tm": tm, "gc": gc, "start": start, "end": start + length}
    return None
def recommend_pcr_conditions(tm_f: float, tm_r: float, amplicon_size: int, include_probe: bool) -> dict[str, Any]:
    anneal = round(min(tm_f, tm_r) - 3.0, 1)
    extension_sec = max(10, min(20, round(amplicon_size / 12)))
    return {
        "anneal_c": anneal,
        "extension_sec": extension_sec,
        "cycles": 40,
        "chemistry": "TaqMan" if include_probe else "SYBR / qPCR",
    }
def mutagenesis_tm(seq: str, mismatch_bases: int) -> float:
    if not seq:
        return 0.0
    mismatch_pct = mismatch_bases * 100 / len(seq)
    tm = 81.5 + 0.41 * gc_percent(seq) - 675 / len(seq) - mismatch_pct
    return round(tm, 1)
def mutagenesis_metrics(seq: str, mismatch_bases: int) -> dict[str, Any]:
    base = primer_metrics(seq)
    return {
        "gc": base["gc"],
        "tm": mutagenesis_tm(seq, mismatch_bases),
        "homopolymer": base["homopolymer"],
        "three_prime_gc": base["three_prime_gc"],
        "hairpin_stem": base["hairpin_stem"],
        "self_dimer": has_self_dimer(seq, min_match=6),
    }
def recommend_mutagenesis_conditions(tm: float, template_length: int) -> dict[str, Any]:
    return {
        "anneal_c": round(max(60.0, tm - 5.0), 1),
        "extension_sec": max(20, min(240, round(template_length / 30))),
        "cycles": 18,
        "digest": "DpnI after PCR",
    }
def build_mutagenesis_context(sequence: str, mutation_start: int, reference: str, alternate: str, flank: int = 12) -> dict[str, Any]:
    left = sequence[max(0, mutation_start - flank) : mutation_start]
    right = sequence[mutation_start + len(reference) : mutation_start + len(reference) + flank]
    return {
        "left": left,
        "reference": reference,
        "alternate": alternate,
        "right": right,
        "wildtype": f"{left}{reference}{right}",
        "mutant": f"{left}{alternate}{right}",
    }
def resolve_mutagenesis_request(payload: dict[str, Any]) -> dict[str, Any]:
    raw_sequence = payload.get("sequence") or ""
    label = (payload.get("label") or "").strip()
    document = parse_sequence_document(raw_sequence, fallback_name=label or "Mutagenesis_Template")
    sequence = document.sequence
    if len(sequence) < 60:
        raise ApiError("点突变模板序列至少建议提供 60 bp。")
    validate_sequence_length(sequence, "mutagenesis", "点突变模板序列")

    mutation_mode = (payload.get("mutationMode") or payload.get("mode") or "dna").strip().lower()

    if mutation_mode in {"aa", "protein", "amino"}:
        try:
            aa_position = int(str(payload.get("aaPosition") or payload.get("position") or "").strip())
        except ValueError as exc:
            raise ApiError("请输入有效的氨基酸位点（1-based）。") from exc
        try:
            cds_start = int(str(payload.get("cdsStart") or 1).strip())
        except ValueError as exc:
            raise ApiError("请输入有效的 CDS 起始位置（1-based）。") from exc

        source_aa = normalize_amino_acid(payload.get("sourceAa") or payload.get("referenceAa") or payload.get("reference") or "")
        target_aa = normalize_amino_acid(payload.get("targetAa") or payload.get("alternateAa") or payload.get("alternate") or "")
        if not source_aa or not target_aa:
            raise ApiError("请填写原氨基酸和目标氨基酸，支持一字母或三字母写法。")
        if source_aa == target_aa:
            raise ApiError("原氨基酸和目标氨基酸相同，不需要设计突变。")
        if cds_start < 1 or cds_start > len(sequence):
            raise ApiError("CDS 起始位置超出了模板序列范围。")

        codon_start = cds_start - 1 + (aa_position - 1) * 3
        codon_end = codon_start + 3
        if aa_position < 1 or codon_end > len(sequence):
            raise ApiError("氨基酸位点超出了提供的编码区范围。")

        wildtype_codon = sequence[codon_start:codon_end]
        actual_source_aa = translate_codon(wildtype_codon)
        if actual_source_aa == "X":
            raise ApiError("模板序列在该位点包含无法翻译的密码子。")
        if actual_source_aa != source_aa:
            raise ApiError(f"模板序列在该位点实际编码 {actual_source_aa}（{wildtype_codon}），与你输入的原氨基酸 {source_aa} 不一致。")

        mutant_codon = choose_target_codon(wildtype_codon, target_aa)
        mutation_label = f"{source_aa}{aa_position}{target_aa}"
        return {
            "sequence": sequence,
            "position": codon_start + 1,
            "reference": wildtype_codon,
            "alternate": mutant_codon,
            "label": label or mutation_label,
            "document": document,
            "mutation_mode": "aa",
            "mutation_label": mutation_label,
            "nt_mutation_label": f"{wildtype_codon}{codon_start + 1}{mutant_codon}",
            "messages": [
                f"已根据氨基酸突变 {mutation_label} 自动推导密码子替换 {wildtype_codon} → {mutant_codon}。",
                f"当前按模板第 {cds_start} 位作为 CDS 起点计算阅读框。",
            ],
            "aa_context": {
                "aa_position": aa_position,
                "source_aa": source_aa,
                "target_aa": target_aa,
                "wildtype_codon": wildtype_codon,
                "mutant_codon": mutant_codon,
                "cds_start": cds_start,
            },
        }

    try:
        position = int(str(payload.get("position") or "").strip())
    except ValueError as exc:
        raise ApiError("请输入有效的突变起始位置（1-based）。") from exc

    reference = sanitize_sequence(payload.get("reference") or payload.get("ref") or "")
    alternate = sanitize_sequence(payload.get("alternate") or payload.get("alt") or "")
    if not reference or not alternate:
        raise ApiError("请填写原序列和目标序列。")
    if len(reference) != len(alternate):
        raise ApiError("当前点突变页面只支持等长替换，不支持插入/缺失。")
    if position < 1 or position + len(reference) - 1 > len(sequence):
        raise ApiError("突变位置超出了模板序列范围。")

    actual_reference = sequence[position - 1 : position - 1 + len(reference)]
    if actual_reference != reference:
        raise ApiError(f"模板序列在该位置实际是 {actual_reference}，与你输入的原序列 {reference} 不一致。")

    mutation_label = f"{reference}{position}{alternate}"
    return {
        "sequence": sequence,
        "position": position,
        "reference": reference,
        "alternate": alternate,
        "label": label or mutation_label,
        "document": document,
        "mutation_mode": "dna",
        "mutation_label": mutation_label,
        "nt_mutation_label": mutation_label,
        "messages": [],
        "aa_context": None,
    }
def design_mutagenesis_primers(
    sequence: str,
    position: int,
    reference: str,
    alternate: str,
) -> tuple[list[dict[str, Any]], bool]:
    mutation_start = position - 1
    mutation_end = mutation_start + len(reference)
    mismatch_bases = sum(1 for base_a, base_b in zip(reference, alternate) if base_a != base_b)
    if mismatch_bases == 0:
        raise ApiError("原序列和目标序列相同，不需要设计点突变引物。")

    strict_candidates: list[dict[str, Any]] = []
    relaxed_candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    min_total = max(25, len(alternate) + 20)
    max_total = min(45, len(sequence))
    if max_total < min_total:
        raise ApiError("模板序列太短，无法为点突变设计稳定引物。")

    for total_length in range(min_total, max_total + 1):
        min_left = max(10, total_length - len(alternate) - 20)
        max_left = min(total_length - len(alternate) - 10, 22)
        for left_len in range(min_left, max_left + 1):
            right_len = total_length - len(alternate) - left_len
            if right_len < 10:
                continue
            primer_start = mutation_start - left_len
            primer_end = mutation_end + right_len
            if primer_start < 0 or primer_end > len(sequence):
                continue

            wildtype_window = sequence[primer_start:primer_end]
            primer_seq = sequence[primer_start:mutation_start] + alternate + sequence[mutation_end:primer_end]
            if primer_seq in seen:
                continue
            seen.add(primer_seq)

            metrics = mutagenesis_metrics(primer_seq, mismatch_bases)
            mutation_center = left_len + len(alternate) / 2
            center_offset = abs(mutation_center - len(primer_seq) / 2)
            score = (
                abs(metrics["tm"] - 78.0) * 0.85
                + abs(metrics["gc"] - 50.0) / 10
                + center_offset * 1.2
                + abs(left_len - right_len) * 0.35
                + max(0, metrics["homopolymer"] - 4) * 1.5
                + max(0, metrics["hairpin_stem"] - 5) * 1.6
                + (3.0 if metrics["self_dimer"] else 0.0)
            )
            ends_with_gc = int(primer_seq[0] in "GC") + int(primer_seq[-1] in "GC")
            if ends_with_gc == 0:
                score += 0.6

            item = {
                "mutation": f"{reference}{position}{alternate}",
                "f": primer_seq,
                "r": reverse_complement(primer_seq),
                "tm_f": metrics["tm"],
                "tm_r": metrics["tm"],
                "gc_f": metrics["gc"],
                "gc_r": metrics["gc"],
                "length": len(primer_seq),
                "template_length": len(sequence),
                "binding_start": primer_start + 1,
                "binding_end": primer_end,
                "mutation_start": position,
                "mutation_end": position + len(reference) - 1,
                "quality": {
                    "center_offset": round(center_offset, 1),
                    "left_flank": left_len,
                    "right_flank": right_len,
                    "homopolymer": metrics["homopolymer"],
                    "hairpin_stem": metrics["hairpin_stem"],
                    "self_dimer": metrics["self_dimer"],
                    "three_prime_gc": metrics["three_prime_gc"],
                },
                "conditions": recommend_mutagenesis_conditions(metrics["tm"], len(sequence)),
                "context": build_mutagenesis_context(sequence, mutation_start, reference, alternate),
                "wildtype_segment": wildtype_window,
                "rank_score": round(score, 3),
            }

            relaxed_candidates.append(item)
            if (
                35 <= metrics["gc"] <= 70
                and 72 <= metrics["tm"] <= 90
                and metrics["homopolymer"] <= 5
                and metrics["hairpin_stem"] < 8
                and not metrics["self_dimer"]
            ):
                strict_candidates.append(item)

    chosen = strict_candidates or [
        item
        for item in relaxed_candidates
        if 30 <= item["gc_f"] <= 75 and item["tm_f"] >= 68 and item["quality"]["hairpin_stem"] < 9
    ]
    used_relaxed = not bool(strict_candidates)
    chosen.sort(key=lambda item: (item["rank_score"], abs(item["length"] - 31), item["mutation_start"]))

    deduped: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for item in chosen:
        key = (item["f"], item["r"])
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        item.pop("rank_score", None)
        deduped.append(item)
        if len(deduped) >= 5:
            break
    return deduped, used_relaxed
def design_cloning_primers(sequence: str, forward_tail: str, reverse_tail: str) -> tuple[list[dict[str, Any]], bool]:
    forward_candidates = terminal_primer_candidates(sequence, reverse=False)
    reverse_candidates = terminal_primer_candidates(sequence, reverse=True)
    if not forward_candidates or not reverse_candidates:
        raise ApiError("没有找到可用于克隆扩增的核心引物，请检查插入片段序列。")

    strict_pairs: list[dict[str, Any]] = []
    relaxed_pairs: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    insert_length = len(sequence)

    for forward in forward_candidates:
        for reverse in reverse_candidates:
            forward_primer = f"{forward_tail}{forward['core']}"
            reverse_primer = f"{reverse_tail}{reverse['core']}"
            if (forward_primer, reverse_primer) in seen:
                continue
            seen.add((forward_primer, reverse_primer))

            tm_delta = abs(forward["tm"] - reverse["tm"])
            cross_dimer = has_cross_dimer(forward_primer, reverse_primer, min_match=6)
            score = (
                forward["score"]
                + reverse["score"]
                + tm_delta * 1.4
                + (2.5 if cross_dimer else 0.0)
                + abs(len(forward_primer) - len(reverse_primer)) * 0.12
            )
            binding_start_f, binding_end_f = _to_zbho(
                forward["binding_start"],
                forward["binding_end"],
            )
            binding_start_r, binding_end_r = _to_zbho(
                reverse["binding_start"],
                reverse["binding_end"],
            )
            item = {
                "f": forward_primer,
                "r": reverse_primer,
                "forward_core": forward["core"],
                "reverse_core": reverse["core"],
                "forward_tail": forward_tail,
                "reverse_tail": reverse_tail,
                "tm_f": forward["tm"],
                "tm_r": reverse["tm"],
                "gc_f": forward["gc"],
                "gc_r": reverse["gc"],
                "insert_length": insert_length,
                "full_length_f": len(forward_primer),
                "full_length_r": len(reverse_primer),
                "binding_start_f": binding_start_f,
                "binding_end_f": binding_end_f,
                "binding_start_r": binding_start_r,
                "binding_end_r": binding_end_r,
                "binding_target": "insert",
                "binding_target_length": insert_length,
                "coordinate_system": COORDINATE_SYSTEM,
                "quality": {
                    "tm_delta": round(tm_delta, 1),
                    "cross_dimer": cross_dimer,
                    "forward_hairpin_stem": forward["quality"]["hairpin_stem"],
                    "reverse_hairpin_stem": reverse["quality"]["hairpin_stem"],
                    "forward_self_dimer": forward["quality"]["self_dimer"],
                    "reverse_self_dimer": reverse["quality"]["self_dimer"],
                    "forward_three_prime_gc": forward["quality"]["three_prime_gc"],
                    "reverse_three_prime_gc": reverse["quality"]["three_prime_gc"],
                    # Overlap (tail) Tm: separate from annealing (core) Tm.
                    # For Gibson/In-Fusion, the tail anneals to the vector backbone.
                    "forward_overlap_tm": round(melting_temp(forward_tail), 1) if forward_tail else None,
                    "reverse_overlap_tm": round(melting_temp(reverse_tail), 1) if reverse_tail else None,
                },
                "conditions": {
                    "anneal_c": round(max(55.0, min(forward["tm"], reverse["tm"]) - 3.0), 1),
                    "extension_sec": max(20, min(180, round(insert_length / 30))),
                },
                "rank_score": round(score, 3),
            }
            relaxed_pairs.append(item)
            if (
                forward.get("strict")
                and reverse.get("strict")
                and tm_delta <= 2.5
                and not cross_dimer
                and 58 <= forward["tm"] <= 66
                and 58 <= reverse["tm"] <= 66
            ):
                strict_pairs.append(item)

    chosen = strict_pairs or [item for item in relaxed_pairs if item["quality"]["tm_delta"] <= 4.0] or relaxed_pairs
    used_relaxed = not bool(strict_pairs)
    chosen.sort(key=lambda item: (item["rank_score"], abs(item["full_length_f"] - 40), abs(item["full_length_r"] - 40)))
    for item in chosen:
        item.pop("rank_score", None)
    return chosen[:5], used_relaxed
def normalize_cloning_fragments(payload: dict[str, Any]) -> list[SequenceDocument]:
    """Parse an ordered multi-fragment cloning payload."""
    raw_fragments = payload.get("fragments")
    if not isinstance(raw_fragments, list) or not raw_fragments:
        return []

    documents: list[SequenceDocument] = []
    for index, raw in enumerate(raw_fragments, start=1):
        if isinstance(raw, dict):
            sequence = raw.get("sequence") or raw.get("dna") or ""
            name = str(raw.get("name") or raw.get("label") or f"Fragment {index}").strip()
        else:
            sequence = raw
            name = f"Fragment {index}"
        sequence_text = sanitize_sequence(sequence)
        if not sequence_text:
            raise ApiError(f"第 {index} 个片段没有有效 DNA 序列。")
        document = parse_sequence_document(sequence_text, fallback_name=name or f"Fragment {index}")
        if len(document.sequence) < 30:
            raise ApiError(f"第 {index} 个片段只有 {len(document.sequence)} bp，至少建议提供 30 bp。")
        documents.append(document)

    if len(documents) < 2:
        raise ApiError("多片段 Gibson 至少需要 2 个片段；只有 1 个片段时请使用普通 Gibson 设计。")
    if len(documents) > 8:
        raise ApiError("当前最多同时规划 8 个 Gibson 片段，请拆成多个构建步骤。")
    return documents
def design_multifragment_gibson_primers(
    fragments: list[SequenceDocument],
    left_homology: str,
    right_homology: str,
    overlap_length: int,
) -> tuple[list[dict[str, Any]], bool]:
    """Design one complete primer set for each ordered Gibson fragment."""
    forward_tails: list[str] = []
    reverse_tail_sources: list[str] = []
    for index, fragment in enumerate(fragments):
        forward_tails.append(
            left_homology[-overlap_length:]
            if index == 0
            else fragments[index - 1].sequence[-overlap_length:]
        )
        reverse_tail_sources.append(
            right_homology[:overlap_length]
            if index == len(fragments) - 1
            else fragments[index + 1].sequence[:overlap_length]
        )

    candidate_sets: list[list[dict[str, Any]]] = []
    used_relaxed = False
    for index, fragment in enumerate(fragments):
        candidates, relaxed = design_cloning_primers(
            fragment.sequence,
            forward_tails[index],
            reverse_complement(reverse_tail_sources[index]),
        )
        if not candidates:
            raise ApiError(f"第 {index + 1} 个片段没有找到可用的 PCR 引物。")
        candidate_sets.append(candidates)
        used_relaxed = used_relaxed or relaxed

    complete_sets: list[dict[str, Any]] = []
    for candidate_index in range(5):
        fragment_primers: list[dict[str, Any]] = []
        for index, fragment in enumerate(fragments):
            candidate = candidate_sets[index][min(candidate_index, len(candidate_sets[index]) - 1)]
            fragment_primers.append({
                **candidate,
                "fragmentIndex": index,
                "fragmentName": fragment.name or f"Fragment {index + 1}",
                "forwardTailSource": forward_tails[index],
                "reverseTailSource": reverse_tail_sources[index],
            })

        first = fragment_primers[0]
        last = fragment_primers[-1]
        tm_deltas = [float(item.get("quality", {}).get("tm_delta") or 0) for item in fragment_primers]
        complete_sets.append({
            "title": f"Multi-fragment Gibson candidate {candidate_index + 1}",
            "summary": f"按 {len(fragments)} 个片段的既定顺序生成完整 PCR 引物集合。",
            "f": first["f"],
            "r": last["r"],
            "forward_core": first.get("forward_core"),
            "reverse_core": last.get("reverse_core"),
            "tm_f": first.get("tm_f"),
            "tm_r": last.get("tm_r"),
            "gc_f": first.get("gc_f"),
            "gc_r": last.get("gc_r"),
            "full_length_f": first.get("full_length_f"),
            "full_length_r": last.get("full_length_r"),
            "insert_length": sum(len(fragment.sequence) for fragment in fragments),
            "fragment_count": len(fragments),
            "fragment_primers": fragment_primers,
            "method": "gibson",
            "assembly_method": "Gibson / Homology · Multi-fragment",
            "quality": {
                "tm_delta": round(max(tm_deltas), 1),
                "cross_dimer": any(bool(item.get("quality", {}).get("cross_dimer")) for item in fragment_primers),
            },
            "conditions": {
                "anneal_c": round(min(float(item.get("conditions", {}).get("anneal_c") or 0) for item in fragment_primers), 1),
                "extension_sec": max(int(item.get("conditions", {}).get("extension_sec") or 0) for item in fragment_primers),
            },
        })
    return complete_sets, used_relaxed
def design_backbone_linearization_primers(
    vector_sequence: str,
    vector_edit: dict[str, Any],
    vector_topology: str = "circular",
) -> dict[str, Any]:
    """Design an inverse-PCR pair that opens a circular backbone at the planned edit."""
    sequence = sanitize_sequence(vector_sequence)
    topology = str(vector_topology or "circular").strip().lower()
    if topology not in {"linear", "circular"}:
        topology = "circular"

    def unavailable(status: str, reason: str) -> dict[str, Any]:
        return {
            "available": False,
            "status": status,
            "method": "inverse_pcr",
            "vectorTopology": topology,
            "reason": reason,
        }

    if not sequence:
        return unavailable("blocked", "缺少载体序列，无法设计 backbone 线性化引物。")
    if not isinstance(vector_edit, dict):
        return unavailable("review", "缺少载体编辑坐标，暂时只能显示 insert 引物。")
    if topology != "circular":
        return unavailable(
            "review",
            "当前载体是线性拓扑；本方案的 inverse-PCR backbone 线性化只对环状载体开放。",
        )

    mode = str(vector_edit.get("mode") or "").strip().lower()
    try:
        start = int(vector_edit.get("start", -1))
        end = start if mode == "insert" else int(vector_edit.get("end", -1))
    except (TypeError, ValueError):
        return unavailable("blocked", "载体编辑坐标无效，无法设计 backbone 线性化引物。")

    if mode not in {"insert", "replace"} or start < 0 or end < start or end > len(sequence):
        return unavailable("blocked", "载体编辑坐标超出当前载体序列范围。")
    expected = sanitize_sequence(vector_edit.get("expectedSequence") or "")
    if mode == "replace" and expected and sequence[start:end] != expected:
        return unavailable("blocked", "当前载体序列与规划时的待替换区域不一致，请重新读取载体。")

    removed_length = end - start
    backbone_template = sequence[end:] + sequence[:start]
    if len(backbone_template) < 60:
        return unavailable("blocked", "删除待插入区域后 backbone 太短，无法稳定设计 inverse-PCR 引物。")

    primer_sets, used_relaxed = design_cloning_primers(backbone_template, "", "")
    if not primer_sets:
        return unavailable("blocked", "没有找到满足条件的 backbone 线性化引物。")

    def map_template_range(offset: int, length: int) -> dict[str, Any]:
        origin = end % len(sequence)
        raw_start = origin + offset
        raw_end = raw_start + length
        return {
            "start": raw_start % len(sequence),
            "end": raw_end % len(sequence),
            "length": length,
            "wrapsOrigin": raw_end > len(sequence),
            "coordinateSystem": COORDINATE_SYSTEM,
        }

    def normalize_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
        forward_core = sanitize_sequence(candidate.get("forward_core") or candidate.get("f") or "")
        reverse_core = sanitize_sequence(candidate.get("reverse_core") or candidate.get("r") or "")
        forward_binding = map_template_range(0, len(forward_core))
        reverse_binding = map_template_range(
            len(backbone_template) - len(reverse_core),
            len(reverse_core),
        )
        return {
            "forwardPrimer": sanitize_sequence(candidate.get("f") or ""),
            "reversePrimer": sanitize_sequence(candidate.get("r") or ""),
            "forwardCore": forward_core,
            "reverseCore": reverse_core,
            "forwardBinding": forward_binding,
            "reverseBinding": reverse_binding,
            "tmForward": candidate.get("tm_f"),
            "tmReverse": candidate.get("tm_r"),
            "gcForward": candidate.get("gc_f"),
            "gcReverse": candidate.get("gc_r"),
            "quality": candidate.get("quality") or {},
            "conditions": candidate.get("conditions") or {},
        }

    primary = normalize_candidate(primer_sets[0])
    candidates = [normalize_candidate(item) for item in primer_sets]
    return {
        "available": True,
        "status": "review" if used_relaxed else "passed",
        "method": "inverse_pcr",
        "vectorTopology": topology,
        "vectorLength": len(sequence),
        "editMode": mode,
        "editStart": start,
        "editEnd": end,
        "removedLength": removed_length,
        "ampliconLength": len(backbone_template),
        "ampliconDigest": f"sha256:{hashlib.sha256(backbone_template.encode('ascii')).hexdigest()[:16]}",
        "forwardPrimer": primary["forwardPrimer"],
        "reversePrimer": primary["reversePrimer"],
        "forwardCore": primary["forwardCore"],
        "reverseCore": primary["reverseCore"],
        "forwardBinding": primary["forwardBinding"],
        "reverseBinding": primary["reverseBinding"],
        "tmForward": primary["tmForward"],
        "tmReverse": primary["tmReverse"],
        "gcForward": primary["gcForward"],
        "gcReverse": primary["gcReverse"],
        "quality": primary["quality"],
        "conditions": primary["conditions"],
        "candidates": candidates,
        "instructions": [
            "用这对引物对环状载体做 inverse PCR，产物为去除选区后的线性 backbone。",
            "将 backbone PCR 产物与 insert PCR 产物按上方 junction 组装；当前载体不会自动被修改。",
        ],
    }
def attach_backbone_linearization_review(
    payload: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any] | None:
    """Attach deterministic backbone primer data when a full vector edit is known."""
    vector_sequence = sanitize_sequence(payload.get("vectorSequence") or "")
    vector_edit = payload.get("vectorEdit")
    vector_topology = str(payload.get("vectorTopology") or "circular").strip().lower()
    if not vector_sequence or not isinstance(vector_edit, dict) or vector_topology != "circular":
        return None
    linearization = design_backbone_linearization_primers(
        vector_sequence,
        vector_edit,
        vector_topology,
    )
    result["backbone_linearization"] = linearization
    return linearization
def normalize_multifragment_type_iis_overhangs(
    payload: dict[str, Any],
    fragment_count: int,
    expected_length: int,
) -> list[str]:
    """Normalize [vector-left, internal..., vector-right] Golden Gate overhangs."""
    if fragment_count < 2:
        raise ApiError("多片段 Golden Gate 至少需要 2 个片段。")

    def parse_list(value: Any, label: str) -> list[str]:
        if not isinstance(value, list):
            return []
        parsed: list[str] = []
        for index, item in enumerate(value, start=1):
            parsed.append(parse_type_iis_overhang(item, expected_length, f"{label} {index}"))
        return parsed

    full = parse_list(payload.get("overhangs"), "overhang")
    internal = parse_list(
        payload.get("fragmentOverhangs") or payload.get("junctionOverhangs"),
        "片段间 overhang",
    )
    left_raw = payload.get("leftOverhang") or ""
    right_raw = payload.get("rightOverhang") or ""

    if full:
        if len(full) == fragment_count + 1:
            if left_raw and parse_type_iis_overhang(left_raw, expected_length, "前向 overhang") != full[0]:
                raise ApiError("overhangs 的第一个值与 leftOverhang 不一致。")
            if right_raw and parse_type_iis_overhang(right_raw, expected_length, "反向 overhang") != full[-1]:
                raise ApiError("overhangs 的最后一个值与 rightOverhang 不一致。")
            return full
        if len(full) != fragment_count - 1:
            raise ApiError(
                f"多片段 Golden Gate 的 overhangs 需要 {fragment_count + 1} 个边界值，"
                f"或只提供 {fragment_count - 1} 个内部 overhang。"
            )
        if internal and internal != full:
            raise ApiError("overhangs 与 fragmentOverhangs 的内部列表不一致。")
        internal = full

    if len(internal) != fragment_count - 1:
        raise ApiError(
            f"多片段 Golden Gate 还需要提供 {fragment_count - 1} 个 fragmentOverhangs，"
            "它们分别对应相邻片段之间的连接。系统不会自动猜测这些序列。"
        )

    left = parse_type_iis_overhang(left_raw, expected_length, "前向 overhang")
    right = parse_type_iis_overhang(right_raw, expected_length, "反向 overhang")
    return [left, *internal, right]
def design_multifragment_golden_gate_primers(
    fragments: list[SequenceDocument],
    overhangs: list[str],
    enzyme: dict[str, Any],
    clamp_length: int,
) -> tuple[list[dict[str, Any]], bool]:
    """Design Type IIS primer pairs for each ordered fragment."""
    candidate_sets: list[list[dict[str, Any]]] = []
    used_relaxed = False
    spacer_length = max(0, int(enzyme.get("primer_spacer_length") or 0))
    for index, fragment in enumerate(fragments):
        forward_tail, _ = build_type_iis_tail(enzyme, overhangs[index], clamp_length, reverse=False)
        reverse_tail, _ = build_type_iis_tail(enzyme, overhangs[index + 1], clamp_length, reverse=True)
        candidates, relaxed = design_cloning_primers(fragment.sequence, forward_tail, reverse_tail)
        if not candidates:
            raise ApiError(f"第 {index + 1} 个片段没有找到可用的 Golden Gate PCR 引物。")
        candidate_sets.append(candidates)
        used_relaxed = used_relaxed or relaxed

    complete_sets: list[dict[str, Any]] = []
    for candidate_index in range(5):
        fragment_primers: list[dict[str, Any]] = []
        for index, fragment in enumerate(fragments):
            candidate = candidate_sets[index][min(candidate_index, len(candidate_sets[index]) - 1)]
            fragment_primers.append({
                **candidate,
                "fragmentIndex": index,
                "fragmentName": fragment.name or f"Fragment {index + 1}",
                "forwardOverhang": overhangs[index],
                "reverseOverhang": overhangs[index + 1],
                "forwardTailSource": overhangs[index],
                "reverseTailSource": overhangs[index + 1],
            })

        first = fragment_primers[0]
        last = fragment_primers[-1]
        tm_deltas = [float(item.get("quality", {}).get("tm_delta") or 0) for item in fragment_primers]
        complete_sets.append({
            "title": f"Multi-fragment Golden Gate candidate {candidate_index + 1}",
            "summary": f"按 {len(fragments)} 个片段的既定顺序生成 Type IIS 引物集合。",
            "f": first["f"],
            "r": last["r"],
            "forward_core": first.get("forward_core"),
            "reverse_core": last.get("reverse_core"),
            "tm_f": first.get("tm_f"),
            "tm_r": last.get("tm_r"),
            "gc_f": first.get("gc_f"),
            "gc_r": last.get("gc_r"),
            "full_length_f": first.get("full_length_f"),
            "full_length_r": last.get("full_length_r"),
            "insert_length": sum(len(fragment.sequence) for fragment in fragments),
            "fragment_count": len(fragments),
            "fragment_primers": fragment_primers,
            "overhangs": overhangs,
            "fragment_overhangs": overhangs[1:-1],
            "method": "golden_gate",
            "assembly_method": "Golden Gate / Type IIS · Multi-fragment",
            "type_iis_enzyme": enzyme["name"],
            "type_iis_site": enzyme["site"],
            "type_iis_spacer_length": spacer_length,
            "type_iis_overhang_length": len(overhangs[0]),
            "clamp_length": clamp_length,
            "quality": {
                "tm_delta": round(max(tm_deltas), 1),
                "cross_dimer": any(bool(item.get("quality", {}).get("cross_dimer")) for item in fragment_primers),
            },
            "conditions": {
                "anneal_c": round(min(float(item.get("conditions", {}).get("anneal_c") or 0) for item in fragment_primers), 1),
                "extension_sec": max(int(item.get("conditions", {}).get("extension_sec") or 0) for item in fragment_primers),
            },
        })
    return complete_sets, used_relaxed
def build_multifragment_golden_gate_analysis(
    fragments: list[SequenceDocument],
    vector_document: SequenceDocument | None,
    enzyme: dict[str, Any],
) -> dict[str, Any]:
    fragment_scans = []
    for fragment in fragments:
        scan = scan_restriction_enzyme_on_sequence(fragment.sequence, enzyme, topology="linear")
        fragment_scans.append({
            "name": fragment.name or "Fragment",
            "length": len(fragment.sequence),
            "hitCount": scan["hit_count"],
            "hits": scan["hits"],
        })
    vector_scan = None
    if vector_document:
        scan = scan_restriction_enzyme_on_sequence(
            vector_document.sequence,
            enzyme,
            topology=vector_document.topology,
        )
        vector_scan = {
            "name": vector_document.name,
            "length": len(vector_document.sequence),
            "hitCount": scan["hit_count"],
            "cuts": scan["cuts"],
            "hits": scan["hits"],
            "fragmentLengths": scan["fragment_lengths"],
            "topology": vector_document.topology,
        }
    return {
        "enzyme": {
            "name": enzyme["name"],
            "site": enzyme["site"],
            "cutIndex": int(enzyme["cut_index"]),
        },
        "fragments": fragment_scans,
        "vector": vector_scan,
    }
def build_multifragment_golden_gate_review(
    payload: dict[str, Any],
    fragments: list[SequenceDocument],
    result: dict[str, Any],
    overhangs: list[str],
    analysis: dict[str, Any],
    vector_document: SequenceDocument | None = None,
) -> dict[str, Any]:
    checks: list[dict[str, str]] = []

    def add_check(key: str, label: str, status: str, detail: str) -> None:
        checks.append({"key": key, "label": label, "status": status, "detail": detail})

    add_check(
        "fragment_count",
        "片段顺序",
        "passed",
        f"已按用户提供的顺序规划 {len(fragments)} 个片段，总长度 {sum(len(item.sequence) for item in fragments)} bp。",
    )
    add_check(
        "overhang_count",
        "overhang 数量",
        "passed" if len(overhangs) == len(fragments) + 1 else "blocked",
        f"已提供 {len(overhangs)} 个边界 overhang，覆盖载体两端和 {len(fragments) - 1} 个内部 junction。",
    )

    canonical_overhangs = [min(item, reverse_complement(item)) for item in overhangs]
    duplicate_overhangs = len(set(canonical_overhangs)) != len(canonical_overhangs)
    add_check(
        "overhang_directionality",
        "overhang 方向性",
        "review" if duplicate_overhangs else "passed",
        "存在重复或反向互补 overhang，可能降低方向性。" if duplicate_overhangs else "所有边界 overhang 在当前列表中保持方向性区分。",
    )

    fragment_conflicts = [
        item for item in analysis.get("fragments") or []
        if isinstance(item, dict) and int(item.get("hitCount") or 0) > 0
    ]
    add_check(
        "type_iis_internal_sites",
        "片段内部 Type IIS 位点",
        "blocked" if fragment_conflicts else "passed",
        (
            "；".join(f"{item.get('name')} 含 {item.get('hitCount')} 个内部位点" for item in fragment_conflicts)
            if fragment_conflicts
            else f"所有 {len(fragments)} 个片段均未检测到 {analysis['enzyme']['name']} 识别位点。"
        ),
    )

    strict_construct = build_strict_type_iis_construct(
        vector_document,
        fragments,
        resolve_type_iis_enzyme(str(analysis.get("enzyme", {}).get("name") or "BsaI")),
        [overhangs[0], overhangs[-1]],
    )
    add_check(
        "exact_construct",
        "精确 Type IIS 构建体",
        "passed" if strict_construct["available"] else "review",
        strict_construct["reason"] if strict_construct["available"] else f"仍是片段规划预览：{strict_construct['reason']}",
    )

    vector_analysis = analysis.get("vector") if isinstance(analysis.get("vector"), dict) else None
    vector_hits = int(vector_analysis.get("hitCount") or 0) if vector_analysis else 0
    if vector_analysis is None:
        vector_status = "review"
        vector_detail = "未提供 backbone 序列，暂时无法确认 Type IIS 位点和 dropout 边界。"
    elif vector_hits == 2:
        vector_status = "passed"
        vector_detail = "载体检测到 2 个 Type IIS 位点；请在 Apply 前确认它们正好包围目标 dropout。"
    else:
        vector_status = "review"
        vector_detail = f"载体检测到 {vector_hits} 个 {analysis['enzyme']['name']} 位点，无法自动确认唯一 dropout。"
    add_check("vector_type_iis_sites", "载体 Type IIS 位点", vector_status, vector_detail)

    primer_architecture: list[dict[str, Any]] = []
    for primer in result.get("fragment_primers") or []:
        index = int(primer.get("fragmentIndex") or 0) + 1
        primer_architecture.extend([
            {
                "name": f"Fragment {index} Forward",
                "tail": sanitize_sequence(primer.get("forward_tail") or ""),
                "core": sanitize_sequence(primer.get("forward_core") or ""),
                "fullSequence": sanitize_sequence(primer.get("f") or ""),
                "tailPurpose": f"左侧 overhang {primer.get('forwardOverhang') or ''}",
            },
            {
                "name": f"Fragment {index} Reverse",
                "tail": sanitize_sequence(primer.get("reverse_tail") or ""),
                "core": sanitize_sequence(primer.get("reverse_core") or ""),
                "fullSequence": sanitize_sequence(primer.get("r") or ""),
                "tailPurpose": f"右侧 overhang {primer.get('reverseOverhang') or ''} 的反向互补",
            },
        ])

    junctions: list[dict[str, str]] = []
    for index, overhang in enumerate(overhangs):
        if index == 0:
            label = "Vector → Fragment 1"
            side = "left"
        elif index == len(overhangs) - 1:
            label = f"Fragment {len(fragments)} → Vector"
            side = "right"
        else:
            label = f"Fragment {index} → Fragment {index + 1}"
            side = f"fragment-{index}-{index + 1}"
        junctions.append({
            "side": side,
            "label": label,
            "overlap": overhang,
            "vectorContext": overhang,
            "insertContext": overhang,
            "assembledPreview": overhang,
        })

    expected_construct: dict[str, Any] = {
        **strict_construct,
        "topology": str((vector_analysis or {}).get("topology") or "circular"),
        "fragmentCount": len(fragments),
        "fragmentLengths": [len(fragment.sequence) for fragment in fragments],
        "insertLength": sum(len(fragment.sequence) for fragment in fragments),
    }
    if vector_analysis:
        expected_construct.update({
            "vectorLength": vector_analysis.get("length"),
            "vectorTypeIisSiteCount": vector_hits,
            "vectorCutPositions": vector_analysis.get("cuts") or [],
            "backboneCandidateLengths": vector_analysis.get("fragmentLengths") or [],
        })

    status = "passed"
    if any(item["status"] == "blocked" for item in checks):
        status = "blocked"
    elif any(item["status"] == "review" for item in checks):
        status = "review"
    return {
        "schemaVersion": 1,
        "method": "golden_gate",
        "status": status,
        "summary": (
            f"已按 {len(fragments)} 个片段和 {analysis['enzyme']['name']} 规划 Golden Gate 组装。"
            if status == "passed"
            else "Golden Gate 多片段方案已生成，但仍有边界或位点需要复核。"
        ),
        "insert": {
            "name": "Multi-fragment insert",
            "length": sum(len(fragment.sequence) for fragment in fragments),
            "fragmentCount": len(fragments),
        },
        "fragments": [
            {"name": fragment.name or f"Fragment {index + 1}", "length": len(fragment.sequence)}
            for index, fragment in enumerate(fragments)
        ],
        "junctions": junctions,
        "primerArchitecture": primer_architecture,
        "expectedConstruct": expected_construct,
        "checks": checks,
    }
def _assess_arm_pair(
    key: str,
    label: str,
    first_arm: str,
    second_arm: str,
    arms_label: str,
    hazard_detail: str,
) -> dict[str, str]:
    """Compare two ends of the same molecule for mutual-annealing hazards.

    Two relationships are hazardous:

    - **Identical arms** (``first == second``): each molecule's two ends expose
      complementary single strands and can anneal directly.
    - **Mutually complementary arms** (``first == reverse_complement(second)``):
      the reaction degenerates to two shared sequences, so ends anneal
      promiscuously (wrong orientation / chimeric products).
    """
    first = (first_arm or "").upper()
    second = (second_arm or "").upper()
    if not first or not second:
        return {
            "key": key,
            "label": label,
            "status": "review",
            "detail": "缺少可比的同源臂序列，无法评估自连接风险。",
        }
    identical = first == second
    complementary = first == reverse_complement_iupac(second)
    if not (identical or complementary):
        return {
            "key": key,
            "label": label,
            "status": "passed",
            "detail": f"{arms_label}互不相同且不互补，无自连接风险。",
        }
    if identical and complementary:
        relationship = "完全相同且自互补"
    elif identical:
        relationship = "完全相同"
    else:
        relationship = "互为反向互补"
    return {
        "key": key,
        "label": label,
        "status": "review",
        "detail": f"{arms_label}{relationship}，{hazard_detail}",
    }
def assess_self_ligation_risk(
    left_arm: str,
    right_arm: str,
    insert_left_arm: str | None = None,
    insert_right_arm: str | None = None,
) -> list[dict[str, str]]:
    """Assess Gibson self-ligation hazards for the backbone and the insert.

    The two checks are computed from independent inputs where available:

    - ``vector_self_ligation`` compares the linearized backbone's left/right
      junction arms (``left_arm``/``right_arm``).
    - ``insert_self_annealing`` compares the insert's actual physical ends
      (``insert_left_arm``/``insert_right_arm`` — e.g. the forward primer tail
      and the reverse primer tail source); when they are not provided it falls
      back to the backbone arms, which describe the same ends in a well-formed
      design.

    Returns check dicts (``passed`` / ``review``) shaped like the rest of a
    construct review's ``checks`` list.
    """
    vector_check = _assess_arm_pair(
        "vector_self_ligation",
        "载体自连接风险",
        left_arm,
        right_arm,
        "载体左右 junction 同源臂",
        "线性化载体两端可退火自环，insert 可能无法插入。建议重新设计至少一侧同源臂。",
    )
    insert_check = _assess_arm_pair(
        "insert_self_annealing",
        "Insert 自环风险",
        insert_left_arm if insert_left_arm else left_arm,
        insert_right_arm if insert_right_arm else right_arm,
        "insert 两端同源臂",
        "insert 可自环或形成串联体/反向组装。建议使两端同源臂互不相同且不互补。",
    )
    return [vector_check, insert_check]
def assess_fragment_overlap_uniqueness(overlaps: list[str]) -> dict[str, str]:
    """Flag duplicate or mutually complementary junction overlaps in multi-fragment Gibson.

    ``overlaps`` lists, in assembly order: the vector left arm, every internal
    junction overlap, and the vector right arm. If any two entries are identical
    or reverse complements of each other, fragments can assemble out of order, in
    the wrong orientation, or through chimeric ends.
    """
    usable = [overlap.upper() for overlap in overlaps if overlap]
    if not usable:
        return {
            "key": "fragment_overlap_uniqueness",
            "label": "片段衔接唯一性",
            "status": "review",
            "detail": "缺少可比的 junction 序列，无法评估片段衔接唯一性。",
        }
    conflicts: list[str] = []
    for index in range(len(usable)):
        for other in range(index + 1, len(usable)):
            if usable[index] == usable[other]:
                conflicts.append(f"junction「{usable[index]}」重复出现")
            elif usable[index] == reverse_complement_iupac(usable[other]):
                conflicts.append(
                    f"junction「{usable[index]}」与「{usable[other]}」互为反向互补"
                )
    if conflicts:
        detail = "；".join(conflicts[:3])
        if len(conflicts) > 3:
            detail += "；等"
        detail += "。片段可能错序或产生嵌合末端，请为每个 junction 设计唯一同源臂。"
        return {
            "key": "fragment_overlap_uniqueness",
            "label": "片段衔接唯一性",
            "status": "review",
            "detail": detail,
        }
    return {
        "key": "fragment_overlap_uniqueness",
        "label": "片段衔接唯一性",
        "status": "passed",
        "detail": "各内部 junction 与载体两端同源臂互不相同且不互补，片段顺序唯一。",
    }
def build_multifragment_construct_review(
    payload: dict[str, Any],
    fragments: list[SequenceDocument],
    result: dict[str, Any],
) -> dict[str, Any]:
    """Review the exact order, junctions, and expected product of a multi-fragment assembly."""
    overlap_length = parse_cloning_homology_length(payload.get("homologyLength"))
    left_homology = sanitize_sequence(payload.get("leftHomology") or "")[-overlap_length:]
    right_homology = sanitize_sequence(payload.get("rightHomology") or "")[:overlap_length]
    vector_sequence = sanitize_sequence(payload.get("vectorSequence") or "")
    vector_topology = str(payload.get("vectorTopology") or "circular").strip().lower()
    if vector_topology not in {"linear", "circular"}:
        vector_topology = "circular"
    combined_insert = "".join(fragment.sequence for fragment in fragments)
    checks: list[dict[str, str]] = []

    def add_check(key: str, label: str, status: str, detail: str) -> None:
        checks.append({"key": key, "label": label, "status": status, "detail": detail})

    add_check(
        "fragment_count",
        "片段顺序",
        "passed",
        f"已按用户提供的顺序规划 {len(fragments)} 个片段，总长度 {len(combined_insert)} bp。",
    )
    add_check(
        "overlap_length",
        "片段衔接",
        "passed" if overlap_length >= 15 else "review",
        f"内部 junction 按相邻片段边界各取 {overlap_length} bp；首尾 junction 使用载体两侧同源臂。",
    )

    fragment_primers = result.get("fragment_primers") if isinstance(result.get("fragment_primers"), list) else []
    insert_left_arm = ""
    insert_right_arm = ""
    if fragment_primers and isinstance(fragment_primers[0], dict):
        insert_left_arm = sanitize_sequence(fragment_primers[0].get("forward_tail") or "")
    if fragment_primers and isinstance(fragment_primers[-1], dict):
        last_primer = fragment_primers[-1]
        insert_right_arm = sanitize_sequence(
            last_primer.get("reverseTailSource") or last_primer.get("reverse_tail_source") or ""
        )
    checks.extend(assess_self_ligation_risk(left_homology, right_homology, insert_left_arm, insert_right_arm))
    checks.append(
        assess_fragment_overlap_uniqueness(
            [left_homology]
            + [fragments[index + 1].sequence[:overlap_length] for index in range(len(fragments) - 1)]
            + [right_homology]
        )
    )

    vector_edit = payload.get("vectorEdit")
    expected_construct: dict[str, Any] = {
        "available": False,
        "topology": vector_topology,
        "fragmentCount": len(fragments),
        "fragmentLengths": [len(fragment.sequence) for fragment in fragments],
    }
    if vector_sequence and isinstance(vector_edit, dict):
        mode = str(vector_edit.get("mode") or "")
        start = int(vector_edit.get("start", -1))
        end = start if mode == "insert" else int(vector_edit.get("end", -1))
        expected = sanitize_sequence(vector_edit.get("expectedSequence") or "")
        valid = mode in {"insert", "replace"} and 0 <= start <= end <= len(vector_sequence)
        valid = valid and (mode != "replace" or vector_sequence[start:end] == expected)
        if valid:
            assembled = vector_sequence[:start] + combined_insert + vector_sequence[end:]
            expected_construct.update({
                "available": True,
                "vectorLength": len(vector_sequence),
                "replacedLength": end - start,
                "length": len(assembled),
                "editMode": mode,
                "editStart": start,
                "editEnd": end,
                "sequenceDigest": f"sha256:{hashlib.sha256(assembled.encode('ascii')).hexdigest()[:16]}",
            })
            add_check(
                "construct_length",
                "预期构建体",
                "passed",
                f"预计构建体长度为 {len(assembled)} bp，载体编辑坐标为 [{start}, {end})。",
            )
        else:
            add_check("vector_edit", "载体编辑坐标", "blocked", "载体坐标或待替换序列已变化，请重新规划。")
    else:
        add_check("construct_context", "载体上下文", "review", "缺少完整载体编辑坐标，只能先复核片段顺序与 junction。")

    context_length = overlap_length
    junctions: list[dict[str, str]] = []
    left_context = left_homology
    right_context = right_homology
    if vector_sequence and isinstance(vector_edit, dict) and expected_construct.get("available"):
        start = int(expected_construct["editStart"])
        end = int(expected_construct["editEnd"])
        left_context = _cloning_context_before(vector_sequence, start, context_length, vector_topology)
        right_context = _cloning_context_after(vector_sequence, end, context_length, vector_topology)
    junctions.append({
        "side": "left",
        "label": "Vector → Fragment 1",
        "overlap": left_homology,
        "vectorContext": left_context,
        "insertContext": fragments[0].sequence[:context_length],
        "assembledPreview": left_context + fragments[0].sequence[:context_length],
    })
    for index in range(len(fragments) - 1):
        upstream = fragments[index].sequence[-context_length:]
        downstream = fragments[index + 1].sequence[:context_length]
        junctions.append({
            "side": f"fragment-{index + 1}-{index + 2}",
            "label": f"Fragment {index + 1} → Fragment {index + 2}",
            "overlap": downstream,
            "vectorContext": upstream,
            "insertContext": downstream,
            "assembledPreview": upstream + downstream,
        })
    junctions.append({
        "side": "right",
        "label": f"Fragment {len(fragments)} → Vector",
        "overlap": right_homology,
        "vectorContext": right_context,
        "insertContext": fragments[-1].sequence[-context_length:],
        "assembledPreview": fragments[-1].sequence[-context_length:] + right_context,
    })

    primer_architecture: list[dict[str, Any]] = []
    for primer in result.get("fragment_primers") or []:
        index = int(primer.get("fragmentIndex") or 0) + 1
        primer_architecture.extend([
            {
                "name": f"Fragment {index} Forward",
                "tail": sanitize_sequence(primer.get("forward_tail") or ""),
                "core": sanitize_sequence(primer.get("forward_core") or ""),
                "fullSequence": sanitize_sequence(primer.get("f") or ""),
                "tailPurpose": str(primer.get("forwardTailSource") or "upstream junction"),
            },
            {
                "name": f"Fragment {index} Reverse",
                "tail": sanitize_sequence(primer.get("reverse_tail") or ""),
                "core": sanitize_sequence(primer.get("reverse_core") or ""),
                "fullSequence": sanitize_sequence(primer.get("r") or ""),
                "tailPurpose": f"{primer.get('reverseTailSource') or 'downstream junction'} 的反向互补",
            },
        ])

    backbone_linearization = result.get("backbone_linearization")
    if isinstance(backbone_linearization, dict):
        backbone_status = str(backbone_linearization.get("status") or ("passed" if backbone_linearization.get("available") else "review"))
        if backbone_status not in {"passed", "review", "blocked"}:
            backbone_status = "review"
        add_check(
            "backbone_linearization",
            "载体线性化引物",
            backbone_status,
            (
                f"已生成 inverse-PCR backbone 引物，预计得到 {backbone_linearization.get('ampliconLength')} bp 线性载体。"
                if backbone_linearization.get("available")
                else str(backbone_linearization.get("reason") or "载体线性化引物仍需人工规划。")
            ),
        )

    status = "passed"
    if any(item["status"] == "blocked" for item in checks):
        status = "blocked"
    elif any(item["status"] == "review" for item in checks):
        status = "review"
    return {
        "schemaVersion": 1,
        "method": "gibson",
        "status": status,
        "summary": (
            f"已按 {len(fragments)} 个片段的顺序生成内部 junction，并完成预期构建体审查。"
            if status == "passed"
            else "多片段方案已生成，但仍有项目需要在订购或 Apply 前复核。"
        ),
        "insert": {
            "name": "Multi-fragment insert",
            "length": len(combined_insert),
            "fragmentCount": len(fragments),
        },
        "fragments": [
            {"name": fragment.name or f"Fragment {index + 1}", "length": len(fragment.sequence)}
            for index, fragment in enumerate(fragments)
        ],
        "junctions": junctions,
        "primerArchitecture": primer_architecture,
        "backboneLinearization": backbone_linearization,
        "expectedConstruct": expected_construct,
        "checks": checks,
    }
def _cloning_context_before(sequence: str, position: int, length: int, topology: str) -> str:
    if not sequence or length <= 0:
        return ""
    if topology == "circular":
        return circular_sequence_window(sequence, position - length, length)
    return sequence[max(0, position - length):position]
def _cloning_context_after(sequence: str, position: int, length: int, topology: str) -> str:
    if not sequence or length <= 0:
        return ""
    if topology == "circular":
        return circular_sequence_window(sequence, position, length)
    return sequence[position:position + length]
def build_gibson_construct_review(
    payload: dict[str, Any],
    insert_document: SequenceDocument,
    result: dict[str, Any],
) -> dict[str, Any]:
    """Build a deterministic review of the proposed Gibson construct."""
    insert_sequence = insert_document.sequence
    left_homology = sanitize_sequence(payload.get("leftHomology") or payload.get("forwardHomology") or "")
    right_homology = sanitize_sequence(payload.get("rightHomology") or payload.get("reverseHomology") or "")
    overlap_length = parse_cloning_homology_length(payload.get("homologyLength"))
    left_overlap = left_homology[-overlap_length:]
    right_overlap = right_homology[:overlap_length]
    checks: list[dict[str, str]] = []

    def add_check(key: str, label: str, status: str, detail: str) -> None:
        checks.append({"key": key, "label": label, "status": status, "detail": detail})

    overlap_status = "passed" if overlap_length >= 15 else "review"
    add_check(
        "overlap_length",
        "同源臂长度",
        overlap_status,
        f"左右同源臂均按 {overlap_length} bp 设计。"
        + ("适合常规 Gibson / 同源重组。" if overlap_status == "passed" else "长度偏短，建议结合试剂体系复核。"),
    )

    forward_tail = sanitize_sequence(result.get("forward_tail") or "")
    reverse_tail_source = sanitize_sequence(result.get("reverse_tail_source") or "")
    tail_direction_ok = forward_tail == left_overlap and reverse_tail_source == right_overlap
    add_check(
        "tail_direction",
        "引物尾序列方向",
        "passed" if tail_direction_ok else "blocked",
        (
            "Forward 5′ tail 对应左载体 junction；Reverse 5′ tail 是右载体 junction 的反向互补。"
            if tail_direction_ok
            else "引物尾序列与载体 junction 不一致，不能直接订购。"
        ),
    )

    vector_sequence = sanitize_sequence(payload.get("vectorSequence") or "")
    vector_topology = str(payload.get("vectorTopology") or "circular").strip().lower()
    if vector_topology not in {"linear", "circular"}:
        vector_topology = "circular"
    vector_edit = payload.get("vectorEdit")
    expected_construct: dict[str, Any] = {
        "available": False,
        "topology": vector_topology,
        "insertLength": len(insert_sequence),
    }
    left_vector_context = left_overlap
    right_vector_context = right_overlap
    edit_start: int | None = None
    edit_end: int | None = None

    if vector_sequence and isinstance(vector_edit, dict):
        mode = str(vector_edit.get("mode") or "")
        start = int(vector_edit.get("start", -1))
        end = int(vector_edit.get("end", -1))
        if mode == "insert":
            end = start
        valid_edit = (
            mode in {"insert", "replace"}
            and 0 <= start <= end <= len(vector_sequence)
        )
        expected_replaced = sanitize_sequence(vector_edit.get("expectedSequence") or "")
        actual_replaced = vector_sequence[start:end] if valid_edit else ""
        if valid_edit and (mode != "replace" or actual_replaced == expected_replaced):
            edit_start = start
            edit_end = end
            assembled_sequence = vector_sequence[:start] + insert_sequence + vector_sequence[end:]
            context_length = overlap_length
            left_vector_context = _cloning_context_before(
                vector_sequence,
                start,
                context_length,
                vector_topology,
            )
            right_vector_context = _cloning_context_after(
                vector_sequence,
                end,
                context_length,
                vector_topology,
            )
            expected_construct.update({
                "available": True,
                "vectorLength": len(vector_sequence),
                "replacedLength": end - start,
                "length": len(assembled_sequence),
                "editMode": mode,
                "editStart": start,
                "editEnd": end,
                "sequenceDigest": f"sha256:{hashlib.sha256(assembled_sequence.encode('ascii')).hexdigest()[:16]}",
                "leftBoundaryPreview": left_vector_context + insert_sequence[:context_length],
                "rightBoundaryPreview": insert_sequence[-context_length:] + right_vector_context,
            })
            add_check(
                "construct_length",
                "预期构建体",
                "passed",
                f"{len(vector_sequence)} bp 载体"
                f"{f'替换 {end - start} bp 后' if end > start else '插入后'}"
                f"预计得到 {len(assembled_sequence)} bp 构建体。",
            )
        else:
            add_check(
                "vector_edit",
                "载体编辑坐标",
                "blocked",
                "载体坐标或待替换序列已变化，请重新规划后再执行。",
            )
    else:
        add_check(
            "construct_context",
            "载体上下文",
            "review",
            "当前只有手动提供的 junction；可以生成 PCR 引物，但还不能计算完整构建体长度和精确编辑坐标。",
        )

    left_identity_ok = not vector_sequence or left_vector_context.endswith(left_overlap)
    right_identity_ok = not vector_sequence or right_vector_context.startswith(right_overlap)
    add_check(
        "junction_identity",
        "Junction 一致性",
        "passed" if left_identity_ok and right_identity_ok else "blocked",
        (
            "左右 junction 与载体边界一致。"
            if left_identity_ok and right_identity_ok
            else "至少一侧同源臂与当前载体边界不一致，请重新读取载体后设计。"
        ),
    )

    checks.extend(assess_self_ligation_risk(left_overlap, right_overlap, forward_tail, reverse_tail_source))

    expression_review = payload.get("expressionReview")
    normalized_expression = expression_review if isinstance(expression_review, dict) else None
    if bool(payload.get("preserveReadingFrame")):
        expression_status = str((normalized_expression or {}).get("status") or "needs_review")
        add_check(
            "reading_frame",
            "阅读框与表达边界",
            "passed" if expression_status == "passed" else "review",
            (
                "已通过 CDS 边界、终止密码子和 insert 长度检查。"
                if expression_status == "passed"
                else "已要求保持阅读框，但当前结果仍需人工核对 CDS 边界与连接肽。"
            ),
        )

    backbone_linearization = result.get("backbone_linearization")
    if isinstance(backbone_linearization, dict):
        backbone_status = str(backbone_linearization.get("status") or ("passed" if backbone_linearization.get("available") else "review"))
        if backbone_status not in {"passed", "review", "blocked"}:
            backbone_status = "review"
        add_check(
            "backbone_linearization",
            "载体线性化引物",
            backbone_status,
            (
                f"已生成 inverse-PCR backbone 引物，预计得到 {backbone_linearization.get('ampliconLength')} bp 线性载体。"
                if backbone_linearization.get("available")
                else str(backbone_linearization.get("reason") or "载体线性化引物仍需人工规划。")
            ),
        )

    overall_status = "passed"
    if any(item["status"] == "blocked" for item in checks):
        overall_status = "blocked"
    elif any(item["status"] == "review" for item in checks):
        overall_status = "review"

    context_length = overlap_length
    return {
        "schemaVersion": 1,
        "method": "gibson",
        "status": overall_status,
        "summary": (
            "左右 junction、引物方向和预期载体编辑均已通过自动复核。"
            if overall_status == "passed"
            else "方案已生成，但仍有项目需要在订购或 Apply 前复核。"
        ),
        "insert": {
            "name": str(payload.get("insertName") or insert_document.name or "insert"),
            "length": len(insert_sequence),
            "fivePrimePreview": insert_sequence[:context_length],
            "threePrimePreview": insert_sequence[-context_length:],
        },
        "vectorEdit": {
            "mode": str(vector_edit.get("mode") or "") if isinstance(vector_edit, dict) else "",
            "start": edit_start,
            "end": edit_end,
            "coordinateSystem": COORDINATE_SYSTEM,
        },
        "junctions": [
            {
                "side": "left",
                "label": "Left junction",
                "overlap": left_overlap,
                "vectorContext": left_vector_context,
                "insertContext": insert_sequence[:context_length],
                "assembledPreview": left_vector_context + insert_sequence[:context_length],
            },
            {
                "side": "right",
                "label": "Right junction",
                "overlap": right_overlap,
                "vectorContext": right_vector_context,
                "insertContext": insert_sequence[-context_length:],
                "assembledPreview": insert_sequence[-context_length:] + right_vector_context,
            },
        ],
        "primerArchitecture": [
            {
                "name": "Forward",
                "tail": forward_tail,
                "core": sanitize_sequence(result.get("forward_core") or ""),
                "fullSequence": sanitize_sequence(result.get("f") or ""),
                "tailPurpose": "左载体 junction",
            },
            {
                "name": "Reverse",
                "tail": sanitize_sequence(result.get("reverse_tail") or ""),
                "tailSource": reverse_tail_source,
                "core": sanitize_sequence(result.get("reverse_core") or ""),
                "fullSequence": sanitize_sequence(result.get("r") or ""),
                "tailPurpose": "右载体 junction 的反向互补",
            },
        ],
        "backboneLinearization": backbone_linearization,
        "expectedConstruct": expected_construct,
        "expressionReview": normalized_expression,
        "checks": checks,
    }
def _cloning_review_status(checks: list[dict[str, str]]) -> str:
    if any(item.get("status") == "blocked" for item in checks):
        return "blocked"
    if any(item.get("status") == "review" for item in checks):
        return "review"
    return "passed"
def build_restriction_construct_review(
    payload: dict[str, Any],
    insert_document: SequenceDocument,
    result: dict[str, Any],
    restriction_analysis: dict[str, Any],
) -> dict[str, Any]:
    """Build a deterministic review for a single-insert restriction plan."""
    sequence = insert_document.sequence
    forward_site = sanitize_sequence(result.get("forward_site") or "")
    reverse_site = sanitize_sequence(result.get("reverse_site") or "")
    forward_tail = sanitize_sequence(result.get("forward_tail") or "")
    reverse_tail = sanitize_sequence(result.get("reverse_tail") or "")
    checks: list[dict[str, str]] = []

    def add_check(key: str, label: str, status: str, detail: str) -> None:
        checks.append({"key": key, "label": label, "status": status, "detail": detail})

    architecture_ok = (
        sanitize_sequence(result.get("f") or "")
        == forward_tail + sanitize_sequence(result.get("forward_core") or "")
        and sanitize_sequence(result.get("r") or "")
        == reverse_tail + sanitize_sequence(result.get("reverse_core") or "")
    )
    add_check(
        "primer_architecture",
        "引物结构",
        "passed" if architecture_ok else "blocked",
        "保护碱基、酶切位点和 3′ core 的连接顺序正确。"
        if architecture_ok
        else "至少一条引物的 tail/core 结构不一致，不能直接订购。",
    )
    site_ok = bool(forward_site and reverse_site) and forward_site in forward_tail and reverse_site in reverse_tail
    add_check(
        "restriction_sites",
        "酶切位点",
        "passed" if site_ok else "blocked",
        (
            f"Forward 含 {result.get('forward_site_name')}/{forward_site}；"
            f"Reverse 含 {result.get('reverse_site_name')}/{reverse_site}。"
            if site_ok
            else "引物 tail 与选择的限制酶识别位点不一致。"
        ),
    )

    chosen = restriction_analysis.get("chosenEnzymes") if isinstance(restriction_analysis, dict) else []
    conflicts = [
        item for item in (chosen or [])
        if isinstance(item, dict) and item.get("insert_conflict")
    ]
    add_check(
        "insert_internal_sites",
        "Insert 内部位点",
        "blocked" if conflicts else "passed",
        (
            "、".join(f"{item.get('name')} 命中 {((item.get('insert') or {}).get('hit_count') or 0)} 次" for item in conflicts)
            if conflicts
            else "当前选择的限制酶不会在 insert 内部切开。"
        ),
    )

    vector_document = restriction_analysis.get("vectorLength") if isinstance(restriction_analysis, dict) else None
    vector_issues: list[str] = []
    if vector_document:
        for item in chosen or []:
            if not isinstance(item, dict):
                continue
            vector = item.get("vector") if isinstance(item.get("vector"), dict) else {}
            if not vector.get("is_unique"):
                vector_issues.append(f"{item.get('name')} 在载体命中 {vector.get('hit_count') or 0} 次")
        add_check(
            "vector_unique_sites",
            "载体唯一切位",
            "passed" if not vector_issues else "review",
            "两种酶均在载体中唯一切开。" if not vector_issues else "；".join(vector_issues),
        )
    else:
        add_check(
            "vector_unique_sites",
            "载体唯一切位",
            "review",
            "未提供载体序列，暂时不能确认两个位点是否唯一。",
        )

    assessment = result.get("restriction_pair_assessment")
    if not isinstance(assessment, dict):
        assessment = restriction_analysis.get("chosenPairAssessment") if isinstance(restriction_analysis, dict) else {}
    directional = isinstance(assessment, dict) and assessment.get("directionality") == "Directional"
    add_check(
        "directionality",
        "连接方向性",
        "passed" if directional else "review",
        str((assessment or {}).get("summary") or "当前缺少足够载体上下文，建议人工确认连接方向。"),
    )

    status = _cloning_review_status(checks)
    context_length = min(20, len(sequence))
    return {
        "schemaVersion": 1,
        "method": "restriction",
        "status": status,
        "summary": (
            "酶切位点、insert 内部冲突和连接方向均已通过自动复核。"
            if status == "passed"
            else "酶切克隆引物已生成，但仍有位点或载体上下文需要复核。"
        ),
        "insert": {
            "name": str(payload.get("insertName") or insert_document.name or "insert"),
            "length": len(sequence),
            "fivePrimePreview": sequence[:context_length],
            "threePrimePreview": sequence[-context_length:],
        },
        "junctions": [
            {
                "side": "left",
                "label": f"{result.get('forward_site_name') or 'Forward enzyme'} → Insert",
                "overlap": forward_site,
                "vectorContext": str(result.get("forward_site_name") or ""),
                "insertContext": sequence[:context_length],
                "assembledPreview": forward_site + sequence[:context_length],
            },
            {
                "side": "right",
                "label": f"Insert → {result.get('reverse_site_name') or 'Reverse enzyme'}",
                "overlap": reverse_site,
                "vectorContext": str(result.get("reverse_site_name") or ""),
                "insertContext": sequence[-context_length:],
                "assembledPreview": sequence[-context_length:] + reverse_site,
            },
        ],
        "primerArchitecture": [
            {
                "name": "Forward",
                "tail": forward_tail,
                "core": sanitize_sequence(result.get("forward_core") or ""),
                "fullSequence": sanitize_sequence(result.get("f") or ""),
                "tailPurpose": f"{result.get('forward_site_name') or ''} 保护碱基与识别位点",
            },
            {
                "name": "Reverse",
                "tail": reverse_tail,
                "core": sanitize_sequence(result.get("reverse_core") or ""),
                "fullSequence": sanitize_sequence(result.get("r") or ""),
                "tailPurpose": f"{result.get('reverse_site_name') or ''} 保护碱基与识别位点",
            },
        ],
        "expectedConstruct": {
            "available": False,
            "topology": str(payload.get("vectorTopology") or "circular"),
            "insertLength": len(sequence),
            "reason": "限制酶连接后的精确构建体需要结合切口和 dropout 边界确认。",
        },
        "checks": checks,
    }
def build_single_golden_gate_review(
    payload: dict[str, Any],
    insert_document: SequenceDocument,
    result: dict[str, Any],
    restriction_analysis: dict[str, Any],
    vector_document: SequenceDocument | None = None,
) -> dict[str, Any]:
    """Build a deterministic review for a single-insert Type IIS plan."""
    sequence = insert_document.sequence
    enzyme_name = str(result.get("type_iis_enzyme") or "Type IIS")
    enzyme_site = sanitize_sequence(result.get("type_iis_site") or "")
    left_overhang = sanitize_sequence(result.get("left_overhang") or "")
    right_overhang = sanitize_sequence(result.get("right_overhang") or "")
    forward_tail = sanitize_sequence(result.get("forward_tail") or "")
    reverse_tail = sanitize_sequence(result.get("reverse_tail") or "")
    checks: list[dict[str, str]] = []

    def add_check(key: str, label: str, status: str, detail: str) -> None:
        checks.append({"key": key, "label": label, "status": status, "detail": detail})

    architecture_ok = (
        sanitize_sequence(result.get("f") or "")
        == forward_tail + sanitize_sequence(result.get("forward_core") or "")
        and sanitize_sequence(result.get("r") or "")
        == reverse_tail + sanitize_sequence(result.get("reverse_core") or "")
        and enzyme_site in forward_tail
        and enzyme_site in reverse_tail
    )
    add_check(
        "primer_architecture",
        "Type IIS 引物结构",
        "passed" if architecture_ok else "blocked",
        f"两条引物均包含 {enzyme_name}/{enzyme_site}、spacer、overhang 和 3′ core。"
        if architecture_ok
        else "至少一条引物的 Type IIS tail/core 结构不完整。",
    )

    expected_overhang_length = int(result.get("type_iis_overhang_length") or 4)
    overhang_ok = len(left_overhang) == expected_overhang_length and len(right_overhang) == expected_overhang_length
    directional = overhang_ok and left_overhang != right_overhang
    add_check(
        "overhang_length",
        "Overhang 长度",
        "passed" if overhang_ok else "blocked",
        f"左右 overhang 分别为 {left_overhang} / {right_overhang}，长度要求 {expected_overhang_length} bp。",
    )
    add_check(
        "overhang_directionality",
        "Overhang 方向性",
        "passed" if directional else "review",
        "两端 overhang 不同，可维持方向性。" if directional else "两端 overhang 相同，建议确认是否会产生非定向组装。",
    )

    chosen = restriction_analysis.get("chosenEnzymes") if isinstance(restriction_analysis, dict) else []
    enzyme_analysis = chosen[0] if chosen and isinstance(chosen[0], dict) else {}
    insert_hits = int(((enzyme_analysis.get("insert") or {}).get("hit_count") or 0))
    add_check(
        "type_iis_internal_sites",
        "片段内部 Type IIS 位点",
        "passed" if insert_hits == 0 else "blocked",
        (
            f"Insert 内未检测到 {enzyme_name} 识别位点。"
            if insert_hits == 0
            else f"Insert 内检测到 {insert_hits} 个 {enzyme_name} 位点，需要先 domestication。"
        ),
    )

    vector = enzyme_analysis.get("vector") if isinstance(enzyme_analysis.get("vector"), dict) else None
    if vector is None:
        add_check(
            "vector_type_iis_sites",
            "载体 Type IIS 位点",
            "review",
            "未提供 backbone 序列，暂时无法确认 Type IIS 位点和 dropout 边界。",
        )
    else:
        vector_hits = int(vector.get("hit_count") or 0)
        add_check(
            "vector_type_iis_sites",
            "载体 Type IIS 位点",
            "passed" if vector_hits == 2 else "review",
            f"载体检测到 {vector_hits} 个 {enzyme_name} 位点；常规 dropout backbone 通常应为预期方向的 2 个位点。",
        )

    strict_construct = build_strict_type_iis_construct(
        vector_document,
        [insert_document],
        resolve_type_iis_enzyme(enzyme_name),
        [left_overhang, right_overhang],
    )
    add_check(
        "exact_construct",
        "精确 Type IIS 构建体",
        "passed" if strict_construct["available"] else "review",
        strict_construct["reason"] if strict_construct["available"] else f"仍是片段规划预览：{strict_construct['reason']}",
    )

    status = _cloning_review_status(checks)
    context_length = min(20, len(sequence))
    return {
        "schemaVersion": 1,
        "method": "golden_gate",
        "status": status,
        "summary": (
            "Type IIS 引物结构、overhang 和内部位点均已通过自动复核。"
            if status == "passed"
            else "Golden Gate 引物已生成，但仍有 overhang 或 backbone 位点需要复核。"
        ),
        "insert": {
            "name": str(payload.get("insertName") or insert_document.name or "insert"),
            "length": len(sequence),
            "fivePrimePreview": sequence[:context_length],
            "threePrimePreview": sequence[-context_length:],
        },
        "junctions": [
            {
                "side": "left",
                "label": "Vector → Insert",
                "overlap": left_overhang,
                "vectorContext": left_overhang,
                "insertContext": sequence[:context_length],
                "assembledPreview": left_overhang + sequence[:context_length],
            },
            {
                "side": "right",
                "label": "Insert → Vector",
                "overlap": right_overhang,
                "vectorContext": right_overhang,
                "insertContext": sequence[-context_length:],
                "assembledPreview": sequence[-context_length:] + right_overhang,
            },
        ],
        "primerArchitecture": [
            {
                "name": "Forward",
                "tail": forward_tail,
                "core": sanitize_sequence(result.get("forward_core") or ""),
                "fullSequence": sanitize_sequence(result.get("f") or ""),
                "tailPurpose": f"{enzyme_name} + 左侧 overhang {left_overhang}",
            },
            {
                "name": "Reverse",
                "tail": reverse_tail,
                "core": sanitize_sequence(result.get("reverse_core") or ""),
                "fullSequence": sanitize_sequence(result.get("r") or ""),
                "tailPurpose": f"{enzyme_name} + 右侧 overhang {right_overhang} 的反向互补",
            },
        ],
        "expectedConstruct": {
            **strict_construct,
            "topology": str(payload.get("vectorTopology") or strict_construct.get("topology") or "circular"),
            "insertLength": len(sequence),
        },
        "checks": checks,
    }
def design_cloning_response(payload: dict[str, Any]) -> dict[str, Any]:
    label = (payload.get("label") or "分子克隆").strip() or "分子克隆"
    fragment_documents = normalize_cloning_fragments(payload)
    method = (payload.get("method") or "gibson").strip().lower()
    if fragment_documents:
        if method == "golden_gate":
            try:
                clamp_length = int(str(payload.get("goldenGateClampLength") or payload.get("clampLength") or 4).strip())
            except ValueError as exc:
                raise ApiError("请输入有效的保护碱基长度。") from exc
            clamp_length = max(0, min(clamp_length, 8))
            enzyme = resolve_type_iis_enzyme(str(payload.get("typeIisEnzyme") or payload.get("goldenGateEnzyme") or "BsaI"))
            overhang_length = max(1, int(enzyme.get("assembly_overhang_length") or 4))
            overhangs = normalize_multifragment_type_iis_overhangs(
                payload,
                len(fragment_documents),
                overhang_length,
            )
            vector_raw = payload.get("vectorSequence") or payload.get("goldenGateVectorSequence") or ""
            vector_topology = str(
                payload.get("vectorTopology") or payload.get("goldenGateVectorTopology") or "circular"
            ).strip().lower()
            vector_document = None
            if vector_raw:
                vector_document = parse_sequence_document(vector_raw, fallback_name=f"{label}_vector")
                vector_document.topology = vector_topology if vector_topology in {"linear", "circular"} else (vector_document.topology or "circular")

            results, used_relaxed = design_multifragment_golden_gate_primers(
                fragment_documents,
                overhangs,
                enzyme,
                clamp_length,
            )
            analysis = build_multifragment_golden_gate_analysis(fragment_documents, vector_document, enzyme)
            messages = [
                f"已按 Golden Gate / Type IIS 模式为 {len(fragment_documents)} 个片段生成独立 PCR 引物。",
                f"{enzyme['name']} 的边界 overhang 顺序为：{' → '.join(overhangs)}。",
                f"系统已在识别位点前加入 {clamp_length} bp GC 保护碱基，并保留 {int(enzyme.get('primer_spacer_length') or 0)} bp spacer。",
            ]
            fragment_conflicts = [
                item for item in analysis.get("fragments") or []
                if int(item.get("hitCount") or 0) > 0
            ]
            if fragment_conflicts:
                messages.append(
                    "；".join(
                        f"{item.get('name')} 内部含 {item.get('hitCount')} 个 {enzyme['name']} 位点"
                        for item in fragment_conflicts
                    )
                    + "，正式组装前需要先做 domestication。"
                )
            if vector_document:
                vector_hits = int((analysis.get("vector") or {}).get("hitCount") or 0)
                messages.append(
                    f"当前载体检测到 {vector_hits} 个 {enzyme['name']} 位点；请确认它们正好包围目标 dropout。"
                )
            else:
                messages.append("如果补充 backbone 序列，系统会继续确认 Type IIS 位点和 dropout 边界。")

            for result in results:
                result["method"] = "golden_gate"
                result["assembly_method"] = "Golden Gate / Type IIS · Multi-fragment"
                result["type_iis_enzyme"] = enzyme["name"]
                result["type_iis_site"] = enzyme["site"]
                result["type_iis_cut_index"] = int(enzyme["cut_index"])
                result["type_iis_spacer_length"] = int(enzyme.get("primer_spacer_length") or 0)
                result["type_iis_overhang_length"] = overhang_length
                result["overhangs"] = overhangs
                result["fragment_overhangs"] = overhangs[1:-1]
                result["clamp_length"] = clamp_length
                result["construct_review"] = build_multifragment_golden_gate_review(
                    payload,
                    fragment_documents,
                    result,
                    overhangs,
                    analysis,
                    vector_document,
                )

            strict_expected = ((results[0].get("construct_review") if results else {}) or {}).get("expectedConstruct") or {}
            if strict_expected.get("available"):
                messages.append(
                    f"已由双链切点生成确定性的 in-silico 构建体：{strict_expected.get('length')} bp，"
                    f"sha256={strict_expected.get('sequenceDigest')}；这不是湿实验验证。"
                )
            else:
                messages.append(
                    f"精确构建体仍保持 review-only：{strict_expected.get('reason') or '缺少可验证的 backbone 切点。'}"
                )

            if used_relaxed:
                messages.append("严格阈值下没有找到所有片段的理想核心引物，结果已放宽筛选，实验前建议逐片段复核。")
            total_length = sum(len(fragment.sequence) for fragment in fragment_documents)
            return {
                "meta": {
                    "label": label,
                    "context": f"Cloning · Golden Gate · {len(fragment_documents)} fragments · {total_length} bp insert",
                    "accession": None,
                    "transcriptOptions": None,
                    "cloningMethod": "golden_gate",
                    "fragmentCount": len(fragment_documents),
                    "sequenceDocument": sequence_document_to_dict(fragment_documents[0]),
                    "vectorSequenceDocument": sequence_document_to_dict(vector_document) if vector_document else None,
                    "restrictionAnalysis": analysis,
                },
                "messages": messages,
                "results": results,
            }
        if method != "gibson":
            raise ApiError("当前多片段规划支持 Gibson / 同源重组和 Golden Gate / Type IIS；其它路线请先拆成单片段步骤。")
        left_flank = sanitize_sequence(payload.get("leftHomology") or payload.get("forwardHomology") or "")
        right_flank = sanitize_sequence(payload.get("rightHomology") or payload.get("reverseHomology") or "")
        overlap_length = parse_cloning_homology_length(payload.get("homologyLength"))
        if len(left_flank) < overlap_length or len(right_flank) < overlap_length:
            raise ApiError(f"多片段 Gibson 下，左右载体衔接序列至少各提供 {overlap_length} bp。")
        results, used_relaxed = design_multifragment_gibson_primers(
            fragment_documents,
            left_flank,
            right_flank,
            overlap_length,
        )
        for result in results:
            attach_backbone_linearization_review(payload, result)
            result["construct_review"] = build_multifragment_construct_review(payload, fragment_documents, result)
        messages = [
            "PCR 退火温度主要参考每条引物 3' 端退火区（core）Tm，而不是带 overlap 的总长度。",
            f"已按 {len(fragment_documents)} 个片段的既定顺序生成完整 Gibson 引物集合。",
            f"片段之间按 {overlap_length} bp 规则规划内部 junction，首尾连接到载体两侧 junction。",
        ]
        backbone = results[0].get("backbone_linearization") if results else None
        if isinstance(backbone, dict) and backbone.get("available"):
            messages.append(
                f"同时生成 backbone inverse-PCR 线性化引物，预计得到 {backbone.get('ampliconLength')} bp 载体 PCR 产物。"
            )
        if used_relaxed:
            messages.append("部分片段在严格阈值下没有理想核心引物，结果已放宽筛选，实验前建议逐片段复核。")
        total_length = sum(len(fragment.sequence) for fragment in fragment_documents)
        return {
            "meta": {
                "label": label,
                "context": f"Cloning · {len(fragment_documents)} fragments · {total_length} bp insert",
                "accession": None,
                "transcriptOptions": None,
                "cloningMethod": "gibson",
                "fragmentCount": len(fragment_documents),
                "sequenceDocument": sequence_document_to_dict(fragment_documents[0]),
                "vectorSequenceDocument": None,
                "restrictionAnalysis": None,
            },
            "messages": messages,
            "results": results,
        }
    document = parse_sequence_document(payload.get("sequence") or "", fallback_name=label)
    sequence = document.sequence
    if len(sequence) < 30:
        raise ApiError("插入片段至少建议提供 30 bp；更短片段通常更适合直接合成或寡核苷酸退火。")
    validate_sequence_length(sequence, "cloning", "Insert 序列")

    messages = [
        "PCR 退火温度主要参考引物 3' 端退火区（core）Tm，而不是整条带尾巴引物的总长度。",
    ]
    context = f"Cloning · {len(sequence)} bp insert"

    vector_raw = payload.get("vectorSequence") or ""
    vector_document = None
    vector_topology = (payload.get("vectorTopology") or "circular").strip().lower()
    if vector_raw:
        vector_document = parse_sequence_document(vector_raw, fallback_name=f"{label}_vector")
        vector_document.topology = vector_topology if vector_topology in {"linear", "circular"} else (vector_document.topology or "circular")

    if method == "gibson":
        left_flank = sanitize_sequence(payload.get("leftHomology") or payload.get("forwardHomology") or "")
        right_flank = sanitize_sequence(payload.get("rightHomology") or payload.get("reverseHomology") or "")
        try:
            overlap_length = int(str(payload.get("homologyLength") or 20).strip())
        except ValueError as exc:
            raise ApiError("请输入有效的同源臂长度。") from exc
        overlap_length = max(12, min(overlap_length, 30))
        if len(left_flank) < overlap_length or len(right_flank) < overlap_length:
            raise ApiError(f"Gibson/同源重组模式下，左右载体衔接序列至少各提供 {overlap_length} bp。")

        forward_tail = left_flank[-overlap_length:]
        reverse_tail_source = right_flank[:overlap_length]
        reverse_tail = reverse_complement(reverse_tail_source)
        results, used_relaxed = design_cloning_primers(sequence, forward_tail, reverse_tail)
        if not results:
            raise ApiError("没有找到满足条件的克隆引物，请尝试延长插入片段或调整同源臂。")

        for result in results:
            result["method"] = "gibson"
            result["assembly_method"] = "Gibson / Homology"
            result["forward_tail_source"] = forward_tail
            result["reverse_tail_source"] = reverse_tail_source
            result["tail_length_f"] = len(forward_tail)
            result["tail_length_r"] = len(reverse_tail)
            attach_backbone_linearization_review(payload, result)
            result["construct_review"] = build_gibson_construct_review(payload, document, result)

        messages.extend(
            [
                f"已按 Gibson/同源重组模式生成引物，左右同源臂长度均为 {overlap_length} bp。",
                "反向引物 5' 端已自动使用右侧载体衔接序列的反向互补，避免尾巴方向加反。",
                "建议线性化载体两端与这里填写的左右衔接序列保持一致。",
            ]
        )
        backbone = results[0].get("backbone_linearization") if results else None
        if isinstance(backbone, dict) and backbone.get("available"):
            messages.append(
                f"已根据当前载体选区生成 backbone inverse-PCR 线性化引物，预计得到 {backbone.get('ampliconLength')} bp 载体 PCR 产物。"
            )
        if used_relaxed:
            messages.append("严格阈值下没有找到理想核心引物，结果已自动放宽筛选，实验前建议人工复核。")
        return {
            "meta": {
                "label": label,
                "context": context,
                "accession": None,
                "transcriptOptions": None,
                "cloningMethod": "gibson",
                "sequenceDocument": sequence_document_to_dict(document),
                "vectorSequenceDocument": sequence_document_to_dict(vector_document),
                "restrictionAnalysis": None,
            },
            "messages": messages,
            "results": results,
        }

    if method not in {"restriction", "golden_gate"}:
        raise ApiError("当前分子克隆页仅支持 Gibson/同源重组、酶切克隆 或 Golden Gate / Type IIS 三种模式。")

    if method == "golden_gate":
        try:
            clamp_length = int(str(payload.get("goldenGateClampLength") or payload.get("clampLength") or 4).strip())
        except ValueError as exc:
            raise ApiError("请输入有效的保护碱基长度。") from exc
        clamp_length = max(0, min(clamp_length, 8))
        enzyme = resolve_type_iis_enzyme(str(payload.get("typeIisEnzyme") or payload.get("goldenGateEnzyme") or "BsaI"))
        overhang_length = max(1, int(enzyme.get("assembly_overhang_length") or 4))
        left_overhang = parse_type_iis_overhang(payload.get("leftOverhang") or "", overhang_length, "前向 overhang")
        right_overhang = parse_type_iis_overhang(payload.get("rightOverhang") or "", overhang_length, "反向 overhang")
        if left_overhang == right_overhang:
            messages.append("前后 overhang 当前完全一致；如果你追求方向性拼接，通常建议两端 overhang 不同。")

        forward_tail, spacer_length = build_type_iis_tail(enzyme, left_overhang, clamp_length, reverse=False)
        reverse_tail, _ = build_type_iis_tail(enzyme, right_overhang, clamp_length, reverse=True)
        results, used_relaxed = design_cloning_primers(sequence, forward_tail, reverse_tail)
        if not results:
            raise ApiError("没有找到满足条件的 Golden Gate 引物，请尝试调整 insert 边界或 overhang 设计。")

        restriction_analysis = summarize_restriction_scan(
            document,
            vector_document,
            chosen_tokens=[enzyme["name"]],
            vector_topology=vector_document.topology if vector_document else "circular",
        )
        chosen_analysis = restriction_analysis["chosenEnzymes"]
        insert_warnings: list[str] = []
        enzyme_analysis = chosen_analysis[0] if chosen_analysis else None
        if enzyme_analysis and enzyme_analysis["insert_conflict"]:
            hit_count = enzyme_analysis["insert"]["hit_count"]
            messages.append(f"{enzyme['name']} 识别位点在 insert 内命中 {hit_count} 次，Golden Gate 前建议先做 domestication。")
            insert_warnings.append(f"插入片段内部已含 {enzyme['name']}/{enzyme['site']} 识别位点，消化后可能把 insert 切碎。")
        if vector_document:
            vector_hits = enzyme_analysis["vector"]["hit_count"] if enzyme_analysis and enzyme_analysis["vector"] else 0
            if vector_hits < 2:
                messages.append(f"{enzyme['name']} 在载体里只命中 {vector_hits} 次；常见 Golden Gate backbone 通常需要 2 个定向位点。")
            else:
                messages.append(f"{enzyme['name']} 在载体里命中 {vector_hits} 次；请确认这就是你预期替换 dropout 的那一对位点。")
        else:
            messages.append("如果再补载体序列，系统会一起检查 Type IIS 识别位点是否只落在你预期的 backbone 上。")

        for result in results:
            result["method"] = "golden_gate"
            result["assembly_method"] = "Golden Gate / Type IIS"
            result["type_iis_enzyme"] = enzyme["name"]
            result["type_iis_site"] = enzyme["site"]
            result["type_iis_cut_index"] = int(enzyme["cut_index"])
            result["type_iis_spacer_length"] = spacer_length
            result["type_iis_overhang_length"] = overhang_length
            result["left_overhang"] = left_overhang
            result["right_overhang"] = right_overhang
            result["forward_tail_source"] = left_overhang
            result["reverse_tail_source"] = right_overhang
            result["clamp_length"] = clamp_length
            result["tail_length_f"] = len(forward_tail)
            result["tail_length_r"] = len(reverse_tail)
            result["construct_review"] = build_single_golden_gate_review(
                payload,
                document,
                result,
                restriction_analysis,
                vector_document,
            )

        strict_expected = ((results[0].get("construct_review") if results else {}) or {}).get("expectedConstruct") or {}
        if strict_expected.get("available"):
            messages.append(
                f"已由双链切点生成确定性的 in-silico 构建体：{strict_expected.get('length')} bp，"
                f"sha256={strict_expected.get('sequenceDigest')}；这不是湿实验验证。"
            )
        else:
            messages.append(
                f"精确构建体仍保持 review-only：{strict_expected.get('reason') or '缺少可验证的 backbone 切点。'}"
            )

        messages.extend(
            [
                f"已按 Golden Gate / Type IIS 模式生成引物，识别酶为 {enzyme['name']}，两端 overhang 长度为 {overhang_length} bp。",
                f"系统已在识别位点前默认加入 {clamp_length} bp GC 保护碱基，并在位点与 overhang 之间保留 {spacer_length} bp spacer。",
                "Golden Gate 结果会直接保留你填写的组装 overhang；正式下单前请再和 backbone 的 acceptor overhang 做一次人工核对。",
            ]
        )
        if used_relaxed:
            messages.append("严格阈值下没有找到理想核心引物，结果已自动放宽筛选，实验前建议人工复核。")
        messages.extend(insert_warnings)
        return {
            "meta": {
                "label": label,
                "context": context,
                "accession": None,
                "transcriptOptions": None,
                "cloningMethod": "golden_gate",
                "sequenceDocument": sequence_document_to_dict(document),
                "vectorSequenceDocument": sequence_document_to_dict(vector_document),
                "restrictionAnalysis": restriction_analysis,
            },
            "messages": messages,
            "results": results,
        }

    try:
        clamp_length = int(str(payload.get("clampLength") or 4).strip())
    except ValueError as exc:
        raise ApiError("请输入有效的保护碱基长度。") from exc
    clamp_length = max(0, min(clamp_length, 8))
    forward_token = str(payload.get("forwardSite") or payload.get("forwardEnzyme") or "").strip()
    reverse_token = str(payload.get("reverseSite") or payload.get("reverseEnzyme") or "").strip()
    auto_pick_sites = bool(payload.get("autoPickSites"))
    auto_selected_pair = None
    if not forward_token and not reverse_token and auto_pick_sites:
        if not vector_document:
            raise ApiError("自动推荐双酶切位点需要先提供载体序列。")
        preliminary_analysis = summarize_restriction_scan(
            document,
            vector_document,
            chosen_tokens=[],
            vector_topology=vector_document.topology if vector_document else "circular",
        )
        auto_selected_pair = next(
            (item for item in preliminary_analysis.get("recommendedPairs") or [] if item.get("auto_pick_eligible")),
            None,
        )
        if not auto_selected_pair:
            raise ApiError("当前载体 / insert 没有找到足够稳妥的自动双酶切候选；建议手动指定位点，或改走 Gibson / 同源重组。")
        forward_token = auto_selected_pair["forwardName"]
        reverse_token = auto_selected_pair["reverseName"]
        messages.append(
            f"已自动选择推荐双酶切位点：{forward_token} / {reverse_token}。默认按载体序列中的位点顺序，把更靠前的 unique cut 当作左端。"
        )
    elif auto_pick_sites and (not forward_token or not reverse_token):
        raise ApiError("如果要自动推荐双酶切位点，请把前后位点都留空；如果想手动指定，则需要前后位点都填写。")

    forward_enzyme = resolve_restriction_enzyme(forward_token)
    reverse_enzyme = resolve_restriction_enzyme(reverse_token)
    forward_name = forward_enzyme["name"]
    reverse_name = reverse_enzyme["name"]
    forward_site = forward_enzyme["site"]
    reverse_site = reverse_enzyme["site"]
    forward_tail = f"{build_gc_clamp(clamp_length)}{forward_site}"
    reverse_tail = f"{build_gc_clamp(clamp_length)}{reverse_site}"
    results, used_relaxed = design_cloning_primers(sequence, forward_tail, reverse_tail)
    if not results:
        raise ApiError("没有找到满足条件的酶切克隆引物，请尝试更换插入片段或位点。")

    insert_warnings: list[str] = []

    restriction_analysis = summarize_restriction_scan(
        document,
        vector_document,
        chosen_tokens=[forward_name, reverse_name],
        vector_topology=vector_document.topology if vector_document else "circular",
    )
    chosen_analysis = restriction_analysis["chosenEnzymes"]
    pair_assessment = restriction_analysis.get("chosenPairAssessment")
    for enzyme_analysis in chosen_analysis:
        if enzyme_analysis["insert_conflict"]:
            messages.append(f"{enzyme_analysis['name']} 在 insert 内命中 {enzyme_analysis['insert']['hit_count']} 次，建议换酶或改走 Gibson。")
            insert_warnings.append(f"插入片段内部已含 {enzyme_analysis['name']}/{enzyme_analysis['site']} 位点，请确认不会影响后续酶切。")
        elif vector_document and not enzyme_analysis["ideal_for_cloning"]:
            vector_hits = enzyme_analysis["vector"]["hit_count"] if enzyme_analysis["vector"] else 0
            if vector_hits == 0:
                messages.append(f"{enzyme_analysis['name']} 在载体里没有命中；如果这是预期线性化位点，请再确认载体序列。")
            elif vector_hits > 1:
                messages.append(f"{enzyme_analysis['name']} 在载体里命中 {vector_hits} 次，不是唯一切位。")

    if vector_document and restriction_analysis["recommendedEnzymes"]:
        top_names = ", ".join(item["name"] for item in restriction_analysis["recommendedEnzymes"][:4])
        messages.append(f"基于当前载体/insert 扫描，优先可考虑的唯一切位酶有：{top_names}。")
    elif vector_document:
        messages.append("当前常见酶库里没有找到既在载体唯一切开、又不切 insert 的理想候选，建议换位点或改走 Gibson。")
    else:
        messages.append("如果补充载体序列，系统会进一步判断唯一切位、片段长度和更合适的候选酶。")
    if pair_assessment:
        messages.append(pair_assessment["summary"])
    elif vector_document:
        messages.append("当前载体信息还不足以可靠判断双酶切方向性；正式实验前建议再结合载体图谱核对。")

    for result in results:
        result["method"] = "restriction"
        result["assembly_method"] = "Restriction cloning"
        result["forward_site_name"] = forward_name
        result["reverse_site_name"] = reverse_name
        result["forward_site"] = forward_site
        result["reverse_site"] = reverse_site
        result["forward_cut_index"] = int(forward_enzyme["cut_index"])
        result["reverse_cut_index"] = int(reverse_enzyme["cut_index"])
        result["clamp_length"] = clamp_length
        result["tail_length_f"] = len(forward_tail)
        result["tail_length_r"] = len(reverse_tail)
        result["restriction_pair_assessment"] = pair_assessment
        result["auto_selected_sites"] = bool(auto_selected_pair)
        result["construct_review"] = build_restriction_construct_review(
            payload,
            document,
            result,
            restriction_analysis,
        )

    messages.extend(
        [
            f"已按酶切克隆模式生成引物，前后引物分别添加 {forward_name} / {reverse_name} 位点。",
            f"当前默认在每条位点前加入 {clamp_length} bp GC 保护碱基，以提高酶切效率。",
            "建议 PCR 纯化后再做双酶切和连接；如果使用非回文位点，请额外人工确认方向性。",
        ]
    )
    if used_relaxed:
        messages.append("严格阈值下没有找到理想核心引物，结果已自动放宽筛选，实验前建议人工复核。")
    messages.extend(insert_warnings)
    return {
        "meta": {
            "label": label,
            "context": context,
            "accession": None,
            "transcriptOptions": None,
            "cloningMethod": "restriction",
            "sequenceDocument": sequence_document_to_dict(document),
            "vectorSequenceDocument": sequence_document_to_dict(vector_document),
            "restrictionAnalysis": restriction_analysis,
        },
        "messages": messages,
        "results": results,
    }
# Default RT-qPCR amplicon window.  The planner/tool schema advertises
# ampliconMin/ampliconMax, so the value must actually reach the design engine
# (audit F5) — the defaults reproduce the historical 70–160 bp behaviour.
RT_AMPLICON_MIN_DEFAULT = 70
RT_AMPLICON_MAX_DEFAULT = 160
def resolve_amplicon_bounds(payload: dict[str, Any]) -> tuple[int, int]:
    """Resolve the requested amplicon size window.

    Unsupported or inconsistent values raise instead of being silently dropped,
    which is what made "the model planned a legal step" and "the engine ignored
    the user's constraint" diverge (audit F5).
    """
    def coerce(key: str, default: int) -> int:
        raw = payload.get(key)
        if raw in (None, ""):
            return default
        try:
            return int(str(raw).strip())
        except (TypeError, ValueError):
            raise ApiError(f"{key} 必须是整数（扩增子长度，单位 bp）。")

    minimum = coerce("ampliconMin", RT_AMPLICON_MIN_DEFAULT)
    maximum = coerce("ampliconMax", RT_AMPLICON_MAX_DEFAULT)
    if minimum < 40 or maximum > 2000:
        raise ApiError("扩增子长度范围需要在 40–2000 bp 之间。")
    if minimum >= maximum:
        raise ApiError("ampliconMin 必须小于 ampliconMax。")
    if maximum - minimum < 10:
        raise ApiError("扩增子长度范围至少需要 10 bp 的跨度。")
    return minimum, maximum
def design_rt_primers(
    sequence: str,
    junctions: list[int],
    gdna_check: bool,
    include_probe: bool,
    *,
    amplicon_min: int = RT_AMPLICON_MIN_DEFAULT,
    amplicon_max: int = RT_AMPLICON_MAX_DEFAULT,
) -> list[dict[str, Any]]:
    forward = generate_primer_candidates(sequence, reverse=False)
    reverse = generate_primer_candidates(sequence, reverse=True)
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for f_start, forward_items in forward.items():
        min_r = max(f_start + amplicon_min - 24, 0)
        max_r = min(f_start + amplicon_max - 18, len(sequence))
        for r_start in range(min_r, max_r + 1):
            reverse_items = reverse.get(r_start)
            if not reverse_items:
                continue
            for f_item in forward_items:
                for r_item in reverse_items:
                    amplicon = r_item["end"] - f_item["start"]
                    if not amplicon_min <= amplicon <= amplicon_max:
                        continue
                    tm_delta = abs(f_item["tm"] - r_item["tm"])
                    if tm_delta > 1.8:
                        continue
                    if has_cross_dimer(f_item["seq"], r_item["seq"]):
                        continue

                    gdna_state = "Unknown"
                    gdna_safe = False
                    if junctions:
                        gdna_safe = spans_exon_junction(f_item["start"], f_item["end"], junctions) or spans_exon_junction(
                            r_item["start"], r_item["end"], junctions
                        ) or pair_spans_multiple_exons(f_item["end"], r_item["start"], junctions)
                        gdna_state = "Yes" if gdna_safe else "No"
                    if gdna_check and junctions and not gdna_safe:
                        continue

                    probe = None
                    if include_probe:
                        probe = find_probe(sequence, f_item["end"], r_item["start"], max(f_item["tm"], r_item["tm"]))
                        if not probe:
                            continue

                    key = (f_item["seq"], r_item["seq"])
                    if key in seen:
                        continue
                    seen.add(key)

                    ideal_amplicon = min(max(110, amplicon_min), amplicon_max)
                    score = (
                        f_item["quality"]
                        + r_item["quality"]
                        + tm_delta * 1.4
                        + abs(amplicon - ideal_amplicon) / 25
                        + (0 if gdna_state == "Yes" else 1.0 if gdna_state == "Unknown" else 4.0)
                    )
                    candidates.append(
                        {
                            "f": f_item["seq"],
                            "r": r_item["seq"],
                            "tm_f": f_item["tm"],
                            "tm_r": r_item["tm"],
                            "gc_f": f_item["gc"],
                            "gc_r": r_item["gc"],
                            "size": amplicon,
                            "amplicon_gc": gc_percent(sequence[f_item["start"] : r_item["end"]]),
                            "gdna": gdna_state,
                            "probe": {
                                "seq": probe["seq"],
                                "tm": probe["tm"],
                                "gc": probe["gc"],
                                "start": probe["start"] + 1,
                                "end": probe["end"],
                            } if probe else None,
                            "positions": {
                                "template_length": len(sequence),
                                "forward_start": f_item["start"] + 1,
                                "forward_end": f_item["end"],
                                "reverse_start": r_item["start"] + 1,
                                "reverse_end": r_item["end"],
                                "amplicon_start": f_item["start"] + 1,
                                "amplicon_end": r_item["end"],
                            },
                            "quality": {
                                "tm_delta": round(tm_delta, 1),
                                "cross_dimer": False,  # pre-filtered: surviving pairs have no cross-dimer
                                "forward_three_prime_gc": f_item["three_prime_gc"],
                                "reverse_three_prime_gc": r_item["three_prime_gc"],
                                "forward_hairpin_stem": f_item["hairpin_stem"],
                                "reverse_hairpin_stem": r_item["hairpin_stem"],
                                "forward_homopolymer": f_item["homopolymer"],
                                "reverse_homopolymer": r_item["homopolymer"],
                            },
                            "conditions": recommend_pcr_conditions(f_item["tm"], r_item["tm"], amplicon, include_probe),
                            "score": round(score, 2),
                        }
                    )

    candidates.sort(key=lambda item: item["score"])
    return candidates[:6]
def resolve_ensembl_gene_id(gene: str, species: str) -> str | None:
    entries = ensembl_json(f"/xrefs/symbol/{ensembl_species_slug(species)}/{quote(gene)}")
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if entry.get("type") == "gene" and str(entry.get("id", "")).startswith("ENSG"):
            return entry["id"]
    return None
def lookup_ensembl_gene_transcripts(gene_id: str) -> list[dict[str, Any]]:
    payload = ensembl_json(f"/lookup/id/{quote(gene_id)}", {"expand": 1})
    transcripts = payload.get("Transcript") if isinstance(payload, dict) else None
    if not isinstance(transcripts, list):
        return []
    return transcripts
def transcript_refseq_xrefs(transcript_id: str) -> list[dict[str, Any]]:
    payload = ensembl_json(f"/xrefs/id/{quote(transcript_id)}", {"external_db": "RefSeq_mRNA"})
    return payload if isinstance(payload, list) else []
def resolve_ensembl_transcript_for_refseq(gene: str, species: str, accession: str) -> dict[str, Any] | None:
    if not gene or not accession or not is_human_species(species):
        return None

    key = cache_key(
        "ensembl_refseq_transcript",
        {"gene": gene.upper(), "species": normalize_species(species), "accession": normalize_accession(accession)},
    )
    cached = cache_get(key)
    if cached is not None:
        return cached

    gene_id = resolve_ensembl_gene_id(gene, species)
    if not gene_id:
        return cache_set(key, None, ttl=60 * 60)

    target = normalize_accession(accession)
    target_base = accession_base(accession)
    best_match: dict[str, Any] | None = None
    best_rank: tuple[int, int, int, int] | None = None
    transcripts = sorted(
        lookup_ensembl_gene_transcripts(gene_id),
        key=lambda item: (
            1 if item.get("is_canonical") else 0,
            1 if item.get("biotype") == "protein_coding" else 0,
            max(0, int(item.get("end") or 0) - int(item.get("start") or 0)),
        ),
        reverse=True,
    )

    for transcript in transcripts[:18]:
        transcript_id = transcript.get("id")
        if not transcript_id:
            continue

        match_score = 0
        matched_refseq = None
        for xref in transcript_refseq_xrefs(transcript_id):
            display_id = normalize_accession(xref.get("display_id") or "")
            primary_id = normalize_accession(xref.get("primary_id") or "")
            if display_id == target:
                match_score = max(match_score, 3)
                matched_refseq = display_id
            elif accession_base(display_id) == target_base or primary_id == target_base:
                match_score = max(match_score, 2)
                matched_refseq = display_id or primary_id

        if not match_score:
            continue

        transcript_length = max(0, int(transcript.get("end") or 0) - int(transcript.get("start") or 0))
        rank = (
            match_score,
            1 if transcript.get("is_canonical") else 0,
            1 if transcript.get("biotype") == "protein_coding" else 0,
            transcript_length,
        )
        if best_rank is None or rank > best_rank:
            best_rank = rank
            best_match = {
                "gene_id": gene_id,
                "transcript_id": transcript_id,
                "matched_refseq": matched_refseq or accession,
                "is_canonical": bool(transcript.get("is_canonical")),
                "biotype": transcript.get("biotype"),
            }
            if match_score >= 3:
                break

    return cache_set(key, best_match, ttl=ENSEMBL_CACHE_TTL)
def cdna_region_mappings(transcript_id: str, cdna_start: int, cdna_end: int) -> list[dict[str, Any]]:
    payload = ensembl_json(f"/map/cdna/{quote(transcript_id)}/{cdna_start}..{cdna_end}")
    raw_mappings = payload.get("mappings") if isinstance(payload, dict) else None
    if not isinstance(raw_mappings, list):
        return []

    mappings: list[dict[str, Any]] = []
    cursor = cdna_start
    for mapping in raw_mappings:
        genomic_start = int(mapping.get("start") or 0)
        genomic_end = int(mapping.get("end") or 0)
        if genomic_start <= 0 or genomic_end <= 0:
            continue
        segment_len = abs(genomic_end - genomic_start) + 1
        mappings.append(
            {
                "seq_region_name": str(mapping.get("seq_region_name") or ""),
                "genomic_start": genomic_start,
                "genomic_end": genomic_end,
                "strand": int(mapping.get("strand") or 1),
                "cdna_start": cursor,
                "cdna_end": cursor + segment_len - 1,
            }
        )
        cursor += segment_len
    return mappings
def region_variations(seq_region_name: str, genomic_start: int, genomic_end: int) -> list[dict[str, Any]]:
    region = quote(f"{seq_region_name}:{genomic_start}-{genomic_end}", safe=":-")
    payload = ensembl_json(f"/overlap/region/human/{region}", {"feature": "variation"})
    return payload if isinstance(payload, list) else []
def variation_summary(variant_id: str) -> dict[str, Any]:
    payload = ensembl_json(f"/variation/human/{quote(variant_id)}")
    return payload if isinstance(payload, dict) else {}
def parse_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
def genomic_to_cdna_span(mapping: dict[str, Any], genomic_start: int, genomic_end: int) -> tuple[int, int] | None:
    overlap_start = max(mapping["genomic_start"], genomic_start)
    overlap_end = min(mapping["genomic_end"], genomic_end)
    if overlap_start > overlap_end:
        return None

    if mapping["strand"] >= 0:
        cdna_start = mapping["cdna_start"] + (overlap_start - mapping["genomic_start"])
        cdna_end = mapping["cdna_start"] + (overlap_end - mapping["genomic_start"])
    else:
        cdna_start = mapping["cdna_end"] - (overlap_end - mapping["genomic_start"])
        cdna_end = mapping["cdna_end"] - (overlap_start - mapping["genomic_start"])
    if cdna_start > cdna_end:
        cdna_start, cdna_end = cdna_end, cdna_start
    return cdna_start, cdna_end
def overlaps(span_start: int, span_end: int, query_start: int, query_end: int) -> bool:
    return not (span_end < query_start or span_start > query_end)
def analyze_primer_snp_window(transcript_id: str, primer: str, cdna_start: int, cdna_end: int, terminal_anchor: str) -> dict[str, Any]:
    key = cache_key(
        "snp_window",
        {
            "transcript_id": transcript_id,
            "primer": primer,
            "cdna_start": cdna_start,
            "cdna_end": cdna_end,
            "terminal_anchor": terminal_anchor,
        },
    )
    cached = cache_get(key)
    if cached is not None:
        return cached

    terminal_start = cdna_start if terminal_anchor == "start" else max(cdna_start, cdna_end - 1)
    terminal_end = min(cdna_end, cdna_start + 1) if terminal_anchor == "start" else cdna_end
    seen: set[str] = set()
    details: list[dict[str, Any]] = []

    for mapping in cdna_region_mappings(transcript_id, cdna_start, cdna_end):
        if not mapping["seq_region_name"]:
            continue
        for variant in region_variations(mapping["seq_region_name"], mapping["genomic_start"], mapping["genomic_end"]):
            variant_id = variant.get("id")
            if not variant_id or variant_id in seen:
                continue

            span = genomic_to_cdna_span(mapping, int(variant.get("start") or 0), int(variant.get("end") or 0))
            if not span:
                continue

            summary = variation_summary(variant_id)
            if summary.get("var_class") not in {None, "SNP"}:
                continue

            seen.add(variant_id)
            maf = parse_float(summary.get("MAF"))
            evidence = summary.get("evidence") or []
            clinical = summary.get("clinical_significance") or []
            consequence = variant.get("consequence_type") or summary.get("most_severe_consequence") or "-"
            details.append(
                {
                    "primer": primer,
                    "id": variant_id,
                    "cdna_start": span[0],
                    "cdna_end": span[1],
                    "maf": round(maf, 4) if maf is not None else None,
                    "common": maf is not None and maf >= 0.01,
                    "terminal": overlaps(span[0], span[1], terminal_start, terminal_end),
                    "consequence": consequence,
                    "clinical": ", ".join(clinical[:2]) if clinical else "",
                    "evidence": ", ".join(evidence[:3]) if evidence else "",
                }
            )

    details.sort(key=lambda item: (0 if item["common"] else 1, 0 if item["terminal"] else 1, item["id"]))
    result = {
        "hit_count": len(details),
        "common_hits": sum(1 for item in details if item["common"]),
        "terminal_hits": sum(1 for item in details if item["terminal"]),
        "details": details,
    }
    return cache_set(key, result, ttl=ENSEMBL_CACHE_TTL)
def summarize_snp_status(known_hits: int, common_hits: int, terminal_hits: int) -> str:
    if known_hits == 0:
        return "SNP Safe"
    if common_hits > 0 or terminal_hits > 0:
        return "SNP Warning"
    return "SNP Watch"
def annotate_rt_candidates_with_snp(results: list[dict[str, Any]], payload: SequencePayload) -> str | None:
    for result in results:
        result["snp"] = {
            "status": "Unknown",
            "applied": False,
            "summary": "当前输入未启用 SNP 预警。",
            "known_hits": 0,
            "common_hits": 0,
            "terminal_hits": 0,
            "forward_hits": 0,
            "reverse_hits": 0,
            "details": [],
        }

    if not is_human_species(payload.species):
        return "当前 SNP 预警仅对 Homo sapiens 的 RefSeq 转录本启用。"
    if not payload.gene_symbol or not payload.accession:
        return "当前输入缺少可映射的人类基因符号或 RefSeq transcript，已跳过 SNP 预警。"

    try:
        transcript_match = resolve_ensembl_transcript_for_refseq(payload.gene_symbol, payload.species, payload.accession)
        if not transcript_match:
            return "无法把当前 RefSeq transcript 映射到 Ensembl，已跳过 SNP 预警。"

        for result in results:
            positions = result.get("positions") or {}
            forward_end = int(positions.get("forward_end") or 0)
            reverse_start = int(positions.get("reverse_start") or 0)
            if forward_end < 5 or reverse_start <= 0:
                continue

            forward_window = analyze_primer_snp_window(
                transcript_match["transcript_id"],
                "Forward",
                forward_end - 4,
                forward_end,
                "end",
            )
            reverse_window = analyze_primer_snp_window(
                transcript_match["transcript_id"],
                "Reverse",
                reverse_start,
                reverse_start + 4,
                "start",
            )

            known_hits = forward_window["hit_count"] + reverse_window["hit_count"]
            common_hits = forward_window["common_hits"] + reverse_window["common_hits"]
            terminal_hits = forward_window["terminal_hits"] + reverse_window["terminal_hits"]
            penalty = common_hits * 5.0 + terminal_hits * 3.0 + max(0, known_hits - common_hits - terminal_hits) * 1.5
            result["score"] = round(result["score"] + penalty, 2)
            result["snp"] = {
                "status": summarize_snp_status(known_hits, common_hits, terminal_hits),
                "applied": True,
                "summary": f"Forward {forward_window['hit_count']} | Reverse {reverse_window['hit_count']} | Terminal {terminal_hits}",
                "known_hits": known_hits,
                "common_hits": common_hits,
                "terminal_hits": terminal_hits,
                "forward_hits": forward_window["hit_count"],
                "reverse_hits": reverse_window["hit_count"],
                "penalty": round(penalty, 1),
                "transcript_id": transcript_match["transcript_id"],
                "details": (forward_window["details"] + reverse_window["details"])[:6],
            }

        status_order = {"SNP Safe": 0, "SNP Watch": 1, "SNP Warning": 2, "Unknown": 3}
        results.sort(key=lambda item: (status_order.get(item["snp"]["status"], 9), item["score"]))
        return f"已对人类 transcript {transcript_match['transcript_id']} 的引物 3' 端执行 dbSNP 预警，并对命中候选做了降权排序。"
    except ApiError:
        return "SNP 预警查询暂时不可用，当前结果按原始引物评分排序。"
def local_repeat_risk(guide: str, sequence: str) -> str:
    seed = guide[8:20]
    rc = reverse_complement(sequence)
    count = sequence.count(seed) + rc.count(seed)
    if count <= 2:
        return "Low"
    if count <= 4:
        return "Medium"
    return "High"
def count_occurrences(sequence: str, motif: str) -> int:
    if not sequence or not motif:
        return 0
    count = 0
    cursor = 0
    while True:
        index = sequence.find(motif, cursor)
        if index < 0:
            return count
        count += 1
        cursor = index + 1
def sirna_region_label(start: int, end: int, total_length: int) -> str:
    midpoint = (start + end) / 2
    if midpoint <= total_length * 0.25:
        return "5' 端附近"
    if midpoint >= total_length * 0.75:
        return "3' 端附近"
    return "中部区域"
def sirna_seed_risk(seed_gc: float, extra_seed_hits: int, seed_homopolymer: int) -> str:
    if extra_seed_hits >= 3 or seed_homopolymer >= 4 or seed_gc < 20 or seed_gc > 72:
        return "High"
    if extra_seed_hits >= 1 or seed_homopolymer >= 3 or seed_gc < 26 or seed_gc > 62:
        return "Medium"
    return "Low"
def sirna_repeat_risk(extra_target_hits: int, extra_core_hits: int) -> str:
    if extra_target_hits >= 1 or extra_core_hits >= 3:
        return "High"
    if extra_core_hits >= 1:
        return "Medium"
    return "Low"
def sirna_functional_region(
    start: int,
    end: int,
    cds_summary: dict[str, Any] | None,
    accession: str | None = None,
) -> dict[str, Any]:
    if not cds_summary:
        label = "Non-coding transcript" if (accession or "").startswith(("NR_", "XR_")) else "No CDS annotation"
        return {
            "label": label,
            "zone": None,
            "progress": None,
            "rank": 4,
            "preferred_offset": 1.0,
        }

    cds_start = int(cds_summary["start"])
    cds_end = int(cds_summary["end"])
    if end < cds_start:
        return {
            "label": "5' UTR",
            "zone": None,
            "progress": None,
            "rank": 2,
            "preferred_offset": 1.0,
        }
    if start > cds_end:
        return {
            "label": "3' UTR",
            "zone": None,
            "progress": None,
            "rank": 3,
            "preferred_offset": 1.0,
        }
    if start >= cds_start and end <= cds_end:
        midpoint = (start + end) / 2
        progress = clamp((midpoint - cds_start + 1) / max(cds_end - cds_start + 1, 1), 0.0, 1.0)
        if progress < 0.28:
            zone = "CDS early"
        elif progress > 0.72:
            zone = "CDS late"
        else:
            zone = "CDS middle"
        return {
            "label": "CDS",
            "zone": zone,
            "progress": round(progress * 100, 1),
            "rank": 0,
            "preferred_offset": abs(progress - 0.42),
        }
    return {
        "label": "Mixed",
        "zone": "CDS boundary",
        "progress": None,
        "rank": 1,
        "preferred_offset": 0.75,
    }
def sirna_variant_sharing(target_seq: str, variant_sequences: list[dict[str, Any]] | None) -> dict[str, Any]:
    if not variant_sequences or len(variant_sequences) < 2:
        return {
            "shared_variants": None,
            "variant_total": len(variant_sequences or []),
            "shared_accessions": [],
            "shared_all_variants": None,
            "shared_label": "Single transcript",
            "rank": 1,
        }

    matched: list[str] = []
    for item in variant_sequences:
        sequence = clean_sequence_letters(item.get("sequence") or "")
        if sequence and target_seq in sequence:
            matched.append(item.get("accession") or item.get("title") or "transcript")

    shared = len(matched)
    total = len(variant_sequences)
    return {
        "shared_variants": shared,
        "variant_total": total,
        "shared_accessions": matched,
        "shared_all_variants": shared == total,
        "shared_label": f"Shared {shared}/{total}",
        "rank": 0 if shared == total else 1,
    }
def sirna_context_bonus(functional_region: dict[str, Any], sharing: dict[str, Any]) -> int:
    bonus = 0
    label = functional_region.get("label")
    zone = functional_region.get("zone")
    if label == "CDS":
        bonus += 6
        if zone == "CDS middle":
            bonus += 3
        elif zone == "CDS late":
            bonus -= 2
    elif label == "Mixed":
        bonus -= 4
    elif label in {"5' UTR", "3' UTR"}:
        bonus -= 10
    elif label == "Non-coding transcript":
        bonus -= 5

    shared_variants = sharing.get("shared_variants")
    variant_total = sharing.get("variant_total") or 0
    if shared_variants is not None and variant_total >= 2:
        bonus += min(8, max(0, shared_variants - 1) * 2)
        if sharing.get("shared_all_variants"):
            bonus += 3
    return bonus
def sirna_score(
    target_seq: str,
    antisense_seq: str,
    *,
    total_length: int,
    start_index: int,
    extra_seed_hits: int,
    extra_target_hits: int,
    extra_core_hits: int,
) -> tuple[int, dict[str, Any]]:
    gc = gc_percent(target_seq)
    seed = antisense_seq[1:8]
    seed_gc = gc_percent(seed)
    seed_homopolymer = max_homopolymer(seed)
    homopolymer = max_homopolymer(target_seq)
    edge_distance = min(start_index, total_length - (start_index + len(target_seq)))
    score = 100.0

    score -= abs(gc - 42.0) * 1.45
    if gc < 28 or gc > 58:
        score -= 16
    if antisense_seq[0] in {"A", "T"}:
        score += 7
    if antisense_seq[-1] in {"G", "C"}:
        score += 4
    if seed_gc < 24 or seed_gc > 62:
        score -= 9
    if "AAAA" in target_seq or "TTTT" in target_seq:
        score -= 10
    if homopolymer >= 4:
        score -= 10 + (homopolymer - 4) * 3
    if edge_distance < 12:
        score -= 10
    elif edge_distance < 24:
        score -= 4
    score -= extra_seed_hits * 6
    score -= extra_target_hits * 15
    score -= extra_core_hits * 4

    return int(clamp(round(score), 0, 100)), {
        "gc": gc,
        "seed_gc": seed_gc,
        "seed_homopolymer": seed_homopolymer,
        "homopolymer": homopolymer,
        "edge_distance": edge_distance,
    }
def design_sirna(
    sequence: str,
    duplex_length: int,
    overhang_mode: str,
    *,
    cds_summary: dict[str, Any] | None = None,
    variant_sequences: list[dict[str, Any]] | None = None,
    accession: str | None = None,
    prefer_shared: bool = False,
    cds_only: bool = False,
    exclude_high_risk: bool = False,
) -> list[dict[str, Any]]:
    transcript = clean_sequence_letters(sequence)
    if duplex_length not in {19, 21}:
        duplex_length = 21
    if len(transcript) < duplex_length + 8:
        raise ApiError(f"序列长度至少需要 {duplex_length + 8} nt，才能稳定生成 siRNA 候选。")

    candidates: list[dict[str, Any]] = []
    risk_order = {"Low": 0, "Medium": 1, "High": 2}
    for index in range(0, len(transcript) - duplex_length + 1):
        target_seq = transcript[index : index + duplex_length]
        if "N" in target_seq:
            continue
        antisense_dna = reverse_complement(target_seq)
        seed_target = reverse_complement(antisense_dna[1:8])
        core_target = target_seq[3:15] if len(target_seq) >= 15 else target_seq
        extra_seed_hits = max(0, count_occurrences(transcript, seed_target) - 1)
        extra_target_hits = max(0, count_occurrences(transcript, target_seq) - 1)
        extra_core_hits = max(0, count_occurrences(transcript, core_target) - 1)

        base_score, metrics = sirna_score(
            target_seq,
            antisense_dna,
            total_length=len(transcript),
            start_index=index,
            extra_seed_hits=extra_seed_hits,
            extra_target_hits=extra_target_hits,
            extra_core_hits=extra_core_hits,
        )
        seed_risk = sirna_seed_risk(metrics["seed_gc"], extra_seed_hits, metrics["seed_homopolymer"])
        repeat_risk = sirna_repeat_risk(extra_target_hits, extra_core_hits)
        functional_region = sirna_functional_region(index + 1, index + duplex_length, cds_summary, accession=accession)
        sharing = sirna_variant_sharing(target_seq, variant_sequences)
        if cds_only and functional_region["label"] != "CDS":
            continue
        if exclude_high_risk and (seed_risk == "High" or repeat_risk == "High"):
            continue
        score = int(clamp(base_score + sirna_context_bonus(functional_region, sharing), 0, 100))
        sense_rna = dna_to_rna(target_seq)
        antisense_rna = dna_to_rna(antisense_dna)
        sense_duplex = f"{sense_rna}dTdT" if overhang_mode == "dtdt" else sense_rna
        antisense_duplex = f"{antisense_rna}dTdT" if overhang_mode == "dtdt" else antisense_rna
        shared_penalty = 0
        shared_gap = 0
        if prefer_shared and (sharing["variant_total"] or 0) >= 2:
            shared_penalty = 0 if sharing.get("shared_all_variants") else 1
            shared_gap = max(0, (sharing["variant_total"] or 0) - (sharing["shared_variants"] or 0))
        candidates.append(
            {
                "target_seq": dna_to_rna(target_seq),
                "target_seq_dna": target_seq,
                "sense": sense_rna,
                "antisense": antisense_rna,
                "sense_duplex": sense_duplex,
                "antisense_duplex": antisense_duplex,
                "score": score,
                "base_score": base_score,
                "gc": metrics["gc"],
                "seed_seq": dna_to_rna(antisense_dna[1:8]),
                "seed_gc": metrics["seed_gc"],
                "seed_risk": seed_risk,
                "seed_hits": extra_seed_hits,
                "repeat_risk": repeat_risk,
                "repeat_hits": extra_target_hits,
                "core_repeat_hits": extra_core_hits,
                "target_start": index + 1,
                "target_end": index + duplex_length,
                "template_length": len(transcript),
                "region": sirna_region_label(index + 1, index + duplex_length, len(transcript)),
                "functional_region": functional_region["label"],
                "cds_zone": functional_region["zone"],
                "cds_progress": functional_region["progress"],
                "cds_start": cds_summary["start"] if cds_summary else None,
                "cds_end": cds_summary["end"] if cds_summary else None,
                "shared_variants": sharing["shared_variants"],
                "variant_total": sharing["variant_total"],
                "shared_accessions": sharing["shared_accessions"][:6],
                "shared_all_variants": sharing["shared_all_variants"],
                "shared_label": sharing["shared_label"],
                "overhang_mode": overhang_mode,
                "recommended_format": "19-21 nt duplex + dTdT" if overhang_mode == "dtdt" else "裸 siRNA duplex",
                "quality": {
                    "homopolymer": metrics["homopolymer"],
                    "edge_distance": metrics["edge_distance"],
                },
                "rank_score": (
                    shared_penalty,
                    shared_gap,
                    -score,
                    functional_region["rank"],
                    functional_region["preferred_offset"],
                    sharing["rank"],
                    -(sharing["shared_variants"] or 0),
                    risk_order[seed_risk],
                    risk_order[repeat_risk],
                    extra_target_hits,
                    extra_seed_hits,
                    metrics["edge_distance"],
                    index,
                ),
            }
        )

    if not candidates:
        return []

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in sorted(candidates, key=lambda row: row["rank_score"]):
        key = item["antisense_duplex"]
        if key in seen:
            continue
        seen.add(key)
        item.pop("rank_score", None)
        deduped.append(item)
        if len(deduped) >= 8:
            break
    return deduped
def matches_pattern(seq: str, pattern: str) -> bool:
    if len(seq) != len(pattern):
        return False
    for base, token in zip(seq, pattern):
        if token == "N":
            continue
        if base != token:
            return False
    return True
def pam_penalty(pam: str, pam_set: str) -> int:
    config = PAM_LIBRARY.get(pam_set, PAM_LIBRARY["spcas9_ngg"])
    return config["pam_bias"].get(pam, 0)
def guide_score(guide: str, pam: str, pam_set: str) -> int:
    score = 50.0
    gc = gc_percent(guide)
    if 40 <= gc <= 70:
        score += 15
    elif gc < 30 or gc > 80:
        score -= 20
    else:
        score += 5

    seed = guide[14:20]
    score += (seed.count("G") + seed.count("C")) * 4.5
    if guide[19] == "G":
        score += 8
    if guide[19] == "C":
        score -= 5
    if guide[0] == "G":
        score += 4
    if "TTTT" in guide:
        score -= 25
    if max_homopolymer(guide) > 4:
        score -= 15
    score += pam_penalty(pam, pam_set)
    return int(clamp(round(score), 0, 100))
def count_mismatches(a: str, b: str, max_mismatches: int = 2) -> int | None:
    mismatches = 0
    for left, right in zip(a, b):
        if left != right:
            mismatches += 1
            if mismatches > max_mismatches:
                return None
    return mismatches
def collect_target_sites(sequence: str, pam_set: str) -> list[dict[str, Any]]:
    config = PAM_LIBRARY.get(pam_set, PAM_LIBRARY["spcas9_ngg"])
    sites: list[dict[str, Any]] = []
    seq_len = len(sequence)

    for index in range(seq_len - 22):
        pam = sequence[index + 20 : index + 23]
        if len(pam) != 3 or not any(matches_pattern(pam, pattern) for pattern in config["patterns"]):
            continue
        guide = sequence[index : index + 20]
        if "N" in guide:
            continue
        sites.append(
            {
                "guide": guide,
                "pam": pam,
                "cut": index + 18,
                "direction": "Forward",
                "guide_start": index + 1,
                "guide_end": index + 20,
            }
        )

    rc = reverse_complement(sequence)
    for index in range(seq_len - 22):
        pam = rc[index + 20 : index + 23]
        if len(pam) != 3 or not any(matches_pattern(pam, pattern) for pattern in config["patterns"]):
            continue
        guide = rc[index : index + 20]
        if "N" in guide:
            continue
        guide_end = seq_len - index
        guide_start = guide_end - 19
        sites.append(
            {
                "guide": guide,
                "pam": pam,
                "cut": seq_len - index - 17,
                "direction": "Reverse",
                "guide_start": guide_start,
                "guide_end": guide_end,
            }
        )
    return sites
def classify_off_target(exact_offtargets: int, one_mismatch_hits: int, seed_sensitive_hits: int, two_mismatch_hits: int) -> str:
    if exact_offtargets > 0 or seed_sensitive_hits >= 2:
        return "High"
    if one_mismatch_hits > 0 or seed_sensitive_hits > 0 or two_mismatch_hits >= 3:
        return "Medium"
    return "Low"
def analyze_off_targets(candidate: dict[str, Any], target_sites: list[dict[str, Any]]) -> dict[str, Any]:
    exact_offtargets = 0
    one_mismatch_hits = 0
    two_mismatch_hits = 0
    seed_sensitive_hits = 0
    details: list[dict[str, Any]] = []

    for site in target_sites:
        mismatches = count_mismatches(candidate["seq"], site["guide"], max_mismatches=2)
        if mismatches is None:
            continue

        is_self_site = (
            site["direction"] == candidate["direction"]
            and site["cut"] == candidate["cut"]
            and site["guide"] == candidate["seq"]
        )
        if is_self_site and mismatches == 0:
            continue

        seed_mismatches = count_mismatches(candidate["seq"][10:], site["guide"][10:], max_mismatches=2)
        seed_mismatches = seed_mismatches if seed_mismatches is not None else 3

        if mismatches == 0:
            exact_offtargets += 1
        elif mismatches == 1:
            one_mismatch_hits += 1
        elif mismatches == 2:
            two_mismatch_hits += 1

        if mismatches <= 1 and seed_mismatches <= 1:
            seed_sensitive_hits += 1

        details.append(
            {
                "guide": site["guide"],
                "pam": site["pam"],
                "direction": site["direction"],
                "cut": site["cut"],
                "mismatches": mismatches,
                "seed_mismatches": seed_mismatches,
            }
        )

    details.sort(key=lambda item: (item["mismatches"], item["seed_mismatches"], item["cut"]))
    risk = classify_off_target(exact_offtargets, one_mismatch_hits, seed_sensitive_hits, two_mismatch_hits)
    return {
        "off": risk,
        "offtarget": {
            "exact_offtargets": exact_offtargets,
            "one_mismatch_hits": one_mismatch_hits,
            "two_mismatch_hits": two_mismatch_hits,
            "seed_sensitive_hits": seed_sensitive_hits,
            "top_sites": details[:3],
        },
    }
def design_sgrna(sequence: str, mode: str, pam_set: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seq_len = len(sequence)
    midpoint = seq_len / 2
    config = PAM_LIBRARY.get(pam_set, PAM_LIBRARY["spcas9_ngg"])

    for index in range(seq_len - 22):
        pam = sequence[index + 20 : index + 23]
        if len(pam) != 3 or not any(matches_pattern(pam, pattern) for pattern in config["patterns"]):
            continue
        guide = sequence[index : index + 20]
        if "N" in guide:
            continue
        score = guide_score(guide, pam, pam_set)
        cut = index + 18
        distance = abs(cut - midpoint)
        candidates.append(
            {
                "seq": guide,
                "pam": pam,
                "score": score,
                "gc": gc_percent(guide),
                "cut": cut,
                "guide_start": index + 1,
                "guide_end": index + 20,
                "template_length": seq_len,
                "direction": "Forward",
                "rank_score": (-score, distance if mode == "ki" else 0),
            }
        )

    rc = reverse_complement(sequence)
    for index in range(seq_len - 22):
        pam = rc[index + 20 : index + 23]
        if len(pam) != 3 or not any(matches_pattern(pam, pattern) for pattern in config["patterns"]):
            continue
        guide = rc[index : index + 20]
        if "N" in guide:
            continue
        score = guide_score(guide, pam, pam_set)
        cut = seq_len - index - 17
        distance = abs(cut - midpoint)
        guide_end = seq_len - index
        guide_start = guide_end - 19
        candidates.append(
            {
                "seq": guide,
                "pam": pam,
                "score": score,
                "gc": gc_percent(guide),
                "cut": cut,
                "guide_start": guide_start,
                "guide_end": guide_end,
                "template_length": seq_len,
                "direction": "Reverse",
                "rank_score": (-score, distance if mode == "ki" else 0),
            }
        )

    shortlist = sorted(candidates, key=lambda row: row["rank_score"])[:40]
    target_sites = collect_target_sites(sequence, pam_set)
    risk_order = {"Low": 0, "Medium": 1, "High": 2}
    for item in shortlist:
        item.update(analyze_off_targets(item, target_sites))
        item["repeat_risk"] = local_repeat_risk(item["seq"], sequence)
        item["rank_score"] = (
            -item["score"],
            risk_order[item["off"]],
            item["offtarget"]["exact_offtargets"],
            item["offtarget"]["one_mismatch_hits"],
            item["offtarget"]["two_mismatch_hits"],
            abs(item["cut"] - midpoint) if mode == "ki" else 0,
        )

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for item in sorted(shortlist, key=lambda row: row["rank_score"]):
        key = (item["seq"], item["direction"], item["cut"])
        if key in seen:
            continue
        seen.add(key)
        item.pop("rank_score", None)
        deduped.append(item)
        if len(deduped) >= 8:
            break
    return deduped
def design_rt_response(payload: dict[str, Any]) -> dict[str, Any]:
    label, seq_payload = resolve_rt_payload(payload)
    gdna_check = bool(payload.get("gdnaCheck", True))
    include_probe = bool(payload.get("includeProbe", False))
    amplicon_min, amplicon_max = resolve_amplicon_bounds(payload)
    results = design_rt_primers(
        seq_payload.sequence,
        seq_payload.junctions,
        gdna_check,
        include_probe,
        amplicon_min=amplicon_min,
        amplicon_max=amplicon_max,
    )
    if not results:
        raise ApiError("没有找到满足当前条件的 RT-qPCR 引物，请换一个候选条目或放宽条件。")

    messages = [seq_payload.note]
    if (amplicon_min, amplicon_max) != (RT_AMPLICON_MIN_DEFAULT, RT_AMPLICON_MAX_DEFAULT):
        messages.append(f"已按 {amplicon_min}–{amplicon_max} bp 的目标扩增子范围筛选候选。")
    snp_message = annotate_rt_candidates_with_snp(results, seq_payload)
    results = results[:5]
    if gdna_check and not seq_payload.junctions:
        messages.append("当前条目没有拿到 exon 注释，所以 gDNA 安全性标记为 Unknown。")
    if include_probe:
        messages.append("已尝试加入 TaqMan probe；只有找到合适探针的组合才会展示。")
    if snp_message:
        messages.append(snp_message)
    messages.append("结果里已包含建议退火温度、延伸时间和引物位置坐标。")

    return {
        "meta": {
            "label": label,
            "context": seq_payload.source_label,
            "accession": seq_payload.accession,
            "transcriptOptions": seq_payload.transcript_options,
            "sequenceDocument": sequence_document_to_dict(seq_payload.document),
        },
        "messages": messages,
        "results": results,
    }
def design_mutagenesis_response(payload: dict[str, Any]) -> dict[str, Any]:
    resolved = resolve_mutagenesis_request(payload)
    sequence = resolved["sequence"]
    position = resolved["position"]
    reference = resolved["reference"]
    alternate = resolved["alternate"]
    results, used_relaxed = design_mutagenesis_primers(sequence, position, reference, alternate)
    if not results:
        upstream = position - 1
        downstream = len(sequence) - (position - 1 + len(reference))
        if upstream < 10 or downstream < 10:
            raise ApiError("突变位点离模板边缘太近，至少需要在突变两侧各保留约 10 nt 以上序列。")
        raise ApiError("没有找到满足条件的点突变引物，请尝试提供更长的模板序列。")

    label = resolved["label"]
    messages = [
        "当前页面适合替换型定点突变或短片段等长替换，不支持插入/缺失。",
        f"已按 {resolved['mutation_label']} 生成 whole-plasmid / overlap PCR 风格的突变引物。",
        "建议使用高保真聚合酶并在扩增后加入 DpnI 消化模板。",
    ]
    messages.extend(resolved["messages"])
    if used_relaxed:
        messages.append("严格参数下没有找到理想候选，结果已自动放宽筛选阈值，实验前建议再人工复核。")

    for result in results:
        result["mutation"] = resolved["mutation_label"]
        result["nucleotide_mutation"] = resolved["nt_mutation_label"]
        result["mutation_mode"] = resolved["mutation_mode"]
        if resolved["aa_context"]:
            result["amino_acid_mutation"] = resolved["mutation_label"]
            result["codon_change"] = f"{resolved['aa_context']['wildtype_codon']}→{resolved['aa_context']['mutant_codon']}"
            result["context"].update(resolved["aa_context"])

    return {
        "meta": {
            "label": label,
            "context": f"Site-directed mutagenesis · {len(sequence)} bp template",
            "accession": None,
            "transcriptOptions": None,
            "sequenceDocument": sequence_document_to_dict(resolved.get("document")),
        },
        "messages": messages,
        "results": results,
    }
def result_meta(label: str, context: str, **extra: Any) -> dict[str, Any]:
    meta = {
        "label": label,
        "context": context,
        "accession": None,
        "transcriptOptions": None,
        "sequenceDocument": None,
    }
    meta.update(extra)
    return meta
def design_sgrna_response(payload: dict[str, Any]) -> dict[str, Any]:
    label, seq_payload = resolve_sgrna_payload(payload)
    mode = (payload.get("mode") or "ko").strip().lower()
    pam_set = (payload.get("pamSet") or "spcas9_ngg").strip()
    if mode not in {"ko", "ki"}:
        mode = "ko"
    if pam_set not in PAM_LIBRARY:
        pam_set = "spcas9_ngg"
    if len(seq_payload.sequence) > MAX_SEQUENCE_LENGTH["sgrna"]:
        raise ApiError(f"目标序列过长（{len(seq_payload.sequence)} bp），上限 {MAX_SEQUENCE_LENGTH['sgrna']} bp，请裁剪后重试。")
    results = design_sgrna(seq_payload.sequence, mode, pam_set)
    if not results:
        raise ApiError("这段序列里没有找到 NGG PAM 位点。")

    messages = [
        seq_payload.note,
        "脱靶风险当前基于输入序列和其反向互补链的近似错配扫描，不是全基因组脱靶搜索。",
        f"当前 PAM 集合：{PAM_LIBRARY[pam_set]['label']}。",
    ]
    if mode == "ki":
        messages.append("KI 模式会优先把更靠近序列中心的 guide 排在前面。")

    return {
        "meta": {
            "label": label,
            "context": seq_payload.source_label,
            "accession": seq_payload.accession,
            "transcriptOptions": None,
            "targetOptions": seq_payload.transcript_options,
            "pamSet": pam_set,
            "sequenceDocument": sequence_document_to_dict(seq_payload.document),
        },
        "messages": messages,
        "results": results,
    }
def design_sirna_response(payload: dict[str, Any]) -> dict[str, Any]:
    label, seq_payload = resolve_sirna_payload(payload)
    duplex_length = int(payload.get("duplexLength") or 21)
    overhang_mode = (payload.get("overhangMode") or "dtdt").strip().lower()
    if overhang_mode not in {"dtdt", "none"}:
        overhang_mode = "dtdt"
    prefer_shared_requested = bool(payload.get("preferShared"))
    cds_only_requested = bool(payload.get("cdsOnly"))
    exclude_high_risk = bool(payload.get("excludeHighRisk"))
    prefer_shared = prefer_shared_requested and len(seq_payload.variant_sequences or []) >= 2
    cds_only = cds_only_requested and bool(seq_payload.cds_summary)

    results = design_sirna(
        seq_payload.sequence,
        duplex_length,
        overhang_mode,
        cds_summary=seq_payload.cds_summary,
        variant_sequences=seq_payload.variant_sequences,
        accession=seq_payload.accession,
        prefer_shared=prefer_shared,
        cds_only=cds_only,
        exclude_high_risk=exclude_high_risk,
    )
    if not results:
        hints: list[str] = []
        if cds_only:
            hints.append("关闭“仅保留 CDS 区候选”")
        if exclude_high_risk:
            hints.append("取消“排除 High 风险候选”")
        hint_text = f"；建议{ '，'.join(hints) }" if hints else ""
        raise ApiError(f"当前 transcript 在这些条件下没有找到满足规则的 siRNA 候选{hint_text}，或尝试另一种长度。")

    messages = [
        seq_payload.note,
        "当前 siRNA 评分基于 transcript 内的 GC / seed / 重复片段 / 低复杂度规则，并在可用时结合 CDS/UTR 与 transcript-shared 信息做轻量排序；它仍然不是全 transcriptome 脱靶搜索。",
        f"当前输出长度：{duplex_length} nt；{'已自动追加 dTdT overhang' if overhang_mode == 'dtdt' else '输出为裸 siRNA duplex'}。",
    ]
    if seq_payload.accession and not seq_payload.accession.startswith(("NM_", "XM_", "NR_", "XR_")):
        messages.append("当前条目不一定是标准 transcript accession；如果你要做 siRNA，建议优先选择 RefSeq RNA / transcript 条目。")
    if seq_payload.cds_summary:
        messages.append("当前条目已解析出 CDS 区间；建议优先选择位于 CDS early-middle、且 seed / repeat 风险都低的候选。")
    else:
        messages.append("当前条目没有解析到可靠 CDS 注释，所以结果里不会给出明确的 CDS / UTR 优先级。")
    if seq_payload.variant_sequences and len(seq_payload.variant_sequences) >= 2:
        messages.append("结果中的 Shared X/Y 表示该 siRNA 在当前候选 transcript 列表里命中的变体数；如果你要兼顾多个转录本，优先看 Shared 比例更高的候选。")
    if prefer_shared:
        messages.append("当前已开启“优先共享转录本靶点”；排序会把 Shared 比例更高、尤其是命中全部候选 transcript 的 siRNA 前置。")
    elif prefer_shared_requested:
        messages.append("你开启了“优先共享转录本靶点”，但当前候选 transcript 不足 2 条，所以这次没有额外应用共享区排序。")
    if cds_only:
        messages.append("当前已开启“仅保留 CDS 区候选”；5' / 3' UTR 与 CDS boundary 的窗口不会显示。")
    elif cds_only_requested:
        messages.append("你开启了“仅保留 CDS 区候选”，但当前条目没有可靠 CDS 注释，所以这次没有额外过滤。")
    if exclude_high_risk:
        messages.append("当前已开启“排除 High 风险候选”；seed 或 repeat 风险为 High 的 siRNA 已被过滤。")

    return {
        "meta": {
            "label": label,
            "context": seq_payload.source_label,
            "accession": seq_payload.accession,
            "transcriptOptions": seq_payload.transcript_options,
            "sequenceDocument": sequence_document_to_dict(seq_payload.document),
            "duplexLength": duplex_length,
            "overhangMode": overhang_mode,
            "cdsSummary": seq_payload.cds_summary,
            "variantTranscriptCount": len(seq_payload.variant_sequences or []),
            "preferences": {
                "preferShared": prefer_shared,
                "cdsOnly": cds_only,
                "excludeHighRisk": exclude_high_risk,
            },
        },
        "messages": messages,
        "results": results,
    }
def build_target_option_items(options: list[dict[str, Any]], selected_index: int = 0) -> list[dict[str, Any]]:
    return [
        {
            "accession": option["accession"],
            "title": option["title"],
            "length": option["length"],
            "variant": option["variant"],
            "tags": option.get("tags", []),
            "selected": index == selected_index,
        }
        for index, option in enumerate(options)
    ]
def resolve_rt_target_response(payload: dict[str, Any]) -> dict[str, Any]:
    gene = (payload.get("query") or "").strip()
    species = (payload.get("species") or "Homo sapiens").strip() or "Homo sapiens"
    strain = (payload.get("strain") or "").strip()
    if not gene:
        raise ApiError("请输入基因名。")
    if looks_like_sequence(gene) or ACCESSION_RE.match(gene.upper()):
        raise ApiError("候选条目查询只接受基因名；如果你已经有序列或 accession，可以直接开始设计。")

    options = resolve_transcript_options(gene, species, strain=strain)
    return {
        "meta": {
            "label": gene,
            "context": f"{species}{f' · {strain}' if strain else ''}",
            "accession": options[0]["accession"] if options else None,
            "transcriptOptions": build_target_option_items(options, selected_index=0),
        },
        "messages": [f"已为 {species}{f' · {strain}' if strain else ''} 的 {gene} 找到 {len(options)} 个候选条目。"],
        "results": [],
    }
def resolve_sgrna_target_response(payload: dict[str, Any]) -> dict[str, Any]:
    gene = (payload.get("query") or "").strip()
    species = (payload.get("species") or "Homo sapiens").strip() or "Homo sapiens"
    strain = (payload.get("strain") or "").strip()
    if not gene:
        raise ApiError("请输入基因名。")
    if looks_like_sequence(gene) or ACCESSION_RE.match(gene.upper()):
        raise ApiError("候选条目查询只接受基因名；如果你已经有序列或 accession，可以直接开始设计。")

    options = resolve_target_options(gene, species, strain=strain)
    return {
        "meta": {
            "label": gene,
            "context": f"{species}{f' · {strain}' if strain else ''}",
            "accession": options[0]["accession"] if options else None,
            "targetOptions": build_target_option_items(options, selected_index=0),
        },
        "messages": [f"已为 {species}{f' · {strain}' if strain else ''} 的 {gene} 找到 {len(options)} 个候选条目。"],
        "results": [],
    }
def resolve_sirna_target_response(payload: dict[str, Any]) -> dict[str, Any]:
    gene = (payload.get("query") or "").strip()
    species = (payload.get("species") or "Homo sapiens").strip() or "Homo sapiens"
    strain = (payload.get("strain") or "").strip()
    if not gene:
        raise ApiError("请输入基因名。")
    if looks_like_sequence(gene) or ACCESSION_RE.match(gene.upper()):
        raise ApiError("候选条目查询只接受基因名；如果你已经有序列或 accession，可以直接开始设计。")

    options = resolve_transcript_options(gene, species, strain=strain)
    return {
        "meta": {
            "label": gene,
            "context": f"{species}{f' · {strain}' if strain else ''}",
            "accession": options[0]["accession"] if options else None,
            "transcriptOptions": build_target_option_items(options, selected_index=0),
        },
        "messages": [f"已为 {species}{f' · {strain}' if strain else ''} 的 {gene} 找到 {len(options)} 个 transcript 候选。"],
        "results": [],
    }
def design_rt_batch_response(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        raise ApiError("批量设计至少需要 1 条输入。")

    gdna_check = bool(payload.get("gdnaCheck", True))
    include_probe = bool(payload.get("includeProbe", False))

    results: list[dict[str, Any]] = []
    success = 0
    for raw_item in items[:50]:
        if not isinstance(raw_item, dict):
            continue
        item_payload = {
            "query": raw_item.get("query") or "",
            "species": raw_item.get("species") or "Homo sapiens",
            "strain": raw_item.get("strain") or "",
            "selectedAccession": raw_item.get("selectedAccession") or "",
            "gdnaCheck": gdna_check,
            "includeProbe": include_probe,
        }
        try:
            data = design_rt_response(item_payload)
            top = data["results"][0] if data["results"] else None
            results.append(
                {
                    "query": raw_item.get("query") or "",
                    "species": raw_item.get("species") or "Homo sapiens",
                    "strain": raw_item.get("strain") or "",
                    "ok": True,
                    "accession": data["meta"]["accession"],
                    "context": data["meta"]["context"],
                    "messages": data["messages"],
                    "topResult": top,
                }
            )
            success += 1
        except ApiError as exc:
            results.append(
                {
                    "query": raw_item.get("query") or "",
                    "species": raw_item.get("species") or "Homo sapiens",
                    "strain": raw_item.get("strain") or "",
                    "ok": False,
                    "error": str(exc),
                }
            )

    return {
        "meta": {
            "label": f"批量 RT-qPCR ({success}/{len(results)} 成功)",
            "context": "Batch Mode",
            "accession": None,
            "transcriptOptions": None,
            "sequenceDocument": None,
        },
        "messages": [f"共处理 {len(results)} 条输入，成功 {success} 条。"],
        "results": results,
    }
def sequence_document_from_payload(payload: dict[str, Any]) -> SequenceDocument:
    if not isinstance(payload, dict):
        raise ApiError("缺少可导出的序列对象。")
    sequence = sanitize_sequence(payload.get("sequence") or "")
    if not sequence:
        raise ApiError("序列对象里没有有效的 DNA 内容。")
    feature_items = []
    for raw_feature in payload.get("features") or []:
        if not isinstance(raw_feature, dict):
            continue
        qualifiers = raw_feature.get("qualifiers") or {}
        if not isinstance(qualifiers, dict):
            qualifiers = {}
        feature_items.append(
            SequenceFeature(
                str(raw_feature.get("type") or "misc_feature"),
                str(raw_feature.get("location") or ""),
                {str(key): str(value) for key, value in qualifiers.items()},
            )
        )
    return SequenceDocument(
        name=normalize_sequence_name(str(payload.get("name") or payload.get("accession") or "Imported_Sequence")),
        sequence=sequence,
        format=str(payload.get("format") or "plain"),
        description=str(payload.get("description") or payload.get("name") or "Imported Sequence"),
        accession=str(payload.get("accession") or "") or None,
        version=str(payload.get("version") or "") or None,
        topology=str(payload.get("topology") or "linear"),
        molecule_type=str(payload.get("molecule_type") or payload.get("moleculeType") or "DNA"),
        source=str(payload.get("source") or "") or None,
        organism=str(payload.get("organism") or "") or None,
        date=str(payload.get("date") or "") or None,
        features=feature_items,
    )
def parse_sequence_response(payload: dict[str, Any]) -> dict[str, Any]:
    raw_text = payload.get("text") or payload.get("sequence") or ""
    fallback_name = (payload.get("name") or payload.get("filename") or "Imported Sequence").strip() or "Imported Sequence"
    if not raw_text:
        raise ApiError("请提供要解析的序列文本。")
    document = parse_sequence_document(str(raw_text), fallback_name=fallback_name)
    format_labels = {"plain": "纯序列", "fasta": "FASTA", "genbank": "GenBank"}
    messages = [f"已识别为 {format_labels.get(document.format, document.format)}，长度 {len(document.sequence)} bp。"]
    if document.accession:
        messages.append(f"accession：{document.accession}")
    if document.features:
        messages.append(f"已保留 {len(document.features)} 个 feature，可继续用于后续可视化和导出。")
    biophysics = calculate_bio_params(document.sequence)
    gc_window = calculate_gc_window(document.sequence, window_size=50)

    return {
        "document": sequence_document_to_dict(document),
        "messages": messages,
        "biophysics": biophysics,
        "gcWindow": gc_window,
    }
def export_sequence_response(payload: dict[str, Any]) -> dict[str, Any]:
    document = sequence_document_from_payload(payload.get("document") or {})
    format_name = str(payload.get("format") or document.format or "fasta").strip().lower()
    if format_name == "genbank":
        content = format_genbank_document(document)
        extension = "gb"
        mime_type = "application/octet-stream"
    elif format_name == "fasta":
        content = format_fasta_document(document)
        extension = "fa"
        mime_type = "text/plain; charset=utf-8"
    else:
        raise ApiError("当前只支持导出 FASTA 或 GenBank。")
    filename = f"{normalize_sequence_name(document.accession or document.name or 'sequence')}.{extension}"
    return {
        "content": content,
        "mimeType": mime_type,
        "filename": filename,
        "document": sequence_document_to_dict(document),
    }
def scan_restriction_sites_response(payload: dict[str, Any]) -> dict[str, Any]:
    sequence_raw = payload.get("sequence") or ""
    if not sequence_raw:
        raise ApiError("请先输入 insert 或目标序列，再扫描酶切位点。")
    label = (payload.get("label") or "Restriction Scan").strip() or "Restriction Scan"
    insert_document = parse_sequence_document(sequence_raw, fallback_name=label)
    insert_topology = (payload.get("topology") or insert_document.topology or "linear").strip().lower()
    insert_document.topology = insert_topology if insert_topology in {"linear", "circular"} else "linear"

    vector_raw = payload.get("vectorSequence") or ""
    vector_document = None
    vector_topology = (payload.get("vectorTopology") or "circular").strip().lower()
    if vector_raw:
        vector_document = parse_sequence_document(vector_raw, fallback_name=f"{label}_vector")
        vector_document.topology = vector_topology if vector_topology in {"linear", "circular"} else (vector_document.topology or "circular")

    chosen_tokens = payload.get("enzymes") or []
    if not isinstance(chosen_tokens, list):
        chosen_tokens = []
    analysis = summarize_restriction_scan(
        insert_document,
        vector_document,
        chosen_tokens=[str(item) for item in chosen_tokens if str(item).strip()],
        vector_topology=vector_document.topology if vector_document else "circular",
    )
    scanned_names = [str(item) for item in chosen_tokens if str(item).strip()]
    if scanned_names:
        # A-AGT-001: when the request named specific enzymes, report exactly
        # those (with their positions) instead of library-wide counts.
        messages = [
            f"已按用户指定酶（{'、'.join(scanned_names)}）扫描，当前 insert 长度 {analysis['insertLength']} bp。",
        ]
        for item in analysis.get("chosenEnzymes") or []:
            if not isinstance(item, dict):
                continue
            insert = item.get("insert") or {}
            name = str(item.get("name") or "")
            count = int(insert.get("hit_count") or 0)
            positions = [int(p) + 1 for p in (insert.get("positions") or [])][:6]
            if count:
                messages.append(f"{name}：{count} 个位点（位置 {'、'.join(str(p) for p in positions)}）。")
            else:
                messages.append(f"{name}：无位点。")
    else:
        messages = [
            f"已扫描 {analysis['summary']['librarySize']} 种常见限制酶，当前 insert 长度 {analysis['insertLength']} bp。",
            f"insert 内完全不切的常见酶有 {analysis['summary']['insertSafeCutters']} 种。",
        ]
    if vector_document:
        messages.append(
            f"载体里唯一切开的常见酶有 {analysis['summary']['vectorSingleCutters'] or 0} 种；可组成的推荐双酶切组合约 {analysis['summary']['recommendedPairs'] or 0} 组。"
        )
        top_pair = next((item for item in analysis.get("recommendedPairs") or [] if item.get("auto_pick_eligible")), None)
        if top_pair:
            messages.append(
                f"当前最稳的自动双酶切候选是 {top_pair['forwardName']} / {top_pair['reverseName']}：{top_pair['summary']}"
            )
    else:
        messages.append("如果再提供载体序列，系统可以继续判断唯一切位和推荐双酶切组合。")
    return {
        "meta": {
            "label": label,
            "context": f"Restriction Scan · {analysis['insertLength']} bp insert",
            "accession": None,
            "transcriptOptions": None,
            "sequenceDocument": sequence_document_to_dict(insert_document),
            "vectorSequenceDocument": sequence_document_to_dict(vector_document),
            "restrictionAnalysis": analysis,
        },
        "messages": messages,
        "results": [],
    }
def parse_cloning_homology_length(value: Any, default: int = 20) -> int:
    try:
        parsed = int(str(value or default).strip())
    except (TypeError, ValueError):
        parsed = default
    return max(12, min(parsed, 30))
def circular_sequence_window(sequence: str, start: int, length: int) -> str:
    if not sequence or length <= 0:
        return ""
    return "".join(sequence[(start + offset) % len(sequence)] for offset in range(length))
def derive_vector_homology_plan(
    vector_sequence: str,
    selection: dict[str, Any],
    homology_length: int = 20,
    topology: str = "circular",
) -> dict[str, Any]:
    """Derive Gibson junctions and a reversible edit from the open vector selection."""
    sequence = sanitize_sequence(vector_sequence)
    if not sequence:
        raise ApiError("当前打开的载体没有可用序列。")

    start = int(selection.get("start", -1))
    end = int(selection.get("end", -1))
    wraps_origin = bool(selection.get("wrapsOrigin"))
    is_cursor = bool(selection.get("cursor"))
    if wraps_origin:
        raise ApiError("当前选区跨越环状载体原点，暂时不能安全生成载体修改；请改选一个不跨原点的连续区域。")
    if start < 0 or end < start or end > len(sequence) or (end == start and not is_cursor):
        raise ApiError("当前载体选区坐标无效，请重新选择插入位置。")

    overlap_length = parse_cloning_homology_length(homology_length)
    if len(sequence) < overlap_length:
        raise ApiError(f"载体长度不足，无法提取 {overlap_length} bp 同源臂。")

    # A synthetic zero-width feature boundary or a one-base editor selection
    # acts as an insertion cursor. A longer selection is replaced.
    edit_mode = "insert" if is_cursor or end - start == 1 else "replace"
    edit_end = start if edit_mode == "insert" else end
    right_anchor = start if edit_mode == "insert" else end
    normalized_topology = topology if topology in {"linear", "circular"} else "circular"

    if normalized_topology == "linear":
        if start < overlap_length or right_anchor + overlap_length > len(sequence):
            raise ApiError(
                f"选区距离线性载体末端太近，左右至少各需要 {overlap_length} bp 才能自动提取同源臂。"
            )
        left_homology = sequence[start - overlap_length:start]
        right_homology = sequence[right_anchor:right_anchor + overlap_length]
    else:
        left_homology = circular_sequence_window(sequence, start - overlap_length, overlap_length)
        right_homology = circular_sequence_window(sequence, right_anchor, overlap_length)

    expected_sequence = sequence[start:end] if edit_mode == "replace" else ""
    return {
        "mode": edit_mode,
        "start": start,
        "end": edit_end,
        "selectionStart": start,
        "selectionEnd": end,
        "selectionLength": end - start,
        "expectedSequence": expected_sequence,
        "leftHomology": left_homology,
        "rightHomology": right_homology,
        "homologyLength": overlap_length,
        "vectorLength": len(sequence),
        "vectorTopology": normalized_topology,
        "coordinateSystem": COORDINATE_SYSTEM,
    }
def infer_cloning_agent_method(message: str, state: dict[str, Any]) -> str | None:
    lowered = message.lower()
    if any(token in lowered for token in ("golden gate", "type iis", "bsa", "bsmbi", "esp3i", "sapi")):
        return "golden_gate"
    if any(token in lowered for token in ("gibson", "同源", "homology", "重组")):
        return "gibson"
    if any(token in lowered for token in ("酶切", "restriction", "双酶切", "sticky end", "eco", "xho", "bamh", "hind")):
        return "restriction"
    preferred = str(state.get("method") or "").strip().lower()
    if preferred in {"restriction", "golden_gate"}:
        return preferred
    return None
def is_cloning_compare_request(message: str) -> bool:
    lowered = message.lower()
    return any(token in lowered for token in ("推荐", "判断", "compare", "比较", "哪个", "路线", "strategy", "方案", "合适", "copilot"))
def combine_agent_missing_message(message: str, missing_inputs: list[str]) -> str:
    unique_inputs = list(dict.fromkeys(str(item).strip() for item in missing_inputs if str(item).strip()))
    if not unique_inputs:
        return message
    questions = "\n".join(f"- {item}" for item in unique_inputs)
    return f"{message}\n\n继续前需要你确认：\n{questions}"
def resolve_cloning_insert_from_query(
    state: dict[str, Any],
    plan: list[dict[str, Any]],
    warnings: list[str],
) -> tuple[SequenceDocument | None, dict[str, Any] | None, list[str]]:
    query = str(state.get("query") or "").strip()
    species = str(state.get("species") or "").strip()
    strain = str(state.get("strain") or "").strip()
    selected_accession = str(state.get("selectedAccession") or "").strip().upper()
    if not query:
        return None, None, []

    missing_inputs: list[str] = []
    query_upper = query.upper()
    try:
        if ACCESSION_RE.match(query.upper()):
            accession, title, sequence = fetch_fasta_with_title(query.upper())
            document = build_sequence_document(
                sequence,
                name=accession,
                description=title or accession,
                accession=accession,
                format_name="fasta",
            )
            plan.append(
                {
                    "step": "读取 insert accession",
                    "tool": "resolve_cloning_target",
                    "status": "pending",
                    "detail": f"已按 {accession} 读取 insert，长度约 {len(sequence)} bp。",
                }
            )
            return document, {
                "query": accession,
                "species": species,
                "strain": strain,
                "selectedAccession": accession,
                "targetOptions": [
                    {
                        "accession": accession,
                        "title": title or accession,
                        "length": len(sequence),
                        "recommended": True,
                        "selected": True,
                    }
                ],
            }, []

        if query_upper in CLONING_COMMON_INSERT_ALIASES:
            missing_inputs.append(
                f"{query} 更像一个常见 reporter / tag / 合成 insert 名称，不适合直接按 NCBI 基因名唯一定位。请直接发 insert 序列、对应 accession，或者把来源质粒 / 构建文件发给我。"
            )
            return None, None, missing_inputs

        if not species:
            missing_inputs.append(
                f"我识别到你想做 {query} 的克隆，但这个名字还不能唯一定位 insert。请直接发 insert 序列 / FASTA / GenBank，或者补充物种、具体变体或模板载体名。"
            )
            return None, None, missing_inputs

        options = resolve_target_options(query, species, strain=strain)
        selected = selected_accession or (options[0]["accession"] if options else "")
        chosen = next((item for item in options if item["accession"].upper() == selected), options[0] if options else None)
        if not chosen:
            missing_inputs.append(f"我还没有为 {query} 找到合适的 insert 候选。请直接提供序列、accession，或更具体的变体信息。")
            return None, None, missing_inputs

        document = build_sequence_document(
            chosen["sequence"],
            name=chosen["accession"],
            description=chosen.get("title") or chosen["accession"],
            accession=chosen["accession"],
            format_name="fasta",
        )
        plan.append(
            {
                "step": "查询 insert 候选",
                "tool": "resolve_cloning_target",
                "status": "pending",
                "detail": f"已找到 {len(options)} 个候选条目，当前先按 {chosen['accession']} 规划 insert。",
            }
        )
        if len(options) >= 2 and not selected_accession:
            warnings.append(f"{query} 目前还没有显式指定条目，我先按默认候选 {chosen['accession']} 继续。")
        return document, {
            "query": query,
            "species": species,
            "strain": strain,
            "selectedAccession": chosen["accession"],
            "targetOptions": [
                {
                    "accession": item["accession"],
                    "title": item["title"],
                    "length": item["length"],
                    "recommended": bool(item.get("recommended")),
                    "selected": item["accession"] == chosen["accession"],
                }
                for item in options
            ],
        }, []
    except ApiError as exc:
        exc_text = str(exc).rstrip("。.")
        missing_inputs.append(
            f"我尝试按 {query} 去定位 insert，但暂时没能稳定找到对应条目：{exc_text}。你可以直接发序列，或补物种 / 具体变体后我再继续。"
        )
        return None, None, missing_inputs
