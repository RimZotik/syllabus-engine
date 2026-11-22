"""Claude Code presence check and subscription limits (same approach as montage-studio).

Checks that the `claude` CLI exists and reports its version. Subscription limits come from the
`rate_limit_event` that `claude -p --output-format stream-json --verbose` prints on every call:
utilization of the 5-hour and 7-day windows plus reset times. Every call the platform makes
(grading, the small refresh probe) updates them; the platform never reads Claude credentials.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

# On Windows every call of the claude CLI would otherwise flash a console window and steal the focus.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_cache: dict = {"at": 0.0, "value": None}
_limits: dict = {"value": None}
_probe_lock = threading.Lock()


def find_exe() -> str | None:
    """`claude` on PATH, or in the usual install folders (the server may start with a shorter PATH)."""
    exe = shutil.which("claude")
    if exe:
        return exe
    home = Path.home()
    candidates = [home / ".local" / "bin" / "claude.exe", home / ".local" / "bin" / "claude",
                  home / ".claude" / "local" / "claude", home / ".claude" / "local" / "claude.exe"]
    if os.environ.get("APPDATA"):
        candidates.append(Path(os.environ["APPDATA"]) / "npm" / "claude.cmd")
    return next((str(p) for p in candidates if p.is_file()), None)


def status(ttl: float = 300.0, missing_ttl: float = 15.0) -> dict:
    """Cached; when Claude is missing the cache is short, so an install is noticed without restarting."""
    v = _cache["value"]
    if v is None or time.time() - _cache["at"] >= (ttl if v["installed"] else missing_ttl):
        exe = find_exe()
        v = {"installed": False, "version": None}
        if exe:
            try:
                out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10, creationflags=NO_WINDOW).stdout.strip()
                v = {"installed": True, "version": out.split()[0] if out else None}
            except (OSError, subprocess.TimeoutExpired):
                v = {"installed": True, "version": None}
        _cache.update(at=time.time(), value=v)
    return v | {"limits": _limits["value"]}


def _window(w: dict | None) -> dict | None:
    if not isinstance(w, dict) or "utilization" not in w:
        return None
    return {"used": float(w["utilization"]), "resets_at": w.get("resetsAt"), "status": w.get("status")}


def note_rate_limit(info: dict) -> None:
    """Remember the latest limits from a `rate_limit_event`."""
    win = info.get("unifiedWindows") or {}
    five, week = _window(win.get("five_hour")), _window(win.get("seven_day"))
    if five or week:
        _limits["value"] = {"five_hour": five, "seven_day": week, "updated_at": time.time()}


def run_stream(args: list[str], prompt: str, timeout: int) -> dict:
    """Run `claude -p` with stream-json output; record limits; return the final `result` event (or {})."""
    exe = find_exe()
    if not exe:
        raise FileNotFoundError("claude")
    proc = subprocess.run([exe, "-p", "--output-format", "stream-json", "--verbose", *args], input=prompt,
                          capture_output=True, text=True, encoding="utf-8", timeout=timeout, creationflags=NO_WINDOW)
    result: dict = {}
    for line in proc.stdout.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "rate_limit_event":
            note_rate_limit(ev.get("rate_limit_info") or {})
        elif ev.get("type") == "result":
            result = ev
    return result


def _window_reset(cur: dict) -> bool:
    """A remembered window whose reset time has passed is stale even if it was read a minute ago."""
    now = time.time()
    for w in (cur.get("five_hour"), cur.get("seven_day")):
        r = (w or {}).get("resets_at")
        if isinstance(r, (int, float)) and r <= now:
            return True
    return False


def refresh_limits(max_age: float = 300.0) -> dict | None:
    """Tiny haiku call just to read the limits; skipped while they are fresh. Costs a negligible share of the quota."""
    cur = _limits["value"]
    if cur and time.time() - cur["updated_at"] < max_age and not _window_reset(cur):
        return cur
    if not _probe_lock.acquire(blocking=False):
        return cur
    try:
        run_stream(["--tools", "", "--model", "haiku", "--no-session-persistence", "--strict-mcp-config"], "Ответь одним словом: ок", 60)
    except (OSError, subprocess.TimeoutExpired):
        pass
    finally:
        _probe_lock.release()
    return _limits["value"]
