"""The packaged app (tools/bundle): one .exe with the server, the built web pages and one course inside.

Double-click → the server starts on the course's own local port and the course opens in the learner's
default browser (Chrome, Edge, Firefox…). Running it again while it works just opens the course again.
The app stops by itself a few minutes after the last course tab is closed: open pages poll the server
(`/api/claude`) every 30–60 seconds, background tabs at least once a minute.
Learner data lives in %LOCALAPPDATA%/SyllabusEngine. The AI teacher works only if Claude Code is installed
and logged in; without it the course runs without written-answer checks, as in development.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
import zlib
from pathlib import Path

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
DATA = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "SyllabusEngine"
os.environ.setdefault("SYLLABUS_CONTENT_ROOT", str(BASE / "courses"))
os.environ.setdefault("SYLLABUS_WEB_DIST", str(BASE / "web"))
os.environ.setdefault("SYLLABUS_DATA_DIR", str(DATA))
IDLE_EXIT = int(os.environ.get("SYLLABUS_IDLE_EXIT", 5 * 60))   # seconds without a request from an open page → the app stops
FIRST_GRACE = int(os.environ.get("SYLLABUS_FIRST_GRACE", 3 * 60))  # the browser may take a while to open the first page


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


def _port_for(pkg: str) -> int:
    """A fixed port per course: the browser keeps the page's own settings (theme, demo state) between runs."""
    return 47000 + zlib.crc32(pkg.encode()) % 1000


def _ours(url: str, pkg: str) -> bool:
    """Whether this app with the same course already serves at url."""
    try:
        with urllib.request.urlopen(url + "api/package", timeout=1) as r:
            return json.load(r).get("id") == pkg
    except (OSError, ValueError):
        return False


def _busy(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


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

    pkg = active_package()
    # SYLLABUS_HEADLESS_PORT: serve on that port without opening a browser (checks of a build)
    headless = os.environ.get("SYLLABUS_HEADLESS_PORT")
    port = int(headless) if headless else _port_for(pkg)
    url = f"http://127.0.0.1:{port}/"
    if not headless and _busy(port):
        if _ours(url, pkg):
            print("already running, opening", url + pkg)
            webbrowser.open(url + pkg)
            return
        port = _free_port()  # another program holds the course's port
        url = f"http://127.0.0.1:{port}/"
    app = create_app()
    seen = {"last": time.time(), "any": False}

    @app.middleware("http")
    async def page_alive(request, call_next):  # every request of an open page counts as "still used"
        seen["last"], seen["any"] = time.time(), True
        return await call_next(request)

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, access_log=False))
    threading.Thread(target=server.run, daemon=True).start()
    if not _wait_up(url):
        print("server did not start")
        return
    start = url + pkg
    print("serving", start)
    if headless:
        while True:
            time.sleep(3600)
    webbrowser.open(start)
    tick = time.time()
    while True:
        time.sleep(5)
        now = time.time()
        if now - tick > 60:  # the computer slept: the pages had no chance to call, start counting anew
            seen["last"] = now
        tick = now
        if now - seen["last"] > (IDLE_EXIT if seen["any"] else FIRST_GRACE):
            print("no open pages, stopping")
            break
    server.should_exit = True
    time.sleep(1)


if __name__ == "__main__":
    main()
