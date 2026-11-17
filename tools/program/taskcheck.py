"""Runs one task's code against its tests with the same driver the browser sandbox uses.

stdin: JSON {"code": str, "tests": {...}}  →  stdout: JSON {"results": [...]}
Called by build.py in a subprocess (with a timeout), so a broken reference solution cannot hang the check.
"""
import json
import sys
from pathlib import Path

DRIVER = Path(__file__).resolve().parents[2] / "apps" / "web" / "src" / "sandbox" / "driver.py"

if __name__ == "__main__":
    req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    real_stdout = sys.stdout
    ns: dict = {"__name__": "driver"}
    exec(compile(DRIVER.read_text(encoding="utf-8"), str(DRIVER), "exec"), ns)
    out = ns["check"](req["code"], json.dumps(req["tests"], ensure_ascii=False))
    real_stdout.buffer.write(out.encode("utf-8"))
