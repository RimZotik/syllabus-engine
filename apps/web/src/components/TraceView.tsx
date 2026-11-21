import { Children, isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, LoaderCircle } from "lucide-react";
import { explainError, tracePython, type TraceResult, type TraceStep, type TraceVal } from "../sandbox/runner";

const TYPE_RU: Record<string, string> = { list: "список", tuple: "кортеж", dict: "словарь", set: "множество", frozenset: "множество" };
const isRef = (v: TraceVal): v is { r: number } => "r" in v;
const same = (a?: TraceVal, b?: TraceVal) => JSON.stringify(a) === JSON.stringify(b);

/** A reference to object №n: the same number and colour wherever the same object appears. */
function Ref({ n, heap }: { n: number; heap: TraceStep["heap"] }) {
  const t = heap[String(n)]?.t;
  return <span className={`tr-ref tr-c${((n - 1) % 6) + 1}`}>{TYPE_RU[t ?? ""] ?? "объект"} №{n}</span>;
}

function Val({ v, heap }: { v: TraceVal; heap: TraceStep["heap"] }) {
  return isRef(v) ? <Ref n={v.r} heap={heap} /> : <code className="tr-prim">{v.p}</code>;
}

/**
 * Step-by-step run of a short program: which line runs next, which names exist in every function call,
 * and which values they point to. Names that point to the same list share its number and colour.
 * Used in topics as <Trace code={`...`} /> and in the sandbox («По шагам»).
 */
