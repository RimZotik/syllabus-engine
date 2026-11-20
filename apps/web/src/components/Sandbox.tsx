import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Footprints, Lightbulb, RotateCcw } from "lucide-react";
import { TraceView } from "./TraceView";
import { RichText } from "./RichText";
import { CodeRunner } from "./CodeRunner";
import { api } from "../api";
import { content, type Task } from "../content/registry";
import type { TestResult } from "../sandbox/runner";

/** What is stored per task, so the code and the result are there when the learner comes back. */
type Saved = { code: string; passed: boolean; hints: number; results: TestResult[] | null; checks: number; stdout?: string | null };

/**
 * A coding task as a workspace, like a LeetCode problem page: on the left the statement, the text around it
 * (`intro`) and the hints; on the right the editor, «Проверить» and the tests as tabs. Python runs in the
 * browser (Pyodide). The reader gives every task a page of its own.
 */
export function Sandbox({ task: id, intro }: { task: string; intro?: ReactNode }) {
  const task = content.task(id);
  if (!task) return <div className="needs-claude">Задача «{id}» не найдена.</div>;
  return <TaskView key={id} task={task} intro={intro} />;
}

function TaskView({ task, intro }: { task: Task; intro?: ReactNode }) {
  const scope = `task:${task.id}`;
  const saveTimer = useRef<number>(0);
  const [st, setSt] = useState<Saved>({ code: task.starter ?? "", passed: false, hints: 0, results: null, checks: 0 });
  const stRef = useRef(st);
  const [loaded, setLoaded] = useState(false);
  const [initial, setInitial] = useState(task.starter ?? "");
  const [traceCode, setTraceCode] = useState<string | null>(null);
  const [resetN, setResetN] = useState(0); // «Начать заново» gives the editor a fresh start

  function update(patch: Partial<Saved>, immediate = false) {
    const next = { ...stRef.current, ...patch };
    stRef.current = next;
    setSt(next);
    window.clearTimeout(saveTimer.current);
    const save = () => api.saveQuizState(scope, next, next.passed).catch(() => {});
    if (immediate) save(); else saveTimer.current = window.setTimeout(save, 800);
  }

  useEffect(() => {
    let alive = true;
    api.quizState<Saved>(scope).then(({ state }) => {
      if (alive && state && typeof state.code === "string") { stRef.current = state; setSt(state); setInitial(state.code); }
    }).catch(() => {}).finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [scope]);

  const hints = task.hints ?? [];
  // input for the step-by-step view: the task's own, else the first example's
  const traceStdin = task.stdin ?? task.tests.io?.[0]?.stdin ?? task.tests.stdin ?? "";

  return (
    <div className="ws-outer">
    <div className="workspace">
      <div className="ws-left">
        <div className="sb-head">
          <div><div className="eyebrow">Задача</div><h2>{task.title}</h2></div>
          {st.passed ? <span className="chip green"><CheckCircle2 size={14} />Решено</span> : task.difficulty ? <span className="chip">сложность {task.difficulty} из 5</span> : null}
        </div>
        {intro && <div className="ws-intro">{intro}</div>}
        <div className="sb-statement"><RichText text={task.statement} block /></div>
        {hints.slice(0, st.hints).map((h, i) => <div key={i} className="sb-hint"><Lightbulb size={16} /><div><b>Подсказка {i + 1}.</b> <RichText text={h.text} /></div></div>)}
        {hints.length > 0 && st.hints < hints.length && (
          <button className="btn soft sm ws-hint-btn" onClick={() => update({ hints: st.hints + 1 }, true)}><Lightbulb size={16} />Подсказка {st.hints + 1} из {hints.length}</button>
        )}
        {(st.checks > 0 || st.hints > 0) && <div className="faint ws-meta">Проверок: {st.checks}{st.hints ? ` · подсказок: ${st.hints}` : ""}</div>}
      </div>
      <div className="ws-right">
        {!loaded ? <div className="faint">Загружаю задачу…</div> : (
          <CodeRunner key={resetN} tall initial={initial} tests={task.tests} timeoutMs={task.timeout_ms ?? 5000} results={st.results} stdout={st.stdout}
            onCode={(code) => update({ code })}
            onChecked={(r, code) => {
              const ok = r.results.length > 0 && r.results.every((x) => x.ok);
              update({ code, results: r.results, stdout: r.stdout ?? null, passed: stRef.current.passed || ok, checks: stRef.current.checks + 1 }, true);
              api.saveAttempts([{ scope, item_id: task.id, kind: "code", answer: code, correct: ok, seconds: 0 }]).catch(() => {});
            }}
            actions={(code, busy) => (
              <>
                <button className="btn soft sm" onClick={() => setTraceCode(traceCode === null ? code() : null)} disabled={busy}><Footprints size={16} />{traceCode === null ? "По шагам" : "Скрыть шаги"}</button>
                <button className="btn soft sm" onClick={() => { setInitial(task.starter ?? ""); setResetN((n) => n + 1); update({ code: task.starter ?? "", results: null, stdout: null }); }} disabled={busy}><RotateCcw size={16} />Начать заново</button>
              </>
            )} />
        )}
      </div>
    </div>
    {/* below the two columns, so the sticky statement never covers it */}
    {traceCode !== null && <div className="ws-trace"><TraceView code={traceCode} stdin={traceStdin} /></div>}
    </div>
  );
}
