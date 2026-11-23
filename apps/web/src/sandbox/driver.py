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

class InputInFunctionTask(Exception):
    """input() in a function task: the data comes in the parameters."""


def _no_input(prompt=""):
    raise InputInFunctionTask("В этой задаче данные приходят в параметры функции, а не через input(). "
                              "Уберите input() — проверка сама вызовет функцию с нужными значениями.")


def _err(e):
    """An exception as {type, line, msg}: the line is the last one of the learner's own code."""
    if isinstance(e, SyntaxError):
        return {"type": type(e).__name__, "line": e.lineno, "msg": e.msg}
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "<ваш код>"]
    return {"type": type(e).__name__, "line": frames[-1].lineno if frames else None, "msg": str(e)}


def _exec(code, stdin, echo, no_input=False):
    out = io.StringIO()
    ns = {"__name__": "__main__"}
    sys.stdin = _Stdin(stdin or "")
    builtins.input = _no_input if no_input else _make_input(echo, out)
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


def trace(code, stdin, files_json="{}", call_json=""):
    """`call_json` — {"function": name, "text": "name(1, [2])"} for a function task: the program runs
    untraced, then only that call is traced step by step."""
    with _workdir(json.loads(files_json or "{}"), code):
        return _trace(code, stdin, json.loads(call_json) if call_json else None)


def _trace(code, stdin, call=None):
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

    if call is not None:
        return _trace_call(code, call, tracer, out, steps)
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

def _trace_call(code, call, tracer, out, steps):
    """Function-task trace: the program (definitions, demo calls) runs untraced, then one call of the
    function is traced, so the steps show its loops and branches. `notice` — why there is nothing to show."""
    fname = call.get("function") or ""
    res = {"steps": steps, "stdout": "", "error": None, "truncated": False, "call": None}
    try:
        args, kwargs = _parse_call(call.get("text") or "", fname)
    except ValueError as e:
        return json.dumps({**res, "notice": str(e)}, ensure_ascii=False)
    res["call"] = _call_text(fname, args, kwargs)
    _, err, ns = _exec(code, "", False, no_input=True)
    if err:
        return json.dumps({**res, "error": err}, ensure_ascii=False)
    fn, why = _find_function(ns, fname)
    why = why or _bind_error(fn, fname, args, kwargs, res["call"])
    if why:
        return json.dumps({**res, "notice": why}, ensure_ascii=False)
    try:
        with contextlib.redirect_stdout(out):
            sys.settrace(tracer)
            try:
                got = fn(*args, **kwargs)
            finally:
                sys.settrace(None)
        res["returned"] = repr(got)
    except _TooLong:
        res["truncated"] = True
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as e:
        res["error"] = _err(e)
    res["stdout"] = out.getvalue()
    return json.dumps(res, ensure_ascii=False)


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


# ── function tasks (`tests.calls`): the check calls the learner's function and compares what it returns ──
_TYPE_RU = {"int": ("число", "число"), "float": ("число", "число"), "bool": ("логическое значение", "логическое значение"),
            "str": ("строка", "строку"), "list": ("список", "список"), "tuple": ("кортеж", "кортеж"),
            "dict": ("словарь", "словарь"), "set": ("множество", "множество"), "frozenset": ("множество", "множество"),
            "NoneType": ("None", "None")}


def _type_ru(v, form=0):
    return _TYPE_RU.get(type(v).__name__, (type(v).__name__,) * 2)[form]


def _case_args(case):
    """Positional and keyword arguments of a case: `args` (a list of YAML values) or `args_py` (a Python literal)."""
    import ast
    if "args_py" in case:
        a = ast.literal_eval(case["args_py"])
        args = list(a) if isinstance(a, (tuple, list)) else [a]
    else:
        args = list(case.get("args") or [])
    return args, dict(case.get("kwargs") or {})


def _case_expect(case):
    import ast
    return ast.literal_eval(case["expect_py"]) if "expect_py" in case else case.get("expect")


def _call_text(fname, args, kwargs):
    return f"{fname}(" + ", ".join([repr(a) for a in args] + [f"{k}={v!r}" for k, v in kwargs.items()]) + ")"


def _same(a, b, tol, strict):
    """Is the returned `a` the expected `b`? None only equals None, bool never equals a number,
    floats are compared with a tolerance, list and tuple are equal unless `strict`."""
    import math
    if a is None or b is None:
        return a is b
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    num = (int, float)
    if isinstance(a, num) and isinstance(b, num):
        if strict and type(a) is not type(b):
            return False
        if isinstance(a, float) or isinstance(b, float):
            return math.isclose(a, b, rel_tol=tol, abs_tol=tol)
        return a == b
    seq = (list, tuple)
    if isinstance(a, seq) and isinstance(b, seq):
        if strict and type(a) is not type(b):
            return False
        return len(a) == len(b) and all(_same(x, y, tol, strict) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k], tol, strict) for k in b)
    if isinstance(a, (set, frozenset)) and isinstance(b, (set, frozenset)):
        return a == b
    return type(a) is type(b) and a == b


