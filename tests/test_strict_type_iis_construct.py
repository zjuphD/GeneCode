from __future__ import annotations

import hashlib
import unittest

import server


VECTOR = "AAAAA" + "AAAAA" + "GAGACC" + "AAAAAAAA" + "GGTCTC" + "TTTTT"


def make_document(sequence: str, topology: str = "linear") -> server.SequenceDocument:
    return server.SequenceDocument(
        name="fixture",
        sequence=sequence,
        topology=topology,
        features=[],
    )


class TestStrictTypeIisConstruct(unittest.TestCase):
    def test_builds_digestible_linear_construct_from_dual_strand_cuts(self) -> None:
        construct = server.build_strict_type_iis_construct(
            make_document(VECTOR),
            [make_document("CCCC")],
            server.resolve_type_iis_enzyme("BsaI"),
            ["AAAA", "TTTT"],
        )
        self.assertTrue(construct["available"])
        self.assertEqual(construct["vectorCutPositions"], [5, 31])
        self.assertEqual(construct["vectorSiteDirections"], ["Reverse", "Forward"])
        self.assertEqual(construct["actualOverhangs"], ["AAAA", "TTTT"])
        self.assertEqual(construct["length"], 13)
        self.assertEqual(
            construct["sequenceDigest"],
            hashlib.sha256("AAAAACCCCTTTT".encode("ascii")).hexdigest(),
        )

    def test_origin_wrap_keeps_circular_sticky_end(self) -> None:
        construct = server.build_strict_type_iis_construct(
            make_document(VECTOR, topology="circular"),
            [make_document("CCCC")],
            server.resolve_type_iis_enzyme("BsaI"),
            ["AAAA", "TTTT"],
        )
        self.assertTrue(construct["available"])
        self.assertEqual(construct["actualOverhangs"], ["AAAA", "TTTT"])

    def test_rejects_non_outward_pair_and_internal_site(self) -> None:
        same_direction = "A" * 10 + "GGTCTC" + "A" * 12 + "GGTCTC" + "C" * 20
        result = server.build_strict_type_iis_construct(
            make_document(same_direction),
            [make_document("CCCC")],
            server.resolve_type_iis_enzyme("BsaI"),
            ["AAAA", "TTTT"],
        )
        self.assertFalse(result["available"])
        self.assertIn("outward-facing", result["reason"])

        result = server.build_strict_type_iis_construct(
            make_document(VECTOR),
            [make_document("CCCCGGTCTCAAAA")],
            server.resolve_type_iis_enzyme("BsaI"),
            ["AAAA", "TTTT"],
        )
        self.assertFalse(result["available"])
        self.assertIn("识别位点", result["reason"])


if __name__ == "__main__":
    unittest.main()
