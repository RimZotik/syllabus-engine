/**
 * The shell simulator: bash on a virtual file system, in the browser (sandbox `shell`, docs/content/authoring.md).
 * The interpreter is just-bash (Apache-2.0, loaded lazily — about 340 KB gzip); the commands of the course whose
 * wording or behaviour must match GNU coreutils exactly are our own (commands.ts), and so is the file system's
 * strictness (no parent folders created behind the learner's back, a folder is never overwritten by a file).
 *
 * A command line is run pipeline by pipeline: `echo a; ls nope; echo b` prints in the real order, and `&&`/`||`
 * are decided here by exit codes. Shell variables and the working folder carry over from line to line.
 * Pure TypeScript without Vite features: the course validator runs it in Node (tools/program/build.py → headless.ts).
 */
import type { Bash, InMemoryFs } from "just-bash/browser";
import { makeCommands } from "./commands.ts";

type Lib = typeof import("just-bash/browser");
let libP: Promise<Lib> | null = null;
/** Loads the interpreter once (a separate chunk: pages without a terminal never download it). */
export const loadLib = (): Promise<Lib> => (libP ??= import("just-bash/browser"));

export type SetupFile = string | { content?: string; mode?: string; owner?: string; group?: string };
export type ShellSetup = {
  /** starting folder; relative paths in `files`, `dirs` and the checks are relative to it */
  cwd?: string;
  user?: string;
  env?: Record<string, string>;
  files?: Record<string, SetupFile>;
  dirs?: string[];
  /** date of the task's files (ls -l), ISO; default — yesterday 09:00 */
  date?: string;
};

/** One file system entry in a saved state. */
export type FsEntrySnap = { t: "f"; c: string; m: number; d: number } | { t: "d"; m: number; d: number } | { t: "l"; to: string; d: number };
export type FsSnap = Record<string, FsEntrySnap>;
/** What a session remembers: the file system, the folder, variables and what was typed. */
export type ShellState = { fs: FsSnap; cwd: string; env: Record<string, string>; history: string[]; log: LogEntry[]; owners: Record<string, string> };
/** A command line as it ran: the commands it used (names, for the checks) and what it printed. */
export type LogEntry = { line: string; commands: string[]; out: string; code: number };

export type Chunk = { fd: 1 | 2; text: string };
export type RunResult = { stdout: string; stderr: string; exitCode: number; chunks: Chunk[] };

/** A full-screen program (nano, less, man) as the terminal shows it. */
export interface ScreenApp {
  /** rows of the screen (with ANSI colours), the cursor (row, col), null — hide it */
  render(cols: number, rows: number): { lines: string[]; cursor: [number, number] | null };
  key(k: string): void | Promise<void>;
  done: boolean;
}
/** What the terminal gives the commands: questions (`rm -i`) and the full screen. Headless runs script them. */
export interface ShellUI {
  ask(prompt: string): Promise<string | null>;
  screen(app: ScreenApp): Promise<void>;
  cols: number;
  rows: number;
}

export const HOME_OF = (user: string) => (user === "root" ? "/root" : `/home/${user}`);
/** Files of a task are dated yesterday 09:00 (fixed `date` in the task overrides): `ls -l` looks like a live machine. */
const defaultDate = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(9, 0, 0, 0); return d; };
/** Folders of the simulated machine that are not the learner's business: hidden from snapshots and the tree. */
const SYSTEM = ["/bin", "/usr/bin", "/dev", "/proc"];
const isSystem = (p: string) => SYSTEM.some((s) => p === s || p.startsWith(s + "/"));

const parentOf = (p: string) => p.replace(/\/[^/]*$/, "") || "/";
export const joinPath = (base: string, p: string) => {
  const parts = (p.startsWith("/") ? p : `${base}/${p}`).split("/");
  const out: string[] = [];
  for (const x of parts) {
    if (!x || x === ".") continue;
    if (x === "..") out.pop(); else out.push(x);
  }
  return "/" + out.join("/");
};

function fsError(code: string, text: string, path: string) {
  return Object.assign(new Error(`${code}: ${text}, '${path}'`), { code });
}

