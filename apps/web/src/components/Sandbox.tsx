import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleX, Footprints, Lightbulb, LoaderCircle, Play, RotateCcw, ListChecks } from "lucide-react";
import { TraceView } from "./TraceView";
import { EditorView, basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { api } from "../api";
import { content, type Task } from "../content/registry";
import { useDraft } from "../persist";
import { checkPython, explainError, runPython, Timeout, warmUp, type PyError, type RunResult, type TestResult } from "../sandbox/runner";

/** What is stored per task, so the code and the result are there when the learner comes back. */
type Saved = { code: string; passed: boolean; hints: number; results: TestResult[] | null; checks: number };

const theme = EditorView.theme({
  "&": { fontSize: "15px", backgroundColor: "var(--paper)", color: "var(--ink)", borderRadius: "var(--r-m)" },
  ".cm-content": { fontFamily: "var(--f-mono)", padding: "12px 0", caretColor: "var(--ink)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--ink-3)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--green-soft) 45%, transparent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--lav-soft) !important" },
});

/** Inline `code` in task statements. */
function Text({ text }: { text: string }) {
  return <>{text.trim().split(/\n\s*\n/).map((para, i) => (
    <p key={i}>{para.split(/(`[^`]+`)/).map((s, j) => (s.startsWith("`") ? <code key={j}>{s.slice(1, -1)}</code> : s))}</p>
  ))}</>;
}

function ErrorBox({ e }: { e: PyError }) {
  return (
    <div className="sb-error"><CircleAlert size={18} />
      <div><b>{e.type}{e.line ? ` в строке ${e.line}` : ""}:</b> {e.msg}<span>{explainError(e)}</span></div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sb-io"><span>{label}</span><pre>{children}</pre></div>;
}

/** A coding task: editor, «Запустить», «Проверить» with hidden tests, hint ladder. Python runs in the browser (Pyodide). */
export function Sandbox({ task: id }: { task: string }) {
  const task = content.task(id);
  if (!task) return <div className="needs-claude">Задача «{id}» не найдена.</div>;
  return <TaskView task={task} />;
}

function TaskView({ task }: { task: Task }) {
  const scope = `task:${task.id}`;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saveTimer = useRef<number>(0);
  const [st, setSt] = useState<Saved>({ code: task.starter ?? "", passed: false, hints: 0, results: null, checks: 0 });
  const stRef = useRef(st);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"run" | "check" | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [traceCode, setTraceCode] = useState<string | null>(null);
  const [stdin, setStdin] = useDraft(`draft:stdin:${task.id}`, task.stdin ?? "");

  function update(patch: Partial<Saved>, immediate = false) {
    const next = { ...stRef.current, ...patch };
    stRef.current = next;
    setSt(next);
    window.clearTimeout(saveTimer.current);
    const save = () => api.saveQuizState(scope, next, next.passed).catch(() => {});
    if (immediate) save(); else saveTimer.current = window.setTimeout(save, 800);
  }

  useEffect(() => {
    warmUp();
    let alive = true;
    api.quizState<Saved>(scope).then(({ state }) => {
      if (alive && state && typeof state.code === "string") { stRef.current = state; setSt(state); }
    }).catch(() => {}).finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [scope]);

  useEffect(() => {
    if (!loaded || !host.current) return;
    const v = new EditorView({
      doc: stRef.current.code,
      parent: host.current,
      extensions: [basicSetup, python(), keymap.of([indentWithTab]), theme,
        EditorView.updateListener.of((u) => { if (u.docChanged) update({ code: u.state.doc.toString() }); })],
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const code = () => view.current?.state.doc.toString() ?? stRef.current.code;
  const timeoutMs = task.timeout_ms ?? 5000;
  const onFail = (e: unknown) => setNotice(e instanceof Timeout
    ? `Программа работала дольше ${Math.round(timeoutMs / 1000)} с и была остановлена. Скорее всего, где-то бесконечный цикл.`
    : `Не удалось выполнить код: ${String(e)}`);

  async function doRun() {
    setBusy("run"); setNotice(null); setRun(null);
    try { setRun(await runPython(code(), stdin, timeoutMs)); } catch (e) { onFail(e); } finally { setBusy(null); }
  }

  async function doCheck() {
    setBusy("check"); setNotice(null);
    const started = Date.now();
    try {
      const { results } = await checkPython(code(), task.tests, timeoutMs * 2);
      const ok = results.length > 0 && results.every((r) => r.ok);
      update({ results, passed: stRef.current.passed || ok, checks: stRef.current.checks + 1 }, true);
      api.saveAttempts([{ scope, item_id: task.id, kind: "code", answer: code(), correct: ok, seconds: Math.round((Date.now() - started) / 1000) }]).catch(() => {});
    } catch (e) { onFail(e); } finally { setBusy(null); }
  }

  function reset() {
    view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: task.starter ?? "" } });
    setRun(null); setNotice(null);
  }

  const hints = task.hints ?? [];
  const results = st.results;
  const okCount = results?.filter((r) => r.ok).length ?? 0;

  return (
    <div className="sandbox">
      <div className="sb-head">
        <div><div className="eyebrow">Задача</div><h3>{task.title}</h3></div>
        {st.passed ? <span className="chip green"><CheckCircle2 size={14} />Решено</span> : task.difficulty ? <span className="chip">сложность {task.difficulty} из 5</span> : null}
      </div>
      <div className="sb-statement"><Text text={task.statement} /></div>
      {!loaded ? <div className="faint">Загружаю задачу…</div> : <div className="sb-editor" ref={host} />}
      {task.stdin !== undefined && (
        <label className="sb-stdin"><span>Ввод для запуска — каждая строка отдаётся одному input()</span>
          <textarea value={stdin} rows={Math.max(2, stdin.split("\n").length)} onChange={(e) => setStdin(e.target.value)} /></label>
      )}
      <div className="sb-actions">
        <button className="btn soft sm" onClick={doRun} disabled={!!busy || !loaded}>{busy === "run" ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}Запустить</button>
        <button className="btn sm" onClick={doCheck} disabled={!!busy || !loaded}>{busy === "check" ? <LoaderCircle size={16} className="spin" /> : <ListChecks size={16} />}Проверить</button>
        <button className="btn soft sm" onClick={() => setTraceCode(traceCode === null ? code() : null)} disabled={!!busy || !loaded}><Footprints size={16} />{traceCode === null ? "По шагам" : "Скрыть шаги"}</button>
        <button className="btn soft sm" onClick={reset} disabled={!!busy}><RotateCcw size={16} />Начать заново</button>
        {hints.length > 0 && st.hints < hints.length && (
          <button className="btn soft sm" onClick={() => update({ hints: st.hints + 1 }, true)}><Lightbulb size={16} />Подсказка {st.hints + 1} из {hints.length}</button>
        )}
      </div>
      {busy && <div className="grading"><LoaderCircle size={18} />{busy === "run" ? "Выполняю…" : "Проверяю на тестах…"} Первый запуск загружает Python — несколько секунд.</div>}
      {notice && <div className="verdict error"><CircleAlert size={22} /><div>{notice}</div></div>}
      {hints.slice(0, st.hints).map((h, i) => <div key={i} className="sb-hint"><Lightbulb size={16} /><div><b>Подсказка {i + 1}.</b> {h.text}</div></div>)}
      {traceCode !== null && <TraceView code={traceCode} stdin={stdin} />}
      {run && (
        <div className="sb-out">
          <Block label="Вывод программы">{run.stdout || <span className="faint">(программа ничего не вывела)</span>}</Block>
          {run.error && <ErrorBox e={run.error} />}
        </div>
      )}
      {results && (
        <div className="sb-results">
          <div className={`verdict ${okCount === results.length ? "pass" : "revise"}`}>
            {okCount === results.length ? <CheckCircle2 size={22} /> : <CircleAlert size={22} />}
            <div><b>{okCount === results.length ? "Все тесты пройдены." : `Пройдено тестов: ${okCount} из ${results.length}.`}</b>
              <span className="meta">Проверок: {st.checks}{st.hints ? ` · подсказок: ${st.hints}` : ""}</span></div>
          </div>
          {results.map((r, i) => (
            <div key={i} className={`sb-test${r.ok ? " ok" : ""}`}>
              <div className="sb-test-head">{r.ok ? <CheckCircle2 size={16} /> : <CircleX size={16} />}<span>{r.name}</span></div>
              {!r.ok && !r.hidden && (
                <div className="sb-test-body">
                  {r.stdin ? <Block label="Ввод">{r.stdin}</Block> : null}
                  {r.expected !== undefined && <Block label="Ожидалось">{r.expected}</Block>}
                  {r.got !== undefined && <Block label="Получено">{r.got || <span className="faint">(программа ничего не вывела)</span>}</Block>}
                  {r.message && <div className="explain">{r.message}</div>}
                  {r.error && <ErrorBox e={r.error} />}
                </div>
              )}
              {!r.ok && r.hidden && <div className="sb-test-body faint">Это скрытый тест: проверьте граничные случаи из условия.</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
