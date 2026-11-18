"""The packaged app (tools/bundle): one .exe with the server, the built web pages and one course inside.

Double-click → the server starts on a free local port and the course opens in its own window
(Microsoft Edge in app mode, which every Windows 10/11 has; the default browser otherwise).
Closing the window stops the app. Learner data lives in %LOCALAPPDATA%\\SyllabusEngine.
The AI teacher works only if Claude Code is installed and logged in; without it the course runs
without written-answer checks, as in development.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
DATA = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "SyllabusEngine"
os.environ.setdefault("SYLLABUS_CONTENT_ROOT", str(BASE / "courses"))
os.environ.setdefault("SYLLABUS_WEB_DIST", str(BASE / "web"))
os.environ.setdefault("SYLLABUS_DATA_DIR", str(DATA))
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _log() -> None:
    """Without a console there is nowhere to print: everything goes to a log file."""
    (DATA / "logs").mkdir(parents=True, exist_ok=True)
    f = open(DATA / "logs" / "desktop.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = f
    print(f"\n--- start {time.strftime('%Y-%m-%d %H:%M:%S')}")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _edge() -> str | None:
    for root in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if root:
            p = Path(root) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if p.is_file():
                return str(p)
    return None


def _wait_up(url: str, seconds: float = 30) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url + "api/health", timeout=1)
            return True
        except OSError:
            time.sleep(0.2)
    return False


def main() -> None:
    _log()
    import uvicorn
    from syllabus_server.app import create_app
    from syllabus_server.settings import active_package

    # SYLLABUS_HEADLESS_PORT: serve on that port without a window (checks of a build, no window on screen)
    headless = os.environ.get("SYLLABUS_HEADLESS_PORT")
    port = int(headless) if headless else _free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_config=None, access_log=False))
    threading.Thread(target=server.run, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    if not _wait_up(url):
        print("server did not start")
        return
    start = url + active_package()
    print("serving", start)
    if headless:
        while True:
            time.sleep(3600)
    edge = _edge()
    if edge:
        # its own profile makes it a separate Edge process: the window closing ends it, and then the app
        window = subprocess.Popen([edge, f"--app={start}", f"--user-data-dir={DATA / 'window'}", "--no-first-run",
                                   "--no-default-browser-check", "--window-size=1280,860"], creationflags=NO_WINDOW)
        window.wait()
    else:
        webbrowser.open(start)
        while True:  # no window to watch: keep serving until the process is ended
            time.sleep(3600)
    server.should_exit = True


if __name__ == "__main__":
    main()
