import { Fragment, type ReactNode } from "react";

/** `inline code` inside a line of text. */
function inline(line: string, key: string): ReactNode[] {
  return line.split(/(`[^`\n]+`)/).map((s, j) =>
    s.length > 2 && s.startsWith("`") && s.endsWith("`") ? <code key={`${key}-${j}`}>{s.slice(1, -1)}</code> : <Fragment key={`${key}-${j}`}>{s}</Fragment>);
}

/**
 * Plain text from YAML (questions, options, explanations, task statements) with a tiny bit of markup:
 * `code` inline, ``` fenced blocks ``` for multi-line code, line breaks kept, blank line = new paragraph.
 * `block` — paragraphs become <p> (task statements); otherwise everything stays inline-level.
 */
export function RichText({ text, block = false }: { text: string; block?: boolean }) {
  const parts = (text ?? "").replace(/\r\n/g, "\n").split(/```[a-z]*\n?([\s\S]*?)```/);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(<pre key={i} className="rt-pre"><code>{part.replace(/\n$/, "")}</code></pre>);
      return;
    }
    const trimmed = part.replace(/^\n+|\n+$/g, "");
    if (!trimmed) return;
    const paras = trimmed.split(/\n\s*\n/);
    paras.forEach((para, k) => {
      const lines: ReactNode[] = para.split("\n").flatMap((line, l): ReactNode[] => [...(l ? [<br key={`${i}-${k}-br${l}`} />] : []), ...inline(line, `${i}-${k}-${l}`)]);
      out.push(block ? <p key={`${i}-${k}`}>{lines}</p> : <Fragment key={`${i}-${k}`}>{k ? <><br /><br /></> : null}{lines}</Fragment>);
    });
  });
  return <>{out}</>;
}
