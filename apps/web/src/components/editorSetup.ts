/**
 * The code editor's look and behaviour — close to VS Code (Light+ / Dark+ colours, set as CSS variables in
 * styles.css so they follow the site's theme). Deliberately left out of CodeMirror's basicSetup: the
 * highlighted current line and the highlighting of every other occurrence of the selected word.
 */
import { EditorView, drawSelection, dropCursor, highlightSpecialChars, keymap, lineNumbers, rectangularSelection, type Command } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { python, pythonLanguage } from "@codemirror/lang-python";
import { dotCompletions } from "./pyComplete";
import { tags as t } from "@lezer/highlight";

const v = (name: string) => `var(--tok-${name})`;

const pythonColors = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.modifier, t.operatorKeyword], color: v("keyword") },
  { tag: [t.controlKeyword, t.moduleKeyword], color: v("control") },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: v("function") },
  { tag: [t.definition(t.className), t.className, t.typeName, t.standard(t.variableName)], color: v("type") },
  { tag: [t.variableName, t.propertyName, t.definition(t.variableName), t.attributeName], color: v("variable") },
  { tag: [t.self, t.bool, t.null, t.atom], color: v("keyword") },
  { tag: [t.number, t.integer, t.float], color: v("number") },
  { tag: [t.string, t.special(t.string), t.docString], color: v("string") },
  { tag: [t.escape, t.regexp], color: v("escape") },
  { tag: [t.comment, t.lineComment], color: v("comment"), fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: v("punct") },
  { tag: t.invalid, color: v("invalid") },
]);

const look = EditorView.theme({
  "&": { fontSize: "15px", backgroundColor: "var(--ed-bg)", color: "var(--tok-variable)", borderRadius: "var(--r-m)" },
  ".cm-content": { fontFamily: "var(--f-mono)", padding: "12px 0", caretColor: "var(--ed-caret)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ed-caret)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--ed-gutter)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--ed-selection) !important" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--ed-bracket)", outline: "1px solid var(--ed-bracket-line)", color: "inherit" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "transparent", color: "var(--tok-invalid)" },
  // autocompletion list — follows the theme instead of staying white
  ".cm-tooltip": { backgroundColor: "var(--ed-popup)", color: "var(--ink)", border: "1px solid var(--line-2)", borderRadius: "8px", overflow: "hidden", boxShadow: "0 8px 24px -12px rgba(0,0,0,.45)" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--f-mono)", fontSize: "14px", maxHeight: "14em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px !important", lineHeight: "1.5" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--ed-popup-sel)", color: "var(--ink)" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700", color: "var(--tok-keyword)" },
  ".cm-completionIcon": { opacity: ".7" },
  ".cm-completionDetail": { color: "var(--ink-3)", fontStyle: "normal", marginLeft: "0" },
});

/** One indent level = 4 spaces, as in every example of the course and PEP 8 (Tab, Enter after «:»). */
export const INDENT = "    ";

/** Backspace in the leading spaces of a line removes a whole indent level, like VS Code — one press, not four. */
export const backspaceIndent: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.some((r) => !r.empty)) return false;
  const changes = state.selection.ranges.map((r) => {
    const line = state.doc.lineAt(r.head);
    const before = state.sliceDoc(line.from, r.head);
    if (!before.length || /[^ ]/.test(before)) return null;
    const to = Math.floor((before.length - 1) / INDENT.length) * INDENT.length;
    return { from: line.from + to, to: r.head };
  });
  if (changes.some((c) => c === null)) return false;
  view.dispatch(state.update({ changes: changes as { from: number; to: number }[], scrollIntoView: true, userEvent: "delete.backward" }));
  return true;
};

/** Everything the editor needs; `extra` goes first so its keys win (e.g. Ctrl+Enter). */
export function editorExtensions(extra: Extension[] = []): Extension[] {
  return [
    ...extra,
    lineNumbers(), highlightSpecialChars(), history(), drawSelection(), dropCursor(),
    EditorState.allowMultipleSelections.of(true), indentUnit.of(INDENT), EditorState.tabSize.of(4),
    indentOnInput(), bracketMatching(), closeBrackets(),
    // a suggestion is taken with Tab; Enter always starts a new line (the list closes on its own)
    autocompletion({ defaultKeymap: false }), rectangularSelection(),
    keymap.of([{ key: "Tab", run: acceptCompletion }, ...completionKeymap.filter((b) => b.key !== "Enter"),
      { key: "Backspace", run: backspaceIndent }, indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
    python(), pythonLanguage.data.of({ autocomplete: dotCompletions }), syntaxHighlighting(pythonColors), look,
  ];
}
