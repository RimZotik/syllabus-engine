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
