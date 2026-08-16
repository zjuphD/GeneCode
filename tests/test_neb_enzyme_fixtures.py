#!/usr/bin/env python3
"""A-BIO-002 NEB authoritative fixtures.

Pins the double-strand cut positions (cuts_top / cuts_bottom) and optimal
incubation temperatures of the built-in restriction enzyme library against
NEB's published reference data. The mirror rule (top = cut_index,
bottom = len(site) - top) is the same one Biopython applies; these tests make
the mapping explicit so a future data edit cannot silently diverge from NEB.

Reference notation (NEB, e.g. EcoRI G^AATTC / CTTAA^G):
  - 5' overhang enzymes cut the top strand early (low index), bottom late.
  - 3' overhang enzymes cut the top strand late, bottom early.
  - Blunt cutters share one position on both strands.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402

# NEB reference: enzyme -> (site, (top cut, bottom cut) 0-based from motif start)
NEB_CUTS: dict[str, tuple[str, tuple[int, int]]] = {
    # 5' overhang, 4 nt
    "EcoRI": ("GAATTC", (1, 5)),
    "BamHI": ("GGATCC", (1, 5)),
    "XhoI": ("CTCGAG", (1, 5)),
    "HindIII": ("AAGCTT", (1, 5)),
    "NheI": ("GCTAGC", (1, 5)),
    "XbaI": ("TCTAGA", (1, 5)),
    "SalI": ("GTCGAC", (1, 5)),
    "AgeI": ("ACCGGT", (1, 5)),
    "BglII": ("AGATCT", (1, 5)),
    "SpeI": ("ACTAGT", (1, 5)),
    "NcoI": ("CCATGG", (1, 5)),
    "MluI": ("ACGCGT", (1, 5)),
    "BsiWI": ("CGTACG", (1, 5)),
    "BspEI": ("TCCGGA", (1, 5)),
    "BsrGI": ("TGTACA", (1, 5)),
    "AvrII": ("CCTAGG", (1, 5)),
    "ApoI": ("RAATTY", (1, 5)),
    "BstYI": ("RGATCY", (1, 5)),
    "Acc65I": ("GGTACC", (1, 5)),
    # 5' overhang, 2 nt
    "NdeI": ("CATATG", (2, 4)),
    "ClaI": ("ATCGAT", (2, 4)),
    # 5' overhang, 8 nt
    "NotI": ("GCGGCCGC", (2, 6)),
    # 3' overhang, 4 nt
    "KpnI": ("GGTACC", (5, 1)),
    "PstI": ("CTGCAG", (5, 1)),
    "SacI": ("GAGCTC", (5, 1)),
    "ApaI": ("GGGCCC", (5, 1)),
    # blunt
    "EcoRV": ("GATATC", (3, 3)),
    "SmaI": ("CCCGGG", (3, 3)),
    "PvuII": ("CAGCTG", (3, 3)),
    # Type IIS (asymmetric; NEB GGTCTC(1/5), CGTCTC(N1/N5), GCTCTTC(N1/N4))
    "BsaI": ("GGTCTC", (7, 11)),
    "BsmBI": ("CGTCTC", (7, 11)),
    "SapI": ("GCTCTTC", (8, 11)),
    "BbsI": ("GAAGAC", (8, 12)),
    "AarI": ("CACCTGC", (12, 16)),
}

# NEB recommended incubation temperature (°C)
NEB_TEMP: dict[str, int] = {
    "EcoRI": 37, "BamHI": 37, "XhoI": 37, "NotI": 37, "KpnI": 37,
    "Acc65I": 37, "HindIII": 37, "NheI": 37, "XbaI": 37, "SalI": 37,
    "AgeI": 37, "BglII": 37, "SpeI": 37, "PstI": 37, "SacI": 37,
    "ApaI": 37, "EcoRV": 37, "SmaI": 25, "PvuII": 37, "NcoI": 37,
    "NdeI": 37, "ClaI": 37, "MluI": 37, "BsiWI": 37, "BspEI": 37,
    "BsrGI": 37, "AvrII": 37, "ApoI": 50, "BstYI": 60,
    "BsaI": 50, "BsmBI": 55, "SapI": 37, "BbsI": 37, "AarI": 37,
}


def expand_iupac(code: str) -> str:
    """Expand IUPAC ambiguity codes into concrete bases for synthetic
    sequences (R=A/G, Y=C/T, M=A/C, K=G/T, S=G/C, W=A/T, B=C/G/T,
    D=A/G/T, H=A/C/T, V=A/C/G, N=any)."""
    return {
        "R": "A", "Y": "C", "M": "A", "K": "G",
        "S": "G", "W": "A", "B": "C", "D": "A",
        "H": "A", "V": "A", "N": "A",
    }.get(code, code)


class TestNebCuts(unittest.TestCase):
    def test_every_reference_enzyme_carries_neb_cuts(self) -> None:
        library = server.RESTRICTION_ENZYME_LIBRARY
        for name, (site, (top, bottom)) in NEB_CUTS.items():
            self.assertIn(name, library, f"{name}: missing from library")
            entry = library[name]
            self.assertEqual(entry["site"], site, f"{name}: site")
            self.assertEqual(
                list(entry.get("cuts_top") or []),
                [top],
                f"{name}: top-strand cut differs from NEB",
            )
            self.assertEqual(
                list(entry.get("cuts_bottom") or []),
                [bottom],
                f"{name}: bottom-strand cut differs from NEB",
            )
            # Legacy cut_index must stay in sync with the explicit top cut — it
            # still feeds hit["cut"] (dedup key + legacy consumers).
            self.assertEqual(
                int(entry["cut_index"]),
                top,
                f"{name}: cut_index diverges from cuts_top[0]",
            )
            # sanity: cut positions must be non-negative. For symmetric
            # (in-site) cutters they stay within [0, len(site)]; Type IIS cuts
            # legitimately extend past the motif end (N1/N5), so no upper bound
            # is asserted here (checked via the mirror rule test instead).
            self.assertGreaterEqual(top, 0)
            self.assertGreaterEqual(bottom, 0)

    def test_mirror_rule_holds_for_every_symmetric_enzyme(self) -> None:
        """top + bottom == len(site) for palindromic enzymes (NEB mirror)."""
        for name, (site, (top, bottom)) in NEB_CUTS.items():
            if name in ("BsaI", "BsmBI", "SapI", "BbsI", "AarI"):
                continue  # Type IIS are asymmetric by design
            self.assertEqual(
                top + bottom,
                len(site),
                f"{name}: palindromic mirror top+{bottom} != len({site})",
            )

    def test_neb_temperature_matches_reference(self) -> None:
        library = server.RESTRICTION_ENZYME_LIBRARY
        for name, temp in NEB_TEMP.items():
            self.assertIn(name, library, f"{name}: missing from library")
            self.assertEqual(
                library[name].get("optimal_temp"),
                temp,
                f"{name}: optimal_temp differs from NEB reference",
            )

    def test_scan_reports_cuts_consistent_with_neb(self) -> None:
        """A real scan on a synthetic motif must place cut_top/cut_bottom at
        the NEB-defined offsets relative to the motif start."""
        for name, (site, (top, bottom)) in NEB_CUTS.items():
            entry = server.RESTRICTION_ENZYME_LIBRARY[name]
            # Expand IUPAC ambiguity codes into concrete bases so the synthetic
            # sequence actually contains a recognisable motif (ApoI/BstYI).
            concrete = "".join(expand_iupac(c) for c in site)
            # Build a sequence with the motif at 0-based position 10.
            sequence = "A" * 10 + concrete + "A" * 10
            hits = server.find_restriction_site_hits(
                sequence,
                entry["site"],
                int(entry["cut_index"]),
                topology="linear",
                cuts_top=entry.get("cuts_top"),
                cuts_bottom=entry.get("cuts_bottom"),
            )
            fwd = [h for h in hits if h["direction"] == "Forward"]
            self.assertEqual(len(fwd), 1, f"{name}: expected one forward hit")
            hit = fwd[0]
            self.assertEqual(hit["cut_top"], 10 + top, f"{name}: top cut offset")
            self.assertEqual(hit["cut_bottom"], 10 + bottom, f"{name}: bottom cut offset")


if __name__ == "__main__":
    unittest.main()
