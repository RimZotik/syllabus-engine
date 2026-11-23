import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { callCases, callText, expectText, pyRepr, traceCalls } from "../sandbox/calls";
import { RichText } from "../components/RichText";

describe("function tasks (tests.calls) on the page", () => {
  it("writes values the way Python's repr does", () => {
    expect(pyRepr([1, "a", null, true, 2.5, { k: [] }])).toBe("[1, 'a', None, True, 2.5, {'k': []}]");
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr("a\nb")).toBe("'a\\nb'");
  });
  it("builds the call line from args, args_py and kwargs", () => {
    expect(callText("f", { args: [[300, 1200], 1000] })).toBe("f([300, 1200], 1000)");
    expect(callText("f", { args: [[]], kwargs: { sep: "," } })).toBe("f([], sep=',')");
    expect(callText("f", { args_py: "((1, 2), {3})" })).toBe("f((1, 2), {3})");
    expect(callText("f", { args_py: "((1, 2),)" })).toBe("f((1, 2))");
    expect(callText("f", { args: [] })).toBe("f()");
  });
  it("shows the expected value, a raised error, and hides hidden cases' data", () => {
    expect(expectText({ expect: "450" })).toBe("'450'");
    expect(expectText({ expect: null })).toBe("None");
    expect(expectText({ raises: "ValueError" })).toBe("ошибка ValueError");
    const tests = { function: "g", calls: [{ args: [1], expect: 2 }, { name: "Край", args: [0], expect: 0, hidden: true }] };
    expect(callCases(tests)).toEqual([
      { name: "Тест 1", ok: false, hidden: undefined, call: "g(1)", expected: "2" },
      { name: "Край", ok: false, hidden: true },
    ]);
    expect(traceCalls(tests)).toEqual([{ name: "Тест 1", text: "g(1)" }]);
  });
  it("labels ```call / ```return examples in a statement", () => {
    const html = renderToStaticMarkup(<RichText text={"```call\nf([1])\n```\n```return\n1\n```"} />);
    expect(html).toContain("<span>Вызов</span>");
    expect(html).toContain("<span>Возвращает</span>");
  });
});
