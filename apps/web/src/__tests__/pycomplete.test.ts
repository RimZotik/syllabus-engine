import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { dotCompletions } from "../components/pyComplete";

/** Labels offered when the cursor stands at the end of `code`. */
function offered(code: string): string[] {
  const state = EditorState.create({ doc: code });
  const r = dotCompletions(new CompletionContext(state, code.length, false));
  return r ? r.options.map((o) => o.label) : [];
}

describe("suggestions after a dot", () => {
  it("knows the type from a literal, a call or the name's assignment", () => {
    expect(offered('"abc".')).toContain("split");
    expect(offered("name = input()\nname.")).toContain("strip");
    expect(offered("name = input().strip()\nname.")).toContain("lower");
    expect(offered("xs = [1, 2]\nxs.")).toContain("append");
    expect(offered("xs = [1, 2]\nxs.")).not.toContain("split");
    expect(offered("d = {'a': 1}\nd.")).toContain("items");
    expect(offered("words = line.split()\nwords.")).toContain("sort");
    expect(offered("with open('a.txt', encoding='utf-8') as f:\n    f.")).toContain("readlines");
  });
  it("lists a module's names, also through aliases and from-imports", () => {
    expect(offered("import math\nmath.")).toContain("sqrt");
    expect(offered("import statistics as st\nst.")).toContain("median");
    expect(offered("import os\nos.path.")).toContain("join");
    expect(offered("from datetime import date\ndate.")).toContain("today");
    expect(offered("from datetime import datetime\nd = datetime.now()\nd.")).toContain("strftime");
  });
  it("offers the common containers' methods when the type is unknown, and nothing where a dot is not a member access", () => {
    const any = offered("def f(x):\n    return x.");
    expect(any).toContain("split");
    expect(any).toContain("append");
    expect(offered("x = 3.")).toEqual([]);
    expect(offered("import os.")).toEqual([]);
    expect(offered("# see math.")).toEqual([]);
  });
});
