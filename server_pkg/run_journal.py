"""Durable local Agent run journal and content-addressed artifacts.

The Agent runtime keeps a small in-memory projection for low-latency UI updates.
This module is the durable companion: it records run metadata, append-only
events, confirmation state, and structured artifacts in a local SQLite database
under ``PRIMER_DATA_DIR``. Database/file failures are deliberately fail-open for
the design request itself; observability must not make a valid design fail.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
import hashlib
import json
import os
import sqlite3
import sys
import threading
import time

from .config import DATA_DIR


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


class RunJournal:
    """Best-effort durable projection for Agent runs.

    The class owns one SQLite connection because the sidecar is a single local
    process. ``check_same_thread=False`` plus the lock keeps threaded HTTP
    requests serialized without exposing a connection to child processes.
    """

    def __init__(self, db_path: str | Path | None = None, *, enabled: bool | None = None) -> None:
        configured = os.environ.get("GENECODE_RUN_JOURNAL_ENABLED", "1").strip().lower()
        test_process = "unittest" in sys.modules or "pytest" in sys.modules
        self.enabled = enabled if enabled is not None else (
            not test_process and configured not in {"0", "false", "off", "no"}
        )
        self.path = Path(
            db_path
            or os.environ.get("GENECODE_RUN_JOURNAL_PATH")
            or (DATA_DIR / ".runtime-cache" / "agent_runs.db")
        ).expanduser().resolve()
        self.artifact_dir = self.path.parent / "agent-artifacts"
        self._lock = threading.RLock()
        self._connection: sqlite3.Connection | None = None
        self.last_error: str | None = None
        if self.enabled:
            self._initialize()

    def _initialize(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.artifact_dir.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(self.path, timeout=5.0, check_same_thread=False)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_runs (
                    run_id TEXT PRIMARY KEY,
                    mode TEXT NOT NULL DEFAULT '',
                    workspace TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'created',
                    plan_snapshot_hash TEXT NOT NULL DEFAULT '',
                    execute_snapshot_hash TEXT NOT NULL DEFAULT '',
                    record_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_events (
                    run_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    event_type TEXT NOT NULL DEFAULT '',
                    tool TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT '',
                    timestamp REAL NOT NULL,
                    event_json TEXT NOT NULL,
                    PRIMARY KEY (run_id, event_id),
                    UNIQUE (run_id, sequence)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_confirmations (
                    run_id TEXT NOT NULL,
                    confirmation_key TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    confirmation_json TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (run_id, confirmation_key)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_artifacts (
                    run_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    artifact_type TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'available',
                    content_hash TEXT NOT NULL DEFAULT '',
                    byte_size INTEGER NOT NULL DEFAULT 0,
                    relative_path TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    PRIMARY KEY (run_id, artifact_id)
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_agent_runs_updated ON agent_runs(updated_at DESC)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, sequence)")
            connection.commit()
            self._connection = connection
            self.mark_interrupted()
        except Exception as exc:  # pragma: no cover - exercised by read-only/locked environments
            self.last_error = str(exc)
            self.enabled = False
            self._connection = None

    def _conn(self) -> sqlite3.Connection | None:
        return self._connection if self.enabled else None

    def close(self) -> None:
        """Release the local connection on shutdown or after a test."""
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def _write_record(self, record: dict[str, Any]) -> None:
        connection = self._conn()
        run_id = str(record.get("run_id") or "").strip()
        if connection is None or not run_id:
            return
        now = float(record.get("updated_at") or time.time())
        created = float(record.get("created_at") or now)
        try:
            with self._lock, connection:
                connection.execute(
                    """
                    INSERT INTO agent_runs
                      (run_id, mode, workspace, status, plan_snapshot_hash,
                       execute_snapshot_hash, record_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(run_id) DO UPDATE SET
                      mode=excluded.mode,
                      workspace=excluded.workspace,
                      status=excluded.status,
                      plan_snapshot_hash=excluded.plan_snapshot_hash,
                      execute_snapshot_hash=excluded.execute_snapshot_hash,
                      record_json=excluded.record_json,
                      updated_at=excluded.updated_at
                    """,
                    (
                        run_id,
                        str(record.get("mode") or ""),
                        str(record.get("task_type") or record.get("workspace") or ""),
                        str(record.get("status") or "created"),
                        str(record.get("plan_snapshot_hash") or ""),
                        str(record.get("execute_snapshot_hash") or ""),
                        _json(record),
                        created,
                        now,
                    ),
                )
        except Exception as exc:  # pragma: no cover - best effort persistence
            self.last_error = str(exc)

    def create_run(self, record: dict[str, Any]) -> None:
        self._write_record(record)

    def update_record(self, record: dict[str, Any]) -> None:
        self._write_record(record)

    def update_status(self, run_id: str, status: str, *, updated_at: float | None = None) -> None:
        connection = self._conn()
        if connection is None or not run_id:
            return
        now = updated_at or time.time()
        try:
            with self._lock, connection:
                record = self.load_run(run_id)
                if record is not None:
                    record.update(status=status, updated_at=now)
                    self._write_record(record)
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)

    def append_event(self, event: dict[str, Any]) -> None:
        connection = self._conn()
        run_id = str(event.get("run_id") or "").strip()
        event_id = str(event.get("event_id") or "").strip()
        if connection is None or not run_id or not event_id:
            return
        try:
            with self._lock, connection:
                row = connection.execute(
                    "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM agent_events WHERE run_id = ?",
                    (run_id,),
                ).fetchone()
                sequence = int(row["next_sequence"] if row is not None else 1)
                connection.execute(
                    """
                    INSERT OR IGNORE INTO agent_events
                      (run_id, event_id, sequence, event_type, tool, status, timestamp, event_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        event_id,
                        sequence,
                        str(event.get("type") or ""),
                        str(event.get("tool") or ""),
                        str(event.get("status") or ""),
                        float(event.get("timestamp") or time.time()),
                        _json(event),
                    ),
                )
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)

    def persist_confirmations(self, run_id: str, confirmations: list[dict[str, Any]]) -> None:
        connection = self._conn()
        if connection is None or not run_id:
            return
        now = time.time()
        try:
            with self._lock, connection:
                for confirmation in confirmations:
                    key = str(confirmation.get("key") or confirmation.get("label") or "").strip()
                    if not key:
                        continue
                    connection.execute(
                        """
                        INSERT INTO agent_confirmations (run_id, confirmation_key, status, confirmation_json, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(run_id, confirmation_key) DO UPDATE SET
                          status=excluded.status,
                          confirmation_json=excluded.confirmation_json,
                          updated_at=excluded.updated_at
                        """,
                        (run_id, key, str(confirmation.get("status") or "pending"), _json(confirmation), now),
                    )
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)

    def persist_artifacts(self, run_id: str, artifacts: list[dict[str, Any]]) -> None:
        connection = self._conn()
        if connection is None or not run_id:
            return
        now = time.time()
        try:
            with self._lock:
                for artifact in artifacts:
                    artifact_id = str(artifact.get("artifact_id") or artifact.get("artifactId") or "").strip()
                    if not artifact_id:
                        continue
                    raw = _json(artifact).encode("utf-8")
                    content_hash = "sha256:" + hashlib.sha256(raw).hexdigest()
                    filename = f"{content_hash.split(':', 1)[1]}.json"
                    target = self.artifact_dir / filename
                    if not target.exists():
                        temporary = self.artifact_dir / f".{filename}.{os.getpid()}.tmp"
                        temporary.write_bytes(raw)
                        os.replace(temporary, target)
                    metadata = {key: value for key, value in artifact.items() if key != "data"}
                    relative_path = str(target.relative_to(self.path.parent))
                    with connection:
                        connection.execute(
                            """
                            INSERT INTO agent_artifacts
                              (run_id, artifact_id, artifact_type, status, content_hash,
                               byte_size, relative_path, metadata_json, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(run_id, artifact_id) DO UPDATE SET
                              artifact_type=excluded.artifact_type,
                              status=excluded.status,
                              content_hash=excluded.content_hash,
                              byte_size=excluded.byte_size,
                              relative_path=excluded.relative_path,
                              metadata_json=excluded.metadata_json
                            """,
                            (
                                run_id,
                                artifact_id,
                                str(artifact.get("type") or ""),
                                str(artifact.get("status") or "available"),
                                content_hash,
                                len(raw),
                                relative_path,
                                _json(metadata),
                                float(artifact.get("created_at") or now),
                            ),
                        )
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)

    def load_run(self, run_id: str) -> dict[str, Any] | None:
        connection = self._conn()
        if connection is None or not run_id:
            return None
        try:
            with self._lock:
                row = connection.execute("SELECT record_json FROM agent_runs WHERE run_id = ?", (run_id,)).fetchone()
                if row is None:
                    return None
                record = json.loads(str(row["record_json"]))
                if not isinstance(record, dict):
                    return None
                events: list[dict[str, Any]] = []
                for event_row in connection.execute(
                    "SELECT event_json FROM agent_events WHERE run_id = ? ORDER BY sequence ASC",
                    (run_id,),
                ):
                    try:
                        event = json.loads(str(event_row["event_json"]))
                    except (TypeError, ValueError):
                        continue
                    if isinstance(event, dict):
                        events.append(event)
                record["events"] = events
                record["workspace"] = str(record.get("workspace") or record.get("task_type") or "")
                artifacts: list[dict[str, Any]] = []
                for artifact_row in connection.execute(
                    "SELECT artifact_id, artifact_type, status, content_hash, byte_size, metadata_json, created_at FROM agent_artifacts WHERE run_id = ? ORDER BY created_at ASC",
                    (run_id,),
                ):
                    try:
                        metadata = json.loads(str(artifact_row["metadata_json"]))
                    except (TypeError, ValueError):
                        metadata = {}
                    if not isinstance(metadata, dict):
                        metadata = {}
                    artifacts.append({
                        **metadata,
                        "artifact_id": str(artifact_row["artifact_id"]),
                        "type": str(artifact_row["artifact_type"]),
                        "status": str(artifact_row["status"]),
                        "content_hash": str(artifact_row["content_hash"]),
                        "byte_size": int(artifact_row["byte_size"]),
                        "created_at": float(artifact_row["created_at"]),
                    })
                if artifacts:
                    record["artifacts"] = artifacts
                return record
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)
            return None

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        connection = self._conn()
        if connection is None:
            return []
        bounded = max(1, min(int(limit), 200))
        try:
            with self._lock:
                rows = connection.execute(
                    "SELECT run_id FROM agent_runs ORDER BY updated_at DESC LIMIT ?",
                    (bounded,),
                ).fetchall()
                records: list[dict[str, Any]] = []
                for row in rows:
                    value = self.load_run(str(row["run_id"]))
                    if value is not None:
                        records.append(value)
                return records
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)
            return []

    def get_artifact(
        self,
        run_id: str,
        artifact_id: str,
        *,
        include_data: bool = True,
        max_bytes: int = 2_000_000,
    ) -> dict[str, Any] | None:
        connection = self._conn()
        if connection is None or not run_id or not artifact_id:
            return None
        try:
            with self._lock:
                row = connection.execute(
                    "SELECT metadata_json, relative_path, content_hash, byte_size FROM agent_artifacts WHERE run_id = ? AND artifact_id = ?",
                    (run_id, artifact_id),
                ).fetchone()
                if row is None:
                    return None
                metadata = json.loads(str(row["metadata_json"]))
                if not isinstance(metadata, dict):
                    metadata = {}
                target = self.path.parent / str(row["relative_path"])
                bounded_bytes = max(1_024, min(int(max_bytes), 8_000_000))
                if include_data and target.is_file():
                    try:
                        raw = target.read_bytes()
                        if len(raw) > bounded_bytes:
                            metadata["dataPreview"] = raw[:bounded_bytes].decode("utf-8", errors="replace")
                            metadata["dataTruncated"] = True
                        else:
                            stored = json.loads(raw.decode("utf-8"))
                            if isinstance(stored, dict) and "data" in stored:
                                metadata["data"] = stored["data"]
                    except (OSError, ValueError):
                        pass
                return {
                    **metadata,
                    "artifact_id": artifact_id,
                    "content_hash": str(row["content_hash"]),
                    "byte_size": int(row["byte_size"]),
                }
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)
            return None

    def mark_interrupted(self) -> None:
        connection = self._conn()
        if connection is None:
            return
        active_statuses = ("created", "planning", "executing", "reviewing")
        now = time.time()
        try:
            with self._lock, connection:
                rows = connection.execute(
                    "SELECT run_id, record_json FROM agent_runs WHERE status IN (?, ?, ?, ?)",
                    active_statuses,
                ).fetchall()
                for row in rows:
                    run_id = str(row["run_id"])
                    try:
                        record = json.loads(str(row["record_json"]))
                    except (TypeError, ValueError):
                        record = {}
                    if not isinstance(record, dict):
                        record = {}
                    record["status"] = "interrupted"
                    record["updated_at"] = now
                    connection.execute(
                        "UPDATE agent_runs SET status = 'interrupted', record_json = ?, updated_at = ? WHERE run_id = ?",
                        (_json(record), now, run_id),
                    )
        except Exception as exc:  # pragma: no cover
            self.last_error = str(exc)
