import { describe, expect, it } from "vitest";
import { examStarted, isPartial, optionMark, restartState, unanswered, type Saved } from "../components/quizLogic";
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
  it("keeps a non-accepted written answer as a draft without the old verdict", () => {
    expect(next.answers.o2).toBe("ответ на доработку");
    expect(next.grades.o2).toBeUndefined();
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
