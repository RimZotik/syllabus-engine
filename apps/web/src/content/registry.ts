/**
 * Finds the content of every installed learning package (`@courses` = courses/, set in vite.config.ts);
 * the package of the open page (current.ts) answers. Layout inside a package (docs/template/course-package.md):
 *   lessons/<discipline>/<section>/<NN-slug>/topic.mdx   → topic id  <discipline>.<section>.<NN>
 *   lessons/<discipline>/<section>/<NN-slug>/quiz.yaml   → topic test
 *   lessons/<discipline>/<section>/test.yaml             → section test (контрольная)
 *   lessons/<discipline>/<section>/<NN-slug>/tasks/<id>/task.yaml → coding task, <Sandbox task="<id>" />
 */
import type { ComponentType } from "react";
import { packageOf, sectionIdOf, topicIdOf } from "./paths";
import { currentPackage } from "../current";

export type TopicMeta = { minutes?: number; lead?: string };
export type TopicModule = { default: ComponentType<{ components?: Record<string, unknown> }>; meta?: TopicMeta };
export type Question = {
  id: string; type: "single" | "multi" | "open" | "fields" | "code"; q: string; options?: string[];
  /** type `code`: write, complete, fix or change a program; graded by running its tests (same format as a task's) */
  starter?: string; solution?: string; tests?: Task["tests"]; timeout_ms?: number;
  /** type `fields`: fill in named fields (a journal entry: Дебет, Кредит, КОСГУ, КФО; a value and its unit…).
   *  Each field accepts one or several equivalent answers; compared without spaces, case and with «,» = «.». */
  fields?: { label: string; answer: string | string[]; placeholder?: string }[];
  answer?: number | number[]; explain?: string; rubric?: string[];
  /** for the teacher: typical wrong answers and follow-up probes of the oral check */
  wrong_answers?: string[]; followups?: string[];
  /** wrong options deliberately worded like the lecture — the teacher watches them */
  traps?: number[];
};
export type QuizData = { title?: string; pass?: number; minutes?: number; questions: Question[] };

/** `files` — this case's own files on top of the task's; `files_out` — files the program must leave (name → text). */
export type IoCase = { name?: string; stdin?: string; stdout: string; hidden?: boolean; files?: Record<string, string>; files_out?: Record<string, string> };
export type TaskTests = { io?: IoCase[]; asserts?: AssertCase[]; stdin?: string; forbid?: string[]; files?: Record<string, string> };
export type AssertCase = { name?: string; code: string; message?: string };
export type Task = {
  id: string; title: string; sandbox: "python-browser"; difficulty?: number; concepts?: string[];
  statement: string; starter?: string; solution?: string;
  /** default input for the «Запустить» button */
  stdin?: string;
  /** forbid — names the solution must not use (tasks «write your own max»), checked on the code's syntax tree */
  tests: TaskTests;
  hints?: { level: number; text: string }[];
  timeout_ms?: number;
};

const topicFiles = import.meta.glob<TopicModule>("../../../../courses/*/lessons/*/*/*/topic.mdx");
const quizFiles = import.meta.glob<{ default: QuizData }>("../../../../courses/*/lessons/*/*/*/quiz.yaml", { eager: true });
const testFiles = import.meta.glob<{ default: QuizData }>("../../../../courses/*/lessons/*/*/test.yaml", { eager: true });
const taskFiles = import.meta.glob<{ default: Task }>("../../../../courses/*/lessons/*/*/*/tasks/*/task.yaml", { eager: true });

type Pkg = { topics: Map<string, () => Promise<TopicModule>>; quizzes: Map<string, QuizData>; tests: Map<string, QuizData>; tasks: Map<string, Task> };
const packages = new Map<string, Pkg>();
const pkgOf = (path: string): Pkg => {
  const id = packageOf(path);
  let p = packages.get(id);
  if (!p) packages.set(id, (p = { topics: new Map(), quizzes: new Map(), tests: new Map(), tasks: new Map() }));
  return p;
};
for (const [path, load] of Object.entries(topicFiles)) pkgOf(path).topics.set(topicIdOf(path), load);
for (const [path, mod] of Object.entries(quizFiles)) pkgOf(path).quizzes.set(topicIdOf(path), mod.default);
for (const [path, mod] of Object.entries(testFiles)) pkgOf(path).tests.set(sectionIdOf(path), mod.default);
for (const [path, mod] of Object.entries(taskFiles)) pkgOf(path).tasks.set(mod.default.id, mod.default);

const EMPTY: Pkg = { topics: new Map(), quizzes: new Map(), tests: new Map(), tasks: new Map() };
const cur = () => packages.get(currentPackage()) ?? EMPTY;

export const content = {
  hasTopic: (id: string) => cur().topics.has(id),
  loadTopic: (id: string) => cur().topics.get(id)?.(),
  quiz: (id: string) => cur().quizzes.get(id),
  sectionTest: (sectionId: string) => cur().tests.get(sectionId),
  authoredCount: () => cur().topics.size,
  task: (id: string) => cur().tasks.get(id),
};
