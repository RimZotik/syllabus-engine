import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleX, FileCode2, FileText, ListChecks, LoaderCircle } from "lucide-react";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { editorExtensions } from "./editorSetup";
import type { Task } from "../content/registry";
import { checkPython, explainError, Timeout, warmUp, type CheckResult, type PyError, type TestResult } from "../sandbox/runner";
import { callCases } from "../sandbox/calls";
import { RichText } from "./RichText";

export type Tests = Task["tests"];


export function ErrorBox({ e }: { e: PyError }) {
  return (
    <div className="sb-error"><CircleAlert size={18} />
      <div><b>{e.type}{e.line ? ` в строке ${e.line}` : ""}:</b> {e.msg}<span>{explainError(e)}</span></div>
    </div>
  );
}

export function Block({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return <div className="sb-io"><span>{label}{note && <em className="sb-io-note">{note}</em>}</span><pre>{children}</pre></div>;
}

/** The cases as the learner sees them before the first check: visible examples with their data, hidden ones by name only. */
function caseList(tests: Tests): TestResult[] {
  const io = (tests.io ?? []).map((c, i) => ({ name: c.name ?? `Пример ${i + 1}`, ok: false, stdin: c.stdin, expected: c.stdout, hidden: c.hidden }));
  const as = (tests.asserts ?? []).map((c, i) => ({ name: c.name ?? `Проверка ${i + 1}`, ok: false }));
  return [...callCases(tests), ...io, ...as];
}

/**
 * Code editor with one «Проверить» button and the tests as a row of tabs (green — passed, red — not),
 * the first tab open. Used by a task page and by a code question in a test.
 * Inside the editor every key works for the editor: arrows, PgUp/PgDn, Home/End, Tab (indent). Ctrl+Enter — check.
 */
export function CodeRunner({ initial, tests, timeoutMs = 5000, results, stdout, readOnly = false, onCode, onChecked, actions, tall = false }: {
  initial: string; tests: Tests; timeoutMs?: number; results: TestResult[] | null; stdout?: string | null; readOnly?: boolean;
  onCode: (code: string) => void; onChecked: (r: CheckResult, code: string) => void; actions?: (code: () => string, busy: boolean) => ReactNode; tall?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [fileTab, setFileTab] = useState<string | null>(null);
  const checkRef = useRef<() => void>(() => {});
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    warmUp();
    if (!host.current) return;
    const v = new EditorView({
      doc: initial,
      parent: host.current,
      extensions: editorExtensions([
        keymap.of([{ key: "Mod-Enter", run: () => { checkRef.current(); return true; } }]),
        editable.current.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of((u) => { if (u.docChanged) onCodeRef.current(u.state.doc.toString()); }),
      ]),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  // «Начать заново» from outside: the parent changes `initial`
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== initial) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: initial } });
  }, [initial]);

  const code = () => view.current?.state.doc.toString() ?? initial;

  async function check() {
    if (busy || readOnly) return;
    setBusy(true); setNotice(null);
    try {
      const r = await checkPython(code(), tests, timeoutMs * 2);
      onChecked(r, code());
    } catch (e) {
      setNotice(e instanceof Timeout
        ? `Программа работала дольше ${Math.round((timeoutMs * 2) / 1000)} с и была остановлена. Скорее всего, где-то бесконечный цикл.`
        : `Не удалось выполнить код: ${String(e)}`);
    } finally { setBusy(false); }
  }
  checkRef.current = () => void check();

  const cases = results ?? caseList(tests);
  const cur = cases[Math.min(tab, cases.length - 1)];
  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const all = !!results && okCount === results.length && results.length > 0;

  // the task's files (a module to import, a table to read): tabs above the editor, read-only
  const files = Object.entries(tests.files ?? {});
  const shown = fileTab === null ? null : files.find(([n]) => n === fileTab);

  return (
    <div className="runner">
      {files.length > 0 && (
        <div className="file-tabs" role="tablist" aria-label="Файлы задачи">
          <button role="tab" aria-selected={!shown} className={`ftab${!shown ? " on" : ""}`} onClick={() => setFileTab(null)}><FileCode2 size={14} />Ваш код</button>
          {files.map(([name]) => (
            <button key={name} role="tab" aria-selected={shown?.[0] === name} className={`ftab${shown?.[0] === name ? " on" : ""}`} onClick={() => setFileTab(name)} title="Файл задачи — только для чтения">
              <FileText size={14} />{name}</button>
          ))}
        </div>
      )}
      {shown && <pre className={`file-view${tall ? " tall" : ""}`}>{shown[1]}</pre>}
      <div className={`sb-editor${tall ? " tall" : ""}`} ref={host} hidden={!!shown} />
      <div className="sb-actions">
        {!readOnly && <button className="btn sm" onClick={check} disabled={busy} title="Ctrl+Enter">{busy ? <LoaderCircle size={16} className="spin" /> : <ListChecks size={16} />}Проверить</button>}
        {actions?.(code, busy)}
      </div>
      {notice && <div className="verdict error"><CircleAlert size={22} /><div>{notice}</div></div>}
      {cases.length > 0 && (
        <div className={`tests${busy ? " busy" : ""}`} aria-busy={busy}>
          <div className="tests-head">
            <span className="eyebrow">Тесты</span>
            {busy ? <span className="faint">Проверяю… первый запуск загружает Python — несколько секунд</span>
              : results && <b className={all ? "ok" : "bad"}>{all ? "Все тесты пройдены" : `Пройдено ${okCount} из ${results.length}`}</b>}
          </div>
          <div className="tabs" role="tablist">
            {cases.map((c, i) => (
              <button key={i} role="tab" aria-selected={i === tab} title={c.name}
                className={`tab${i === tab ? " on" : ""}${results ? (c.ok ? " ok" : " bad") : ""}`} onClick={() => setTab(i)}>
                {results && (c.ok ? <CheckCircle2 size={14} /> : <CircleX size={14} />)}Тест {i + 1}
              </button>
            ))}
          </div>
          {cur && (
            <div className="tab-body">
              <div className="tab-name">{cur.name}{cur.hidden ? " · скрытый" : ""}</div>
              {cur.hidden && !results && <div className="faint">Данные скрытого теста не показываются — он проверяет граничные случаи из условия.</div>}
              {cur.call !== undefined ? (
                // a function-task case: the call, what it must return, what it returned, what it printed
                <>
                  <Block label="Вызов">{cur.call}</Block>
                  {cur.expected !== undefined && <Block label="Должна вернуть">{cur.expected}</Block>}
                  {results && cur.got !== undefined && <Block label="Вернула" note={cur.got_type && `тип: ${cur.got_type}`}>{cur.got}</Block>}
                </>
              ) : (
                <>
                  {!cur.hidden && cur.stdin ? <Block label="Ввод">{cur.stdin}</Block> : null}
                  {!cur.hidden && cur.expected !== undefined && <Block label="Ожидалось">{cur.expected}</Block>}
                  {results && !cur.hidden && cur.got !== undefined && <Block label="Получено">{cur.got || <span className="faint">(программа ничего не вывела)</span>}</Block>}
                </>
              )}
              {results && !cur.hidden && cur.output ? <Block label="Вывод" note="не влияет на проверку">{cur.output}</Block> : null}
              {results && cur.ok && cur.got === undefined && <div className="faint">Проверка пройдена.</div>}
              {results && !cur.ok && cur.hidden && !cur.error && <div className="faint">Скрытый тест не пройден: проверьте граничные случаи из условия.</div>}
              {!results && !cur.hidden && cur.stdin === undefined && cur.expected === undefined && <div className="faint">Эта проверка вызывает вашу функцию с разными данными. Что именно не так, будет видно после «Проверить».</div>}
              {results && cur.message && <div className="explain"><RichText text={cur.message} /></div>}
              {results && cur.error && <ErrorBox e={cur.error} />}
            </div>
          )}
          {results && stdout ? <Block label={tests.calls?.length ? "Вывод кода вне функции" : "Что напечатала программа"} note={tests.calls?.length ? "не влияет на проверку" : undefined}>{stdout}</Block> : null}
        </div>
      )}
    </div>
  );
}
