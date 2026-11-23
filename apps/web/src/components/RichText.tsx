import { Fragment, type ReactNode } from "react";

/** `inline code` and **bold** inside a line of text. */
function inline(line: string, key: string): ReactNode[] {
  // tokens: `code` or a ** marker; ** inside code stays code (2 ** 3), code may sit inside bold
  const tokens = line.split(/(`[^`\n]+`|\*\*)/).filter((s) => s !== "");
  const markers = tokens.filter((s) => s === "**").length;
  const out: ReactNode[] = [];
  let bold: ReactNode[] | null = null;
  let seen = 0;
  tokens.forEach((s, j) => {
    const k = `${key}-${j}`;
    // an unpaired last marker stays literal
    if (s === "**" && (bold || seen < markers - (markers % 2))) {
      seen++;
      if (bold) { out.push(<b key={k}>{bold}</b>); bold = null; } else bold = [];
      return;
    }
    const node = s.length > 2 && s.startsWith("`") && s.endsWith("`") ? <code key={k}>{s.slice(1, -1)}</code> : <Fragment key={k}>{s}</Fragment>;
    (bold ?? out).push(node);
  });
  return out;
}

/**
 * Plain text from YAML (questions, options, explanations, task statements) with a tiny bit of markup:
 * `code` inline, ``` fenced blocks ``` for multi-line code, line breaks kept, blank line = new paragraph.
 * Fence language: ```python — code; ```input — what the program reads («Ввод»);
 * ``` or ```output — what it prints («Вывод»); ```call / ```return — a function task's example:
 * the call and the value it must return («Вызов» / «Возвращает»).
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
      // ```input and ```output are labelled like an example on LeetCode; a plain fence right after an input is its output
      const afterInput = !lang && i >= 3 && parts[i - 2]?.toLowerCase() === "input" && !trimmed;
      const label = lang === "input" ? "Ввод" : lang === "output" || afterInput ? "Вывод" : lang === "call" ? "Вызов" : lang === "return" ? "Возвращает" : null;
      const pre = <pre key={`f${i}`} className="rt-pre"><code className={lang ? `language-${lang}` : undefined}>{parts[i + 2].replace(/\n$/, "")}</code></pre>;
      out.push(label ? <div key={`f${i}`} className="rt-io"><span>{label}</span>{pre}</div> : pre);
    }
  }
  return <>{out}</>;
}