/** The interpreter's in-memory FS made as strict as a real one. */
function strictFs(lib: Lib): InMemoryFs {
  class StrictFs extends lib.InMemoryFs {
    async isDir(p: string) { return (await super.exists(p)) && (await super.stat(p)).isDirectory; }
    async checkWrite(p: string) {
      const par = parentOf(p);
      if (!(await super.exists(par))) throw fsError("ENOENT", "no such file or directory", p);
      if (!(await super.stat(par)).isDirectory) throw fsError("ENOTDIR", "not a directory", p);
      if (await this.isDir(p)) throw fsError("EISDIR", "illegal operation on a directory", p);
    }
    async checkRead(p: string) { if (await this.isDir(p)) throw fsError("EISDIR", "illegal operation on a directory, read", p); }
    override async writeFile(p: string, c: Parameters<InMemoryFs["writeFile"]>[1], o?: Parameters<InMemoryFs["writeFile"]>[2]) { await this.checkWrite(p); return super.writeFile(p, c, o); }
    override async appendFile(p: string, c: Parameters<InMemoryFs["appendFile"]>[1], o?: Parameters<InMemoryFs["appendFile"]>[2]) { await this.checkWrite(p); return super.appendFile(p, c, o); }
    override async readFile(p: string, o?: Parameters<InMemoryFs["readFile"]>[1]) { await this.checkRead(p); return super.readFile(p, o); }
    override async readFileBuffer(p: string) { await this.checkRead(p); return super.readFileBuffer(p); }
    override async mkdir(p: string, o?: { recursive?: boolean }) {
      if (!o?.recursive) {
        const par = parentOf(p);
        if (!(await super.exists(par))) throw fsError("ENOENT", "no such file or directory, mkdir", p);
        if (await super.exists(p)) throw fsError("EEXIST", "file already exists, mkdir", p);
      }
      return super.mkdir(p, o);
    }
  }
  return new StrictFs();
}

/** An Ubuntu-like skeleton: the learner's home, /tmp, /etc with a few real files. */
const LAYOUT_DIRS = ["/etc", "/tmp", "/var", "/var/log", "/usr/share", "/root", "/home"];
const LAYOUT_FILES: Record<string, string> = {
  "/etc/hostname": "forge\n",
  "/etc/os-release": 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\n',
  "/etc/shells": "# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n",
};

type ExitScript = Record<number, unknown>;

export class ShellSession {
  bash!: Bash;
  fs!: InMemoryFs;
  lib!: Lib;
  ui: ShellUI;
  setup: ShellSetup;
  user: string;
  home: string;
  cwd: string;
  env: Record<string, string> = {};
  history: string[] = [];
  log: LogEntry[] = [];
  /** owner of each path created by the task or the learner (phase 1: no permission checks, only `ls -l`) */
  owners: Record<string, string> = {};
  /** set while a command line runs: which of ls, man, less write straight to the terminal (ls: columns and colours) */
  ttyNames = new Set<string>();
  get tty() { return this.ttyNames.has("ls"); }
  /** what our own commands printed in this pipeline, in order — to show stdout and stderr interleaved */
  segments: { id: number; fd: 1 | 2; text: string }[] = [];
  private nextAst: unknown = null;
  private exitScripts: ExitScript = {};
  private lastCode = 0;

  private constructor(setup: ShellSetup, ui: ShellUI) {
    this.setup = setup;
    this.ui = ui;
    this.user = setup.user ?? "student";
    this.home = HOME_OF(this.user);
    this.cwd = joinPath("/", setup.cwd ?? this.home);
  }

  /** A fresh session in the task's starting state. */
  static async create(setup: ShellSetup = {}, ui: ShellUI = headlessUI()): Promise<ShellSession> {
    const s = new ShellSession(setup, ui);
    await s.init();
    await s.applySetup();
    return s;
  }

  /** A session that continues a saved state (the learner came back to the task). */
  static async restore(setup: ShellSetup, state: ShellState, ui: ShellUI = headlessUI()): Promise<ShellSession> {
    const s = new ShellSession(setup, ui);
    await s.init();
    await s.loadSnap(state.fs);
    s.owners = { ...state.owners };
    s.cwd = state.cwd;
    s.env = { ...state.env };
    s.history = [...state.history];
    s.log = [...state.log];
    return s;
  }

