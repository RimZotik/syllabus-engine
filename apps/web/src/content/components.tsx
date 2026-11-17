/**
 * Components available inside topic.mdx. Rules for authors: docs/content/style-guide.md.
 * Adding a component here makes it available to every topic at once.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, BookMarked, Check as CheckIcon, History, Lightbulb } from "lucide-react";
import { useApp } from "../state";
import { term as lookup } from "./glossary";
import { Sandbox } from "../components/Sandbox";

/** One page of a topic. The reader shows pages one at a time. */
export function Page({ children }: { title: string; minutes?: number; children: ReactNode }) {
  return <>{children}</>;
}

export function Mark({ children }: { children: ReactNode }) {
  return <mark>{children}</mark>;
}

/** Glossary term: hover — short definition, click — the "Справка" drawer. */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const { openTerm } = useApp();
  const t = lookup(id);
  return (
    <span className="term" role="button" tabIndex={0} onClick={() => openTerm(id)} onKeyDown={(e) => e.key === "Enter" && openTerm(id)}>
      {children ?? t?.term ?? id}
      {t && <span className="tip">{t.short}<small>Нажмите, чтобы открыть справку</small></span>}
    </span>
  );
}

const CALLOUT = {
  warning: { icon: AlertTriangle, label: "Внимание" },
  remember: { icon: BookMarked, label: "Запомните" },
  history: { icon: History, label: "Из истории" },
  example: { icon: Lightbulb, label: "Пример" },
} as const;

export function Callout({ kind = "remember", title, children }: { kind?: keyof typeof CALLOUT; title?: string; children: ReactNode }) {
  const c = CALLOUT[kind];
  const Icon = c.icon;
  return (
    <div className={`callout ${kind}`}>
      <Icon size={20} />
      <div><b className="title">{title ?? c.label}</b>{children}</div>
    </div>
  );
}

/** Definitions, theorems and rules get their own visual block.
 *  `formal` — the generally accepted wording (with `source`); children — the same in plain words. */
export function Theorem({ kind = "definition", title, formal, source, children }: { kind?: "definition" | "theorem" | "rule"; title: string; formal?: string; source?: string; children: ReactNode }) {
  const label = { definition: "Определение", theorem: "Теорема", rule: "Правило" }[kind];
  return (
    <div className={`theorem ${kind}`}>
      <div className="head"><span className="kind">{label}</span><b>{title}</b></div>
      {formal && <blockquote className="formal">{formal}{source && <cite>{source}</cite>}</blockquote>}
      {formal ? <div className="plain"><span className="eyebrow">Простыми словами</span>{children}</div> : children}
    </div>
  );
}

export function Figure({ caption, wide, children }: { caption?: string; wide?: boolean; children: ReactNode }) {
  return <figure className={`figure${wide ? " wide" : ""}`} style={{ margin: "10px 0 26px" }}>{children}{caption && <figcaption className="cap">{caption}</figcaption>}</figure>;
}

/** Inline «Проверь себя» question. */
export function Check({ q, options, answer, explain }: { q: string; options: string[]; answer: number; explain: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className="check">
      <div className="eyebrow">Проверь себя</div>
      <div className="q">{q}</div>
      {options.map((o, i) => (
        <button key={i} className={`opt${picked === null ? "" : i === answer ? " right" : i === picked ? " wrong" : ""}`} onClick={() => setPicked(i)} disabled={picked !== null}>
          <input type="radio" readOnly checked={picked === i} tabIndex={-1} />{o}
        </button>
      ))}
      {picked !== null && <div className="explain">{picked === answer ? "Верно. " : "Не совсем. "}{explain}</div>}
    </div>
  );
}

export function Summary({ items }: { items: string[] }) {
  return (
    <div className="summary">
      <div className="eyebrow">Итог темы</div>
      <ul>{items.map((t) => <li key={t}><CheckIcon size={16} />{t}</li>)}</ul>
    </div>
  );
}

export function Wide({ children }: { children: ReactNode }) {
  return <div className="wide">{children}</div>;
}

// A package may add its own components (interactive demos of its subject): content/<id>/components/index.ts(x)
// exporting named React components. They become available in every topic of that package.
const packageComponents = Object.assign({}, ...Object.values(import.meta.glob<Record<string, unknown>>("@pkg/components/index.{ts,tsx}", { eager: true })));

export const mdxComponents = { Page, Mark, Term, Callout, Theorem, Figure, Check, Summary, Wide, Sandbox, ...packageComponents };
