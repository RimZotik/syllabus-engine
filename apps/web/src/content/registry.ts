/**
 * Finds course content on disk. Folder layout (see docs/content/authoring.md):
 *   content/courses/<course>/<discipline>/<section>/<NN-slug>/topic.mdx   → topic id  <discipline>.<section>.<NN>
 *   content/courses/<course>/<discipline>/<section>/<NN-slug>/quiz.yaml   → topic test
 *   content/courses/<course>/<discipline>/<section>/test.yaml             → section test (контрольная)
 */
import type { ComponentType } from "react";

export type TopicMeta = { minutes?: number; lead?: string };
export type TopicModule = { default: ComponentType<{ components?: Record<string, unknown> }>; meta?: TopicMeta };
export type Question = {
  id: string; type: "single" | "multi" | "open"; q: string; options?: string[];
  answer?: number | number[]; explain?: string; rubric?: string[];
};
export type QuizData = { title?: string; pass?: number; minutes?: number; questions: Question[] };

const topicFiles = import.meta.glob<TopicModule>("../../../../content/courses/**/topic.mdx");
const quizFiles = import.meta.glob<{ default: QuizData }>("../../../../content/courses/**/quiz.yaml", { eager: true });
const testFiles = import.meta.glob<{ default: QuizData }>("../../../../content/courses/*/*/*/test.yaml", { eager: true });

function parts(path: string): string[] {
  return path.split("/content/courses/")[1].split("/");
}
function topicIdOf(path: string): string {
  const [, disc, section, folder] = parts(path);
  return `${disc}.${section}.${parseInt(folder, 10)}`;
}

const topics = new Map<string, () => Promise<TopicModule>>();
for (const [path, load] of Object.entries(topicFiles)) topics.set(topicIdOf(path), load);

const quizzes = new Map<string, QuizData>();
for (const [path, mod] of Object.entries(quizFiles)) quizzes.set(topicIdOf(path), mod.default);

const sectionTests = new Map<string, QuizData>();
for (const [path, mod] of Object.entries(testFiles)) {
  const [, disc, section] = parts(path);
  sectionTests.set(`${disc}.${section}`, mod.default);
}

export const content = {
  hasTopic: (id: string) => topics.has(id),
  loadTopic: (id: string) => topics.get(id)?.(),
  quiz: (id: string) => quizzes.get(id),
  sectionTest: (sectionId: string) => sectionTests.get(sectionId),
  authoredCount: () => topics.size,
};
