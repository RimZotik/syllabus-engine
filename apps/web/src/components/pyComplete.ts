/**
 * Suggestions after a dot: `text.` → string methods, `math.` → the module's functions, with signatures.
 * Python is not run for this: the type of what stands before the dot is guessed from the code itself —
 * a literal (`"…".`, `[…].`), a call (`input().`, `open(…).`), an import (`import math`, `from datetime import date`)
 * or the name's last assignment (`name = input()`). When the type is unknown, the methods of str, list, dict
 * and set are offered together, each marked with its type. Data: pyCompletions.json (tools/program/gen_completions.py).
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import DATA from "./pyCompletions.json";

type Entry = { label: string; type: string; detail: string };
const D = DATA as { types: Record<string, Entry[]>; modules: Record<string, Entry[]>; classes: Record<string, Entry[]> };

// what a call returns, for `f(...).`
const CALLS: Record<string, string> = {
  input: "str", str: "str", repr: "str", chr: "str", format: "str", int: "int", len: "int", ord: "int", round: "int", float: "float",
  list: "list", sorted: "list", dict: "dict", set: "set", tuple: "tuple", open: "file", bytes: "bytes",
  Path: "class:Path", Counter: "class:Counter", date: "class:date", datetime: "class:datetime", timedelta: "class:timedelta",
};
// string methods that give a string / a list back, for chains like `s.strip().` or `s.split().`
const STR_TO_STR = new Set(["strip", "lstrip", "rstrip", "lower", "upper", "title", "capitalize", "replace", "join", "casefold", "center", "ljust", "rjust", "zfill", "format", "removeprefix", "removesuffix", "swapcase", "expandtabs"]);
const TO_LIST = new Set(["split", "rsplit", "splitlines", "readlines", "keys", "values", "items", "findall"]);

type Kind = string | null; // "str" | … | "module:math" | "class:Path" | null (unknown)

/** Names bound by imports: alias → "module:x" or "class:Y". */
function imports(doc: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of doc.split("\n")) {
    const imp = line.match(/^\s*import\s+(.+)$/);
    if (imp) for (const part of imp[1].split(",")) {
      const [mod, alias] = part.trim().split(/\s+as\s+/);
      if (mod) m.set(alias ?? mod.split(".")[0], `module:${alias ? mod : mod.split(".")[0]}`);
    }
    const from = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/);
    if (from) for (const part of from[2].replace(/[()]/g, "").split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (!name) continue;
      const sub = `${from[1]}.${name}`;
      if (D.modules[sub]) m.set(alias ?? name, `module:${sub}`);
      else if (D.classes[name]) m.set(alias ?? name, `class:${name}`);
    }
  }
  return m;
}

