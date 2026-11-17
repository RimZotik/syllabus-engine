"""Runs learner code and task tests. Shared by the browser sandbox (Pyodide) and tools/program/build.py,
so a reference solution is checked exactly the way the learner's code is."""
import sys, io, json, traceback, builtins, contextlib

class _Stdin(io.StringIO):
    pass

def _make_input(echo, out):
    def _input(prompt=""):
        line = sys.stdin.readline()
        if line == "":
            raise EOFError("входные данные закончились: программа ждёт больше строк, чем ей дали")
        line = line.rstrip("\n")
        if echo:
            out.write(str(prompt) + line + "\n")
        return line
    return _input

def _exec(code, stdin, echo):
    out = io.StringIO()
    ns = {"__name__": "__main__"}
    sys.stdin = _Stdin(stdin or "")
    builtins.input = _make_input(echo, out)
    err = None
    try:
        with contextlib.redirect_stdout(out):
            exec(compile(code, "<ваш код>", "exec"), ns)
    except SystemExit:
        pass
    except SyntaxError as e:
        err = {"type": type(e).__name__, "line": e.lineno, "msg": e.msg}
    except BaseException as e:
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "<ваш код>"]
        err = {"type": type(e).__name__, "line": frames[-1].lineno if frames else None, "msg": str(e)}
    return out.getvalue(), err, ns

def _norm(s):
    return "\n".join(line.rstrip() for line in s.replace("\r\n", "\n").strip("\n").split("\n"))

def run(code, stdin):
    out, err, _ = _exec(code, stdin, True)
    return json.dumps({"stdout": out, "error": err}, ensure_ascii=False)

def _forbidden(code, names):
    """Names from `tests.forbid` that the code uses (as a name, attribute or import) — for tasks
    «write it yourself without max/sum/sorted». Only real code counts, not comments or strings."""
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used.add(node.id)
        elif isinstance(node, ast.Attribute):
            used.add(node.attr)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            used.update(a.name.split(".")[0] for a in node.names)
            if isinstance(node, ast.ImportFrom) and node.module:
                used.add(node.module.split(".")[0])
    return [n for n in names if n in used]


def check(code, tests_json):
    tests = json.loads(tests_json)
    results = []
    banned = _forbidden(code, tests.get("forbid") or [])
    if tests.get("forbid"):
        results.append({"name": "Без готовых функций", "ok": not banned,
                        "message": ("В этой задаче нужно обойтись без: " + ", ".join(banned) + ". Напишите это сами.") if banned else ""})
    for i, case in enumerate(tests.get("io") or []):
        out, err, _ = _exec(code, case.get("stdin", ""), False)
        name = case.get("name") or f"Пример {i + 1}"
        if err:
            results.append({"name": name, "ok": False, "error": err, "stdin": case.get("stdin", ""), "hidden": case.get("hidden", False)})
        else:
            ok = _norm(out) == _norm(case.get("stdout", ""))
            results.append({"name": name, "ok": ok, "stdin": case.get("stdin", ""), "expected": case.get("stdout", ""), "got": out, "hidden": case.get("hidden", False)})
    asserts = tests.get("asserts") or []
    if asserts:
        out, err, ns = _exec(code, tests.get("stdin", ""), False)
        for i, t in enumerate(asserts):
            name = t.get("name") or f"Проверка {i + 1}"
            if err:
                results.append({"name": name, "ok": False, "error": err})
                continue
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    exec(compile(t["code"], "<проверка>", "exec"), ns)
                results.append({"name": name, "ok": True})
            except AssertionError as e:
                results.append({"name": name, "ok": False, "message": str(e) or t.get("message", "")})
            except BaseException as e:
                results.append({"name": name, "ok": False, "error": {"type": type(e).__name__, "line": None, "msg": str(e)}})
    return json.dumps({"results": results}, ensure_ascii=False)
