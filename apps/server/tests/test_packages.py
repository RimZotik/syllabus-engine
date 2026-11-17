"""Learning packages: choosing the active one, its passport, per-package learner data, the validator."""
import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from syllabus_server import settings
from syllabus_server.app import create_app
from syllabus_server.db import connect
from syllabus_server.program import load_package, load_program

ROOT = Path(__file__).resolve().parents[3]

PROGRAM = """
program:
  title: Рисование
  levels:
    - {id: course, title: Курс, gate: Итоговая работа}
    - {id: topic, title: Тема, gate: Проверка темы}
subjects:
  - {id: draw, title: Рисунок}
courses:
- id: I
  title: Основы
  tagline: Линия и форма
  disciplines:
  - id: draw1
    subject: draw
    level: 1
    title: Линия
    hours: 4
    summary: Как держать карандаш и строить простые формы.
    sections:
    - id: draw1.line
      title: Линия
      topics: [Прямая и кривая, Штриховка]
"""


def make_package(root: Path, pkg: str = "drawing", package_yaml: str | None = None, rules: str = "") -> Path:
    d = root / pkg
    d.mkdir(parents=True)
    (d / "package.yaml").write_text(package_yaml or f"id: {pkg}\ntitle: Рисование с нуля\n{rules}", encoding="utf-8")
    (d / "program.yaml").write_text(PROGRAM, encoding="utf-8")
    (d / "glossary.yaml").write_text("- id: line\n  term: линия\n  short: След движения карандаша.\n", encoding="utf-8")
    return d


@pytest.fixture
def content(tmp_path, monkeypatch):
    """An isolated content/ folder with one package and its own syllabus.yaml."""
    croot = tmp_path / "content"
    make_package(croot)
    cfg = tmp_path / "syllabus.yaml"
    cfg.write_text("active: drawing\n", encoding="utf-8")
    monkeypatch.setattr(settings, "CONTENT_ROOT", croot)
    monkeypatch.setattr(settings, "CONFIG_FILE", cfg)
    monkeypatch.delenv("SYLLABUS_PACKAGE", raising=False)
    monkeypatch.setenv("SYLLABUS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SYLLABUS_NO_LIMITS_PROBE", "1")
    return croot


def test_active_package_from_config_and_env(content, monkeypatch):
    assert settings.active_package() == "drawing"
    make_package(content, "music")
    monkeypatch.setenv("SYLLABUS_PACKAGE", "music")
    assert settings.active_package() == "music"


def test_unknown_or_unset_package_is_a_clear_error(content, monkeypatch):
    monkeypatch.setenv("SYLLABUS_PACKAGE", "nope")
    with pytest.raises(settings.PackageError, match="content/nope"):
        settings.active_package()
    monkeypatch.delenv("SYLLABUS_PACKAGE")
    settings.CONFIG_FILE.write_text("# nothing chosen\n", encoding="utf-8")
    with pytest.raises(settings.PackageError, match="active"):
        settings.active_package()


def test_package_passport_defaults(content):
    p = load_package()
    assert p["id"] == "drawing" and p["title"] == "Рисование с нуля"
    # landing and teacher fall back to the title, so a minimal package still renders a home page
    assert p["landing"]["headline"] == "Рисование с нуля" and p["landing"]["cta"] == "Начать"
    assert p["teacher"]["course"] == "Рисование с нуля"


def test_program_of_the_active_package(content):
    prog = load_program()
    assert prog["title"] == "Рисование"
    assert [s["id"] for s in prog["levels"]] == ["course", "topic"]
    topics = prog["courses"][0]["disciplines"][0]["sections"][0]["topics"]
    assert [t["id"] for t in topics] == ["draw1.line.1", "draw1.line.2"]
    # a subject with one level is named without a numeral
    assert prog["courses"][0]["disciplines"][0]["name"] == "Рисунок"


