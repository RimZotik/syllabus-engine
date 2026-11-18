import type { Grade } from "../api";
import type { Question, QuizData } from "../content/registry";

export type Answer = number | number[] | string | undefined;
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
};

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function isRight(q: Question, a: Answer): boolean | null {
  if (q.type === "open") return null;
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
 * «Пройти заново»: auto-graded questions start over in a new order. Written answers are kept: an accepted
 * one stays accepted with the teacher's comment (no new check, nothing to retype); any other one stays
 * as an editable draft and is checked again on «Сдать».
 */
export function restartState(data: QuizData, prev: Saved): Saved {
  const next = fresh(data);
  for (const q of data.questions.filter((x) => x.type === "open")) {
    if (prev.answers[q.id] !== undefined) next.answers[q.id] = prev.answers[q.id];
    if (prev.conf[q.id] !== undefined) next.conf[q.id] = prev.conf[q.id];
    if (accepted(prev, q.id)) next.grades[q.id] = prev.grades[q.id];
  }
  return next;
}

/** A saved state is reused only if the test itself has not changed since (same questions, same option counts). */
export function fits(s: Saved | null, data: QuizData): s is Saved {
  if (!s || !Array.isArray(s.order) || s.order.length !== data.questions.length) return false;
  const byId = new Map(data.questions.map((q) => [q.id, q]));
  return s.order.every((o) => byId.has(o.id) && o.perm.length === (byId.get(o.id)!.options ?? []).length);
}
