// Function tasks (`tests.calls`) on the page side: the call line and the expected value as Python would print them,
// so the learner sees `first_over([300, 1200], 1000)` and `'450'` (a string) vs `450` (a number) before the first check.
import type { CallCase, TaskTests } from "../content/registry";
import type { TestResult } from "./runner";

function pyStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let body = s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  if (q === "'") body = body.replace(/'/g, "\\'");
  return q + body + q;
}

/** A YAML/JSON value written the way Python's repr() writes it: None, True, 'text', [1, 2], {'a': 1}. */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (typeof v === "object") return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${pyStr(k)}: ${pyRepr(x)}`).join(", ")}}`;
  return String(v);
}

/** `name(arg1, arg2, k=v)` for a case. `args_py` is a Python tuple literal like "((1, 2), {3})" — its outer brackets become the call's. */
export function callText(fn: string, c: CallCase): string {
  const kw = Object.entries(c.kwargs ?? {}).map(([k, v]) => `${k}=${pyRepr(v)}`);
  let pos: string;
  if (c.args_py !== undefined) {
    const t = c.args_py.trim();
    pos = /^[([].*[)\]]$/s.test(t) ? t.slice(1, -1).trim().replace(/,$/, "") : t;
  } else pos = (c.args ?? []).map(pyRepr).join(", ");
  return `${fn}(${[pos, ...kw].filter(Boolean).join(", ")})`;
}

/** What the case expects, as shown under «Должна вернуть». */
export function expectText(c: CallCase): string {
  if (c.raises) return `ошибка ${c.raises}`;
  return c.expect_py !== undefined ? c.expect_py : pyRepr(c.expect);
}

/** The function-task cases as the learner sees them before the first check (hidden ones by name only). */
export function callCases(tests: TaskTests): TestResult[] {
  const fn = tests.function ?? "";
  return (tests.calls ?? []).map((c, i) => ({
    name: c.name ?? `Тест ${i + 1}`, ok: false, hidden: c.hidden,
    ...(c.hidden ? {} : { call: callText(fn, c), expected: expectText(c) }),
  }));
}

/** The calls the learner can watch «По шагам»: every visible case. */
export function traceCalls(tests: TaskTests): { name: string; text: string }[] {
  return callCases(tests).filter((c) => !c.hidden && c.call).map((c) => ({ name: c.name, text: c.call! }));
}
