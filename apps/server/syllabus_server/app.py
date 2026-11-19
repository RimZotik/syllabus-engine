"""HTTP API of the platform. The web app talks only to these endpoints."""

import json
import os
import threading
import logging
import logging.handlers
import sqlite3
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import claude, grader
from .db import PerThread, connect, db_file, migrate, transaction
from .program import check_context, lesson_material, load_package, load_program, topic_ids
from .settings import PackageError, active_package, current_package, data_dir, db_path, installed_packages, package_dir, use_package


class PackageDB:
    """The learner database of the package the current request is about. Each package has its own
    file (<data_dir>/<package>.sqlite3), opened and migrated on first use."""

    def __init__(self, default_pkg: str, default_db: PerThread):
        self._dbs = {default_pkg: default_db}
        self._lock = threading.Lock()

    def _db(self) -> PerThread:
        pkg = current_package()
        db = self._dbs.get(pkg)
        if db is None:
            with self._lock:
                db = self._dbs.get(pkg)
                if db is None:
                    first = connect(db_path(pkg))
                    migrate(first)
                    db = self._dbs[pkg] = PerThread(db_file(first))
        return db

    def execute(self, sql: str, params: tuple | list = ()) -> sqlite3.Cursor:
        return self._db().execute(sql, params)

    def commit(self) -> None:
        self._db().commit()

    def rollback(self) -> None:
        self._db().rollback()


