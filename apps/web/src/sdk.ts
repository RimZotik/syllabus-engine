// What a course package's own components (courses/<id>/components/) may use from the platform.
// Import it as "@syllabus/sdk" — never by a relative path into apps/web.
import { useCallback, useRef, useState } from "react";
import { load, store } from "./persist";
import { currentPackage } from "./current";
import { api, type Grade } from "./api";
import { useApp } from "./state";

type SetState<T> = (v: T | ((prev: T) => T)) => void;

/**
 * useState that remembers the value for this topic: leave the page, come back or reload — the demo is where
 * the learner left it. The key is the topic's address plus `name`, so two demos on one topic need two names.
 * Returns [value, set, reset]; `reset()` goes back to `initial` and forgets the saved value.
 */
export function usePageState<T>(name: string, initial: T): [T, SetState<T>, () => void] {
  // the address inside the package (/learn/<topic>): the same key as before packages had their own addresses
  const base = `/${currentPackage()}`, path = location.pathname;
  const inner = path === base || path.startsWith(base + "/") ? path.slice(base.length) : path;
  const key = useRef(`page:${inner}:${name}`).current;
  const [value, setValue] = useState<T>(() => load(key, initial));
  const set: SetState<T> = useCallback((v) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      store(key, next);
      return next;
    });
  }, [key]);
  const reset = useCallback(() => { setValue(initial); store(key, null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set, reset];
}


// ── a package's own exercises: trainers, drag-and-drop, simulators ─────────────
// A component in courses/<id>/components/ can be a full exercise without changes to the platform:
// it keeps its state (usePageState), reports what the learner did (recordAttempt) and, where code cannot
// judge, asks the teacher (askTeacher). Both land in the learner's history next to tests and written answers,
// so the teacher sees them at exams and in the teaching audit.

/** The topic or section test of the open page: /<package>/learn/<topic> → "<topic>". */
export function pageScope(path = location.pathname): string {
  const m = /\/(learn|test)\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[2]) : "site";
}

export type ExerciseResult = {
  /** what the learner answered or built — any JSON (chosen words, placed items, numbers) */
  answer: unknown;
  /** checked by the component itself: true / false; null when only the teacher can judge */
  correct: boolean | null;
  seconds?: number;
};

/** Save one attempt of an exercise (`exerciseId` is unique within the topic). */
export function recordAttempt(exerciseId: string, r: ExerciseResult): Promise<unknown> {
  return api.saveAttempts([{ scope: pageScope(), item_id: exerciseId, kind: "exercise", answer: r.answer ?? null, correct: r.correct, seconds: r.seconds ?? null }]);
}

export type TeacherRequest = {
  /** the task as the learner saw it */
  question: string;
  /** what a good answer contains — the teacher checks exactly these points */
  rubric: string[];
  /** typical mistakes the teacher may name */
  wrongAnswers?: string[];
  /** the learner's work in words: the component describes its state (e.g. «Иванов — субъект, договор — объект») */
  answer: string;
};

/**
 * The teacher (Claude) checks the learner's work by the rubric — the same check as a written answer:
 * met / partly / missing per point, a short comment, no ready answer. Rejects when Claude is not available;
 * show that politely and do not block the learner (see `useTeacher`).
 */
export function askTeacher(exerciseId: string, req: TeacherRequest): Promise<Grade> {
  return api.grade({ scope: pageScope(), item_id: exerciseId, question: req.question, rubric: req.rubric, wrong_answers: req.wrongAnswers ?? [], answer: req.answer, confidence: null });
}

/** Whether the teacher can check right now (Claude Code installed). */
export function useTeacher(): { available: boolean } {
  const { claude } = useApp();
  return { available: !!claude?.installed };
}
