"""Claude Code presence check (same approach as montage-studio).

Only checks that the `claude` CLI exists and reports its version. Subscription limits
(rate_limit_event from `claude -p` stream-json) are wired in stage 4.
"""
from __future__ import annotations

import shutil
import subprocess
import time

_cache: dict = {"at": 0.0, "value": None}


def status(ttl: float = 300.0) -> dict:
    if _cache["value"] is not None and time.time() - _cache["at"] < ttl:
        return _cache["value"]
    exe = shutil.which("claude")
    value: dict = {"installed": False, "version": None, "limits": None}
    if exe:
        try:
            out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
            value = {"installed": True, "version": out.split()[0] if out else None, "limits": None}
        except (OSError, subprocess.TimeoutExpired):
            value = {"installed": True, "version": None, "limits": None}
    _cache.update(at=time.time(), value=value)
    return value