def _logger() -> logging.Logger:
    log = logging.getLogger("syllabus")
    if not log.handlers:
        handler = logging.handlers.RotatingFileHandler(data_dir() / "logs" / "server.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
    return log


def create_app(conn: "sqlite3.Connection | None" = None) -> FastAPI:
    first = conn or connect()
    migrate(first)
    db = PackageDB(active_package(), PerThread(db_file(first)))
    log = _logger()
    app = FastAPI(title="Syllabus Engine", version="0.1.0")

    @app.middleware("http")
    async def package_of_request(request: Request, call_next):
        """X-Syllabus-Package (or ?package=) names the package; without it — the default one."""
        pkg = request.headers.get("x-syllabus-package") or request.query_params.get("package")
        if pkg and pkg not in installed_packages():
            return JSONResponse({"detail": f"Обучение «{pkg}» не установлено"}, status_code=404)
        token = use_package(pkg)
        try:
            return await call_next(request)
        finally:
            from .settings import _current
            _current.reset(token)

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

    @app.get("/api/package")
    def package() -> dict:
        return load_package()

    @app.get("/api/packages")
    def packages() -> dict:
        """Catalog: every installed package's passport, and which one opens by default."""
        items = []
        for p in installed_packages():
            try:
                items.append(load_package(p))
            except (PackageError, OSError, ValueError) as e:  # a broken package must not hide the others
                log.warning("package %s skipped: %s", p, e)
        return {"default": active_package(), "packages": items}

    @app.get("/api/program")
    def program() -> dict:
        return load_program()

    @app.get("/api/exams/active")
    def active_exams() -> list[dict]:
        """Section tests (контрольные) with an attempt in progress, in every installed package: while one runs,
        the other packages are closed too, as at a real exam."""
        import yaml
        from .settings import _current
        out = []
        for p in installed_packages():
            token = use_package(p)
            try:
                for scope, state in db.execute("SELECT scope, state FROM quiz_state WHERE scope NOT LIKE 'task:%'").fetchall():
                    parts = scope.split(".")
                    test = package_dir(p) / "lessons" / parts[0] / parts[-1] / "test.yaml" if len(parts) == 2 else None
                    if not test or not test.exists():
                        continue
                    try:
                        s = json.loads(state or "{}")
                        questions = (yaml.safe_load(test.read_text(encoding="utf-8")) or {}).get("questions") or []
                    except (ValueError, yaml.YAMLError):
                        continue
                    answers = s.get("answers") or {}
                    started = s.get("started") if s.get("started") is not None else any(v not in (None, "") for v in answers.values())
                    # an attempt saved for an older version of the test is not resumed by the page, so it does not lock
                    same = sorted(o.get("id") for o in (s.get("order") or [])) == sorted(q.get("id") for q in questions)
                    if started and not s.get("done") and same:
                        out.append({"package": p, "section": scope})
            finally:
                _current.reset(token)
        return out

    # Warm the Claude check (and read the subscription limits) in the background,
    # so the first page load does not wait for `claude --version`.
    def warm() -> None:
        if claude.status()["installed"] and (os.environ.get("SYLLABUS_NO_LIMITS_PROBE") or os.environ.get("FORGE_NO_LIMITS_PROBE")) != "1":
            claude.refresh_limits()
    threading.Thread(target=warm, daemon=True).start()

    @app.get("/api/claude/status")
    def claude_status() -> dict:
        return claude.status()

    @app.post("/api/claude/limits/refresh")
    def claude_limits_refresh() -> dict:
        """Re-read limits with a tiny call, unless they are under 5 minutes old."""
        if claude.status()["installed"]:
            claude.refresh_limits()
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
        kind: Literal["single", "multi", "open", "fields", "code", "exercise"]  # exercise — a package's own trainer (@syllabus/sdk)
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
        rows = db.execute("SELECT item_id, kind, answer, correct, confidence, feedback, created_at FROM attempt WHERE scope = ? ORDER BY id", (scope,)).fetchall()
        return [dict(r) | {"answer": json.loads(r["answer"]), "feedback": json.loads(r["feedback"]) if r["feedback"] else None} for r in rows]

    # ── teacher check of written answers ────────────────────
    class GradeIn(BaseModel):
        scope: str
        item_id: str
        question: str
        rubric: list[str]
        wrong_answers: list[str] = []
        answer: str = Field(min_length=1, max_length=20000)
        confidence: int | None = Field(None, ge=1, le=5)

    @app.post("/api/grade")
    def grade(body: GradeIn) -> dict:
        # earlier checks of this answer (a check annulled by the teaching audit is not the learner's attempt):
        # the teacher compares the new version with them and with its own earlier remarks
        # An annulled check (the teaching audit found the teacher wrong) is not counted as an attempt and its remarks are dropped,
        # but the learner's answer stays in the history: the understanding shown there still counts.
        past = db.execute("SELECT answer, feedback FROM attempt WHERE scope = ? AND item_id = ? AND kind = 'open' ORDER BY id",
                          (body.scope, body.item_id)).fetchall()
        history = []
        for r in past:
            fb = json.loads(r["feedback"]) if r["feedback"] else {}
            if fb.get("annulled"):
                history.append({"answer": json.loads(r["answer"]), "verdict": None, "feedback": "(отзыв отменён как ошибочный — не опирайся на него)", "fixes": ""})
            else:
                history.append({"answer": json.loads(r["answer"]), "verdict": fb.get("verdict"), "feedback": fb.get("feedback", ""), "fixes": fb.get("fixes", "")})
        n = sum(1 for r in past if not (json.loads(r["feedback"]) if r["feedback"] else {}).get("annulled")) + 1
        ctx = check_context(load_program(), body.scope)
        if ctx:
            ctx["lesson"] = lesson_material(package_dir(current_package()), ctx, body.scope)
        try:
            t = load_package()["teacher"]
            result = grader.grade(body.question, body.rubric, body.wrong_answers, body.answer, n, course=t["course"], role=t["role"], style=t["style"],
                                  history=history, context=ctx)
        except grader.GraderUnavailable as e:
            record_event("warn", "server", f"grader unavailable: {e}", {"scope": body.scope, "item": body.item_id})
            raise HTTPException(503, str(e))
        with transaction(db):
            db.execute("INSERT INTO attempt (scope, item_id, kind, answer, correct, confidence, feedback) VALUES (?, ?, 'open', ?, ?, ?, ?)",
                       (body.scope, body.item_id, json.dumps(body.answer, ensure_ascii=False), int(result["verdict"] == "pass"),
                        body.confidence, json.dumps(result, ensure_ascii=False)))
            issue = (result.pop("content_issue", None) or "").strip()
            if issue:  # the teacher found a flaw in the question itself: into the course backlog, not to the learner
                db.execute("INSERT INTO feedback (kind, source, topic_id, text, quote) VALUES ('content_issue', 'teacher', ?, ?, ?)",
                           (body.scope, f"[{body.item_id}] {issue}", body.question))
        return result | {"attempt": n}

    # ── saved test state (so a finished test stays finished after reload) ──
    class QuizStateIn(BaseModel):
        state: dict
        passed: bool = False

    @app.get("/api/quiz-state/{scope}")
    def quiz_state(scope: str) -> dict:
        row = db.execute("SELECT state, passed FROM quiz_state WHERE scope = ?", (scope,)).fetchone()
        return {"state": json.loads(row["state"]), "passed": bool(row["passed"])} if row else {"state": None, "passed": False}

    @app.put("/api/quiz-state/{scope}")
    def save_quiz_state(scope: str, body: QuizStateIn) -> dict:
        with transaction(db):
            db.execute("INSERT INTO quiz_state (scope, state, passed) VALUES (?, ?, ?) ON CONFLICT(scope) DO UPDATE SET "
                       "state = excluded.state, passed = MAX(quiz_state.passed, excluded.passed), updated_at = datetime('now')",
                       (scope, json.dumps(body.state, ensure_ascii=False), int(body.passed)))
        return {"ok": True}

    # ── study time (heartbeats from the open tab while the learner is active) ──
    class TimeIn(BaseModel):
        scope: str = Field(min_length=1, max_length=200)
        seconds: int = Field(ge=1, le=120)

    @app.post("/api/time")
    def add_time(body: TimeIn) -> dict:
        with transaction(db):
            db.execute("INSERT INTO study_time (day, scope, seconds) VALUES (date('now', 'localtime'), ?, ?) "
                       "ON CONFLICT(day, scope) DO UPDATE SET seconds = seconds + excluded.seconds", (body.scope, body.seconds))
        return {"ok": True}

    @app.get("/api/time")
    def time_stats() -> dict:
        """Totals for the record book. Topic time also includes the older page-turn estimate in topic_progress."""
        by_scope: dict[str, int] = {r["scope"]: r["s"] for r in db.execute("SELECT scope, SUM(seconds) AS s FROM study_time GROUP BY scope")}
        legacy = {r["topic_id"]: r["seconds"] for r in db.execute("SELECT topic_id, seconds FROM topic_progress WHERE seconds > 0")}
        for k, v in legacy.items():
            by_scope[k] = by_scope.get(k, 0) + v
        days = [{"day": r["day"], "seconds": r["s"]} for r in db.execute(
            "SELECT day, SUM(seconds) AS s FROM study_time WHERE day >= date('now', 'localtime', '-29 days') GROUP BY day ORDER BY day")]
        today = db.execute("SELECT COALESCE(SUM(seconds), 0) FROM study_time WHERE day = date('now', 'localtime')").fetchone()[0]
        week = db.execute("SELECT COALESCE(SUM(seconds), 0) FROM study_time WHERE day >= date('now', 'localtime', '-6 days')").fetchone()[0]
        return {"total": sum(by_scope.values()), "today": today, "week": week, "days": days, "by_scope": by_scope}

    @app.get("/api/results")
    def results() -> dict:
        """Per test (topic or section): passed flag and the last score — for the record book."""
        out = {}
        for r in db.execute("SELECT scope, state, passed, updated_at FROM quiz_state WHERE scope NOT LIKE 'task:%'"):
            st = json.loads(r["state"])
            out[r["scope"]] = {"passed": bool(r["passed"]), "score": st.get("score"), "done": bool(st.get("done")), "updated_at": r["updated_at"]}
        return out

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
        quote: str | None = Field(None, max_length=10000)   # fragments the learner highlighted
        page: int | None = Field(None, ge=0)

    @app.post("/api/feedback")
    def add_feedback(body: FeedbackIn) -> dict:
        with transaction(db):
            cur = db.execute("INSERT INTO feedback (kind, source, topic_id, text, quote, page) VALUES (?, ?, ?, ?, ?, ?)",
                             (body.kind, body.source, body.topic_id, body.text, body.quote, body.page))
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

    # A packaged app serves the built web pages itself (no Vite): every address that is not an API call
    # and not a file of the build gets index.html, and the web app routes it.
    web = os.environ.get("SYLLABUS_WEB_DIST")
    if web and os.path.isdir(web):
        from pathlib import Path
        from fastapi.responses import FileResponse
        dist = Path(web).resolve()

        @app.get("/{path:path}", include_in_schema=False)
        def web_page(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            f = (dist / path).resolve()
            if path and f.is_file() and dist in f.parents:
                return FileResponse(f)
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    return app


def __getattr__(name: str):
    """`syllabus_server.app:app` for uvicorn, created on first access — importing this module
    (e.g. in tests) never opens the learner database by itself."""
    if name == "app":
        globals()["app"] = instance = create_app()
        return instance
    raise AttributeError(name)
