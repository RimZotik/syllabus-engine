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


# ── function tasks: tests.calls ─────────────────────────────────────────────────────────────────
FN = "def total(xs):\n    s = 0\n    for x in xs:\n        s += x\n        print('s =', s)\n    return s\nprint('demo', total([1]))\n"


def calls(code: str, cases: list, **extra) -> dict:
    return check(code, {"function": "total", "calls": cases, **extra})


def test_calls_compare_the_return_value_and_keep_each_cases_print():
    r = calls(FN, [{"args": [[1, 2]], "expect": 3}, {"args": [[5]], "expect": 6}])
    ok, bad = r["results"]
    assert ok["ok"] and ok["call"] == "total([1, 2])" and ok["expected"] == "3" and ok["got"] == "3"
    assert ok["output"] == "s = 1\ns = 3\n"  # printed inside THIS call only
    assert not bad["ok"] and bad["got"] == "5" and bad["output"] == "s = 5\n"
    assert r["stdout"] == "s = 1\ndemo 1\n"  # top-level code ran, never part of the verdict


def test_print_instead_of_return_gets_a_dedicated_hint():
    r = calls("def total(xs):\n    print(sum(xs))\n", [{"args": [[1, 2]], "expect": 3}, {"args": [[]], "expect": 0, "hidden": True}])["results"]
    assert r[0]["got"] == "None" and "напечатала «3»" in r[0]["message"] and "return" in r[0]["message"]
    assert "call" not in r[1] and "output" not in r[1] and "None" in r[1]["message"]  # hidden: no data leaks
    missing = calls("def total(xs):\n    if xs:\n        return 1\n", [{"args": [[]], "expect": 0}])["results"][0]
    assert "на каждом пути" in missing["message"]


def test_types_none_bool_float_and_list_vs_tuple():
    r = calls("def total(xs):\n    return xs\n", [
        {"args": ["450"], "expect": 450},
        {"args": [True], "expect": 1},
        {"args": [0.1 + 0.2], "expect": 0.3},
        {"args_py": "((1, 2),)", "expect": [1, 2]},
        {"args": [None], "expect": None},
        {"args": [[3, 1, 2]], "expect": [1, 2, 3], "unordered": True},
        {"args": [1.5], "expect": 2, "tol": 0.6},
    ])["results"]
    assert [x["ok"] for x in r] == [False, False, True, True, True, True, True]
    assert r[0]["got_type"] == "строка" and "строку '450', а нужно число 450" in r[0]["message"]
    strict = calls("def total(xs):\n    return xs\n", [{"args_py": "((1, 2),)", "expect": [1, 2]}], strict_types=True)["results"][0]
    assert not strict["ok"]


def test_fresh_namespace_and_deep_copied_args_per_case():
    code = "seen = []\ndef total(xs):\n    seen.append(1)\n    xs.append(0)\n    return len(seen)\n"
    r = calls(code, [{"args": [[1]], "expect": 1}, {"args": [[1]], "expect": 1}])["results"]
    assert all(x["ok"] for x in r)  # globals don't leak from one case to the next
    mut = calls(code, [{"args": [[1]], "expect": 1}], no_mutate=True)["results"][0]
    assert not mut["ok"] and "был [1], стал [1, 0]" in mut["message"]
    inplace = check("def total(xs):\n    xs.sort()\n", {"function": "total", "calls": [
        {"args": [[2, 1]], "expect": None, "after": [[1, 2]]}, {"args": [[2, 1]], "expect": None, "after": [[2, 1]]}]})["results"]
    assert [x["ok"] for x in inplace] == [True, False] and "должен стать [2, 1]" in inplace[1]["message"]


def test_raises_errors_missing_function_wrong_arity_and_input():
    code = "def total(xs):\n    if xs < 0:\n        raise ValueError('neg')\n    return 10 // xs\n"
    r = calls(code, [{"args": [-1], "raises": "ValueError"}, {"args": [5], "raises": "ValueError"}, {"args": [0], "expect": 0}])["results"]
    assert r[0]["ok"] and not r[1]["ok"] and "а функция вернула 2" in r[1]["message"]
    assert r[2]["error"]["type"] == "ZeroDivisionError" and r[2]["error"]["line"] == 4 and "total(0)" in r[2]["message"]
    typo = calls("def totl(xs):\n    return 1\n", [{"args": [[]], "expect": 0}])["results"][0]
    assert "нет функции `total`" in typo["message"] and "`totl`" in typo["message"]
    arity = calls("def total(xs, k):\n    return 1\n", [{"args": [[]], "expect": 0}])["results"][0]
    assert "принимает 2 параметра (`xs`, `k`)" in arity["message"]
    inp = calls("x = input()\ndef total(xs):\n    return 0\n", [{"args": [[]], "expect": 0}])["results"][0]
    assert inp["error"]["type"] == "InputInFunctionTask" and "параметры функции" in inp["error"]["msg"]
    crash = calls("1 / 0\ndef total(xs):\n    return 0\n", [{"args": [[]], "expect": 0}])["results"][0]
    assert "Код вне функции упал в строке 1" in crash["message"]


def test_calls_live_alongside_io_and_asserts_print_is_kept_per_assert():
    r = check("def total(xs):\n    print('hi')\n    return sum(xs)\n", {"function": "total", "calls": [{"args": [[1]], "expect": 1}],
                                                                   "asserts": [{"code": "assert total([2]) == 2"}]})["results"]
    assert [x["ok"] for x in r] == [True, True] and r[1]["output"] == "hi\n"


def test_trace_of_a_function_call_shows_only_the_call():
    d = load_driver()
    r = json.loads(d["trace"](FN, "", "{}", json.dumps({"function": "total", "text": "total([1, 2])"})))
    assert r["call"] == "total([1, 2])" and r["returned"] == "3" and r["stdout"] == "s = 1\ns = 3\n"
    assert all(s["frames"][0]["name"] == "total()" for s in r["steps"])  # the demo code at the top level is not traced
    bad = json.loads(d["trace"](FN, "", "{}", json.dumps({"function": "total", "text": "__import__('os')"})))
    assert bad["steps"] == [] and "Можно только вызов total" in bad["notice"]
    none = json.loads(d["trace"]("x = 1\n", "", "{}", json.dumps({"function": "total", "text": "total([1])"})))
    assert "нет функции" in none["notice"]
