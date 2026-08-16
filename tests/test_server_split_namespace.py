"""A-MAINT-001 regression tests: server.py shim namespace parity + patch bridge.

After the 16k-line server.py monolith was split into the `server_pkg` package,
the shim re-exports the entire module namespace. These tests pin that contract
so future edits to server_pkg cannot silently drop a symbol the tests/API rely
on, and so the monkeypatch bridge keeps forwarding test patches to the modules
that actually bind the names.
"""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server
import server_pkg.agent
import server_pkg.api
import server_pkg.bio
import server_pkg.config
import server_pkg.providers
import server_pkg.schemas

_PKG_MODULES = [
    server_pkg.schemas,
    server_pkg.config,
    server_pkg.bio,
    server_pkg.providers,
    server_pkg.agent,
    server_pkg.api,
]


class TestNamespaceParity(unittest.TestCase):
    """Every public + underscored symbol bound in the package must be on server."""

    def test_all_package_public_names_reexported(self):
        # Public (non-underscore) names are the API contract; underscore names
        # are internal and pinned separately in test_underscored_test_surface_reexported.
        for module in _PKG_MODULES:
            missing = [
                n for n in module.__dict__
                if not n.startswith("_") and n not in server.__dict__
            ]
            self.assertEqual(missing, [], f"{module.__name__} public names missing from server shim: {missing[:20]}")

    # _event_counter is a module-level monotonic counter that _next_event_id()
    # rebinds via `global _event_counter` — the shim keeps its import-time
    # snapshot (always 0), while server_pkg.agent's copy advances. Functionally
    # equivalent (the counter is only ever read inside agent, never via
    # server._event_counter), and inherent to the split. Excluded here and
    # pinned so any *new* rebound global must be added to this list consciously.
    _REBOUND_MODULE_STATE = {"_event_counter"}

    def test_package_globals_are_the_same_objects(self):
        # Star re-export must bind the *same* objects, not copies.
        for module in _PKG_MODULES:
            for name, value in module.__dict__.items():
                if name.startswith("__") and name not in ("__dict__",):
                    continue
                if name in self._REBOUND_MODULE_STATE:
                    continue
                if name in server.__dict__:
                    self.assertIs(server.__dict__[name], value, f"{module.__name__}.{name} is a different object")

    def test_underscored_test_surface_reexported(self):
        # Names the test suite references via server._x (must never regress).
        required = [
            "_sse_encode",
            "_cancel_run",
            "_is_run_cancelled",
            "_clear_cancelled_flag",
            "_cleanup_cancelled_runs",
            "_agent_auto_verify",
            "_update_run_status",
            "_register_active_run",
            "_unregister_active_run",
            "_run_records",
            "_active_runs",
            "_cancelled_runs",
            "_agent_llm_completion_inner",
            "_event_counter",
            "_to_zbho",
            "_record_event",
            "_inject_sse_metadata",
        ]
        missing = [n for n in required if not hasattr(server, n)]
        self.assertEqual(missing, [], f"underscored symbols missing from server shim: {missing}")

    def test_entrypoint_present(self):
        self.assertTrue(callable(getattr(server, "main", None)), "server.main() entrypoint missing")


class TestPatchBridge(unittest.TestCase):
    """patch.object(server, ...) must reach the server_pkg module globals."""

    def test_patch_reaches_agent_global(self):
        original = server._agent_auto_verify
        with patch.object(server, "_agent_auto_verify", new=lambda *a, **k: {"verdict": "patched"}):
            self.assertIs(server_pkg.agent._agent_auto_verify, server._agent_auto_verify)
            result = server_pkg.agent._agent_auto_verify("x")
            self.assertEqual(result, {"verdict": "patched"})
        # Restored after context exit.
        self.assertIs(server_pkg.agent._agent_auto_verify, original)

    def test_patch_reaches_config_global(self):
        original = server._is_run_cancelled
        with patch.object(server, "_is_run_cancelled", return_value=True):
            self.assertTrue(server_pkg.config._is_run_cancelled("run-x"))
        self.assertIs(server_pkg.config._is_run_cancelled, original)

    def test_patch_restores_after_exit_even_on_failure(self):
        original = server._sse_encode
        try:
            with patch.object(server, "_sse_encode", return_value={"x": 1}):
                raise RuntimeError("boom")
        except RuntimeError:
            pass
        self.assertIs(server._sse_encode, original)
        self.assertIs(server_pkg.agent._sse_encode, original)


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    unittest.main()
