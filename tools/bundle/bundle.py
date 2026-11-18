"""Build a Windows app for ONE course: `npm run bundle -- <course-id>`.

Result: bundles/<course-id>/<course-id>.exe (+ a zip next to it) — the platform server, the built web
pages and that course only, in one file. The receiver double-clicks it; nothing to install. See
docs/platform/desktop-bundle.md.

Steps: a staging copy holds apps/web and courses/<id> only (so no other course gets into the build),
Vite builds the pages there, PyInstaller freezes the server with the pages and the course inside.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def run(cmd: list[str], cwd: Path, env: dict | None = None) -> None:
    print("›", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, check=True, shell=(os.name == "nt" and cmd[0] in ("npx", "npm")))


def junction(link: Path, target: Path) -> None:
    """node_modules is linked, not copied (Windows junction needs no admin rights)."""
    if os.name == "nt":
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, stdout=subprocess.DEVNULL)
    else:
        link.symlink_to(target, target_is_directory=True)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("course", help="folder name in courses/")
    ap.add_argument("--out", default=str(REPO / "bundles"), help="output folder (default: bundles/)")
    args = ap.parse_args()

    course = REPO / "courses" / args.course
    if not (course / "package.yaml").is_file():
        print(f"courses/{args.course}/package.yaml not found", file=sys.stderr)
        return 1
    out = Path(args.out) / args.course
    stage = Path(args.out) / f".stage-{args.course}"
    if stage.exists():
        shutil.rmtree(stage)
    out.mkdir(parents=True, exist_ok=True)

    # 1. staging: the web app and this one course
    skip = shutil.ignore_patterns("node_modules", "dist", ".vite", "*.tsbuildinfo")
    shutil.copytree(REPO / "apps" / "web", stage / "apps" / "web", ignore=skip)
    shutil.copytree(course, stage / "courses" / args.course, ignore=shutil.ignore_patterns("dev", "docs", "__pycache__"))
    (stage / "courses" / "active.yaml").write_text(f"active: {args.course}\n", encoding="utf-8")
    junction(stage / "node_modules", REPO / "node_modules")
    if (REPO / "apps" / "web" / "node_modules").is_dir():
        junction(stage / "apps" / "web" / "node_modules", REPO / "apps" / "web" / "node_modules")

    # 2. the web pages; Python in the browser only if the course has Python tasks
    has_python = any("python-browser" in p.read_text(encoding="utf-8") for p in course.glob("lessons/**/task.yaml"))
    run(["npx", "vite", "build"], cwd=stage / "apps" / "web",
        env={"SYLLABUS_NO_PYODIDE": "0" if has_python else "1", "SYLLABUS_PACKAGE": args.course})

    # 3. one .exe: server + pages + course
    sep = ";" if os.name == "nt" else ":"
    run(["uv", "run", "--project", str(REPO / "apps" / "server"), "--with", "pyinstaller", "pyinstaller",
         "--onefile", "--noconsole", "--clean", "--noconfirm",
         "--name", args.course,
         "--paths", str(REPO / "apps" / "server"),
         "--collect-submodules", "uvicorn",
         "--add-data", f"{stage / 'apps' / 'web' / 'dist'}{sep}web",
         "--add-data", f"{stage / 'courses'}{sep}courses",
         "--distpath", str(out), "--workpath", str(stage / "build"), "--specpath", str(stage),
         str(REPO / "apps" / "server" / "syllabus_server" / "desktop.py")], cwd=REPO)

    exe = out / f"{args.course}.exe"
    (out / "README.txt").write_text(
        "Запуск: двойной щелчок по файлу .exe — обучение откроется в отдельном окне.\r\n"
        "Устанавливать ничего не нужно. Прогресс сохраняется в папке %LOCALAPPDATA%\\SyllabusEngine.\r\n"
        "Преподаватель-ИИ (проверка развёрнутых ответов) работает, если на компьютере установлен и подключён Claude Code;\r\n"
        "без него обучение проходится полностью, кроме проверки развёрнутых ответов.\r\n", encoding="utf-8")
    with zipfile.ZipFile(Path(args.out) / f"{args.course}.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.write(exe, exe.name)
        z.write(out / "README.txt", "README.txt")
    shutil.rmtree(stage, ignore_errors=True)
    print(f"\nГотово: {exe}  ({exe.stat().st_size // 2**20} МБ)\nАрхив: {Path(args.out) / (args.course + '.zip')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
