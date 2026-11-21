"""Runs learner code and task tests. Shared by the browser sandbox (Pyodide) and tools/program/build.py,
so a reference solution is checked exactly the way the learner's code is."""
import sys, io, os, json, traceback, builtins, contextlib, tempfile, shutil


@contextlib.contextmanager
def _workdir(files, code=None):
    """A fresh folder for one run: the task's files (`tests.files`: name → text) are put there, it
    becomes the current folder and the first place `import` looks, so `open("sales.csv")` and
    `import shop` find the task's files. The learner's own code is there too as `main.py`
    (a check may `import main` to see what happens on import). Afterwards everything is removed,
    including modules imported from it, so the next run starts clean."""
    d = tempfile.mkdtemp(prefix="task-")
    for name, text in (files or {}).items():
        path = os.path.join(d, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
    if code is not None and "main.py" not in (files or {}):
        with open(os.path.join(d, "main.py"), "w", encoding="utf-8") as f:
            f.write(code)
    old_cwd, old_path, old_mods = os.getcwd(), list(sys.path), set(sys.modules)
    os.chdir(d)
    sys.path.insert(0, d)
    import importlib
    importlib.invalidate_caches()
    try:
        yield d
    finally:
        os.chdir(old_cwd)
        sys.path[:] = old_path
        for m in set(sys.modules) - old_mods:
            f = getattr(sys.modules[m], "__file__", None) or ""
            if f.startswith(d):
                del sys.modules[m]
        shutil.rmtree(d, ignore_errors=True)


def _read_files(d, names):
    """Text of the files a test expects the program to leave behind (None — the file is missing)."""
    got = {}
    for name in names:
        try:
            with open(os.path.join(d, name), encoding="utf-8") as f:
                got[name] = f.read()
        except OSError:
            got[name] = None
    return got

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

def run(code, stdin, files_json="{}"):
    with _workdir(json.loads(files_json or "{}"), code):
        out, err, _ = _exec(code, stdin, True)
    return json.dumps({"stdout": out, "error": err}, ensure_ascii=False)


# ── step-by-step trace: names → objects, for the visualiser ─────────────────────
_CONTAINERS = (list, tuple, dict, set, frozenset)
MAX_STEPS = 400


class _TooLong(Exception):
    pass


def trace(code, stdin, files_json="{}"):
    with _workdir(json.loads(files_json or "{}"), code):
        return _trace(code, stdin)


def _trace(code, stdin):
    """Execute the code line by line and record, before every line, which names exist in each
    function call and which values they point to. Containers become numbered objects, so two
    names pointing at the same list visibly share one object."""
    import types
    labels = {}          # id(obj) → small stable number
    keep = []            # keep traced objects alive so their ids are not reused
    steps = []
    out = io.StringIO()

    def label(obj):
        k = id(obj)
        if k not in labels:
            labels[k] = len(labels) + 1
            keep.append(obj)
        return labels[k]

    def enc(v, heap, depth=0):
        if isinstance(v, _CONTAINERS):
            n = label(v)
            if n not in heap and depth < 6:
                heap[n] = None  # reserve: protects against self-references
                if isinstance(v, dict):
                    items = [[enc(k, heap, depth + 1), enc(x, heap, depth + 1)] for k, x in list(v.items())[:40]]
                else:
                    seq = sorted(v, key=repr) if isinstance(v, (set, frozenset)) else v
                    items = [enc(x, heap, depth + 1) for x in list(seq)[:40]]
                heap[n] = {"t": type(v).__name__, "items": items, "more": len(v) > 40}
            return {"r": n}
        if isinstance(v, types.FunctionType):
            return {"p": f"функция {v.__name__}"}
        if isinstance(v, types.ModuleType):
            return {"p": f"модуль {v.__name__}"}
        if v is None or isinstance(v, (bool, int, float, complex)):
            return {"p": repr(v)}
        if isinstance(v, str):
            return {"p": repr(v if len(v) <= 60 else v[:57] + "…")}
        return {"p": f"<{type(v).__name__}>"}

    def snapshot(frame, event, arg):
        heap, frames = {}, []
        f = frame
        chain = []
        while f is not None:
            if f.f_code.co_filename == "<ваш код>":
                chain.append(f)
            f = f.f_back
        for fr in reversed(chain):
            name = "Программа" if fr.f_code.co_name == "<module>" else fr.f_code.co_name + "()"
            names = [(k, v) for k, v in fr.f_locals.items()
                     if not k.startswith("__") and not isinstance(v, types.ModuleType)]
            frames.append({"name": name, "vars": [[k, enc(v, heap)] for k, v in names]})
        step = {"line": frame.f_lineno, "event": event, "frames": frames, "heap": heap, "out": out.getvalue()}
        if event == "return":
            step["ret"] = enc(arg, heap)
        steps.append(step)
        if len(steps) >= MAX_STEPS:
            raise _TooLong()

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != "<ваш код>":
            return None
        if event in ("line", "return"):
            snapshot(frame, event, arg)
        return tracer

    ns = {"__name__": "__main__"}
    sys.stdin = _Stdin(stdin or "")
    builtins.input = _make_input(True, out)
    err, truncated = None, False
    try:
        compiled = compile(code, "<ваш код>", "exec")
        with contextlib.redirect_stdout(out):
            sys.settrace(tracer)
            try:
                exec(compiled, ns)
            finally:
                sys.settrace(None)
    except _TooLong:
        truncated = True
    except SystemExit:
        pass
    except SyntaxError as e:
        err = {"type": type(e).__name__, "line": e.lineno, "msg": e.msg}
    except BaseException as e:
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "<ваш код>"]
        err = {"type": type(e).__name__, "line": frames[-1].lineno if frames else None, "msg": str(e)}
    return json.dumps({"steps": steps, "stdout": out.getvalue(), "error": err, "truncated": truncated}, ensure_ascii=False)

