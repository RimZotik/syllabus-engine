import { describe, expect, it } from "vitest";
import { examStarted, fieldRight, isPartial, isRight, optionMark, restartState, unanswered, type Saved } from "../components/quizLogic";
import type { Question, QuizData } from "../content/registry";

const multi = { id: "m", type: "multi", q: "?", options: ["a", "b", "c", "d"], answer: [0, 2] } as Question;
const single = { id: "s", type: "single", q: "?", options: ["a", "b"], answer: 1 } as Question;
const open1 = { id: "o1", type: "open", q: "?" } as Question;
const open2 = { id: "o2", type: "open", q: "?" } as Question;
const data = { questions: [multi, single, open1, open2] } as QuizData;

describe("marks after «Сдать»", () => {
  it("multi: chosen correct is right, missed correct is yellow, chosen wrong is red", () => {
    expect([0, 1, 2, 3].map((i) => optionMark(multi, [0, 1], i))).toEqual(["right", "wrong", "missed", ""]);
  });
  it("single: the correct option is right even if not chosen", () => {
    expect([0, 1].map((i) => optionMark(single, 0, i))).toEqual(["wrong", "right"]);
  });
  it("partial only when nothing wrong is chosen and something correct is missed", () => {
    expect(isPartial(multi, [0])).toBe(true);
    expect(isPartial(multi, [0, 2])).toBe(false);
    expect(isPartial(multi, [0, 1])).toBe(false);
    expect(isPartial(multi, [])).toBe(false);
    expect(isPartial(single, 0)).toBe(false);
  });
});

describe("«Пройти заново»", () => {
  const prev: Saved = {
    order: [], done: true, score: 0.5,
    answers: { m: [0], s: 1, o1: "принятый ответ", o2: "ответ на доработку" },
    conf: { o1: 4, o2: 2 },
    grades: {
      o1: { verdict: "pass", feedback: "Хорошо", attempt: 1 } as Saved["grades"][string],
      o2: { verdict: "revise", feedback: "Дополните", attempt: 2 } as Saved["grades"][string],
    },
  };
  const next = restartState(data, prev);
  it("resets auto-graded answers and the submitted state", () => {
    expect(next.done).toBe(false);
    expect(next.answers.m).toBeUndefined();
    expect(next.answers.s).toBeUndefined();
    expect(next.order.map((o) => o.id).slice(-2)).toEqual(["o1", "o2"]);
  });
  it("keeps an accepted written answer with the teacher's comment", () => {
    expect(next.answers.o1).toBe("принятый ответ");
    expect(next.grades.o1?.verdict).toBe("pass");
    expect(next.conf.o1).toBe(4);
  });
  it("keeps a non-accepted written answer with the teacher's comment, so the learner knows what to fix", () => {
    expect(next.answers.o2).toBe("ответ на доработку");
    expect(next.grades.o2?.verdict).toBe("revise");
    expect(next.grades.o2?.feedback).toBe("Дополните");
  });
});

describe("section test (exam)", () => {
  const base: Saved = { order: [{ id: "m", perm: [0, 1, 2, 3] }, { id: "s", perm: [0, 1] }, { id: "o1", perm: [] }, { id: "o2", perm: [] }], answers: {}, conf: {}, done: false, grades: {} };
  it("counts as started after «Начать» or, for older saved states, once something is answered", () => {
    expect(examStarted(base)).toBe(false);
    expect(examStarted({ ...base, started: true })).toBe(true);
    expect(examStarted({ ...base, answers: { s: 1 } })).toBe(true);
    expect(examStarted({ ...base, answers: { s: 1 }, started: false })).toBe(false);
  });
  it("names unanswered questions by their shown number; written ones only when they can be written", () => {
    const s = { ...base, answers: { m: [], s: 0, o1: "текст" } };
    expect(unanswered(s, data, true)).toEqual([1, 4]);
    expect(unanswered(s, data, false)).toEqual([1]);
  });
  it("keeps the history of attempts through a retake", () => {
    const prev: Saved = { ...base, done: true, history: [{ n: 1, score: 0.5, correct: 1, total: 2, at: "t", answers: {} }] };
    expect(restartState(data, prev).history).toHaveLength(1);
  });
});

describe("fields questions (a journal entry)", () => {
  const q = { id: "e", type: "fields" as const, q: "Проводка", fields: [
    { label: "Дебет", answer: ["0 401 20 211", "40120211"] }, { label: "Кредит", answer: "0 302 11 730" }, { label: "КОСГУ", answer: "211" }] };
  it("accepts any listed variant, ignoring spaces and case", () => {
    expect(isRight(q, ["40120211", "0 302 11 730", " 211 "])).toBe(true);
    expect(fieldRight(q, ["0 401 20 211"], 0)).toBe(true);
  });
  it("one wrong or empty field makes the whole answer wrong", () => {
    expect(isRight(q, ["40120211", "030211730", "212"])).toBe(false);
    expect(isRight(q, ["40120211", "030211730"])).toBe(false);
    expect(fieldRight(q, ["", "", ""], 2)).toBe(false);
  });
});

describe("code questions", () => {
  const code: Question = { id: "c", type: "code", q: "Допишите", starter: "x = 1\n", tests: { io: [{ stdout: "2" }] }, solution: "print(2)" };
  const one: Question = { id: "s", type: "single", q: "?", options: ["a", "b"], answer: 0 };
  const open: Question = { id: "o", type: "open", q: "?", rubric: ["r"] };
  const data: QuizData = { questions: [open, code, one] };

  it("counts only code that passed its tests", () => {
    expect(isRight(code, { code: "print(2)", ok: true })).toBe(true);
    expect(isRight(code, { code: "print(2)" })).toBe(false); // changed since the last check
    expect(isRight(code, undefined)).toBe(false);
  });

  it("goes after choice questions and before written ones", async () => {
    const { freshOrder } = await import("../components/quizLogic");
    expect(freshOrder(data).map((o) => o.id)).toEqual(["s", "c", "o"]);
  });

  it("the untouched starter is not an answer", () => {
    const st: Saved = { order: [{ id: "c", perm: [] }], answers: { c: { code: "x = 1\n" } }, conf: {}, done: false, grades: {} };
    expect(unanswered(st, { questions: [code] }, true)).toEqual([1]);
    st.answers.c = { code: "print(2)" };
    expect(unanswered(st, { questions: [code] }, true)).toEqual([]);
  });

  it("a passed program survives «Пройти заново», a failed one starts over", () => {
    const prev: Saved = { order: [], answers: { c: { code: "print(2)", ok: true } }, conf: {}, done: true, grades: {} };
    expect(restartState({ questions: [code] }, prev).answers.c).toEqual({ code: "print(2)", ok: true });
    prev.answers.c = { code: "print(3)", ok: false };
    expect(restartState({ questions: [code] }, prev).answers.c).toBeUndefined();
  });
});