def test_api_serves_the_active_package(content):
    c = TestClient(create_app(connect()))
    assert c.get("/api/package").json()["id"] == "drawing"
    assert c.get("/api/program").json()["courses"][0]["id"] == "I"
    assert c.put("/api/progress/draw1.line.2", json={"status": "done", "page": 1}).status_code == 200
    assert c.put("/api/progress/intro1.what.1", json={"status": "done"}).status_code == 404  # other package's topic


def test_each_package_has_its_own_database(content, monkeypatch):
    make_package(content, "music")
    a, b = settings.db_path("drawing"), settings.db_path("music")
    assert a != b and a.name == "drawing.sqlite3" and b.name == "music.sqlite3"
    monkeypatch.setenv("SYLLABUS_PACKAGE", "music")
    assert settings.db_path() == b


def test_legacy_forge_db_is_copied_not_moved(tmp_path, monkeypatch):
    legacy = tmp_path / "old" / "forge.sqlite3"
    legacy.parent.mkdir()
    with sqlite3.connect(legacy) as db:
        db.execute("CREATE TABLE t (x)")
        db.execute("INSERT INTO t VALUES (42)")
    home = tmp_path / "home"
    monkeypatch.setattr(settings, "LEGACY_DB", {"forge-ml": legacy})
    monkeypatch.setattr(settings.Path, "home", lambda: home)
    monkeypatch.delenv("SYLLABUS_DATA_DIR", raising=False)
    monkeypatch.delenv("FORGE_DATA_DIR", raising=False)
    path = settings.db_path("forge-ml")
    assert path == home / ".syllabus-engine" / "forge-ml.sqlite3"
    assert sqlite3.connect(path).execute("SELECT x FROM t").fetchone() == (42,)
    assert legacy.exists()  # the original stays as a backup


def test_legacy_copy_never_happens_with_explicit_data_dir(tmp_path, monkeypatch):
    legacy = tmp_path / "forge.sqlite3"
    sqlite3.connect(legacy).close()
    monkeypatch.setattr(settings, "LEGACY_DB", {"forge-ml": legacy})
    monkeypatch.setenv("SYLLABUS_DATA_DIR", str(tmp_path / "data"))
    assert not settings.db_path("forge-ml").exists()


def test_old_forge_env_names_still_work(tmp_path, monkeypatch):
    monkeypatch.delenv("SYLLABUS_DATA_DIR", raising=False)
    monkeypatch.setenv("FORGE_DATA_DIR", str(tmp_path / "x"))
    assert settings.data_dir() == tmp_path / "x"


# ── validator (tools/program/build.py) ─────────────────────────────

def load_build(monkeypatch, croot: Path):
    spec = importlib.util.spec_from_file_location("build_under_test", ROOT / "tools" / "program" / "build.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "CONTENT_ROOT", croot)
    return mod


def test_validator_accepts_a_minimal_package(tmp_path, monkeypatch):
    croot = tmp_path / "content"
    make_package(croot)
    b = load_build(monkeypatch, croot)
    assert b.use_package("drawing") == []
    assert b.validate(b.load()) == []
    assert b.check_content(b.load())[0] == []
    # documents render without optional fields (residual_check, graduation, trees, project)
    assert "Рисунок" in b.render_curriculum(b.load())
    b.render_trees(b.load())


def test_validator_rejects_wrong_passport(tmp_path, monkeypatch):
    croot = tmp_path / "content"
    make_package(croot, "drawing", package_yaml="id: painting\n")
    b = load_build(monkeypatch, croot)
    errors = b.use_package("drawing")
    assert any("must equal the folder name" in e for e in errors) and any("missing title" in e for e in errors)


def test_validator_applies_package_rules(tmp_path, monkeypatch):
    croot = tmp_path / "content"
    make_package(croot, rules="rules:\n  every_course_has: {subject: color, except: []}\n")
    b = load_build(monkeypatch, croot)
    b.use_package("drawing")
    assert any("no level of color" in e for e in b.validate(b.load()))


def test_every_package_in_the_repo_is_valid():
    """The same check CI runs: all packages in content/ pass the validator."""
    import subprocess
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "program" / "build.py"), "--check", "--all"], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
