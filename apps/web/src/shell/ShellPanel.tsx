/**
 * The simulator's box: a toolbar, the terminal and the file tree beside it, which changes after every command
 * (new and changed entries are highlighted, the current folder is marked). Used by the task page and <Shell>.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { File, Folder, FolderOpen, FolderTree, Maximize2, Minimize2 } from "lucide-react";
import { ShellTerminal, type TerminalHandle } from "./Terminal";
import type { RunResult, ShellSession, TreeNode } from "./engine";

type Stamp = Map<string, string>;
function stamps(n: TreeNode, m: Stamp = new Map()): Stamp {
  m.set(n.path, n.dir ? "d" : `f${n.size}`);
  n.children?.forEach((c) => stamps(c, m));
  return m;
}

function Node({ n, cwd, changed, depth }: { n: TreeNode; cwd: string; changed: Set<string>; depth: number }) {
  const here = n.path === cwd;
  const Icon = n.dir ? (cwd === n.path || cwd.startsWith(n.path + "/") ? FolderOpen : Folder) : File;
  return (
    <>
      <div className={`ft-row${changed.has(n.path) ? " new" : ""}${n.name.startsWith(".") ? " hidden" : ""}${here ? " here" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} title={n.path}>
        <Icon size={14} /><span className="ft-name">{n.name}{n.dir ? "/" : ""}</span>{here && <span className="ft-here">вы здесь</span>}
      </div>
      {n.children?.map((c) => <Node key={c.path} n={c} cwd={cwd} changed={changed} depth={depth + 1} />)}
    </>
  );
}

export type ShellPanelHandle = TerminalHandle & { refresh(): Promise<void> };

export const ShellPanel = forwardRef<ShellPanelHandle, {
  session: ShellSession; onCommand?: (line: string, r: RunResult) => void; actions?: ReactNode; greeting?: string; rows?: number; title?: string;
}>(function ShellPanel({ session, onCommand, actions, greeting, rows, title = "Терминал" }, ref) {
  const term = useRef<TerminalHandle>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [cwd, setCwd] = useState(session.cwd);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [showTree, setShowTree] = useState(() => { try { return localStorage.getItem("shell.tree") !== "0"; } catch { return true; } });
  const [full, setFull] = useState(false);
  const prev = useRef<Stamp | null>(null);

  const refresh = useCallback(async () => {
    const root = session.home;
    const t = await session.tree(root);
    const now = stamps(t);
    const diff = new Set<string>();
    if (prev.current) for (const [p, v] of now) if (prev.current.get(p) !== v) diff.add(p);
    prev.current = now;
    setTree(t); setChanged(diff); setCwd(session.cwd);
  }, [session]);

  useEffect(() => { prev.current = null; void refresh(); }, [refresh]);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => term.current?.focus(),
    type: (l, d) => term.current?.type(l, d) ?? Promise.resolve(),
    runQuiet: (l) => term.current?.runQuiet(l) ?? Promise.resolve(),
    clear: () => term.current?.clear(),
    fullscreen: () => term.current?.fullscreen() ?? Promise.resolve(),
    refresh,
  }), [refresh]);

  const toggleTree = () => { setShowTree((v) => { try { localStorage.setItem("shell.tree", v ? "0" : "1"); } catch { /* private mode */ } return !v; }); };
  const outside = tree ? !(cwd === session.home || cwd.startsWith(session.home + "/")) : false;

  return (
    <div className={`shell${full ? " full" : ""}`}>
      <div className="shell-bar">
        <span className="shell-title">{title}</span>
        <div className="shell-actions">
          {actions}
          <button className={`icon-btn${showTree ? " on" : ""}`} onClick={toggleTree} title={showTree ? "Скрыть дерево файлов" : "Показать дерево файлов"} aria-pressed={showTree}><FolderTree size={16} /></button>
          <button className="icon-btn" onClick={() => void term.current?.fullscreen()} title={full ? "Выйти из полноэкранного режима" : "Во весь экран — в нём браузер отдаёт терминалу и Ctrl+W"}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        </div>
      </div>
      <div className={`shell-body${showTree ? " with-tree" : ""}`} onClick={() => term.current?.focus()}>
        <ShellTerminal ref={term} session={session} greeting={greeting} rows={rows} onCommand={(l, r) => { void refresh(); onCommand?.(l, r); }} />
        {showTree && tree && (
          <div className="ft" aria-label="Дерево файлов">
            <div className="ft-head">~ <span className="faint">{session.home}</span></div>
            {tree.children?.length ? tree.children.map((c) => <Node key={c.path} n={c} cwd={cwd} changed={changed} depth={0} />) : <div className="ft-empty faint">Домашняя папка пуста</div>}
            {outside && <div className="ft-out">Вы сейчас в <code>{cwd}</code> — вне домашней папки</div>}
          </div>
        )}
      </div>
    </div>
  );
});
