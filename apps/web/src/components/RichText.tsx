import { Fragment, type ReactNode } from "react";

/** `inline code` inside a line of text. */
function inline(line: string, key: string): ReactNode[] {
  return line.split(/(`[^`\n]+`)/).map((s, j) =>
    s.length > 2 && s.startsWith("`") && s.endsWith("`") ? <code key={`${key}-${j}`}>{s.slice(1, -1)}</code> : <Fragment key={`${key}-${j}`}>{s}</Fragment>);
}

/**
 * Plain text from YAML (questions, options, explanations, task statements) with a tiny bit of markup:
 * `code` inline, ``` fenced blocks ``` for multi-line code, line breaks kept, blank line = new paragraph.
 * Fence language: ```python — code; ```input — what the program reads («Ввод»);
 * ``` or ```output — what it prints («Вывод»).
 * `block` — paragraphs become <p> (task statements); otherwise everything stays inline-level.
 */
export function RichText({ text, block = false }: { text: string; block?: boolean }) {
  const parts = (text ?? "").replace(/\r\n/g, "\n").split(/```([A-Za-z]*)[ \t]*\n?([\s\S]*?)```/);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    const part = parts[i];
    const trimmed = part.replace(/^\n+|\n+$/g, "");
    if (trimmed) {
      trimmed.split(/\n\s*\n/).forEach((para, k) => {
        const lines: ReactNode[] = para.split("\n").flatMap((line, l): ReactNode[] => [...(l ? [<br key={`${i}-${k}-br${l}`} />] : []), ...inline(line, `${i}-${k}-${l}`)]);
        out.push(block ? <p key={`${i}-${k}`}>{lines}</p> : <Fragment key={`${i}-${k}`}>{k ? <><br /><br /></> : null}{lines}</Fragment>);
      });
    }
    if (i + 2 < parts.length) {
      const lang = parts[i + 1].toLowerCase();
      out.push(<pre key={`f${i}`} className="rt-pre"><code className={lang ? `language-${lang}` : undefined}>{parts[i + 2].replace(/\n$/, "")}</code></pre>);
    }
  }
  return <>{out}</>;
}
