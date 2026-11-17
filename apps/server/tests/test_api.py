from fastapi.testclient import TestClient

from forge_server.app import create_app
from forge_server.db import MIGRATIONS, connect, migrate


def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("FORGE_DATA_DIR", str(tmp_path))
    return TestClient(create_app(connect(tmp_path / "t.sqlite3")))


def test_program_has_all_courses(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch)
    p = c.get("/api/program").json()
    assert [x["id"] for x in p["courses"]] == ["0", "I", "II", "III", "IV", "V", "VI"]
    first = p["courses"][0]["disciplines"][0]["sections"][0]["topics"][0]
    assert first["id"] == "intro1.what.1"


def test_progress_is_sticky_and_accumulates_time(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch)
    tid = "intro1.what.1"
    assert c.put(f"/api/progress/{tid}", json={"status": "started", "page": 1, "seconds": 30}).status_code == 200
    c.put(f"/api/progress/{tid}", json={"status": "done", "page": 3, "seconds": 20})
    # a later "started" (e.g. re-reading) must not undo "done"
    r = c.put(f"/api/progress/{tid}", json={"status": "started", "page": 0, "seconds": 10}).json()
    assert r == {"topic_id": tid, "status": "done", "page": 0, "seconds": 60}
    assert c.get("/api/progress").json()[tid]["status"] == "done"


def test_unknown_topic_rejected(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch)
    assert c.put("/api/progress/nope.1", json={"status": "started"}).status_code == 404


def test_attempts_feedback_notes_and_log(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch)
    items = [{"scope": "intro1.what.1", "item_id": "q1", "kind": "single", "answer": 2, "correct": True, "confidence": 4},
             {"scope": "intro1.what.1", "item_id": "q9", "kind": "open", "answer": "текст"}]
    assert c.post("/api/attempts", json=items).json() == {"saved": 2}
    got = c.get("/api/attempts", params={"scope": "intro1.what.1"}).json()
    assert got[1]["correct"] is None and got[1]["answer"] == "текст"

    assert c.post("/api/feedback", json={"kind": "content_issue", "source": "teacher", "topic_id": "intro1.what.1", "text": "Неясный пример"}).status_code == 200
    assert c.post("/api/feedback", json={"kind": "nonsense", "text": "x"}).status_code == 422
    assert len(c.get("/api/feedback").json()) == 1

    c.post("/api/notes", json={"term_id": "model", "text": "моя заметка"})
    assert c.get("/api/notes", params={"term_id": "model"}).json()[0]["text"] == "моя заметка"
    assert c.post("/api/log", json={"message": "boom", "context": {"page": 2}}).json() == {"ok": True}


def test_migrations_idempotent(tmp_path):
    db = connect(tmp_path / "m.sqlite3")
    assert migrate(db) == len(MIGRATIONS)
    assert migrate(db) == len(MIGRATIONS)
    assert db.execute("SELECT version FROM schema_version").fetchone()[0] == len(MIGRATIONS)
