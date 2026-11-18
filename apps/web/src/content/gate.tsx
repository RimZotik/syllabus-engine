/**
 * The course goes in order — not only in menus, but on the pages themselves: a topic or a section test opened
 * by its address (a typed or bookmarked link) shows only if it is passed or is the next step.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { api, type Results } from "../api";
import { to } from "../current";
import { useApp } from "../state";
import { content } from "./registry";
import { isOpen, nextStep, type Step } from "./order";

/** true / false once known, undefined while the results load. */
export function useStepOpen(kind: Step["kind"], id: string): { open: boolean | undefined; next: Step | null } {
  const { program, progress } = useApp();
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => { setResults(null); api.results().then(setResults).catch(() => setResults({})); }, [kind, id]);
  const next = useMemo(() => (program && results ? nextStep(program, progress, results) : null), [program, progress, results]);
  if (!program || !results) return { open: undefined, next: null };
  // a topic that is not written yet has its own «not found» screen
  if (kind === "topic" && !content.hasTopic(id)) return { open: true, next };
  return { open: isOpen({ kind, id }, next, progress, results), next };
}

export function StepLocked({ next }: { next: Step | null }) {
  const href = next ? to(next.kind === "topic" ? `/learn/${next.id}` : `/test/${next.id}`) : to("/learn");
  return (
    <div className="wrap stub">
      <div className="eyebrow row-ic"><Lock size={15} />Ещё закрыто</div>
      <h1>Сюда вы ещё не дошли</h1>
      <p>Курс проходится по порядку: эта страница откроется, когда вы пройдёте всё, что идёт перед ней.</p>
      <Link className="btn" to={href}>{next ? "К следующему шагу" : "К учебному плану"}</Link>
    </div>
  );
}
