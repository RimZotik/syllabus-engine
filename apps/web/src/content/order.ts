// The learning path in program order: written topics, each section followed by its section test.
// The next step is the first topic not done or, once a section's topics are done, its test if not passed.
import type { Program, Progress, Results } from "../api";
import { content } from "./registry";

export type Step = { kind: "topic" | "test"; id: string };

export function nextStep(program: Program | null, progress: Progress, results: Results): Step | null {
  for (const c of program?.courses ?? []) for (const d of c.disciplines) for (const s of d.sections) {
    for (const t of s.topics) if (content.hasTopic(t.id) && progress[t.id]?.status !== "done") return { kind: "topic", id: t.id };
    if (s.topics.some((t) => content.hasTopic(t.id)) && content.sectionTest(s.id) && !results[s.id]?.passed) return { kind: "test", id: s.id };
  }
  return null;
}

// `order: free` in package.yaml: every topic and test is open at once (a group that follows its teacher's pace).
// Set from the package passport when it loads (state.tsx).
let freeOrder = false;
export const setFreeOrder = (v: boolean) => { freeOrder = v; };
export const isFreeOrder = () => freeOrder;

/** Whether a step may be opened from overviews (the record book): what is passed, and the next step. */
export function isOpen(step: Step, next: Step | null, progress: Progress, results: Results): boolean {
  if (freeOrder) return true;
  const passed = step.kind === "topic" ? progress[step.id]?.status === "done" : !!results[step.id]?.passed;
  return passed || (next?.kind === step.kind && next.id === step.id);
}
