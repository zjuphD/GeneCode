#!/usr/bin/env python3
"""A-ALG-002: the Python sidecar's Type IIS enzyme entries must agree with
the single source of truth at molecular-design-studio/src/editor/enzyme-data.json.

The JSON is authoritative for Type IIS recognition sites, double-strand cut
positions, overhangs and the Golden Gate group. Any enzyme present in both
stores must match exactly; enzymes missing from the sidecar library are
reported as a known gap (the JSON remains the reference for a future full
migration)."""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402

ENZYME_DATA_JSON = ROOT / "molecular-design-studio" / "src" / "editor" / "enzyme-data.json"


def load_enzyme_data() -> dict:
    with open(ENZYME_DATA_JSON, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    assert data.get("schemaVersion") == 1, "enzyme-data.json schemaVersion must be 1"
    return data


class TestEnzymeDataConsistency(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.data = load_enzyme_data()

    def test_schema_has_expected_groups(self) -> None:
        self.assertIn("typeIis", self.data)
        self.assertIn("goldenGateGroup", self.data)
        self.assertIn("commonCloningGroup", self.data)
        self.assertEqual(
            self.data["goldenGateGroup"],
            ["AarI", "BbsI", "BsaI", "BsmBI", "Esp3I", "SapI"],
        )

    def test_type_iis_entries_match_server_library(self) -> None:
        """Every Type IIS enzyme in the JSON must agree with server.py on
        recognition site, cut positions, aliases and overhang length.

        A JSON entry with no standalone server.py entry must still be
        alias-represented (e.g. Esp3I lives inside BsmBI's aliases) and must
        share the canonical entry's site and cuts — nothing is skipped."""
        library = server.RESTRICTION_ENZYME_LIBRARY
        for name, entry in self.data["typeIis"].items():
            server_entry = library.get(name)
            if server_entry is None:
                # Alias-represented entries must resolve to a canonical entry
                # that carries the same recognition facts.
                self.assertIn(
                    entry.get("isAliasOf"),
                    library,
                    f"{name}: no entry and no canonical isAliasOf in server.py",
                )
                canonical = library[entry["isAliasOf"]]
                self.assertEqual(
                    canonical["site"], entry["recognitionSite"], f"{name}: alias site"
                )
                self.assertEqual(
                    list(canonical.get("cuts_top") or []),
                    entry.get("cutsTop", []),
                    f"{name}: alias top cuts",
                )
                self.assertEqual(
                    list(canonical.get("cuts_bottom") or []),
                    entry.get("cutsBottom", []),
                    f"{name}: alias bottom cuts",
                )
                self.assertEqual(
                    canonical.get("assembly_overhang_length"),
                    entry.get("overhangLength"),
                    f"{name}: alias overhang length",
                )
                self.assertIn(name, canonical.get("aliases") or [], f"{name}: alias")
                continue
            self.assertEqual(
                server_entry["site"],
                entry["recognitionSite"],
                f"{name}: recognition site differs from enzyme-data.json",
            )
            if entry.get("isAliasOf"):
                # Alias entries map to their canonical enzyme in server.py.
                canonical = server_entry.get("aliases") or []
                self.assertIn(entry["isAliasOf"], canonical, f"{name}: alias mismatch")
            self.assertEqual(
                list(server_entry.get("cuts_top") or []),
                entry.get("cutsTop", []),
                f"{name}: top-strand cuts differ from enzyme-data.json",
            )
            self.assertEqual(
                list(server_entry.get("cuts_bottom") or []),
                entry.get("cutsBottom", []),
                f"{name}: bottom-strand cuts differ from enzyme-data.json",
            )
            self.assertEqual(
                server_entry.get("assembly_overhang_length"),
                entry.get("overhangLength"),
                f"{name}: overhang length differs from enzyme-data.json",
            )

    def test_golden_gate_group_members_have_entries(self) -> None:
        for name in self.data["goldenGateGroup"]:
            self.assertIn(name, self.data["typeIis"], f"{name} missing from typeIis")

    def test_sidecar_recognizes_all_group_members(self) -> None:
        """Every Golden Gate group member must be resolvable in the sidecar
        library — either as a standalone entry or as an alias."""
        sites = server.RESTRICTION_ENZYME_LIBRARY
        for name in self.data["goldenGateGroup"]:
            self.assertTrue(
                name in sites
                or any(name in (e.get("aliases") or []) for e in sites.values()),
                f"{name}: no recognisable entry in the sidecar library",
            )

    def test_common_cloning_group_entries_present(self) -> None:
        library = server.RESTRICTION_ENZYME_LIBRARY
        for name in self.data["commonCloningGroup"]:
            self.assertIn(name, library, f"{name}: missing from server.py library")


if __name__ == "__main__":
    unittest.main()
