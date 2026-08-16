#!/usr/bin/env python3
"""A-BIO-002 regression tests: Type IIS enzymes (BsaI/BsmBI) must carry
asymmetric double-strand cut positions in both orientations, instead of a
single shared cut offset."""

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


def bsaI() -> dict:
    return server.RESTRICTION_ENZYME_LIBRARY["BsaI"]


class TestEnzymeStrandCuts(unittest.TestCase):
    def test_bsai_has_asymmetric_dual_cuts(self) -> None:
        top, bottom = server.enzyme_strand_cuts(bsaI())
        # NEB GGTCTC(1/5): top 1 nt past the motif end (6+1), bottom 5 nt past (6+5).
        self.assertEqual((top, bottom), (7, 11))

    def test_bsmbi_matches_neb(self) -> None:
        top, bottom = server.enzyme_strand_cuts(server.RESTRICTION_ENZYME_LIBRARY["BsmBI"])
        self.assertEqual((top, bottom), (7, 11))

    def test_sapi_matches_neb(self) -> None:
        top, bottom = server.enzyme_strand_cuts(server.RESTRICTION_ENZYME_LIBRARY["SapI"])
        self.assertEqual((top, bottom), (8, 11))

    def test_palindromic_ecori_mirrors_across_motif(self) -> None:
        top, bottom = server.enzyme_strand_cuts(server.RESTRICTION_ENZYME_LIBRARY["EcoRI"])
        # G^AATTC: top cut at 1, bottom at 5 (4-base 5' overhang AATT).
        self.assertEqual((top, bottom), (1, 5))

    def test_palindromic_blunt_ecorv_cuts_centre(self) -> None:
        top, bottom = server.enzyme_strand_cuts(server.RESTRICTION_ENZYME_LIBRARY["EcoRV"])
        self.assertEqual((top, bottom), (3, 3))


class TestTypeIisHitCuts(unittest.TestCase):
    def test_forward_bsai_hit_carries_both_strand_cuts(self) -> None:
        sequence = "AAAAAAAAAAGGTCTCAAAAAAAAAAAAAA"  # motif at 0-based 10
        hits = server.find_restriction_site_hits(
            sequence, bsaI()["site"], int(bsaI()["cut_index"]),
            topology="linear", cuts_top=bsaI()["cuts_top"], cuts_bottom=bsaI()["cuts_bottom"],
        )
        self.assertEqual(len(hits), 1)
        hit = hits[0]
        self.assertEqual(hit["direction"], "Forward")
        self.assertEqual(hit["start"], 11)  # 1-based inclusive
        self.assertEqual(hit["end"], 16)
        self.assertEqual(hit["cut_top"], 17)  # 10 + 7
        self.assertEqual(hit["cut_bottom"], 21)  # 10 + 11
        self.assertEqual(hit["cut"], 17)  # legacy top-strand cut

    def test_reverse_bsai_hit_cuts_before_motif(self) -> None:
        sequence = "AAAAAAAAAAGAGACCAAAAAAAAAAAAAA"  # reverse motif at 0-based 10
        hits = server.find_restriction_site_hits(
            sequence, bsaI()["site"], int(bsaI()["cut_index"]),
            topology="linear", cuts_top=bsaI()["cuts_top"], cuts_bottom=bsaI()["cuts_bottom"],
        )
        self.assertEqual(len(hits), 1)
        hit = hits[0]
        self.assertEqual(hit["direction"], "Reverse")
        # NEB GAGACC(5/1): top strand cut 5 nt before the motif, bottom 1 nt before.
        self.assertEqual(hit["cut_top"], 5)
        self.assertEqual(hit["cut_bottom"], 9)

    def test_forward_and_reverse_cuts_differ(self) -> None:
        """The whole point of the fix: reverse Type IIS sites must not reuse
        the forward +7 rule."""
        seq_fwd = "AAAAAAAAAAGGTCTCAAAAAAAAAAAAAA"
        seq_rev = "AAAAAAAAAAGAGACCAAAAAAAAAAAAAA"
        fwd = server.find_restriction_site_hits(
            seq_fwd, bsaI()["site"], 7, topology="linear",
            cuts_top=bsaI()["cuts_top"], cuts_bottom=bsaI()["cuts_bottom"],
        )[0]
        rev = server.find_restriction_site_hits(
            seq_rev, bsaI()["site"], 7, topology="linear",
            cuts_top=bsaI()["cuts_top"], cuts_bottom=bsaI()["cuts_bottom"],
        )[0]
        self.assertNotEqual((fwd["cut_top"], fwd["cut_bottom"]), (rev["cut_top"], rev["cut_bottom"]))

    def test_circular_origin_wrap_bsai_cuts(self) -> None:
        # The motif GGTCTC spans the origin: positions 16-19 = "GGTC",
        # positions 0-1 = "TC" → GGTCTC wraps around the origin.
        sequence = "TC" + "A" * 14 + "GGTC"  # 20 bp
        hits = server.find_restriction_site_hits(
            sequence, bsaI()["site"], 7, topology="circular",
            cuts_top=bsaI()["cuts_top"], cuts_bottom=bsaI()["cuts_bottom"],
        )
        self.assertTrue(any(hit.get("wraps_origin") for hit in hits))
        hit = next(h for h in hits if h.get("wraps_origin"))
        self.assertEqual(hit["cut_top"], (16 + 7) % 20)  # wraps to 3
        self.assertEqual(hit["cut_bottom"], (16 + 11) % 20)  # wraps to 7


class TestDigestUsesTopStrandCut(unittest.TestCase):
    def test_fragment_lengths_follow_top_strand_cut(self) -> None:
        sequence = "AAAAAAAAAAGGTCTCAAAAAAAAAAAAAA"  # 30 bp, single BsaI site
        scan = server.scan_restriction_enzyme_on_sequence(
            sequence, {**bsaI(), "name": "BsaI", "source": "builtin"}, topology="linear"
        )
        self.assertEqual(scan["cuts"], [17])
        self.assertEqual(scan["fragment_lengths"], [17, 13])
        self.assertEqual(scan["hits"][0]["cut_top"], 17)
        self.assertEqual(scan["hits"][0]["cut_bottom"], 21)


if __name__ == "__main__":
    unittest.main()
