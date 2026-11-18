/**
 * The «Справочник» is not written separately: it is assembled from what the topics already contain.
 * A topic's <Theorem> blocks (definitions, theorems, rules) are rendered straight from the topic's own MDX,
 * with everything around them switched off — one source for the lesson, the reference and the validator.
 */
import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { currentPackage, to } from "../current";
import { content } from "./registry";
import { mdxComponents, Theorem } from "./components";
import { useApp } from "../state";
import { api } from "../api";
import { examStarted, fits, type Saved } from "../components/quizLogic";

const Inside = createContext(false);

// tags that markdown produces at the top level of a topic; inside a <Theorem> they render as usual
const HTML = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "thead", "tbody", "tr", "th", "td", "hr", "div", "img", "a", "strong", "em", "code", "span",
  "sup", "sub", "br", "del", "s", "section", "input", "svg", "path", "figure", "figcaption", "mark", "b", "i", "small", "dl", "dt", "dd", "details", "summary", "kbd", "math"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gate(C: any): ComponentType<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function Gated(props: any) { return useContext(Inside) ? <C {...props} /> : null; };
}

const cache = new Map<string, Record<string, unknown>>();
function referenceComponents(only?: string): Record<string, unknown> {
  const key = `${currentPackage()}\u0000${only ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Record<string, unknown> = {};
  cache.set(key, out);
  for (const t of HTML) out[t] = gate(t);
  for (const [name, C] of Object.entries(mdxComponents())) out[name] = gate(C);
  out.Page = ({ children }: { children: ReactNode }) => <>{children}</>;
  out.Theorem = (p: Parameters<typeof Theorem>[0]) => (only && p.title !== only ? null : <Inside.Provider value={true}><Theorem {...p} /></Inside.Provider>);
  return out;
}

/** Only the definitions, theorems and rules of one topic, rendered from its MDX. */
export function TopicTheorems({ topicId, only }: { topicId: string; only?: string }) {
  const [Mod, setMod] = useState<ComponentType<{ components?: Record<string, unknown> }> | null>(null);
  useEffect(() => {
    let alive = true;
    content.loadTopic(topicId)?.then((m) => { if (alive) setMod(() => m.default); });
    return () => { alive = false; };
  }, [topicId]);
  if (!Mod) return null;
  return <div className="ref-theorems"><Mod components={referenceComponents(only)} /></div>;
}

/**
 * The section test (контрольная) whose attempt is in progress, if any: during it the reference, notes and
 * lessons are closed, as at a real exam. `undefined` while loading.
 */
export function useExamInProgress(): string | null | undefined {
  const { program } = useApp();
  const [active, setActive] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!program) return;
    const ids = program.courses.flatMap((c) => c.disciplines.flatMap((d) => d.sections.map((s) => s.id))).filter((id) => content.sectionTest(id));
    let alive = true;
    Promise.all(ids.map((id) => api.quizState<Saved>(id).then((r) => (r.state && fits(r.state, content.sectionTest(id)!) && !r.state.done && examStarted(r.state) ? id : null)).catch(() => null)))
      .then((found) => { if (alive) setActive(found.find(Boolean) ?? null); });
    return () => { alive = false; };
  }, [program]);
  return active;
}


/** Shown instead of the reference, notes and lessons while a section test is in progress. */
export function ExamLock({ sectionId, what }: { sectionId: string; what: string }) {
  return (
    <div className="wrap stub">
      <div className="eyebrow row-ic"><Lock size={15} />Идёт контрольная</div>
      <h1>{what} закрыт{what.endsWith("а") ? "а" : ""}</h1>
      <p>Во время контрольной справочник, заметки и темы недоступны — как на настоящем экзамене. Они откроются, когда вы сдадите работу.</p>
      <Link className="btn" to={to(`/test/${sectionId}`)}>Вернуться к контрольной</Link>
    </div>
  );
}