def _prints_without_return(code, fname):
    """The function has print() in its body but no `return <value>` at all: «printed instead of returned»."""
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == fname:
            inner = list(ast.walk(node))
            has_print = any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "print" for n in inner)
            return has_print and not any(isinstance(n, ast.Return) and n.value is not None for n in inner)
    return False


def _find_function(ns, fname):
    """The learner's function, or a message why it can't be called."""
    import difflib, types
    fn = ns.get(fname)
    if fn is None:
        msg = f"В коде нет функции `{fname}`. Имя должно быть ровно как в условии: `def {fname}(...)`."
        own = [k for k, v in ns.items() if isinstance(v, types.FunctionType)]
        close = difflib.get_close_matches(fname, own, n=1, cutoff=0.6)
        if close:
            msg += f" Есть функция `{close[0]}` — опечатка в имени?"
        return None, msg
    if not callable(fn):
        return None, f"`{fname}` — не функция, а значение типа {type(fn).__name__}."
    return fn, None


def _plural(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return one
    return few if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14 else many


def _bind_error(fn, fname, args, kwargs, call):
    """Message when the function's parameters don't fit the call (checked before calling)."""
    import inspect
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return None
    try:
        sig.bind(*args, **kwargs)
    except TypeError:
        params = list(sig.parameters)
        return (f"Функция `{fname}` принимает {len(params)} {_plural(len(params), 'параметр', 'параметра', 'параметров')}"
                + (f" ({', '.join(f'`{p}`' for p in params)})" if params else "")
                + f", а проверка вызывает её с {len(args) + len(kwargs)}: `{call}`. Параметры должны быть как в условии.")
    return None


def _verdict(case, got, want, out, code, fname, tol, strict, hidden):
    """(ok, message) for a returned value."""
    sets = (list, tuple, set, frozenset)
    if case.get("unordered") and isinstance(got, sets) and isinstance(want, sets):
        got_c, want_c = sorted(got, key=repr), sorted(want, key=repr)
    else:
        got_c, want_c = got, want
    if _same(got_c, want_c, tol, strict):
        return True, ""
    if got is None:
        if out.strip():
            shown = "" if hidden else f", хотя напечатала «{out.strip().splitlines()[-1][:60]}»"
            return False, (f"Функция вернула None{shown}. `print` показывает значение на экране, но не отдаёт его тому, "
                           "кто вызвал функцию. Замените `print(...)` на `return ...`.")
        if _prints_without_return(code, fname):
            return False, ("Функция вернула None: в ней есть `print`, но нет `return`. `print` показывает значение на экране, "
                           "но не отдаёт его тому, кто вызвал функцию. Замените `print(...)` на `return ...`.")
        return False, "Функция ничего не вернула (None). Проверьте, что `return` есть на каждом пути — после цикла и в каждой ветке if/else."
    seq_pair = isinstance(got, (list, tuple)) and isinstance(want, (list, tuple))
    if want is not None and _type_ru(got) != _type_ru(want) and not (seq_pair and not strict):
        return False, ("Функция вернула значение другого типа." if hidden else
                       f"Функция вернула {_type_ru(got, 1)} {got!r}, а нужно {_type_ru(want, 1)} {want!r}.")
    if strict and type(got) is not type(want) and not hidden:
        return False, f"Функция вернула {type(got).__name__}, а нужен {type(want).__name__}."
    return False, ""


def _check_calls(code, tests):
    """One result per case of `tests.calls`. Every case runs the whole program in a fresh folder and
    namespace (globals don't leak between cases), then calls the function with deep copies of the
    arguments; what the call prints is kept per case and never affects the verdict."""
    import copy
    fname = tests.get("function") or ""
    tol = float(tests.get("tol", 1e-9))
    strict = bool(tests.get("strict_types"))
    files = tests.get("files") or {}
    results, printed = [], None
    for i, case in enumerate(tests.get("calls") or []):
        hidden = bool(case.get("hidden"))
        res = {"name": case.get("name") or f"Тест {i + 1}", "ok": False, "hidden": hidden}
        results.append(res)
        try:
            args, kwargs = _case_args(case)
            want = _case_expect(case)
        except (ValueError, SyntaxError) as e:
            res["message"] = f"Ошибка в данных теста: {e}"
            continue
        call = _call_text(fname, args, kwargs)
        if not hidden:
            res["call"] = call
            res["expected"] = f"ошибка {case['raises']}" if case.get("raises") else repr(want)
        with _workdir(files, code):
            top, err, ns = _exec(code, tests.get("stdin", ""), False, no_input=True)
            if printed is None:
                printed = top
            if err:
                res["error"] = err if not hidden else {"type": err["type"], "line": None, "msg": ""}
                if err["type"] not in ("InputInFunctionTask", "SyntaxError", "IndentationError"):
                    res["message"] = (f"Код вне функции упал в строке {err['line']} — до проверки функции дело не дошло."
                                      if err.get("line") else "Код упал ещё до вызова функции — до проверки функции дело не дошло.")
                continue
            fn, why = _find_function(ns, fname)
            if why is None:
                why = _bind_error(fn, fname, args, kwargs, call)
            if why:
                res["message"] = why
                continue
            passed_args, passed_kwargs = copy.deepcopy(args), copy.deepcopy(kwargs)
            buf = io.StringIO()
            got, raised = None, None
            try:
                with contextlib.redirect_stdout(buf):
                    got = fn(*passed_args, **passed_kwargs)
            except (KeyboardInterrupt, SystemExit):
                raise
            except BaseException as e:
                raised = e
        out = buf.getvalue()
        if not hidden:
            res["output"] = out
        want_err = case.get("raises")
        if want_err:
            if raised is not None and want_err in [c.__name__ for c in type(raised).__mro__]:
                res["ok"] = True
            elif raised is None:
                res["message"] = f"Ожидалась ошибка {want_err}, а функция вернула {'значение' if hidden else repr(got)}."
                if not hidden:
                    res["got"] = repr(got)
            else:
                res["message"] = f"Ожидалась ошибка {want_err}, а возникла {type(raised).__name__}."
            continue
        if raised is not None:
            e = _err(raised)
            res["error"] = e if not hidden else {"type": e["type"], "line": None, "msg": ""}
            if not hidden:
                res["message"] = f"При вызове `{call}`:"
            continue
        if not hidden:
            res["got"] = repr(got)
            if got is not None and _type_ru(got) != _type_ru(want):
                res["got_type"] = _type_ru(got)
        ok, msg = _verdict(case, got, want, out, code, fname, float(case.get("tol", tol)), strict, hidden)
        if ok and tests.get("no_mutate"):
            for before, after in zip(args + list(kwargs.values()), passed_args + list(passed_kwargs.values())):
                if not _same(after, before, 0.0, True):
                    what = "переданный список" if isinstance(before, list) else "переданный аргумент"
                    ok, msg = False, (f"Функция изменила {what}" + ("" if hidden else f": был {before!r}, стал {after!r}")
                                      + ". По условию его менять нельзя — работайте с копией или не удаляйте элементы.")
                    break
        if ok and "after" in case:
            for want_after, after in zip(case["after"], passed_args):
                if not _same(after, want_after, tol, strict):
                    ok, msg = False, ("После вызова аргумент не такой, как нужно." if hidden else
                                      f"После вызова список должен стать {want_after!r}, а он {after!r}.")
                    break
        res["ok"] = ok
        if msg:
            res["message"] = msg
    return results, printed


def _parse_call(text, fname):
    """`best_jump([450, 430], 2)` typed by the learner → (args, kwargs); only literal values are allowed."""
    import ast
    try:
        node = ast.parse(text.strip(), mode="eval").body
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == fname):
            raise ValueError
        return [ast.literal_eval(a) for a in node.args], {k.arg: ast.literal_eval(k.value) for k in node.keywords if k.arg}
    except (SyntaxError, ValueError, TypeError):
        raise ValueError(f"Можно только вызов {fname} с числами, строками и списками, например {fname}([1, 2]).") from None


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
    printed = None  # what the program itself printed outside the checked calls — shown for debugging
    if tests.get("calls"):
        res_calls, printed = _check_calls(code, tests)
        results += res_calls
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
    if asserts:
        with _workdir(files, code):
            out, err, ns = _exec(code, tests.get("stdin", ""), False)
            if printed is None:
                printed = out
            for i, t in enumerate(asserts):
                name = t.get("name") or f"Проверка {i + 1}"
                if err:
                    results.append({"name": name, "ok": False, "error": err})
                    continue
                buf = io.StringIO()  # what the learner's function printed during this check — shown under it
                try:
                    with contextlib.redirect_stdout(buf):
                        exec(compile(t["code"], "<проверка>", "exec"), ns)
                    results.append({"name": name, "ok": True, "output": buf.getvalue()})
                except AssertionError as e:
                    results.append({"name": name, "ok": False, "message": str(e) or t.get("message", ""), "output": buf.getvalue()})
                except BaseException as e:
                    results.append({"name": name, "ok": False, "error": {"type": type(e).__name__, "line": None, "msg": str(e)}, "output": buf.getvalue()})
    return json.dumps({"results": results, "stdout": printed}, ensure_ascii=False)
