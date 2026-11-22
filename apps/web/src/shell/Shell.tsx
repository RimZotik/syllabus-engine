/**
 * <Shell> in a topic: a live terminal on a prepared file system, not graded and not saved.
 *   <Shell files={{"notes/a.txt": "текст\n"}} dirs={["photos"]} cwd="/home/student" />
 *   <Shell files={{…}} script={["ls", "mkdir backup", "cp notes/a.txt backup/", "ls -R"]} />
 * With `script` the commands are typed and run one by one by the «Следующая команда» button (like <Trace>);
 * the learner may type their own in between. «Сбросить» returns the files to the start.
 */
import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, RotateCcw, StepForward } from "lucide-react";
import { ShellSession, type ShellSetup } from "./engine";
import { ShellPanel, type ShellPanelHandle } from "./ShellPanel";

/** `processes`, `users`, `env` — as in a task's setup (docs/content/authoring.md, 3.2), for demonstrations of kill, sudo, PATH. */
export type ShellProps = { files?: ShellSetup["files"]; dirs?: ShellSetup["dirs"]; cwd?: string; script?: string[]; rows?: number; title?: string; processes?: ShellSetup["processes"]; users?: ShellSetup["users"]; env?: ShellSetup["env"] };

export default function Shell({ files, dirs, cwd, script, rows = 14, title, processes, users, env }: ShellProps) {
  const key = JSON.stringify({ files, dirs, cwd, processes, users, env });
  const [session, setSession] = useState<ShellSession | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const panel = useRef<ShellPanelHandle>(null);

  const start = () => ShellSession.create({ files, dirs, cwd, processes, users, env }).then((s) => { setSession(s); setStep(0); }).catch((e) => setFail(String(e)));
  useEffect(() => { void start(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function next() {
    if (!script || step >= script.length || running) return;
    setRunning(true);
    try { await panel.current?.type(script[step]); setStep(step + 1); } finally { setRunning(false); }
  }

  if (fail) return <div className="verdict error"><CircleAlert size={22} /><div>Не удалось запустить терминал: {fail}</div></div>;
  if (!session) return <div className="grading"><LoaderCircle size={18} />Загружаю терминал…</div>;
  return (
    <div className="shell-demo">
      <ShellPanel ref={panel} session={session} rows={rows} title={title ?? "Терминал — попробуйте сами"}
        greeting={script ? "\x1b[2m(нажимайте «Следующая команда» — или вводите свои)\x1b[0m" : undefined}
        actions={<>
          {script && <button className="btn sm" onClick={next} disabled={running || step >= script.length}><StepForward size={16} />{step >= script.length ? "Все команды показаны" : `Следующая команда · ${step + 1} из ${script.length}`}</button>}
          <button className="btn soft sm" onClick={() => void start()} disabled={running} title="Вернуть файлы к началу"><RotateCcw size={16} />Сбросить</button>
        </>} />
    </div>
  );
}