  private async init() {
    this.lib = await loadLib();
    this.fs = strictFs(this.lib);
    this.bash = new this.lib.Bash({
      fs: this.fs,
      cwd: "/",
      customCommands: makeCommands(this),
      executionLimits: { maxOutputSize: 2_000_000, maxCommandCount: 200_000, maxLoopIterations: 100_000 },
    });
    this.bash.registerTransformPlugin({
      name: "forge-pipeline",
      transform: ({ ast }) => {
        if (!this.nextAst) return { ast };
        const a = this.nextAst as typeof ast;
        this.nextAst = null;
        return { ast: a };
      },
    });
    for (const d of [...LAYOUT_DIRS, this.home]) await this.fs.mkdir(d, { recursive: true });
    for (const [p, c] of Object.entries(LAYOUT_FILES)) await this.fs.writeFile(p, c);
    const fixed = defaultDate();
    for (const p of [...LAYOUT_DIRS, ...Object.keys(LAYOUT_FILES)]) await this.fs.utimes(p, fixed, fixed);
    this.owners[this.home] = this.user;
    this.env = {
      HOME: this.home, USER: this.user, LOGNAME: this.user, SHELL: "/bin/bash", LANG: "C.UTF-8", TERM: "xterm-256color",
      PATH: "/usr/local/bin:/usr/bin:/bin", EDITOR: "nano", HOSTNAME: "forge", PWD: this.cwd, OLDPWD: this.cwd,
    };
  }

  /** Path of the task (relative to the starting folder) → absolute. */
  abs(p: string, base = this.setup.cwd ? joinPath("/", this.setup.cwd) : this.home) {
    return joinPath(base, p.replace(/^~(?=\/|$)/, this.home));
  }

  private async applySetup() {
    const date = this.setup.date ? new Date(this.setup.date) : defaultDate();
    const touch = async (p: string) => this.fs.utimes(p, date, date);
    await this.fs.mkdir(this.cwd, { recursive: true });
    for (const d of this.setup.dirs ?? []) {
      const p = this.abs(d);
      await this.fs.mkdir(p, { recursive: true });
      await touch(p);
      this.owners[p] = this.user;
    }
    for (const [rel, f] of Object.entries(this.setup.files ?? {})) {
      const p = this.abs(rel);
      const spec = typeof f === "string" ? { content: f } : f;
      await this.fs.mkdir(parentOf(p), { recursive: true });
      await this.fs.writeFile(p, spec.content ?? "");
      if (spec.mode) await this.fs.chmod(p, parseInt(spec.mode, 8));
      await touch(p);
      this.owners[p] = spec.owner ?? (p.startsWith(this.home + "/") || p.startsWith("/tmp/") ? this.user : "root");
    }
    // writing the files touched their folders: give the whole prepared tree the task's date
    for (const p of this.fs.getAllPaths()) if (!isSystem(p) && p !== "/" && !LAYOUT_FILES[p] && !LAYOUT_DIRS.includes(p)) await touch(p);
    for (const [k, v] of Object.entries(this.setup.env ?? {})) this.env[k] = v;
    this.env.PWD = this.cwd;
    this.env.OLDPWD = this.cwd;
  }

  /** Owner of a path for `ls -l`: what the task or the learner set, else by where it lies. */
  ownerOf(p: string) {
    if (this.owners[p]) return this.owners[p];
    if (p === this.home || p.startsWith(this.home + "/") || p.startsWith("/tmp/")) return this.user;
    return "root";
  }

