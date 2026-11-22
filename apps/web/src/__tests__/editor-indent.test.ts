import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { acceptCompletion, CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { indentMore, insertNewlineAndIndent } from "@codemirror/commands";
import { backspaceIndent, editorExtensions, OWN_BOOST } from "../components/editorSetup";

/** A stand-in for EditorView (no DOM in these tests): commands only read `state` and call `dispatch`. */
function view(doc: string, at: number) {
  const v = {
    state: EditorState.create({ doc, selection: EditorSelection.cursor(at), extensions: editorExtensions() }),
    dispatch(tr: Parameters<EditorView["dispatch"]>[0]) { v.state = (tr as { state: EditorState }).state; },
  };
  return v as unknown as EditorView;
}

describe("editor indentation — 4 spaces, as in the course examples", () => {
  it("Tab indents by 4 spaces", () => {
    const v = view("x = 1", 0);
    indentMore(v);
    expect(v.state.doc.toString()).toBe("    x = 1");
  });

  it("Enter after a colon indents by 4 spaces", () => {
    const v = view("if x:", 5);
    insertNewlineAndIndent(v);
    expect(v.state.doc.toString()).toBe("if x:\n    ");
  });

  it("Backspace in leading spaces removes a whole level", () => {
    const v = view("if x:\n        y", 14);
    expect(backspaceIndent(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("if x:\n    y");
    const odd = view("      y", 6); // 6 spaces → back to 4
    backspaceIndent(odd);
    expect(odd.state.doc.toString()).toBe("    y");
  });

  it("a suggestion is taken with Tab, never with Enter", () => {
    const bindings = view("", 0).state.facet(keymap).flat();
    const tab = bindings.filter((b) => b.key === "Tab");
    expect(tab[0].run).toBe(acceptCompletion); // before Tab-indent: with a list open Tab takes the suggestion
    expect(bindings.some((b) => b.key === "Enter" && b.run === acceptCompletion)).toBe(false);
  });

  it("names defined in the learner's code come before built-ins", async () => {
    const doc = "total_sum = 0\ndef tally(items):\n    return items\nt";
    const state = EditorState.create({ doc, extensions: editorExtensions() });
    const ctx = new CompletionContext(state, doc.length, true);
    const options = (await Promise.all(state.languageDataAt<CompletionSource>("autocomplete", doc.length).map((s) => s(ctx))))
      .flatMap((r) => r?.options ?? []);
    const own = options.filter((o) => ["total_sum", "tally", "items"].includes(o.label));
    expect(own.map((o) => o.label)).toEqual(expect.arrayContaining(["tally", "total_sum"]));
    expect(own.every((o) => o.boost === OWN_BOOST)).toBe(true);
    expect(options.find((o) => o.label === "tuple")?.boost ?? 0).toBeLessThan(OWN_BOOST);
  });

  it("Backspace after text is an ordinary one-character delete", () => {
    const v = view("    ab", 6);
    expect(backspaceIndent(v)).toBe(false);
  });
});