def _forbidden(code, names):
    """Names from `tests.forbid` that the code uses (as a name, attribute or import) — for tasks
    «write it yourself without max/sum/sorted». Only real code counts, not comments or strings."""
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    used, own = set(), set()
    for node in ast.walk(tree):
        # constructs, not names: "[]" — indexing and slicing, "f-string" — f-strings, "for"/"while" — loops
        if isinstance(node, ast.Subscript):
            used.add("[]")
        elif isinstance(node, ast.JoinedStr):
            used.add("f-string")
        elif isinstance(node, (ast.For, ast.comprehension)):
            used.add("for")
        elif isinstance(node, ast.While):
            used.add("while")
        elif isinstance(node, ast.Slice):
            used.add("slice")
        if isinstance(node, ast.Name):
            # a name the learner binds themselves (their own `count = 0`) is theirs, not the built-in
            (own if isinstance(node.ctx, (ast.Store, ast.Del)) else used).add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            own.add(node.name)
        elif isinstance(node, ast.arg):
            own.add(node.arg)
        elif isinstance(node, ast.Attribute):
            used.add(node.attr)  # methods like lst.count(...) are always the ready-made ones
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            used.update(a.name.split(".")[0] for a in node.names)
            if isinstance(node, ast.ImportFrom) and node.module:
                used.add(node.module.split(".")[0])
    return [n for n in names if n in used and (n not in own or n in ("[]", "f-string", "for", "while", "slice"))]


_FORBID_RU = {"[]": "индексы и срезы", "f-string": "f-строки", "for": "цикл for", "while": "цикл while", "slice": "срезы"}


def check(code, tests_json):
    tests = json.loads(tests_json)
    results = []
    banned = _forbidden(code, tests.get("forbid") or [])
    if tests.get("forbid"):
        results.append({"name": "Ограничения задачи", "ok": not banned,
                        "message": ("В этой задаче нельзя использовать: " + ", ".join(_FORBID_RU.get(b, b) for b in banned) + ".") if banned else ""})
        if banned:
            return json.dumps({"results": results}, ensure_ascii=False)  # no point running tests (and no risk of a timeout)
    files = tests.get("files") or {}
    for i, case in enumerate(tests.get("io") or []):
        # a case may bring its own files (another sales.csv) on top of the task's ones
        with _workdir({**files, **(case.get("files") or {})}, code) as d:
            out, err, _ = _exec(code, case.get("stdin", ""), False)
            want_files = case.get("files_out") or {}
            got_files = _read_files(d, want_files)
        name = case.get("name") or f"Пример {i + 1}"
        if err:
            results.append({"name": name, "ok": False, "error": err, "stdin": case.get("stdin", ""), "hidden": case.get("hidden", False)})
        else:
            ok = _norm(out) == _norm(case.get("stdout", ""))
            bad_file = next((n for n, t in want_files.items() if got_files[n] is None or _norm(got_files[n]) != _norm(t)), None)
            res = {"name": name, "ok": ok and bad_file is None, "stdin": case.get("stdin", ""), "expected": case.get("stdout", ""), "got": out, "hidden": case.get("hidden", False)}
            if bad_file is not None:
                res["message"] = (f"Файл {bad_file} не создан." if got_files[bad_file] is None else
                                  f"В файле {bad_file} не то, что нужно." if case.get("hidden") else
                                  f"В файле {bad_file} ожидалось:\n{want_files[bad_file]}\nа в нём:\n{got_files[bad_file]}")
            results.append(res)
    asserts = tests.get("asserts") or []
    printed = None  # what the program itself printed while the asserts were prepared — shown for debugging
    if asserts:
        with _workdir(files, code):
            out, err, ns = _exec(code, tests.get("stdin", ""), False)
            printed = out
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
    return json.dumps({"results": results, "stdout": printed}, ensure_ascii=False)
