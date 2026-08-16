#!/usr/bin/env python3
"""A-SEC-002 regression tests: LLM requests must never place the API key,
prompt, or private sequence into the child process argv."""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402

FAKE_KEY = "AUDIT_FAKE_SECRET_XYZ"
PRIVATE_SEQUENCE = "AUDIT_PRIVATE_SEQUENCE_ACGT"

FAKE_CONFIG = {
    "endpoint": "http://127.0.0.1:9/v1/chat/completions",
    "apiKey": FAKE_KEY,
    "model": "test-model",
    "provider": "test",
    "kind": "chat",
}


class _FakeStdin:
    """Records bytes written by the parent before close."""

    def __init__(self) -> None:
        self.written = b""
        self.closed = False

    def write(self, data: bytes) -> int:
        self.written += data
        return len(data)

    def close(self) -> None:
        self.closed = True


class _FakePipe:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return self._payload


class _FakeProc:
    """Minimal Popen stand-in: exits after the first poll, carries argv/stdin."""

    def __init__(self, stdout_payload: bytes) -> None:
        self.stdin = _FakeStdin()
        self.stdout = _FakePipe(stdout_payload)
        self.stderr = _FakePipe(b"")
        self.killed = False
        self._poll_count = 0

    def poll(self) -> int | None:
        self._poll_count += 1
        return 0 if self._poll_count > 1 else None

    def wait(self) -> int:
        return 0

    def kill(self) -> None:
        self.killed = True


class TestLlmArgvSecurity(unittest.TestCase):
    def _run_completion(self) -> tuple[list[str], bytes]:
        messages = [{"role": "user", "content": f"analyze {PRIVATE_SEQUENCE}"}]
        fake_response = json.dumps(
            {"choices": [{"message": {"content": "ok"}}]}
        ).encode("utf-8")
        captured: dict[str, object] = {}

        def fake_popen(*args: object, **kwargs: object) -> _FakeProc:
            captured["argv"] = args[0]
            captured["proc"] = _FakeProc(b"\x01" + fake_response)
            return captured["proc"]  # type: ignore[return-value]

        with patch("subprocess.Popen", side_effect=fake_popen) as popen:
            result = server._agent_llm_completion_inner(FAKE_CONFIG, messages)
        self.assertEqual(result, "ok")
        proc = captured["proc"]
        self.assertIsInstance(proc, _FakeProc)
        self.assertFalse(proc.killed)
        argv = captured["argv"]  # type: ignore[assignment]
        stdin_data = proc.stdin.written
        return argv, stdin_data

    def test_api_key_never_in_argv(self) -> None:
        argv, _ = self._run_completion()
        argv_text = " ".join(str(a) for a in argv)
        self.assertNotIn(FAKE_KEY, argv_text)

    def test_private_sequence_never_in_argv(self) -> None:
        argv, _ = self._run_completion()
        argv_text = " ".join(str(a) for a in argv)
        self.assertNotIn(PRIVATE_SEQUENCE, argv_text)

    def test_prompt_body_never_in_argv(self) -> None:
        argv, _ = self._run_completion()
        argv_text = " ".join(str(a) for a in argv)
        self.assertNotIn("analyze", argv_text)

    def test_argv_carries_only_script_and_endpoint(self) -> None:
        argv, _ = self._run_completion()
        # [python, -c, child_script, endpoint] — nothing else.
        self.assertEqual(len(argv), 4)
        self.assertEqual(argv[-1], FAKE_CONFIG["endpoint"])
        self.assertTrue(str(argv[0]).endswith("python") or "python" in str(argv[0]))

    def test_key_and_sequence_flow_through_stdin(self) -> None:
        _, stdin_data = self._run_completion()
        payload = json.loads(stdin_data.decode("utf-8"))
        self.assertIn(FAKE_KEY, json.dumps(payload["headers"]))
        self.assertIn(PRIVATE_SEQUENCE, json.dumps(payload["body"]))

    def test_child_receives_serialized_request_body(self) -> None:
        _, stdin_data = self._run_completion()
        payload = json.loads(stdin_data.decode("utf-8"))
        self.assertIsInstance(payload["body"], str)
        request_body = json.loads(payload["body"])
        self.assertEqual(
            request_body["messages"][0]["content"],
            f"analyze {PRIVATE_SEQUENCE}",
        )

    def test_child_script_reads_stdin_not_argv(self) -> None:
        argv, _ = self._run_completion()
        child_script = argv[2]
        self.assertIn("sys.stdin.buffer.read", child_script)
        self.assertNotIn("sys.argv[2]", child_script)
        self.assertNotIn("sys.argv[3]", child_script)


if __name__ == "__main__":
    unittest.main()
