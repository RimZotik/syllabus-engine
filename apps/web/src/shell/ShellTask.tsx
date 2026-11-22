/**
 * A shell task page (sandbox: shell): the statement and hints on the left, the terminal with the file tree on the
 * right, «Проверить» and the checks as tabs below it — the same layout as a Python task (components/Sandbox.tsx).
 * The file system, the folder and the history are saved like a Python task's code (quiz_state, scope task:<id>).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleX, Lightbulb, ListChecks, LoaderCircle, RotateCcw } from "lucide-react";
import { RichText } from "../components/RichText";
import { api } from "../api";
import { ShellSession, type ShellState } from "./engine";
import { checkName, runChecks, type CheckResult, type ShellTaskDef } from "./checks";
import { ShellPanel, type ShellPanelHandle } from "./ShellPanel";

type Saved = { shell?: ShellState; passed: boolean; hints: number; results: CheckResult[] | null; checks: number };

export default function ShellTaskView({ task, intro }: { task: ShellTaskDef; intro?: ReactNode }) {
  const scope = `task:${task.id}`;
  const [st, setSt] = useState<Saved>({ passed: false, hints: 0, results: null, checks: 0 });
  const stRef = useRef(st);
  const [session, setSession] = useState<ShellSession | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(0);
  const panel = useRef<ShellPanelHandle>(null);
  const saveTimer = useRef(0);
  const [greeting, setGreeting] = useState<string | undefined>();

  function update(patch: Partial<Saved>, immediate = false) {
    const next = { ...stRef.current, ...patch };
    stRef.current = next;
    setSt(next);
    window.clearTimeout(saveTimer.current);
    const save = () => api.saveQuizState(scope, next, next.passed).catch(() => {});
    if (immediate) void save(); else saveTimer.current = window.setTimeout(save, 800);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      let saved: Saved | null = null;
      try { saved = (await api.quizState<Saved>(scope)).state; } catch { /* offline: start fresh */ }
      try {
        const s = saved?.shell ? await ShellSession.restore(task.setup ?? {}, saved.shell) : await ShellSession.create(task.setup ?? {});
        if (!alive) return;
        if (saved) { stRef.current = { ...stRef.current, ...saved }; setSt(stRef.current); }
        setGreeting(saved?.shell?.history.length ? `\x1b[2m(сеанс восстановлен: файлы и ${saved.shell.history.length} команд в истории — листайте стрелкой ↑)\x1b[0m` : undefined);
        setSession(s);
      } catch (e) { if (alive) setFail(String(e)); }
    })();
    return () => { alive = false; };
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  async function check() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const results = await runChecks(session, task.tests.checks);
      const ok = results.length > 0 && results.every((r) => r.ok);
      update({ results, passed: stRef.current.passed || ok, checks: stRef.current.checks + 1, shell: await session.state() }, true);
      const firstBad = results.findIndex((r) => !r.ok);
      setTab(firstBad >= 0 ? firstBad : 0);
      api.saveAttempts([{ scope, item_id: task.id, kind: "code", answer: session.history.join("\n"), correct: ok, seconds: 0 }]).catch(() => {});
    } finally { setBusy(false); }
  }

  async function reset() {
    const s = await ShellSession.create(task.setup ?? {});
    setGreeting("\x1b[2m(всё возвращено к началу задачи)\x1b[0m");
    setSession(s);
    update({ shell: undefined, results: null }, true);
  }

  const hints = task.hints ?? [];
  const results = st.results;
  const cases: CheckResult[] = results ?? task.tests.checks.map((c) => ({ name: checkName(c), ok: false, hidden: c.hidden }));
  const cur = cases[Math.min(tab, cases.length - 1)];
  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const all = !!results && okCount === results.length;

  return (
    <div className="ws-outer">
      <div className="workspace shell-ws">
        <div className="ws-left">
          <div className="sb-head">
            <div><div className="eyebrow">Задача в терминале</div><h2>{task.title}</h2></div>
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
          {fail ? <div className="verdict error"><CircleAlert size={22} /><div>Не удалось запустить терминал: {fail}</div></div>
            : !session ? <div className="grading"><LoaderCircle size={18} />Загружаю терминал…</div>
            : <ShellPanel ref={panel} session={session} greeting={greeting}
                onCommand={async () => update({ shell: await session.state() })} />}
          <div className="sb-actions">
            <button className="btn sm" onClick={check} disabled={!session || busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <ListChecks size={16} />}Проверить</button>
            <button className="btn soft sm" onClick={reset} disabled={!session || busy} title="Вернуть файлы и папки к началу задачи, очистить историю"><RotateCcw size={16} />Сбросить</button>
          </div>
          <div className={`tests${busy ? " busy" : ""}`} aria-busy={busy}>
            <div className="tests-head">
              <span className="eyebrow">Проверки</span>
              {results && <b className={all ? "ok" : "bad"}>{all ? "Все проверки пройдены" : `Пройдено ${okCount} из ${results.length}`}</b>}
            </div>
            <div className="tabs" role="tablist">
              {cases.map((c, i) => (
                <button key={i} role="tab" aria-selected={i === tab} title={c.name}
                  className={`tab${i === tab ? " on" : ""}${results ? (c.ok ? " ok" : " bad") : ""}`} onClick={() => setTab(i)}>
                  {results && (c.ok ? <CheckCircle2 size={14} /> : <CircleX size={14} />)}Проверка {i + 1}
                </button>
              ))}
            </div>
            {cur && (
              <div className="tab-body">
                <div className="tab-name">{cur.hidden && !results ? "Скрытая проверка" : cur.name}{cur.hidden ? " · скрытая" : ""}</div>
                {!results && <div className="faint">{cur.hidden ? "Проверяет то, что сказано в условии, но не показывает подробностей." : "Выполните задачу в терминале и нажмите «Проверить»: проверяются итоговые файлы и папки, а не набранные символы."}</div>}
                {results && cur.ok && <div className="faint">Пройдена.</div>}
                {results && !cur.ok && <div className="explain">{cur.hidden ? "Скрытая проверка не пройдена: перечитайте условие — там есть ограничение, которое вы нарушили." : cur.message}</div>}
                {results && !cur.ok && !cur.hidden && cur.expected !== undefined && <div className="sb-io"><span>Ожидалось</span><pre>{cur.expected || "(пусто)"}</pre></div>}
                {results && !cur.ok && !cur.hidden && cur.got !== undefined && <div className="sb-io"><span>Получено</span><pre>{cur.got || "(пусто)"}</pre></div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
