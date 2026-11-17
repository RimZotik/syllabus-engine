"""HTTP API of the platform. The web app talks only to these endpoints."""

import json
import logging
import logging.handlers
import sqlite3
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import claude
from .db import connect, migrate, transaction
from .program import load_program, topic_ids
from .settings import data_dir


def _logger() -> logging.Logger:
    log = logging.getLogger("forge")
    if not log.handlers:
        handler = logging.handlers.RotatingFileHandler(data_dir() / "logs" / "server.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
    return log


def create_app(conn: "sqlite3.Connection | None" = None) -> FastAPI:
    db = conn or connect()
    migrate(db)
    log = _logger()
    app = FastAPI(title="Forge ML", version="0.1.0")

    def record_event(level: str, source: str, message: str, context: Any = None) -> None:
        with transaction(db):
            db.execute("INSERT INTO event (level, source, message, context) VALUES (?, ?, ?, ?)",
                       (level, source, message, json.dumps(context, ensure_ascii=False) if context is not None else None))

    @app.exception_handler(Exception)
    async def on_error(request: Request, exc: Exception):  # every server error lands in the log and the event table
        log.exception("unhandled error on %s", request.url.path)
        record_event("error", "server", f"{type(exc).__name__}: {exc}", {"path": request.url.path})
        return JSONResponse({"detail": "Внутренняя ошибка сервера — она записана в журнал."}, status_code=500)

    # ── program ─────────────────────────────────────────────
    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/api/program")
    def program() -> dict:
        return load_program()

    @app.get("/api/claude/status")
    def claude_status() -> dict:
        return claude.status()

    # ── progress ────────────────────────────────────────────
    class ProgressIn(BaseModel):
        status: Literal["started", "done"]
        page: int = Field(0, ge=0)
        seconds: int = Field(0, ge=0)

    @app.get("/api/progress")
    def progress() -> dict:
        rows = db.execute("SELECT topic_id, status, page, seconds FROM topic_progress").fetchall()
        return {r["topic_id"]: {"status": r["status"], "page": r["page"], "seconds": r["seconds"]} for r in rows}

    @app.put("/api/progress/{topic_id}")
    def set_progress(topic_id: str, body: ProgressIn) -> dict:
        if topic_id not in set(topic_ids(load_program())):
            raise HTTPException(404, "Нет такой темы в учебном плане")
        with transaction(db):
            row = db.execute("SELECT status, seconds FROM topic_progress WHERE topic_id = ?", (topic_id,)).fetchone()
            status = "done" if (row and row["status"] == "done") or body.status == "done" else "started"
            seconds = (row["seconds"] if row else 0) + body.seconds
            db.execute(
                "INSERT INTO topic_progress (topic_id, status, page, seconds) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(topic_id) DO UPDATE SET status = excluded.status, page = excluded.page, "
                "seconds = excluded.seconds, updated_at = datetime('now')",
                (topic_id, status, body.page, seconds))
        return {"topic_id": topic_id, "status": status, "page": body.page, "seconds": seconds}

    # ── attempts (tests) ────────────────────────────────────
    class AttemptIn(BaseModel):
        scope: str
        item_id: str
        kind: Literal["single", "multi", "open"]
        answer: Any
        correct: bool | None = None
        confidence: int | None = Field(None, ge=1, le=5)
        seconds: int | None = Field(None, ge=0)

    @app.post("/api/attempts")
    def add_attempts(items: list[AttemptIn]) -> dict:
        with transaction(db):
            for a in items:
                db.execute(
                    "INSERT INTO attempt (scope, item_id, kind, answer, correct, confidence, seconds) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (a.scope, a.item_id, a.kind, json.dumps(a.answer, ensure_ascii=False),
                     None if a.correct is None else int(a.correct), a.confidence, a.seconds))
        return {"saved": len(items)}

    @app.get("/api/attempts")
    def attempts(scope: str) -> list[dict]:
        rows = db.execute("SELECT item_id, kind, answer, correct, confidence, created_at FROM attempt WHERE scope = ? ORDER BY id", (scope,)).fetchall()
        return [dict(r) | {"answer": json.loads(r["answer"])} for r in rows]

    # ── notes ───────────────────────────────────────────────
    class NoteIn(BaseModel):
        topic_id: str | None = None
        term_id: str | None = None
        text: str = Field(min_length=1, max_length=5000)

    @app.get("/api/notes")
    def notes(topic_id: str | None = None, term_id: str | None = None) -> list[dict]:
        q, args = "SELECT id, topic_id, term_id, text, created_at FROM note WHERE 1=1", []
        if topic_id:
            q += " AND topic_id = ?"; args.append(topic_id)
        if term_id:
            q += " AND term_id = ?"; args.append(term_id)
        return [dict(r) for r in db.execute(q + " ORDER BY id DESC", args).fetchall()]

    @app.post("/api/notes")
    def add_note(body: NoteIn) -> dict:
        with transaction(db):
            cur = db.execute("INSERT INTO note (topic_id, term_id, text) VALUES (?, ?, ?)", (body.topic_id, body.term_id, body.text))
        return {"id": cur.lastrowid}

    # ── course feedback: learner, teacher and system report problems with the COURSE itself ──
    class FeedbackIn(BaseModel):
        kind: Literal["content_issue", "bug", "idea", "question"]
        source: Literal["learner", "teacher", "system"] = "learner"
        topic_id: str | None = None
        text: str = Field(min_length=1, max_length=5000)

    @app.post("/api/feedback")
    def add_feedback(body: FeedbackIn) -> dict:
        with transaction(db):
            cur = db.execute("INSERT INTO feedback (kind, source, topic_id, text) VALUES (?, ?, ?, ?)",
                             (body.kind, body.source, body.topic_id, body.text))
        log.info("feedback %s from %s on %s", body.kind, body.source, body.topic_id)
        return {"id": cur.lastrowid}

    @app.get("/api/feedback")
    def feedback(status: str = "open") -> list[dict]:
        return [dict(r) for r in db.execute("SELECT * FROM feedback WHERE status = ? ORDER BY id", (status,)).fetchall()]

    # ── client-side errors ──────────────────────────────────
    class ClientLog(BaseModel):
        level: Literal["error", "warn", "info"] = "error"
        message: str = Field(max_length=4000)
        context: dict | None = None

    @app.post("/api/log")
    def client_log(body: ClientLog) -> dict:
        record_event(body.level, "web", body.message, body.context)
        log.log(logging.ERROR if body.level == "error" else logging.INFO, "web: %s", body.message)
        return {"ok": True}

    return app


app = create_app()
