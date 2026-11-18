"""The course backlog: notes on the course from the learner, the teacher and the reviewers (docs/dev/backlog.md).

    npm run feedback                                   # open items as Markdown — the inbox to work through
    npm run feedback -- --status fixed                 # closed ones, with level and resolution
    npm run feedback -- --add "текст" --topic intro1.what --source system        # an item found by a reviewer
    npm run feedback -- --resolve 12 --level pipeline --note "правило в style-guide §14" [--status wontfix]
"""
from __future__ import annotations

import argparse
import sys

from .db import connect, migrate, transaction
from .settings import use_package

LABELS = {"content_issue": "Проблема в материале", "bug": "Ошибка платформы", "idea": "Идея", "question": "Вопрос по курсу"}
LEVELS = {"course": "курс", "pipeline": "конвейер", "platform": "платформа"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", default="open")
    ap.add_argument("--package", help="learning package id (default: courses/active.yaml)")
    ap.add_argument("--add", metavar="TEXT", help="add an item (found by a reviewer, the teacher audit, Claude)")
    ap.add_argument("--topic", help="topic or section id for --add")
    ap.add_argument("--source", default="system", choices=["learner", "teacher", "system"])
    ap.add_argument("--kind", default="content_issue", choices=list(LABELS))
    ap.add_argument("--resolve", type=int, metavar="ID", help="close an item")
    ap.add_argument("--level", choices=list(LEVELS), help="where the fix belongs: this course, the pipeline (rules for every course), the platform")
    ap.add_argument("--note", help="what was changed, or why not")
    args = ap.parse_args()
    use_package(args.package)
    db = connect(); migrate(db)
    sys.stdout.reconfigure(encoding="utf-8")

    if args.add:
        with transaction(db):
            cur = db.execute("INSERT INTO feedback (kind, source, topic_id, text) VALUES (?, ?, ?, ?)", (args.kind, args.source, args.topic, args.add))
        print(f"added #{cur.lastrowid}")
        return 0
    if args.resolve:
        if not args.level or not args.note:
            print("--resolve needs --level and --note", file=sys.stderr)
            return 2
        status = args.status if args.status in ("fixed", "wontfix", "triaged") else "fixed"
        with transaction(db):
            n = db.execute("UPDATE feedback SET status = ?, level = ?, resolution = ?, resolved_at = datetime('now') WHERE id = ?",
                           (status, args.level, args.note, args.resolve)).rowcount
        print(f"#{args.resolve}: {status}, {LEVELS[args.level]}" if n else f"#{args.resolve} not found")
        return 0 if n else 1

    rows = db.execute("SELECT * FROM feedback WHERE status = ? ORDER BY topic_id, id", (args.status,)).fetchall()
    if not rows:
        print("Открытых замечаний нет." if args.status == "open" else "Таких замечаний нет.")
        return 0
    print(f"# Замечания к курсу ({len(rows)})\n")
    for r in rows:
        page = f" · страница {r['page'] + 1}" if r["page"] is not None else ""
        print(f"- **#{r['id']} · {LABELS[r['kind']]}** · {r['source']} · тема `{r['topic_id'] or '—'}`{page} · {r['created_at']}")
        if r["quote"]:
            for q in r["quote"].split("\n\n"):
                print(f"  > {q}")
        print(f"  {r['text']}")
        if r["resolution"]:
            print(f"  → {LEVELS.get(r['level'], r['level'])}: {r['resolution']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