  /** The command names a line uses (for checks like «used mv», «did not use rm»), read from its syntax tree. */
  commandsOf(line: string): string[] {
    try {
      const names: string[] = [];
      walk(this.bash.transform(line).ast, (n) => {
        if (n.type !== "SimpleCommand" || !n.name) return;
        const name = wordText(n.name);
        if (name) names.push(name.replace(/^\\/, "").replace(/^.*\//, ""));
      });
      return names;
    } catch { return []; }
  }

  /** Runs one command line as typed at the prompt; `onChunk` receives the output as it is produced. */
  async run(line: string, opts: { signal?: AbortSignal; onChunk?: (c: Chunk) => void; record?: boolean; terminal?: boolean } = {}): Promise<RunResult> {
    const record = opts.record ?? true;
    const chunks: Chunk[] = [];
    const emit = (fd: 1 | 2, text: string) => { if (!text) return; chunks.push({ fd, text }); opts.onChunk?.({ fd, text }); };
    if (record && line.trim() && !/^\s/.test(line) && this.history[this.history.length - 1] !== line) this.history.push(line);
    type Ast = { statements: { pipelines: unknown[]; operators: string[] }[] };
    const parseLine = (): Ast | null => { try { return this.bash.transform(line).ast as unknown as Ast; } catch { return null; } };
    const ast = parseLine();
    this.ttyNames = ast && opts.terminal !== false ? terminalNames(ast) : new Set();
    let code = this.lastCode;
    if (!ast) {
      // a syntax error: let the interpreter word it
      const r = await this.exec(line, null, opts.signal);
      emit(1, r.stdout); emit(2, r.stderr);
      code = r.exitCode || 2;
    } else {
      outer: for (const st of ast.statements) {
        for (let i = 0; i < st.pipelines.length; i++) {
          if (opts.signal?.aborted) break outer;
          const op = i > 0 ? st.operators[i - 1] : ";";
          if ((op === "&&" && code !== 0) || (op === "||" && code === 0)) continue;
          this.segments = [];
          const r = await this.exec(":", st.pipelines[i], opts.signal);
          for (const c of order(r, this.segments)) emit(c.fd, c.text);
          code = r.exitCode;
        }
      }
    }
    this.ttyNames = new Set();
    this.lastCode = code;
    const stdout = chunks.filter((c) => c.fd === 1).map((c) => c.text).join("");
    const stderr = chunks.filter((c) => c.fd === 2).map((c) => c.text).join("");
    if (record && line.trim()) {
      const out = chunks.map((c) => c.text).join("");
      this.log.push({ line, commands: this.commandsOf(line), out: out.length > 4000 ? out.slice(-4000) : out, code });
      if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    }
    return { stdout, stderr, exitCode: code, chunks };
  }

  /** One pipeline (or a whole line when `pipeline` is null) with the session's variables, folder and `$?`. */
  private async exec(script: string, pipeline: unknown, signal?: AbortSignal) {
    if (pipeline) {
      this.exitScripts[this.lastCode] ??= this.bash.transform(`(exit ${this.lastCode})`).ast.statements[0];
      this.nextAst = { type: "Script", statements: [this.exitScripts[this.lastCode], { type: "Statement", pipelines: [pipeline], operators: [], background: false }] };
    }
    const r = await this.bash.exec(script, { env: this.env, replaceEnv: true, cwd: this.cwd, signal });
    this.nextAst = null;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.env ?? {})) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !["IFS", "OPTIND", "SHELLOPTS", "BASHOPTS", "PPID", "HOSTTYPE", "MACHTYPE", "OSTYPE"].includes(k)) env[k] = v;
    this.env = env;
    if (env.PWD && (await this.fs.exists(env.PWD))) this.cwd = env.PWD;
    this.lastCode = r.exitCode;
    return r;
  }

  /** The prompt path: ~ for home. */
  promptPath() {
    return this.cwd === this.home ? "~" : this.cwd.startsWith(this.home + "/") ? "~" + this.cwd.slice(this.home.length) : this.cwd;
  }

  /** Text of the last command line that printed something (for «find and print» tasks). */
  lastOutput() {
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].out.trim()) return this.log[i].out;
    return "";
  }

  async snapshot(): Promise<FsSnap> {
    const snap: FsSnap = {};
    for (const p of this.fs.getAllPaths().sort()) {
      if (p === "/" || isSystem(p)) continue;
      const st = await this.fs.lstat(p);
      const d = st.mtime.getTime();
      if (st.isSymbolicLink) snap[p] = { t: "l", to: await this.fs.readlink(p), d };
      else if (st.isDirectory) snap[p] = { t: "d", m: st.mode & 0o7777, d };
      else snap[p] = { t: "f", c: await this.fs.readFile(p), m: st.mode & 0o7777, d };
    }
    return snap;
  }

  private async loadSnap(snap: FsSnap) {
    // the layout from init() may have been changed by the learner: the snapshot is the truth
    for (const p of this.fs.getAllPaths().sort().reverse()) if (p !== "/" && !isSystem(p) && !snap[p]) await this.fs.rm(p, { recursive: true, force: true });
    for (const [p, e] of Object.entries(snap)) {
      if (e.t === "d") await this.fs.mkdir(p, { recursive: true });
      else if (e.t === "f") { await this.fs.mkdir(parentOf(p), { recursive: true }); await this.fs.writeFile(p, e.c); }
      else { await this.fs.mkdir(parentOf(p), { recursive: true }); await this.fs.symlink(e.to, p); }
    }
    for (const [p, e] of Object.entries(snap)) {
      if (e.t !== "l") await this.fs.chmod(p, e.m);
      if (e.t !== "l") await this.fs.utimes(p, new Date(e.d), new Date(e.d));
    }
  }

  async state(): Promise<ShellState> {
    return { fs: await this.snapshot(), cwd: this.cwd, env: { ...this.env }, history: [...this.history], log: [...this.log], owners: { ...this.owners } };
  }

  /** A separate session on a copy of this file system (the checks' `run` must not change the learner's files). */
  async copy(ui: ShellUI = headlessUI()): Promise<ShellSession> {
    const st = await this.state();
    const s = await ShellSession.restore(this.setup, { ...st, cwd: this.abs("."), history: [], log: [] }, ui);
    s.env.PWD = s.cwd;
    return s;
  }

  /** The tree under `root` for the side panel: folders first, hidden entries included (the panel greys them). */
  async tree(root = this.home): Promise<TreeNode> {
    const build = async (p: string, depth: number): Promise<TreeNode> => {
      const st = await this.fs.stat(p).catch(() => null);
      const name = p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1);
      if (!st?.isDirectory) return { name, path: p, dir: false, size: st?.size ?? 0 };
      const names = depth > 8 ? [] : (await this.fs.readdir(p)).filter((n) => !isSystem(joinPath(p, n)));
      const kids = await Promise.all(names.map((n) => build(joinPath(p, n), depth + 1)));
      kids.sort((a, b) => Number(b.dir) - Number(a.dir) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { name, path: p, dir: true, children: kids };
    };
    return build(root, 0);
  }
}

