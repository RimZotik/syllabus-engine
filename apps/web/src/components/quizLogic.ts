import type { Grade } from "../api";
import type { Question, QuizData } from "../content/registry";

export type Answer = number | number[] | string | string[] | undefined;
/** What is stored on the server, so a finished test stays finished after leaving the page. */
export type Saved = {
  order: { id: string; perm: number[] }[];
  answers: Record<string, Answer>;
  conf: Record<string, number>;
  done: boolean;
  grades: Record<string, Grade>;
  /** share of auto-graded questions answered correctly, set on «Сдать» */
  score?: number;
  submitted_at?: string;
  /** section test: the learner pressed «Начать контрольную» */
  started?: boolean;
  /** every submitted attempt, so the teacher can later see how the learner corrected mistakes */
  history?: { n: number; score: number; correct: number; total: number; at: string; answers: Record<string, Answer> }[];
};

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** How field answers are compared: no spaces, no case, decimal comma = point («0 401 20 223» = «040120223»). Dots stay meaningful (0.5 ≠ 05): list dotted forms like «0.401.20.223» as extra variants. */
export const normField = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/,/g, ".").replace(/ё/g, "е");

/** Whether field `i` of a `fields` question is filled correctly. */
export function fieldRight(q: Question, a: Answer, i: number): boolean {
  const f = q.fields?.[i];
  if (!f) return false;
  const got = normField(String(((a as string[]) ?? [])[i] ?? ""));
  return got !== "" && (Array.isArray(f.answer) ? f.answer : [f.answer]).some((x) => normField(String(x)) === got);
}

export function isRight(q: Question, a: Answer): boolean | null {
  if (q.type === "open") return null;
  if (q.type === "fields") return (q.fields ?? []).every((_, i) => fieldRight(q, a, i));
  if (q.type === "single") return a === q.answer;
  const want = [...((q.answer as number[]) ?? [])].sort().join(",");
  return [...((a as number[]) ?? [])].sort().join(",") === want;
}

/**
 * How an option looks after «Сдать»: chosen and correct — right (green), chosen but incorrect — wrong (red),
 * correct but not chosen in a multi-answer question — missed (yellow). In a single-answer question the
 * correct option is simply shown as right.
 */
export function optionMark(q: Question, a: Answer, i: number): "right" | "wrong" | "missed" | "" {
  const correct = q.type === "single" ? q.answer === i : ((q.answer as number[]) ?? []).includes(i);
  const chosen = q.type === "single" ? a === i : ((a as number[]) ?? []).includes(i);
  if (correct) return q.type === "multi" && !chosen ? "missed" : "right";
  return chosen ? "wrong" : "";
}

/** Multi-answer question with no wrong option chosen, but not all correct ones: partly right (still not counted). */
export function isPartial(q: Question, a: Answer): boolean {
  if (q.type !== "multi") return false;
  const want = (q.answer as number[]) ?? [];
  const got = (a as number[]) ?? [];
  return got.length > 0 && got.every((i) => want.includes(i)) && got.length < want.length;
}

// New order of questions and options on every attempt: no position bias, no memorising «the second one».
// Auto-graded questions are shuffled; questions with a written answer always go last.
export function freshOrder(data: QuizData): Saved["order"] {
  return [...shuffled(data.questions.filter((q) => q.type !== "open")), ...data.questions.filter((q) => q.type === "open")]
    .map((q) => ({ id: q.id, perm: shuffled((q.options ?? []).map((_, i) => i)) }));
}

export const fresh = (data: QuizData): Saved => ({ order: freshOrder(data), answers: {}, conf: {}, done: false, grades: {} });

/** The written answer the teacher has already accepted — it is kept and locked when the test is retaken. */
export const accepted = (s: Saved, id: string) => s.grades[id]?.verdict === "pass";

/**
 * «Пройти заново»: auto-graded questions start over in a new order. Written answers are kept with the
 * teacher's last comment: an accepted one stays accepted (no new check, nothing to retype); any other one
 * stays editable — the comment says what to fix — and is checked again on «Сдать».
 */
export function restartState(data: QuizData, prev: Saved): Saved {
  const next: Saved = { ...fresh(data), history: prev.history };
  for (const q of data.questions.filter((x) => x.type === "open")) {
    if (prev.answers[q.id] !== undefined) next.answers[q.id] = prev.answers[q.id];
    if (prev.conf[q.id] !== undefined) next.conf[q.id] = prev.conf[q.id];
    if (prev.grades[q.id]) next.grades[q.id] = prev.grades[q.id];
  }
  return next;
}

/** A section test counts as started if the learner pressed «Начать» — or, for states saved before that button existed, already answered something. */
export const examStarted = (s: Saved) => s.started ?? Object.keys(s.answers).some((id) => s.answers[id] !== undefined && s.answers[id] !== "");

/** Numbers (1-based, in the shown order) of questions without an answer. Written answers count only when they can be written. */
export function unanswered(s: Saved, data: QuizData, openAvailable: boolean): number[] {
  const byId = new Map(data.questions.map((q) => [q.id, q]));
  return s.order.flatMap(({ id }, i) => {
    const q = byId.get(id); const a = s.answers[id];
    if (!q) return [];
    const empty = q.type === "open" ? openAvailable && !String(a ?? "").trim()
      : q.type === "fields" ? (q.fields ?? []).some((_, j) => !String(((a as string[]) ?? [])[j] ?? "").trim())
      : a === undefined || (Array.isArray(a) && a.length === 0);
    return empty ? [i + 1] : [];
  });
}

/** A saved state is reused only if the test itself has not changed since (same questions, same option counts). */
export function fits(s: Saved | null, data: QuizData): s is Saved {
  if (!s || !Array.isArray(s.order) || s.order.length !== data.questions.length) return false;
  const byId = new Map(data.questions.map((q) => [q.id, q]));
  return s.order.every((o) => byId.has(o.id) && o.perm.length === (byId.get(o.id)!.options ?? []).length);
}
