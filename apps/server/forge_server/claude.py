"""Claude Code presence check (same approach as montage-studio).

Only checks that the `claude` CLI exists and reports its version. Subscription limits
(rate_limit_event from `claude -p` stream-json) are wired in stage 4.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

_cache: dict = {"at": 0.0, "value": None}


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
    if v is not None and time.time() - _cache["at"] < (ttl if v["installed"] else missing_ttl):
        return v
    exe = find_exe()
    value: dict = {"installed": False, "version": None, "limits": None}
    if exe:
        try:
            out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
            value = {"installed": True, "version": out.split()[0] if out else None, "limits": None}
        except (OSError, subprocess.TimeoutExpired):
            value = {"installed": True, "version": None, "limits": None}
    _cache.update(at=time.time(), value=value)
    return value