export type TreeNode = { name: string; path: string; dir: boolean; size?: number; children?: TreeNode[] };

/** A UI for runs without a terminal: questions get answers from a list (else «no»), full-screen programs get keys. */
export function headlessUI(answers: string[] = [], keys: string[] = []): ShellUI {
  return {
    cols: 80, rows: 24,
    ask: async () => answers.shift() ?? null,
    async screen(app) {
      let guard = 0;
      while (!app.done && guard++ < 10_000) {
        const k = keys.shift();
        // nothing scripted: leave the program the way a learner would — quit without saving
        await app.key(k ?? (guard % 2 ? "C-x" : "n"));
        if (k === undefined && guard > 6) await app.key("q");
      }
    },
  };
}

type AnyNode = { type: string; [k: string]: unknown };
function walk(node: unknown, f: (n: AnyNode & { name?: unknown }) => void) {
  if (Array.isArray(node)) { for (const x of node) walk(x, f); return; }
  if (!node || typeof node !== "object") return;
  const n = node as AnyNode;
  if (typeof n.type === "string") f(n);
  for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, f);
}

/** Literal text of a word (quotes removed); null if it has expansions. */
export function wordText(w: unknown): string | null {
  const parts = (w as { parts?: { type: string; value?: string; parts?: unknown[] }[] }).parts ?? [];
  let s = "";
  for (const p of parts) {
    if (p.type === "Literal" || p.type === "SingleQuoted" || p.type === "Escaped") s += p.value ?? "";
    else if (p.type === "DoubleQuoted") { const t = wordText(p); if (t === null) return null; s += t; }
    else return null;
  }
  return s;
}

/** Which of ls, man, less write to the terminal in every use on the line (last in the pipeline, stdout not redirected). */
function terminalNames(ast: unknown): Set<string> {
  const ok = new Map<string, boolean>();
  walk(ast, (n) => {
    if (n.type !== "Pipeline") return;
    const cmds = (n.commands as AnyNode[]) ?? [];
    cmds.forEach((c, i) => {
      const name = c.type === "SimpleCommand" && c.name ? wordText(c.name) : null;
      if (!name || !["ls", "man", "less"].includes(name)) return;
      const redirected = ((c.redirections as { operator: string; fd: number | null }[]) ?? []).some((r) => [">", ">>", "&>", "&>>", ">|"].includes(r.operator) && (r.fd === null || r.fd === 1));
      ok.set(name, (ok.get(name) ?? true) && i === cmds.length - 1 && !redirected);
    });
  });
  // `$(ls)` is seen as a pipeline of its own, last in it — a rare case, ignored
  return new Set([...ok].filter(([, v]) => v).map(([k]) => k));
}

/** Interleaves stdout and stderr: in the order one of our commands produced them if it alone printed everything. */
function order(r: { stdout: string; stderr: string }, segs: { id: number; fd: 1 | 2; text: string }[]): Chunk[] {
  const ids = new Set(segs.map((s) => s.id));
  if (ids.size === 1) {
    const out = segs.filter((s) => s.fd === 1).map((s) => s.text).join("");
    const err = segs.filter((s) => s.fd === 2).map((s) => s.text).join("");
    if (out === r.stdout && err === r.stderr) return segs.map((s) => ({ fd: s.fd, text: s.text }));
  }
  return [{ fd: 1, text: r.stdout }, { fd: 2, text: r.stderr }].filter((c) => c.text) as Chunk[];
}
