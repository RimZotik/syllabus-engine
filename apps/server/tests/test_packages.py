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
    topic = d / "lessons" / "draw1" / "line" / "01-straight"
    topic.mkdir(parents=True)
    (topic / "topic.mdx").write_text('<Page title="Прямая">\n\n<Term id="line">Линия</Term> бывает прямой.\n\n</Page>\n', encoding="utf-8")
    (topic / "quiz.yaml").write_text("questions:\n- id: q1\n  type: single\n  q: Какая линия?\n  options: [Прямая, Круглая]\n  answer: 0\n", encoding="utf-8")
    return d


@pytest.fixture
def content(tmp_path, monkeypatch):
    """An isolated courses/ folder with one package and its own active.yaml."""
    croot = tmp_path / "courses"
    make_package(croot)
    cfg = croot / "active.yaml"
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
    with pytest.raises(settings.PackageError, match="courses/nope"):
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



def test_one_server_serves_every_installed_package(content):
    """The page's package travels in X-Syllabus-Package: program, progress and data are that package's."""
    make_package(content, "music")
    c = TestClient(create_app(connect()))
    cat = c.get("/api/packages").json()
    assert cat["default"] == "drawing" and [p["id"] for p in cat["packages"]] == ["drawing", "music"]
    assert cat["packages"][0]["icon"] == "book-open"  # passport defaults for the catalog card
    music = {"X-Syllabus-Package": "music"}
    assert c.get("/api/package", headers=music).json()["id"] == "music"
    assert c.put("/api/progress/draw1.line.2", json={"status": "done", "page": 0}, headers=music).status_code == 200
    # progress went to music's own database, drawing's stays empty
    assert "draw1.line.2" in c.get("/api/progress", headers=music).json()
    assert c.get("/api/progress").json() == {}
    assert (settings.data_dir() / "music.sqlite3").exists()
    assert c.get("/api/package", headers={"X-Syllabus-Package": "nope"}).status_code == 404
    assert c.get("/api/package", headers={"X-Syllabus-Package": "../secret"}).status_code == 404

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
    croot = tmp_path / "courses"
    make_package(croot)
    b = load_build(monkeypatch, croot)
    assert b.use_package("drawing") == []
    assert b.validate(b.load()) == []
    errors, authored = b.check_content(b.load())
    assert errors == [] and authored == {"draw1.line.1"}
    # documents render without optional fields (residual_check, graduation, trees, project)
    assert "Рисунок" in b.render_curriculum(b.load())
    b.render_trees(b.load())


def test_validator_rejects_wrong_passport(tmp_path, monkeypatch):
    croot = tmp_path / "courses"
    make_package(croot, "drawing", package_yaml="id: painting\n")
    b = load_build(monkeypatch, croot)
    errors = b.use_package("drawing")
    assert any("must equal the folder name" in e for e in errors) and any("missing title" in e for e in errors)


def test_validator_applies_package_rules(tmp_path, monkeypatch):
    croot = tmp_path / "courses"
    make_package(croot, rules="rules:\n  every_course_has: {subject: color, except: []}\n")
    b = load_build(monkeypatch, croot)
    b.use_package("drawing")
    assert any("no level of color" in e for e in b.validate(b.load()))


def test_broken_yaml_is_reported_not_a_traceback(tmp_path, monkeypatch, capsys):
    croot = tmp_path / "courses"
    d = make_package(croot)
    (d / "lessons" / "draw1" / "line" / "test.yaml").write_text("questions:\n- q: Что это: линия?\n  x: : y\n", encoding="utf-8")
    b = load_build(monkeypatch, croot)
    b.use_package("drawing")
    errors, _ = b.check_content(b.load())
    assert any("invalid YAML" in e for e in errors)
    (d / "program.yaml").write_text("courses: [\n", encoding="utf-8")
    assert b.safe_check("drawing", check=True, readme=False) == 1
    assert "drawing: FAILED" in capsys.readouterr().err


def test_every_package_in_the_repo_is_valid():
    """The same check CI runs: all packages in courses/ pass the validator."""
    import subprocess
    import os
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}  # the child prints Cyrillic
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "program" / "build.py"), "--check", "--all"], capture_output=True, text=True, encoding="utf-8", env=env)
    assert r.returncode == 0, r.stderr


