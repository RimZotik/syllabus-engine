"""Builds the list the code editor suggests after a dot: methods of the built-in types and the public names
of the standard-library modules the courses use, with their signatures.

    uv run --python 3.12 python tools/program/gen_completions.py

Writes apps/web/src/components/pyCompletions.json. Run again after adding a module to MODULES.
"""
import importlib
import inspect
import io
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "apps" / "web" / "src" / "components" / "pyCompletions.json"

TYPES = {"str": str, "list": list, "dict": dict, "set": set, "tuple": tuple, "int": int, "float": float,
         "file": io.TextIOWrapper, "bytes": bytes}
MODULES = ["math", "random", "statistics", "re", "json", "csv", "datetime", "collections", "os", "os.path",
           "pathlib", "sys", "io", "string", "itertools", "functools", "time", "zoneinfo"]
# objects the courses create from module classes: their methods after a dot
CLASSES = {"datetime": "datetime.datetime", "date": "datetime.date", "timedelta": "datetime.timedelta",
           "Path": "pathlib.Path", "Counter": "collections.Counter", "match": "re.Match"}


def sig(obj, name):
    try:
        s = str(inspect.signature(obj)).replace("self, ", "").replace("(self)", "()")
        # the «positional-only» slash means nothing to a beginner — drop it
        s = s.replace("(/, ", "(").replace(", /)", ")").replace(", /,", ",").replace("(/)", "()")
        return name + s
    except (TypeError, ValueError):
        return name + "(…)" if callable(obj) else name


def kind(obj):
    if inspect.isclass(obj):
        return "class"
    if callable(obj):
        return "function"
    if inspect.ismodule(obj):
        return "namespace"
    return "constant"


def members(obj, public_only=True):
    out = []
    for name in sorted(dir(obj)):
        if name.startswith("_"):
            continue
        try:
            value = getattr(obj, name)
        except Exception:
            continue
        k = "method" if kind(value) == "function" and not inspect.ismodule(obj) else kind(value)
        out.append({"label": name, "type": k, "detail": sig(value, name) if callable(value) else type(value).__name__})
    return out


def resolve(path):
    mod, _, attr = path.rpartition(".")
    return getattr(importlib.import_module(mod), attr)


data = {"types": {t: members(cls) for t, cls in TYPES.items()},
        "modules": {m: members(importlib.import_module(m)) for m in MODULES},
        "classes": {c: members(resolve(p)) for c, p in CLASSES.items()}}
for m in data["modules"].values():   # a module's functions are functions, not methods
    for e in m:
        if e["type"] == "method":
            e["type"] = "function"
OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(OUT, OUT.stat().st_size, "bytes")
