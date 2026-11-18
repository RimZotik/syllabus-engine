"""SQLite storage with ordered, append-only migrations.

Each migration runs once; the applied version is stored in `schema_version`.
To change the schema, append a new entry to MIGRATIONS — never edit an applied one.
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .settings import db_path

MIGRATIONS: list[str] = [
    # 1 — initial schema
    """
    CREATE TABLE topic_progress (
        topic_id    TEXT PRIMARY KEY,
        status      TEXT NOT NULL CHECK (status IN ('started', 'done')),
        page        INTEGER NOT NULL DEFAULT 0,
        seconds     INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE attempt (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        scope       TEXT NOT NULL,              -- topic or section id the test belongs to
        item_id     TEXT NOT NULL,              -- question id
        kind        TEXT NOT NULL,              -- single | multi | open
        answer      TEXT NOT NULL,              -- JSON
        correct     INTEGER,                    -- 1/0, NULL while waiting for the teacher
        confidence  INTEGER,                    -- 1..5, learner's self-rating
        seconds     INTEGER,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX attempt_scope ON attempt(scope);
    CREATE TABLE note (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id    TEXT,
        term_id     TEXT,
        text        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE feedback (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL CHECK (kind IN ('content_issue', 'bug', 'idea', 'question')),
        source      TEXT NOT NULL CHECK (source IN ('learner', 'teacher', 'system')),
        topic_id    TEXT,
        text        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'fixed', 'wontfix')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE event (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        level       TEXT NOT NULL,
        source      TEXT NOT NULL,              -- server | web
        message     TEXT NOT NULL,
        context     TEXT,                       -- JSON
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """,
    # 2 — saved test state and teacher feedback on attempts
    """
    ALTER TABLE attempt ADD COLUMN feedback TEXT;
    CREATE TABLE quiz_state (
        scope       TEXT PRIMARY KEY,
        state       TEXT NOT NULL,              -- JSON: answers, grades, done
        passed      INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """,
    # 3 — feedback remembers the highlighted fragments and the page of the topic
    """
    ALTER TABLE feedback ADD COLUMN quote TEXT;
    ALTER TABLE feedback ADD COLUMN page INTEGER;
    """,
    # 4 — active study time per day and place (topic id, section id for a section test, or 'site')
    """
    CREATE TABLE study_time (
        day      TEXT NOT NULL,              -- local date YYYY-MM-DD
        scope    TEXT NOT NULL,
        seconds  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, scope)
    );
    """,
    # 5 — course backlog triage: which level the fix belongs to and what was done (docs/dev/backlog.md)
    """
    ALTER TABLE feedback ADD COLUMN level TEXT;        -- course | pipeline | platform
    ALTER TABLE feedback ADD COLUMN resolution TEXT;   -- what was changed, or why not
    ALTER TABLE feedback ADD COLUMN resolved_at TEXT;
    """,
]


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


class PerThread:
    """One SQLite connection per server thread (FastAPI runs sync endpoints in a thread pool;
    sharing one connection between threads corrupts concurrent queries)."""

    def __init__(self, path: Path):
        self.path = path
        self._local = threading.local()

    def _conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = self._local.conn = connect(self.path)
        return c

    def execute(self, sql: str, params: tuple | list = ()) -> sqlite3.Cursor:
        return self._conn().execute(sql, params)

    def commit(self) -> None:
        self._conn().commit()

    def rollback(self) -> None:
        self._conn().rollback()


def db_file(conn: sqlite3.Connection) -> Path:
    return Path(conn.execute("PRAGMA database_list").fetchone()[2])


def migrate(conn: sqlite3.Connection) -> int:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    row = conn.execute("SELECT version FROM schema_version").fetchone()
    current = row["version"] if row else 0
    if row is None:
        conn.execute("INSERT INTO schema_version (version) VALUES (0)")
    for version, sql in enumerate(MIGRATIONS[current:], start=current + 1):
        conn.executescript(sql)
        conn.execute("UPDATE schema_version SET version = ?", (version,))
    conn.commit()
    return len(MIGRATIONS)


@contextmanager
def transaction(conn: "sqlite3.Connection | PerThread") -> Iterator["sqlite3.Connection | PerThread"]:
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