def test_package_id_is_a_folder_name_not_a_path(content, monkeypatch):
    # a package outside content/ (or a db file outside the data dir) must never be reachable
    outside = content.parent / "evil"
    make_package(content.parent, "evil")
    assert (outside / "package.yaml").is_file()
    for bad in ("../evil", r"..\evil", "..", "/abs", "a/b", ".hidden"):
        monkeypatch.setenv("SYLLABUS_PACKAGE", bad)
        with pytest.raises(settings.PackageError, match="недопустимое"):
            settings.active_package()
    monkeypatch.delenv("SYLLABUS_PACKAGE")
    settings.CONFIG_FILE.write_text("active: ../evil\n", encoding="utf-8")
    with pytest.raises(settings.PackageError):
        settings.active_package()


def test_active_value_may_be_quoted(content):
    settings.CONFIG_FILE.write_text('active: "drawing"  # comment\n', encoding="utf-8")
    assert settings.active_package() == "drawing"


def test_interrupted_legacy_copy_leaves_nothing_behind(tmp_path, monkeypatch):
    legacy = tmp_path / "forge.sqlite3"
    with sqlite3.connect(legacy) as db:
        db.execute("CREATE TABLE t (x)")
        db.execute("INSERT INTO t VALUES (7)")
    dst = tmp_path / "data" / "forge-ml.sqlite3"
    dst.parent.mkdir()

    class Boom(sqlite3.Connection):
        def backup(self, *a, **k):
            raise KeyboardInterrupt  # e.g. the learner closes the terminal mid-copy

    real_connect = sqlite3.connect
    monkeypatch.setattr(settings.sqlite3, "connect", lambda p, *a, **k: real_connect(p, *a, factory=Boom, **k) if Path(p) == legacy else real_connect(p, *a, **k))
    with pytest.raises(KeyboardInterrupt):
        settings.copy_db(legacy, dst)
    assert list(dst.parent.iterdir()) == []  # no half-written database that would block the next copy
    monkeypatch.setattr(settings.sqlite3, "connect", real_connect)
    settings.copy_db(legacy, dst)
    assert sqlite3.connect(dst).execute("SELECT x FROM t").fetchone() == (7,)
    assert sqlite3.connect(legacy).execute("SELECT x FROM t").fetchone() == (7,)


def test_tests_never_see_the_real_home():
    """conftest.py points the data dir and the home directory into a temp folder."""
    import tempfile
    tmp = Path(tempfile.gettempdir()).resolve()
    assert tmp in Path.home().resolve().parents
    assert tmp in Path(settings._env("DATA_DIR")).resolve().parents


def run_taskcheck(code: str, tests: dict) -> list[dict]:
    import json, subprocess
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "program" / "taskcheck.py")], input=json.dumps({"code": code, "tests": tests}).encode("utf-8"),
                       capture_output=True, timeout=60)
    return json.loads(r.stdout.decode("utf-8"))["results"]


def test_task_forbid_catches_builtin_use_but_not_comments():
    tests = {"forbid": ["max"], "asserts": [{"name": "works", "code": "assert biggest([1, 3, 2]) == 3"}]}
    cheat = run_taskcheck("def biggest(xs):\n    return max(xs)\n", tests)
    assert cheat[0]["ok"] is False and "max" in cheat[0]["message"] and len(cheat) == 1  # tests are skipped after a violation
    own = run_taskcheck("def biggest(xs):  # no max here\n    m = xs[0]\n    for x in xs:\n        m = x if x > m else m\n    return m\n", tests)
    assert all(r["ok"] for r in own)
    via_import = run_taskcheck("from builtins import max as m\ndef biggest(xs):\n    return m(xs)\n", tests)
    assert via_import[0]["ok"] is False


def test_task_forbid_constructs_indexing_and_fstrings():
    tests = {"forbid": ["[]", "f-string", "str"], "io": [{"stdin": "123", "stdout": "6"}]}
    by_index = run_taskcheck("s = input()" + chr(10) + "print(int(s[0]) + int(s[1]) + int(s[2]))", tests)
    assert by_index[0]["ok"] is False and "индексы и срезы" in by_index[0]["message"]
    by_fstring = run_taskcheck("n = int(input())" + chr(10) + "s = f'{n}'" + chr(10) + "print(6)", tests)
    assert by_fstring[0]["ok"] is False
    arithmetic = run_taskcheck("n = int(input())" + chr(10) + "print(n // 100 + n // 10 % 10 + n % 10)", tests)
    assert all(r["ok"] for r in arithmetic)