export function TraceView({ code, stdin = "", files }: { code: string; stdin?: string; files?: Record<string, string> }) {
  const filesKey = JSON.stringify(files ?? {});
  const [res, setRes] = useState<TraceResult | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const lines = useMemo(() => code.replace(/\n+$/, "").split("\n"), [code]);

  useEffect(() => {
    let alive = true;
    setRes(null); setFail(null); setI(0);
    tracePython(code, stdin, 8000, JSON.parse(filesKey)).then((r) => alive && setRes(r)).catch((e) => alive && setFail(String(e)));
    return () => { alive = false; };
  }, [code, stdin, filesKey]);

  if (fail) return <div className="verdict error"><CircleAlert size={22} /><div>Не удалось выполнить по шагам: {fail}</div></div>;
  if (!res) return <div className="grading"><LoaderCircle size={18} className="spin" />Готовлю пошаговое выполнение… Первый раз загружается Python — несколько секунд.</div>;
  if (!res.steps.length) {
    return res.error ? <div className="sb-error"><CircleAlert size={18} /><div><b>{res.error.type}{res.error.line ? ` в строке ${res.error.line}` : ""}:</b> {res.error.msg}<span>{explainError(res.error)}</span></div></div> : null;
  }

  const last = res.steps.length - 1;
  const s = res.steps[Math.min(i, last)];
  const prev = i > 0 ? res.steps[i - 1] : undefined;
  const finished = i === last;
  const top = s.frames[s.frames.length - 1];
  const caption = s.event === "return"
    ? (s.frames.length > 1 ? <>Функция <b>{top.name}</b> заканчивается и возвращает {s.ret ? <Val v={s.ret} heap={s.heap} /> : null}</> : <>Программа выполнена до конца</>)
    : <>Сейчас выполнится строка <b>{s.line}</b></>;
  const prevVar = (frame: number, name: string) => prev?.frames[frame]?.vars.find(([k]) => k === name)?.[1];
  const objects = Object.entries(s.heap).filter(([, o]) => o).map(([n, o]) => [Number(n), o!] as const).sort((a, b) => a[0] - b[0]);
  const objChanged = (n: number) => prev && JSON.stringify(prev.heap[String(n)]) !== JSON.stringify(s.heap[String(n)]);

  return (
    <div className="trace">
      <div className="tr-grid">
        <div className="tr-left">
          <pre className="tr-code">{lines.map((l, k) => (
            <div key={k} className={`tr-line${s.event === "line" && s.line === k + 1 ? " next" : ""}${s.event === "return" && s.line === k + 1 ? " ret" : ""}`}>
              <span className="tr-no">{k + 1}</span><span>{l || " "}</span>
            </div>
          ))}</pre>
          <div className="tr-caption">{caption}</div>
          <div className="tr-controls">
            <button className="icon-btn" onClick={() => setI(0)} disabled={i === 0} aria-label="В начало"><ChevronsLeft size={18} /></button>
            <button className="btn soft sm" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}><ChevronLeft size={16} />Назад</button>
            <input type="range" min={0} max={last} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Шаг" />
            <button className="btn sm" onClick={() => setI(Math.min(last, i + 1))} disabled={finished}>Вперёд<ChevronRight size={16} /></button>
            <button className="icon-btn" onClick={() => setI(last)} disabled={finished} aria-label="В конец"><ChevronsRight size={18} /></button>
            <span className="faint tnum">шаг {i + 1} из {res.steps.length}</span>
          </div>
          {res.truncated && <p className="faint tr-note">Показаны первые {res.steps.length} шагов — программа длинная или зациклилась.</p>}
          {(s.out || finished) && <div className="sb-io"><span>Вывод</span><pre>{(finished ? res.stdout : s.out) || <span className="faint">(пока ничего)</span>}</pre></div>}
          {finished && res.error && <div className="sb-error"><CircleAlert size={18} /><div><b>{res.error.type}{res.error.line ? ` в строке ${res.error.line}` : ""}:</b> {res.error.msg}<span>{explainError(res.error)}</span></div></div>}
        </div>
        <div className="tr-right">
          <div className="tr-h">Имена</div>
          {s.frames.map((f, fi) => (
            <div key={fi} className={`tr-frame${fi === s.frames.length - 1 ? " active" : ""}`}>
              <div className="tr-frame-h">{f.name}</div>
              {f.vars.length === 0 ? <div className="faint tr-empty">пока ни одного имени</div> : f.vars.map(([k, v]) => (
                <div key={k} className={`tr-var${prev && !same(prevVar(fi, k), v) ? " changed" : ""}`}><code>{k}</code><Val v={v} heap={s.heap} /></div>
              ))}
            </div>
          ))}
          {objects.length > 0 && <div className="tr-h">Объекты</div>}
          {objects.map(([n, o]) => (
            <div key={n} className={`tr-obj tr-c${((n - 1) % 6) + 1}${objChanged(n) ? " changed" : ""}`}>
              <div className="tr-obj-h"><Ref n={n} heap={s.heap} /></div>
              <div className="tr-items">
                {o.items.length === 0 && <span className="faint">пусто</span>}
                {o.t === "dict"
                  ? (o.items as [TraceVal, TraceVal][]).map(([k, v], j) => <div key={j} className="tr-kv"><Val v={k} heap={s.heap} /><span className="faint">→</span><Val v={v} heap={s.heap} /></div>)
                  : (o.items as TraceVal[]).map((v, j) => (
                    <div key={j} className="tr-cell">{o.t === "list" || o.t === "tuple" ? <span className="tr-idx">{j}</span> : null}<Val v={v} heap={s.heap} /></div>
                  ))}
                {o.more && <span className="faint">…</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** MDX: <Trace code={`a = [1, 2]\nb = a`} /> */
/** Text and language of every fenced block (<pre><code class="language-…">) among MDX children. */
export function fences(node: ReactNode, out: { lang: string; text: string }[] = []) {
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return;
    if (child.type === "code") {
      const lang = /language-(\w+)/.exec(child.props.className ?? "")?.[1] ?? "";
      out.push({ lang, text: textOf(child.props.children) });
    } else fences(child.props.children, out);
  });
  return out;
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}

/**
 * MDX: the code as a normal fenced block inside the component — indentation is kept exactly;
 * an optional ```input block gives what the program reads:
 *   <Trace>
 *   ```python
 *   for t in [1, 2]:
 *       print(t)
 *   ```
 *   </Trace>
 * The older form <Trace code={"..."} stdin={"..."} /> still works.
 */
export function Trace({ code, stdin, files, children }: { code?: string; stdin?: string; files?: Record<string, string>; children?: ReactNode }) {
  const blocks = fences(children);
  const src = code ?? blocks.find((b) => b.lang !== "input")?.text ?? "";
  const input = stdin ?? blocks.find((b) => b.lang === "input")?.text;
  return <TraceView code={src.replace(/^\n/, "")} stdin={input} files={files} />;
}
