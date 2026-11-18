"""tools/costs/costs.py: stages of subagents and of the main conversation, de-duplicated usage."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("costs", ROOT / "tools" / "costs" / "costs.py")
costs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(costs)


def test_stage_from_prefix_and_keywords():
    assert costs.stage_of_description("facts: prog1.functions definitions") == "facts"
    assert costs.stage_of_description("theory-review: prog1.functions") == "theory-review"
    assert costs.stage_of_description("Examiner: history questions") == "tests"
    assert costs.stage_of_description("Write theory: prog1.basics section") == "theory"
    assert costs.stage_of_description("Fact-check history section") == "facts"
    assert costs.stage_of_description("Something unrelated") == "other"


def _assistant(mid, out, tools=()):
    return {"type": "assistant", "message": {"id": mid, "model": "m", "content": list(tools),
            "usage": {"input_tokens": 10, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": out}}}


def _user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def test_main_segments_and_subagents(tmp_path):
    session = tmp_path / "s1.jsonl"
    edit_topic = {"type": "tool_use", "name": "Edit", "input": {"file_path": "C:/x/courses/pkg/lessons/a/b/01-t/topic.mdx"}}
    edit_app = {"type": "tool_use", "name": "Write", "input": {"file_path": "C:/x/apps/web/src/App.tsx"}}
    rows = [
        _user("обсудим план"), _assistant("a1", 100),
        _user("напиши тему"), _assistant("a2", 100, [edit_topic]), _assistant("a2", 100, [edit_topic]),  # same response twice
        _user("поправь платформу"), _assistant("a3", 100, [edit_app]),
    ]
    session.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    sub = tmp_path / "s1" / "subagents"
    sub.mkdir(parents=True)
    (sub / "agent-x.jsonl").write_text(json.dumps(_assistant("b1", 200)), encoding="utf-8")
    (sub / "agent-x.meta.json").write_text(json.dumps({"description": "tests: prog1 quiz"}), encoding="utf-8")

    acc, sessions = costs.collect([tmp_path])
    assert sessions == 1
    assert acc["discussion"]["output"] == 100
    assert acc["theory"]["output"] == 100          # counted once despite the duplicate entry
    assert acc["platform"]["output"] == 100
    assert acc["tests"]["output"] == 200 and acc["tests"]["agents"] == 1 and acc["tests"]["sub"] > 0
    assert costs.weighted({"input": 10, "cache_write_5m": 0, "cache_write_1h": 0, "cache_read": 0, "output": 100}) == 510
