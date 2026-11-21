"""The Python driver shared by the browser sandbox and the validator: step-by-step trace."""
import json
from pathlib import Path

DRIVER = Path(__file__).resolve().parents[2] / "web" / "src" / "sandbox" / "driver.py"


def load_driver() -> dict:
    ns: dict = {"__name__": "driver"}
    exec(compile(DRIVER.read_text(encoding="utf-8"), str(DRIVER), "exec"), ns)
    return ns


def trace(code: str, stdin: str = "") -> dict:
    return json.loads(load_driver()["trace"](code, stdin))


def names(step: dict, frame: int = -1) -> dict:
    return dict(step["frames"][frame]["vars"])


def test_aliasing_is_visible_as_the_same_object():
    r = trace("a = [1, 2]\nb = a\nb.append(3)\n")
    last = r["steps"][-1]
    assert names(last)["a"] == names(last)["b"] == {"r": 1}
    assert [x["p"] for x in last["heap"]["1"]["items"]] == ["1", "2", "3"]


def test_a_copy_is_a_different_object():
    r = trace("a = [1, 2]\nb = a.copy()\n")
    last = names(r["steps"][-1])
    assert last["a"] != last["b"]


def test_function_call_gets_its_own_names_pointing_to_the_callers_object():
    r = trace("def add(xs, x):\n    xs.append(x)\n    return len(xs)\nnums = [1]\nn = add(nums, 2)\n")
    inside = next(s for s in r["steps"] if len(s["frames"]) == 2)
    assert inside["frames"][1]["name"] == "add()"
    assert names(inside)["xs"] == names(inside, 0)["nums"]
    ret = next(s for s in r["steps"] if s["event"] == "return" and len(s["frames"]) == 2)
    assert ret["ret"] == {"p": "2"}


def test_steps_show_the_line_about_to_run_and_output_so_far():
    r = trace("print('hi')\nx = 1\n")
    assert [s["line"] for s in r["steps"] if s["event"] == "line"] == [1, 2]
    assert r["steps"][1]["out"] == "hi\n" and r["stdout"] == "hi\n"


def test_endless_loop_is_cut_and_errors_are_reported():
    loop = trace("while True:\n    x = 1\n")
    assert loop["truncated"] and len(loop["steps"]) == 400
    err = trace("x = 1\ny = x + 'a'\n")
    assert err["error"]["type"] == "TypeError" and err["error"]["line"] == 2


def test_self_referencing_list_does_not_hang():
    r = trace("a = [1]\na.append(a)\n")
    items = r["steps"][-1]["heap"]["1"]["items"]
    assert items[1] == {"r": 1}


# ── task files: a module to import, a table to read, a file the program must write ──────────────
FILES = {"sales.csv": "a,1\nb,2\n", "shop.py": "def total(xs):\n    return sum(xs)\n"}
CODE = ("import shop\n"
        "with open('sales.csv', encoding='utf-8') as f:\n"
        "    n = sum(int(line.split(',')[1]) for line in f)\n"
        "print(n, shop.total([1, 2]))\n"
        "with open('out.txt', 'w', encoding='utf-8') as f:\n"
        "    f.write(str(n))\n"
        "def double(x):\n"
        "    return x * 2\n"
        "if __name__ == '__main__':\n"
        "    print('main')\n")


def check(code: str, tests: dict) -> dict:
    return json.loads(load_driver()["check"](code, json.dumps(tests)))


def test_task_files_are_readable_importable_and_a_case_can_bring_its_own():
    r = check(CODE, {"files": FILES, "io": [
        {"stdout": "3 3\nmain", "files_out": {"out.txt": "3"}},
        {"stdout": "30 3\nmain", "files": {"sales.csv": "a,10\nb,20\n"}, "files_out": {"out.txt": "30"}},
        {"stdout": "3 3\nmain", "files_out": {"out.txt": "4"}},
        {"stdout": "3 3\nmain", "files_out": {"out.txt": "4"}, "hidden": True},
    ]})["results"]
    assert [x["ok"] for x in r] == [True, True, False, False]
    assert "ожидалось" in r[2]["message"] and "ожидалось" not in r[3]["message"]  # a hidden case keeps its data secret


def test_asserts_run_in_the_same_folder_and_can_import_the_learners_code_as_main():
    probe = ("import io, contextlib\nbuf = io.StringIO()\nwith contextlib.redirect_stdout(buf):\n    import main\n"
             "assert buf.getvalue() == '3 3\\n', buf.getvalue()\nassert open('out.txt').read() == '3'")
    r = check(CODE, {"files": FILES, "asserts": [{"code": "assert double(2) == 4"}, {"code": probe}]})["results"]
    assert all(x["ok"] for x in r), r


def test_each_run_starts_clean():
    d = load_driver()
    assert json.loads(d["run"]("import shop\nprint(shop.total([5]))", "", json.dumps(FILES)))["stdout"] == "5\n"
    gone = json.loads(d["run"]("import shop", "", "{}"))["error"]
    assert gone["type"] == "ModuleNotFoundError"
    assert json.loads(d["trace"]("print(open('sales.csv').read())", "", json.dumps(FILES)))["stdout"] == "a,1\nb,2\n\n"
