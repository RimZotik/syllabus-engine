/**
 * Finds the content of the ACTIVE learning package (`@pkg` = courses/<id>/, set in vite.config.ts).
 * Layout inside the package (docs/template/course-package.md):
 *   lessons/<discipline>/<section>/<NN-slug>/topic.mdx   → topic id  <discipline>.<section>.<NN>
 *   lessons/<discipline>/<section>/<NN-slug>/quiz.yaml   → topic test
 *   lessons/<discipline>/<section>/test.yaml             → section test (контрольная)
 *   lessons/<discipline>/<section>/<NN-slug>/tasks/<id>/task.yaml → coding task, <Sandbox task="<id>" />
 */
import type { ComponentType } from "react";
import { sectionIdOf, topicIdOf } from "./paths";

export type TopicMeta = { minutes?: number; lead?: string };
export type TopicModule = { default: ComponentType<{ components?: Record<string, unknown> }>; meta?: TopicMeta };
export type Question = {
  id: string; type: "single" | "multi" | "open"; q: string; options?: string[];
  answer?: number | number[]; explain?: string; rubric?: string[];
  /** for the teacher: typical wrong answers and follow-up probes of the oral check */
  wrong_answers?: string[]; followups?: string[];
  /** wrong options deliberately worded like the lecture — the teacher watches them */
  traps?: number[];
};
export type QuizData = { title?: string; pass?: number; minutes?: number; questions: Question[] };

export type IoCase = { name?: string; stdin?: string; stdout: string; hidden?: boolean };
export type AssertCase = { name?: string; code: string; message?: string };
export type Task = {
  id: string; title: string; sandbox: "python-browser"; difficulty?: number; concepts?: string[];
  statement: string; starter?: string; solution?: string;
  /** default input for the «Запустить» button */
  stdin?: string;
  /** forbid — names the solution must not use (tasks «write your own max»), checked on the code's syntax tree */
  tests: { io?: IoCase[]; asserts?: AssertCase[]; stdin?: string; forbid?: string[] };
  hints?: { level: number; text: string }[];
  timeout_ms?: number;
};

const topicFiles = import.meta.glob<TopicModule>("@pkg/lessons/*/*/*/topic.mdx");
const quizFiles = import.meta.glob<{ default: QuizData }>("@pkg/lessons/*/*/*/quiz.yaml", { eager: true });
const testFiles = import.meta.glob<{ default: QuizData }>("@pkg/lessons/*/*/test.yaml", { eager: true });

const taskFiles = import.meta.glob<{ default: Task }>("@pkg/lessons/*/*/*/tasks/*/task.yaml", { eager: true });
const tasks = new Map<string, Task>();
for (const mod of Object.values(taskFiles)) tasks.set(mod.default.id, mod.default);

const topics = new Map<string, () => Promise<TopicModule>>();
for (const [path, load] of Object.entries(topicFiles)) topics.set(topicIdOf(path), load);

const quizzes = new Map<string, QuizData>();
for (const [path, mod] of Object.entries(quizFiles)) quizzes.set(topicIdOf(path), mod.default);

const sectionTests = new Map<string, QuizData>();
for (const [path, mod] of Object.entries(testFiles)) sectionTests.set(sectionIdOf(path), mod.default);

export const content = {
  hasTopic: (id: string) => topics.has(id),
  loadTopic: (id: string) => topics.get(id)?.(),
  quiz: (id: string) => quizzes.get(id),
  sectionTest: (sectionId: string) => sectionTests.get(sectionId),
  authoredCount: () => topics.size,
  task: (id: string) => tasks.get(id),
};