/** Type of an expression's text (the right side of an assignment or what stands before a dot). */
function exprKind(expr: string, doc: string, imp: Map<string, string>, depth = 0): Kind {
  const e = expr.trim();
  if (!e || depth > 4) return null;
  if (/^[rbfu]*["']/i.test(e) || /["']$/.test(e)) return /^b["']/i.test(e) ? "bytes" : "str";
  if (/^-?\d+$/.test(e)) return "int";
  if (/^-?\d*\.\d+$|^-?\d+\.\d*$/.test(e)) return "float";
  if (e.startsWith("[")) return "list";
  if (e.startsWith("(") && e.endsWith(")") && e.includes(",")) return "tuple";
  if (e.startsWith("{")) return /^\{\s*\}$/.test(e) || /:/.test(e) ? "dict" : "set";
  // a call: name(...) or something.method(...)
  const call = e.match(/^(.*?)([A-Za-z_]\w*)\s*\((?:[^()]|\([^()]*\))*\)$/);
  if (call) {
    const [, before, fn] = call;
    if (!before) return CALLS[fn] ?? null;
    if (before.endsWith(".")) {
      const owner = exprKind(before.slice(0, -1), doc, imp, depth + 1);
      if (owner === "str" && STR_TO_STR.has(fn)) return "str";
      if (TO_LIST.has(fn)) return "list";
      // datetime.now(), date.fromisoformat(…), dt.replace(…) give an object of the same class
      if (owner?.startsWith("class:") && /^(now|today|utcnow|strptime|fromisoformat|fromtimestamp|combine|replace|astimezone|with_suffix|with_name|resolve|absolute|joinpath)$/.test(fn)) return owner;
      if (owner?.startsWith("module:") || owner?.startsWith("class:")) return CALLS[fn] ?? null;
      return null;
    }
    return null;
  }
  // a dotted name: module.sub or module.Class
  if (/^[A-Za-z_][\w.]*$/.test(e)) {
    const parts = e.split(".");
    const head = imp.get(parts[0]);
    if (head) {
      if (parts.length === 1) return head;
      const path = `${head.slice(head.indexOf(":") + 1)}.${parts.slice(1).join(".")}`;
      if (D.modules[path]) return `module:${path}`;
      const last = parts[parts.length - 1];
      return D.classes[last] ? `class:${last}` : null;
    }
    if (parts.length === 1) return nameKind(e, doc, imp, depth + 1);
  }
  return null;
}

/** Type of a name from its last binding in the code: `name = …`, `with open(…) as name`. */
function nameKind(name: string, doc: string, imp: Map<string, string>, depth: number): Kind {
  const lines = doc.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const asg = l.match(new RegExp(`^\\s*${name}\\s*(?::\\s*[\\w\\[\\], ]+)?=(?!=)\\s*(.+?)\\s*(?:#.*)?$`));
    if (asg) return exprKind(asg[1], lines.slice(0, i).join("\n"), imp, depth);
    const ann = l.match(new RegExp(`\\b${name}\\s*:\\s*(str|int|float|list|dict|set|tuple)\\b`));
    if (ann) return ann[1];
    if (new RegExp(`\\bas\\s+${name}\\s*:`).test(l) && /open\s*\(/.test(l)) return "file";
  }
  return null;
}

const TYPE_ICON: Record<string, Completion["type"]> = { method: "method", function: "function", class: "class", constant: "constant", namespace: "namespace" };
// the name is already the label: the detail shows only the parameters, «(sep=None, maxsplit=-1)»
const params = (e: Entry) => (e.detail.startsWith(e.label) ? e.detail.slice(e.label.length) : e.detail);
const toOption = (e: Entry, from?: string): Completion => ({ label: e.label, type: TYPE_ICON[e.type] ?? "property", detail: from ? `${from} · ${params(e)}` : params(e), boost: e.type === "method" || e.type === "function" ? 1 : 0 });

function entriesFor(kind: Kind): Completion[] {
  if (kind?.startsWith("module:")) return (D.modules[kind.slice(7)] ?? []).map((e) => toOption(e));
  if (kind?.startsWith("class:")) return (D.classes[kind.slice(6)] ?? []).map((e) => toOption(e));
  if (kind && D.types[kind]) return D.types[kind].map((e) => toOption(e));
  // unknown: the common containers together, each option says whose method it is
  const seen = new Map<string, Completion>();
  for (const t of ["str", "list", "dict", "set"]) for (const e of D.types[t]) {
    const prev = seen.get(e.label);
    if (prev) prev.detail = `${prev.detail!.split(" · ")[0]}, ${t} · ${prev.detail!.split(" · ")[1]}`;
    else seen.set(e.label, toOption(e, t));
  }
  return [...seen.values()];
}

/** Receiver text right before the dot on this line: a name chain, a literal or a call. */
function receiver(line: string): string {
  let i = line.length - 1, depth = 0;
  for (; i >= 0; i--) {
    const c = line[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "(" || c === "[" || c === "{") { if (depth === 0) break; depth--; }
    else if (depth === 0 && (c === '"' || c === "'")) {
      const open = line.lastIndexOf(c, i - 1);
      if (open < 0) break;
      i = open;
      while (i > 0 && /[rbfuRBFU]/.test(line[i - 1])) i--;
      if (i > 0 && /[\w.)\]]/.test(line[i - 1])) continue;
      break;
    }
    else if (depth === 0 && !/[\w.]/.test(c)) break;
  }
  return line.slice(i + 1);
}

export function dotCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\.\w*$/);
  if (!word) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, word.from - line.from);
  if (/^\s*(from|import)\b/.test(before) || /#/.test(before.replace(/(["']).*?\1/g, ""))) return null; // imports, comments
  const recv = receiver(before);
  if (!recv || /^\d+$/.test(recv)) return null; // `3.` is a number, not a method call
  const doc = ctx.state.doc.sliceString(0, line.from);
  const options = entriesFor(exprKind(recv, doc, imports(ctx.state.doc.toString())));
  return options.length ? { from: word.from + 1, options, validFor: /^\w*$/ } : null;
}
