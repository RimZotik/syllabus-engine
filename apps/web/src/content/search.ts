/**
 * Search over what the learner has passed: topics, glossary terms and the <Theorem> blocks of finished topics.
 * The theorem index is read from the topics' own MDX text, so nothing is authored twice.
 */
import { currentPackage } from "../current";
import { allTerms } from "./glossary";
import { score } from "./match";

import index from "virtual:theorems";

export type TheoremEntry = { topicId: string; kind: "definition" | "theorem" | "rule"; title: string; text: string };

export const theorems = (): TheoremEntry[] => (index as (TheoremEntry & { pkg: string })[]).filter((e) => e.pkg === currentPackage());

export type Hit =
  | { kind: "topic"; id: string; title: string; where: string; score: number; order: number }
  | { kind: "term"; id: string; title: string; text: string; where: string; score: number; order: number }
  | { kind: "theorem"; entry: TheoremEntry; title: string; text: string; where: string; score: number; order: number };

export { allTerms, score };