def test_task_forbid_ignores_the_learners_own_names_but_not_builtins_or_methods():
    tests = {"forbid": ["count", "max"], "io": [{"stdin": "", "stdout": "2"}]}
    own_counter = run_taskcheck("count = 0" + chr(10) + "for x in [1, 5]:" + chr(10) + "    count += 1" + chr(10) + "print(count)", tests)
    assert all(r["ok"] for r in own_counter)
    method = run_taskcheck("print([1, 5].count(1) + 1)", tests)
    assert method[0]["ok"] is False
    builtin = run_taskcheck("print(max(1, 2))", tests)
    assert builtin[0]["ok"] is False


def test_task_forbid_loops():
    tests = {"forbid": ["for", "while"], "io": [{"stdin": "3", "stdout": "9"}]}
    loop = run_taskcheck("n = int(input())" + chr(10) + "t = 0" + chr(10) + "for k in range(n):" + chr(10) + "    t += 2 * k + 1" + chr(10) + "print(t)", tests)
    assert loop[0]["ok"] is False and "цикл for" in loop[0]["message"]
    formula = run_taskcheck("n = int(input())" + chr(10) + "print(n * n)", tests)
    assert all(r["ok"] for r in formula)



def test_task_forbid_slice_keeps_plain_indexing():
    tests = {"forbid": ["slice"], "io": [{"stdin": "a b c", "stdout": "c b a"}]}
    sliced = run_taskcheck("print(*input().split()[::-1])", tests)
    assert sliced[0]["ok"] is False and "срезы" in sliced[0]["message"]
    by_index = run_taskcheck("w = input().split()" + chr(10) + "i = len(w) - 1" + chr(10) + "r = []" + chr(10) + "while i >= 0:" + chr(10) + "    r.append(w[i])" + chr(10) + "    i -= 1" + chr(10) + "print(*r)", tests)
    assert all(x["ok"] for x in by_index)


def test_validator_catches_a_concept_used_before_it_is_introduced(tmp_path, monkeypatch):
    croot = tmp_path / "courses"
    d = make_package(croot)
    # «штриховка» is introduced in topic 2, but topic 1 already relies on it (by a link and by meta.uses)
    (d / "glossary.yaml").write_text(
        "- id: line\n  term: линия\n  short: След карандаша.\n  introduced_in: draw1.line.1\n"
        "- id: hatch\n  term: штриховка\n  short: Ряды линий.\n  introduced_in: draw1.line.2\n", encoding="utf-8")
    t1 = d / "lessons" / "draw1" / "line" / "01-straight" / "topic.mdx"
    t1.write_text('export const meta = { uses: ["hatch"] }\n\n<Page title="Прямая">\n\n<Term id="line">Линия</Term> бывает прямой.\n\n</Page>\n', encoding="utf-8")
    b = load_build(monkeypatch, croot)
    b.use_package("drawing")
    errors, _ = b.check_content(b.load())
    assert any("'hatch' is used before it is introduced" in e for e in errors)
    # and the term's own topic must mark it: a bare mention is not enough
    t2 = t1.parent.parent / "02-hatching"; t2.mkdir()
    (t2 / "topic.mdx").write_text('<Page title="Штриховка">\n\nТени передают штриховкой.\n\n</Page>\n', encoding="utf-8")
    t1.write_text('<Page title="Прямая">\n\n<Term id="line">Линия</Term> бывает прямой.\n\n</Page>\n', encoding="utf-8")
    errors, _ = b.check_content(b.load())
    assert any("hatch" in e and "<Term" in e for e in errors)
    (t2 / "topic.mdx").write_text('<Page title="Штриховка">\n\nТени передают <Term id="hatch">штриховкой</Term>.\n\n</Page>\n', encoding="utf-8")
    errors, _ = b.check_content(b.load())
    assert errors == []
