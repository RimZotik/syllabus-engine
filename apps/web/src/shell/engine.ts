/**
 * The shell simulator: bash on a virtual file system, in the browser (sandbox `shell`, docs/content/authoring.md).
 * The interpreter is just-bash (Apache-2.0, loaded lazily — about 350 KB gzip); the commands of the course whose
 * wording or behaviour must match GNU coreutils exactly are our own (commands.ts, commands2.ts), and so is the
 * file system's strictness: no parent folders created behind the learner's back, a folder is never overwritten
 * by a file, and every access is checked against owner, group and mode bits (users.ts) for the effective user
 * (the learner, or root under sudo).
 *
 * A command line is run pipeline by pipeline: `echo a; ls nope; echo b` prints in the real order, `&&`/`||` are
 * decided here by exit codes, `&` makes a job (procs.ts). Between lines the session keeps the folder, shell
 * variables apart from exported ones (a child process sees only `export`ed), aliases and functions.
 * Pure TypeScript without Vite features: the course validator runs it in Node (tools/program/build.py → headless.ts).
 */
import type { Bash, InMemoryFs } from "just-bash/browser";
import { makeCommands } from "./commands.ts";
import { makeCommands2 } from "./commands2.ts";
import { allowed, Users, type UserSpec } from "./users.ts";
import { Procs, type Job, type Proc, type ProcSpec, type SignalRec } from "./procs.ts";

type Lib = typeof import("just-bash/browser");
let libP: Promise<Lib> | null = null;
/** Loads the interpreter once (a separate chunk: pages without a terminal never download it). */
export const loadLib = (): Promise<Lib> => (libP ??= import("just-bash/browser"));

export type SetupFile = string | { content?: string; mode?: string; owner?: string; group?: string };
export type SetupDir = string | { path: string; mode?: string; owner?: string; group?: string };
export type ShellSetup = {
  /** starting folder; relative paths in `files`, `dirs` and the checks are relative to it */
  cwd?: string;
  /** who the learner is (default student) */
  user?: string;
  env?: Record<string, string>;
  files?: Record<string, SetupFile>;
  dirs?: SetupDir[];
  /** date of the task's files (ls -l), ISO; default — yesterday 09:00 */
  date?: string;
  /** extra users or changes to the default ones (student, anna): {name: {groups, password, uid}} */
  users?: Record<string, UserSpec>;
  /** the learner's password for sudo (default forge) */
  sudo_password?: string;
  /** processes running when the task starts */
  processes?: ProcSpec[];
};

/** One file system entry in a saved state. */
export type FsEntrySnap = { t: "f"; c: string; m: number; d: number } | { t: "d"; m: number; d: number } | { t: "l"; to: string; d: number };
export type FsSnap = Record<string, FsEntrySnap>;
type Meta = { o: string; g: string };
/** What a session remembers: the file system, the folder, variables and what was typed. */
export type ShellState = {
  fs: FsSnap; cwd: string; env: Record<string, string>; history: string[]; log: LogEntry[]; owners: Record<string, string>;
  meta?: Record<string, Meta>; exported?: string[]; aliases?: Record<string, string>; functions?: Record<string, string>;
  procs?: { procs: Proc[]; jobs: Job[]; signals: SignalRec[] };
};
/** A command line as it ran: the commands it used (names, for the checks) and what it printed. */
export type LogEntry = { line: string; commands: string[]; out: string; code: number };

export type Chunk = { fd: 1 | 2; text: string };
export type RunResult = { stdout: string; stderr: string; exitCode: number; chunks: Chunk[] };

/** A full-screen program (nano, less, man, top) as the terminal shows it. */
export interface ScreenApp {
  /** rows of the screen (with ANSI colours), the cursor (row, col), null — hide it */
  render(cols: number, rows: number): { lines: string[]; cursor: [number, number] | null };
  key(k: string): void | Promise<void>;
  done: boolean;
  /** redraw every `interval` ms (top), calling tick() first */
  interval?: number;
  tick?(): void | Promise<void>;
}
/** What the terminal gives the commands: questions (`rm -i`, sudo's password) and the full screen. Headless runs script them. */
export interface ShellUI {
  ask(prompt: string, opts?: { secret?: boolean }): Promise<string | null>;
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

export const parentOf = (p: string) => p.replace(/\/[^/]*$/, "") || "/";
export const joinPath = (base: string, p: string) => {
  const parts = (p.startsWith("/") ? p : `${base}/${p}`).split("/");
  const out: string[] = [];
  for (const x of parts) {
    if (!x || x === ".") continue;
    if (x === "..") out.pop(); else out.push(x);
  }
  return "/" + out.join("/");
};
const ancestors = (p: string) => { const out: string[] = []; let a = parentOf(p); for (;;) { out.unshift(a); if (a === "/") break; a = parentOf(a); } return p === "/" ? [] : out; };

export function fsError(code: string, text: string, path: string) {
  return Object.assign(new Error(`${code}: ${text}, '${path}'`), { code });
}
export const errCode = (e: unknown) => (e as { code?: string })?.code ?? /^(E[A-Z]+)/.exec(String((e as Error)?.message ?? ""))?.[1] ?? "EIO";

/** The interpreter's in-memory FS made as strict as a real one, with owners and permission checks. */
export type StrictFs = InMemoryFs & {
  meta: Map<string, Meta>;
  /** >0 — the platform itself reads or writes (snapshots, the tree, checks): no permission checks */
  sysDepth: number;
  metaOf(p: string): Meta;
  can(p: string, want: number): Promise<boolean>;
  search(p: string): Promise<void>;
};

function strictFs(lib: Lib, s: ShellSession): StrictFs {
  class Strict extends lib.InMemoryFs {
    meta = new Map<string, Meta>();
    sysDepth = 0;
    get sys() { return this.sysDepth > 0; }
    metaOf(p: string): Meta {
      const m = this.meta.get(p);
      if (m) return m;
      for (const u of s.users.users.values()) if (u.uid !== 0 && (p === u.home || p.startsWith(u.home + "/"))) return { o: u.name, g: s.users.primary(u.name) };
      if (p.startsWith("/tmp/")) return { o: s.user, g: s.users.primary(s.user) };
      return { o: "root", g: p === "/etc/shadow" ? "shadow" : "root" };
    }
    private async st(p: string) { return super.stat(p); }
    async can(p: string, want: number) {
      if (this.sys) return true;
      const st = await this.st(p);
      const m = this.metaOf(p);
      return allowed(s.users, s.euid, st.mode, m.o, m.g, want, st.isDirectory);
    }
    /** Every folder on the way must be enterable (x); a missing one is ENOENT, a file on the way ENOTDIR. */
    async search(p: string) {
      if (this.sys) return;
      for (const a of ancestors(p)) {
        let st;
        try { st = await this.st(a); } catch { throw fsError("ENOENT", "no such file or directory", p); }
        if (!st.isDirectory) throw fsError("ENOTDIR", "not a directory", p);
        if (!(await this.can(a, 1))) throw fsError("EACCES", "permission denied", p);
      }
    }
    private mine() { return { o: s.euid, g: s.users.primary(s.euid) }; }
    private setMine(p: string) { if (!this.sys) this.meta.set(p, this.mine()); }
    private async isDir(p: string) { return (await super.exists(p)) && (await this.st(p)).isDirectory; }
    private async checkRead(p: string) {
      await this.search(p);
      if (await this.isDir(p)) throw fsError("EISDIR", "illegal operation on a directory, read", p);
      if ((await super.exists(p)) && !(await this.can(p, 4))) throw fsError("EACCES", "permission denied, open", p);
    }
    /** Writing to p: the folder must exist, be enterable, and (for a new file) writable; an existing file must be writable. */
    private async checkWrite(p: string): Promise<boolean> {
      const par = parentOf(p);
      await this.search(p);
      if (!(await super.exists(par))) throw fsError("ENOENT", "no such file or directory", p);
      if (!(await this.st(par)).isDirectory) throw fsError("ENOTDIR", "not a directory", p);
      if (await this.isDir(p)) throw fsError("EISDIR", "illegal operation on a directory", p);
      const exists = await super.exists(p);
      if (exists ? !(await this.can(p, 2)) : !(await this.can(par, 3))) throw fsError("EACCES", "permission denied, open", p);
      return !exists;
    }
    /** Creating or removing an entry in a folder: w+x on the folder; with the sticky bit (/tmp) only the owner of the entry. */
    private async checkEntry(p: string, removing: boolean) {
      const par = parentOf(p);
      await this.search(p);
      if (!(await this.can(par, 3))) throw fsError("EACCES", "permission denied", p);
      if (removing && !this.sys && s.euid !== "root") {
        const pst = await this.st(par);
        if (pst.mode & 0o1000 && this.metaOf(p).o !== s.euid && this.metaOf(par).o !== s.euid) throw fsError("EPERM", "operation not permitted", p);
      }
    }
    override async writeFile(p: string, c: Parameters<InMemoryFs["writeFile"]>[1], o?: Parameters<InMemoryFs["writeFile"]>[2]) {
      const created = await this.checkWrite(p); await super.writeFile(p, c, o); if (created) this.setMine(p);
    }
    override async appendFile(p: string, c: Parameters<InMemoryFs["appendFile"]>[1], o?: Parameters<InMemoryFs["appendFile"]>[2]) {
      const created = await this.checkWrite(p); await super.appendFile(p, c, o); if (created) this.setMine(p);
    }
    override async readFile(p: string, o?: Parameters<InMemoryFs["readFile"]>[1]) { await this.checkRead(p); return super.readFile(p, o); }
    override async readFileBuffer(p: string) { await this.checkRead(p); return super.readFileBuffer(p); }
    override async readFileBytes(p: string) { await this.checkRead(p); return super.readFileBytes(p); }
    override async exists(p: string) { try { await this.search(p); } catch { return false; } return super.exists(p); }
    override async stat(p: string) { await this.search(p); return super.stat(p); }
    override async lstat(p: string) { await this.search(p); return super.lstat(p); }
    override async realpath(p: string) { await this.search(p); return super.realpath(p); }
    override async readdir(p: string) { await this.search(p); if ((await super.exists(p)) && (await this.isDir(p)) && !(await this.can(p, 4))) throw fsError("EACCES", "permission denied, scandir", p); return super.readdir(p); }
    override async readdirWithFileTypes(p: string) { await this.search(p); if ((await super.exists(p)) && (await this.isDir(p)) && !(await this.can(p, 4))) throw fsError("EACCES", "permission denied, scandir", p); return super.readdirWithFileTypes(p); }
    override async mkdir(p: string, o?: { recursive?: boolean }) {
      if (!o?.recursive) {
        const par = parentOf(p);
        await this.search(p);
        if (!(await super.exists(par))) throw fsError("ENOENT", "no such file or directory, mkdir", p);
        if (await super.exists(p)) throw fsError("EEXIST", "file already exists, mkdir", p);
        await this.checkEntry(p, false);
        await super.mkdir(p, o);
        this.setMine(p);
        return;
      }
      // -p: create each missing component with the same checks
      const parts = p.split("/").filter(Boolean);
      let cur = "";
      for (const x of parts) {
        cur += "/" + x;
        if (await super.exists(cur)) { if (!(await this.st(cur)).isDirectory) throw fsError("ENOTDIR", "not a directory", cur); continue; }
        await this.mkdir(cur);
      }
    }
    override async rm(p: string, o?: { recursive?: boolean; force?: boolean }) {
      if (await super.exists(p)) await this.checkEntry(p, true);
      await super.rm(p, o);
      for (const k of [...this.meta.keys()]) if (k === p || k.startsWith(p + "/")) this.meta.delete(k);
    }
    override async mv(a: string, b: string) {
      await this.checkEntry(a, true);
      await this.checkEntry(b, false);
      await super.mv(a, b);
      for (const [k, v] of [...this.meta]) if (k === a || k.startsWith(a + "/")) { this.meta.delete(k); this.meta.set(b + k.slice(a.length), v); }
    }
    override async cp(a: string, b: string, o?: { recursive?: boolean }) {
      await this.checkRead(a).catch((e) => { if (errCode(e) !== "EISDIR") throw e; });
      await this.checkEntry(b, false);
      await super.cp(a, b, o);
      if (!this.sys) for (const k of this.getAllPaths()) if (k === b || k.startsWith(b + "/")) this.meta.set(k, this.mine());
    }
    override async chmod(p: string, mode: number) {
      await this.search(p);
      if (!this.sys && s.euid !== "root" && this.metaOf(p).o !== s.euid) throw fsError("EPERM", "operation not permitted, chmod", p);
      return super.chmod(p, mode);
    }
    override async utimes(p: string, a: Date, m: Date) {
      await this.search(p);
      if (!this.sys && s.euid !== "root" && this.metaOf(p).o !== s.euid && !(await this.can(p, 2))) throw fsError("EACCES", "permission denied, utime", p);
      return super.utimes(p, a, m);
    }
    override async symlink(t: string, p: string) { await this.checkEntry(p, false); await super.symlink(t, p); this.setMine(p); }
    override async link(a: string, p: string) { await this.checkEntry(p, false); await super.link(a, p); this.setMine(p); }
  }
  return new Strict() as unknown as StrictFs;
}

/** An Ubuntu-like skeleton: homes, /tmp (sticky), /etc with the user database, /root closed. */
const LAYOUT_DIRS: [string, number][] = [["/etc", 0o755], ["/tmp", 0o1777], ["/var", 0o755], ["/var/log", 0o755], ["/usr/share", 0o755], ["/usr/local/bin", 0o755], ["/root", 0o700], ["/home", 0o755], ["/opt", 0o755], ["/srv", 0o755]];
const LAYOUT_FILES: Record<string, string> = {
  "/etc/hostname": "forge\n",
  "/etc/os-release": 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\n',
  "/etc/shells": "# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n",
  "/root/.bashrc": "# ~/.bashrc: executed by bash(1) for non-login shells.\n",
};
const BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.
# (в тренажёре — при каждом «новом окне терминала»)

# don't put duplicate lines or lines starting with space in the history.
HISTCONTROL=ignoreboth

# some more ls aliases
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
`;

const SPECIAL_VARS = new Set(["IFS", "OPTIND", "SHELLOPTS", "BASHOPTS", "PPID", "HOSTTYPE", "MACHTYPE", "OSTYPE", "BASH_VERSION", "BASH_VERSINFO", "SHLVL", "_", "RANDOM", "SECONDS", "LINENO", "UID", "EUID"]);
const SHELL_BUILTINS = new Set(["cd", "export", "unset", "source", ".", "alias", "unalias", "exit", "logout", "set", "shopt", "read", "declare", "local", "eval", "exec", "fg", "bg", "jobs", "wait", "history", "type", "hash", "umask", "ulimit", "trap", "return", "shift", "break", "continue", "readonly", "let", "pushd", "popd", "dirs", "builtin", "command", "test", "[", "echo", "printf", "true", "false", "kill", "pwd", "times", "getopts", "help", "enable", "complete", "compgen", "bind", "caller", "disown", "suspend", "typeset", "mapfile", "readarray", "coproc", ":", "fc"]);
export const isBuiltin = (n: string) => SHELL_BUILTINS.has(n);
const sq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
const isVarName = (k: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);

/** A shell «window»: who you are, where, with which variables. `sudo -i` and `su` push one, `exit` pops it. */
type Frame = { euid: string; cwd: string; env: Record<string, string>; exported: Set<string>; aliases: Record<string, string>; functions: Record<string, string>; login: boolean };

type Ast = { statements: { pipelines: unknown[]; operators: string[]; background?: boolean; sourceText?: string }[] };

export class ShellSession {
  bash!: Bash;
  fs!: StrictFs;
  lib!: Lib;
  ui: ShellUI;
  setup: ShellSetup;
  /** the login user (the learner) */
  user: string;
  /** the effective user right now: root inside sudo, someone else after su */
  euid: string;
  home: string;
  cwd: string;
  env: Record<string, string> = {};
  /** names of exported variables; the rest of `env` are shell variables a child process does not see */
  exported = new Set<string>();
  aliases: Record<string, string> = {};
  functions: Record<string, string> = {};
  frames: Frame[] = [];
  users!: Users;
  procs!: Procs;
  sudoPassword: string;
  sudoUntil = 0;
  history: string[] = [];
  log: LogEntry[] = [];
  /** kept for saved states of phase 1; owners now live in fs.meta */
  owners: Record<string, string> = {};
  /** set while a command line runs: which of ls, man, less write straight to the terminal (ls: columns and colours) */
  ttyNames = new Set<string>();
  get tty() { return this.ttyNames.has("ls"); }
  /** what our own commands printed in this pipeline, in order — to show stdout and stderr interleaved */
  segments: { id: number; fd: 1 | 2; text: string }[] = [];
  /** a command (sudo -i, su) changed the shell itself: the pipeline's environment must not overwrite it */
  frameChanged = false;
  private nextAst: unknown = null;
  private lastCode = 0;
  private loginEnv: Record<string, string> = {};
  private loginExported = new Set<string>();
  private lockP: Promise<void> = Promise.resolve();
  private preludeCache = new Map<string, unknown[]>();

  private constructor(setup: ShellSetup, ui: ShellUI) {
    this.setup = setup;
    this.ui = ui;
    this.user = setup.user ?? "student";
    this.euid = this.user;
    this.home = HOME_OF(this.user);
    this.cwd = joinPath("/", setup.cwd ?? this.home);
    this.sudoPassword = setup.sudo_password ?? "forge";
  }

  /** A fresh session in the task's starting state. */
  static async create(setup: ShellSetup = {}, ui: ShellUI = headlessUI()): Promise<ShellSession> {
    const s = new ShellSession(setup, ui);
    await s.init();
    await s.asRoot(() => s.applySetup());
    s.procs.init(s.user, (setup.processes ?? []).map((p) => ({ ...p, file: p.file ? s.abs(p.file) : undefined })));
    await s.startWindow(null);
    return s;
  }

  /** A session that continues a saved state (the learner came back to the task). */
  static async restore(setup: ShellSetup, state: ShellState, ui: ShellUI = headlessUI()): Promise<ShellSession> {
    const s = new ShellSession(setup, ui);
    await s.init();
    await s.asRoot(() => s.loadSnap(state.fs));
    if (state.meta) for (const [k, v] of Object.entries(state.meta)) s.fs.meta.set(k, v);
    else for (const [k, v] of Object.entries(state.owners ?? {})) s.fs.meta.set(k, { o: v, g: s.users.primary(v) });
    s.cwd = state.cwd;
    s.env = { ...state.env };
    s.exported = new Set(state.exported ?? Object.keys(state.env));
    s.aliases = { ...(state.aliases ?? {}) };
    s.functions = { ...(state.functions ?? {}) };
    s.history = [...state.history];
    s.log = [...state.log];
    if (state.procs) { s.procs.procs = state.procs.procs.map((p) => ({ ...p, wake: undefined })); s.procs.jobs = state.procs.jobs; s.procs.signals = state.procs.signals; }
    else s.procs.init(s.user, (setup.processes ?? []).map((p) => ({ ...p, file: p.file ? s.abs(p.file) : undefined })));
    return s;
  }

  private async init() {
    this.lib = await loadLib();
    this.users = new Users(this.setup.users ?? {}, this.user);
    this.fs = strictFs(this.lib, this);
    this.procs = new Procs({
      now: () => Date.now(),
      append: (path, text) => this.asRoot(async () => { if (await this.fs.exists(parentOf(path))) await this.fs.appendFile(path, text); }),
    });
    this.bash = new this.lib.Bash({
      fs: this.fs,
      cwd: "/",
      customCommands: [...makeCommands(this), ...makeCommands2(this)],
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
    await this.asRoot(async () => {
      const fixed = defaultDate();
      for (const [d, m] of LAYOUT_DIRS) { await this.fs.mkdir(d, { recursive: true }); await this.fs.chmod(d, m); }
      for (const u of this.users.users.values()) {
        if (u.uid === 0) continue;
        await this.fs.mkdir(u.home, { recursive: true });
        await this.fs.chmod(u.home, 0o750);
      }
      for (const [p, c] of Object.entries(LAYOUT_FILES)) await this.fs.writeFile(p, c);
      await this.fs.writeFile("/etc/passwd", this.users.passwd());
      await this.fs.writeFile("/etc/group", this.users.group());
      await this.fs.writeFile("/etc/shadow", [...this.users.users.values()].map((u) => `${u.name}:${u.uid === 0 ? "*" : "$y$j9T$forge$hash"}:20000:0:99999:7:::\n`).join(""));
      await this.fs.chmod("/etc/shadow", 0o640);
      await this.fs.writeFile("/etc/sudoers", "Defaults\tenv_reset\nroot\tALL=(ALL:ALL) ALL\n%sudo\tALL=(ALL:ALL) ALL\n");
      await this.fs.chmod("/etc/sudoers", 0o440);
      await this.fs.writeFile(`${this.home}/.bashrc`, BASHRC);
      for (const p of this.fs.getAllPaths()) if (!isSystem(p)) await this.fs.utimes(p, fixed, fixed);
    });
    this.env = {
      HOME: this.home, USER: this.user, LOGNAME: this.user, SHELL: "/bin/bash", LANG: "C.UTF-8", TERM: "xterm-256color",
      PATH: "/usr/local/bin:/usr/bin:/bin", EDITOR: "nano", PWD: this.cwd, OLDPWD: this.cwd,
    };
    this.exported = new Set(Object.keys(this.env));
  }

  /** The platform's own reads and writes (setup, snapshots, the tree, the checks): no permission checks. */
  async asRoot<T>(fn: () => Promise<T>): Promise<T> {
    this.fs.sysDepth++;
    try { return await fn(); } finally { this.fs.sysDepth--; }
  }
  /** Like asRoot, but waits until the command line that runs now is over (never call from inside a command). */
  sys<T>(fn: () => Promise<T>): Promise<T> { return this.locked(() => this.asRoot(fn)); }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.lockP;
    let release!: () => void;
    this.lockP = new Promise((r) => (release = r));
    await prev;
    try { return await fn(); } finally { release(); }
  }

  /** Path of the task (relative to the starting folder) → absolute. */
  abs(p: string, base = this.setup.cwd ? joinPath("/", this.setup.cwd) : this.home) {
    return joinPath(base, p.replace(/^~(?=\/|$)/, this.home));
  }

  private async applySetup() {
    const date = this.setup.date ? new Date(this.setup.date) : defaultDate();
    const touched: string[] = [];
    const own = (p: string, o?: string, g?: string) => { if (o || g) this.fs.meta.set(p, { o: o ?? this.fs.metaOf(p).o, g: g ?? (o ? this.users.primary(o) : this.fs.metaOf(p).g) }); };
    const mkdirs = async (p: string) => {
      const parts = p.split("/").filter(Boolean);
      let cur = "";
      for (const x of parts) { cur += "/" + x; if (!(await this.fs.exists(cur))) { await this.fs.mkdir(cur); touched.push(cur); } }
    };
    await mkdirs(this.cwd);
    const files = Object.entries(this.setup.files ?? {});
    for (const d of this.setup.dirs ?? []) {
      const spec = typeof d === "string" ? { path: d } : d;
      const p = this.abs(spec.path);
      await mkdirs(p);
      if (spec.mode) await this.fs.chmod(p, parseInt(spec.mode, 8));
      own(p, spec.owner, spec.group);
      touched.push(p);
    }
    for (const [rel, f] of files) {
      const p = this.abs(rel);
      const spec = typeof f === "string" ? { content: f } : f;
      await mkdirs(parentOf(p));
      await this.fs.writeFile(p, spec.content ?? "");
      if (spec.mode) await this.fs.chmod(p, parseInt(spec.mode, 8));
      own(p, spec.owner, spec.group);
      touched.push(p);
    }
    for (const p of touched) await this.fs.utimes(p, date, date);
    // the folders that got new files: the task's date too
    for (const p of new Set(touched.map(parentOf))) if (!LAYOUT_DIRS.some(([d]) => d === p) && p !== "/") await this.fs.utimes(p, date, date);
    for (const [k, v] of Object.entries(this.setup.env ?? {})) { this.env[k] = v; this.exported.add(k); }
    this.env.PWD = this.cwd;
    this.env.OLDPWD = this.cwd;
    this.loginEnv = { ...this.env };
    this.loginExported = new Set(this.exported);
  }

  /** Owner of a path for `ls -l` and `stat`. */
  ownerOf(p: string) { return this.fs.metaOf(p).o; }
  groupOf(p: string) { return this.fs.metaOf(p).g; }

  /** The command names a line uses (for checks like «used mv», «did not use rm»), read from its syntax tree. */
  commandsOf(line: string): string[] {
    try {
      const names: string[] = [];
      walk(this.bash.transform(line).ast, (n) => {
        if (n.type !== "SimpleCommand" || !n.name) return;
        const name = wordText(n.name);
        if (name) names.push(name.replace(/^\\/, "").replace(/^.*\//, ""));
        // sudo X, command X, time X: X is used too
        const args = (n.args as unknown[]) ?? [];
        if (name && ["sudo", "command", "time", "nohup", "exec", "builtin"].includes(name)) {
          const first = args.map((a) => wordText(a)).find((a) => a && !a.startsWith("-"));
          if (first) names.push(first.replace(/^.*\//, ""));
        }
      });
      return names;
    } catch { return []; }
  }

  /** Runs one command line as typed at the prompt; `onChunk` receives the output as it is produced. */
  run(line: string, opts: { signal?: AbortSignal; onChunk?: (c: Chunk) => void; record?: boolean; terminal?: boolean } = {}): Promise<RunResult> {
    return this.locked(() => this.runNow(line, opts));
  }

  private async runNow(line: string, opts: { signal?: AbortSignal; onChunk?: (c: Chunk) => void; record?: boolean; terminal?: boolean }): Promise<RunResult> {
    const record = opts.record ?? true;
    const chunks: Chunk[] = [];
    this.cancelLine = false;
    // an interrupted line: bash just stops, without the interpreter's own note
    const emit = (fd: 1 | 2, text: string) => { text = text.replace(/^bash: execution aborted\n?/m, ""); if (!text) return; chunks.push({ fd, text }); opts.onChunk?.({ fd, text }); };
    if (record && line.trim() && !/^\s/.test(line) && this.history[this.history.length - 1] !== line) this.history.push(line);
    await this.procs.tick();
    const src = line;
    const parseLine = (): Ast | null => { try { return this.bash.transform(src).ast as unknown as Ast; } catch { return null; } };
    const ast = parseLine();
    this.ttyNames = ast && opts.terminal !== false ? terminalNames(ast) : new Set();
    let code = this.lastCode;
    if (!ast) {
      // a syntax error: let the interpreter word it
      const r = await this.exec(src, null, opts.signal);
      emit(1, r.stdout); emit(2, r.stderr);
      code = r.exitCode || 2;
    } else {
      outer: for (const st of ast.statements) {
        if (st.background) { code = await this.background(st, emit, opts.signal); continue; }
        for (let i = 0; i < st.pipelines.length; i++) {
          if (opts.signal?.aborted || this.cancelLine) break outer;
          const op = i > 0 ? st.operators[i - 1] : ";";
          if ((op === "&&" && code !== 0) || (op === "||" && code === 0)) continue;
          const pl = st.pipelines[i];
          const ex = exitWord(pl);
          if (ex) { code = await this.exitShell(ex.code ?? this.lastCode, emit); continue; }
          this.segments = [];
          await this.procs.tick();
          const r = await this.exec(":", pl, opts.signal, st.sourceText);
          for (const c of order(r, this.segments)) emit(c.fd, c.text);
          code = r.exitCode;
        }
      }
    }
    this.ttyNames = new Set();
    this.lastCode = code;
    await this.procs.tick();
    emit(1, this.procs.notices());
    const stdout = chunks.filter((c) => c.fd === 1).map((c) => c.text).join("");
    const stderr = chunks.filter((c) => c.fd === 2).map((c) => c.text).join("");
    if (record && line.trim()) {
      const out = chunks.map((c) => c.text).join("");
      this.log.push({ line, commands: this.commandsOf(line), out: out.length > 4000 ? out.slice(-4000) : out, code });
      if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
    }
    return { stdout, stderr, exitCode: code, chunks };
  }

  /** `cmd &`: a job. `sleep N &` just sleeps in the table; anything else runs now (up to 3 s) and keeps running if it has not finished. */
  private async background(st: Ast["statements"][number], emit: (fd: 1 | 2, t: string) => void, signal?: AbortSignal) {
    const text = (st.sourceText ?? "").replace(/\s*&\s*$/, "").trim() || "job";
    const pl = st.pipelines[0] as { commands?: { type: string; name?: unknown; args?: unknown[] }[] };
    const c0 = st.pipelines.length === 1 && pl.commands?.length === 1 ? pl.commands[0] : null;
    const sleepArgs = c0?.type === "SimpleCommand" && wordText(c0.name) === "sleep" ? (c0.args ?? []).map((a) => wordText(a)) : null;
    if (sleepArgs && sleepArgs.every((a) => a !== null)) {
      const ms = sleepMs(sleepArgs as string[]);
      if (ms !== null) {
        const p = this.procs.spawn(this.euid, "sleep", `sleep ${sleepArgs.join(" ")}`, "sleep", { endAt: Date.now() + ms });
        const job = this.procs.addJob(p, "Running", text);
        emit(1, `[${job.id}] ${p.pid}\n`);
        return 0;
      }
    }
    const name = c0?.type === "SimpleCommand" ? (wordText(c0.name) ?? text).replace(/^.*\//, "") : text.split(/\s+/)[0];
    const p = this.procs.spawn(this.euid, name, text, "idle");
    const job = this.procs.addJob(p, "Running", text);
    emit(1, `[${job.id}] ${p.pid}\n`);
    const ac = new AbortController();
    const stop = () => ac.abort();
    signal?.addEventListener("abort", stop);
    const timer = setTimeout(stop, 3000);
    for (let i = 0; i < st.pipelines.length; i++) {
      this.segments = [];
      const r = await this.exec(":", st.pipelines[i], ac.signal, st.sourceText);
      for (const c of order(r, this.segments)) emit(c.fd, c.text);
      if (ac.signal.aborted) break;
      if (i === st.pipelines.length - 1 && this.procs.find(p.pid)) this.procs.exit(p, r.exitCode, r.exitCode ? `Exit ${r.exitCode}` : "Done");
    }
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    this.procs.lastBg = String(p.pid);
    return 0;
  }

  /** `exit` at the prompt: leaves sudo -i / su, or «closes the window» (a new one opens). */
  private async exitShell(code: number, emit: (fd: 1 | 2, t: string) => void) {
    const f = this.frames.pop();
    if (f) {
      emit(1, f.login ? "logout\n" : "exit\n");
      this.euid = f.euid; this.cwd = f.cwd; this.env = f.env; this.exported = f.exported; this.aliases = f.aliases; this.functions = f.functions;
      return code;
    }
    emit(1, "exit\n\x1b[2m(в настоящем терминале окно бы закрылось; здесь открыто новое)\x1b[0m\n");
    await this.startWindow(emit);
    return code;
  }

  /** sudo -i, sudo -s, su: a shell of another user on top of the current one. */
  pushFrame(user: string, login: boolean) {
    this.frames.push({ euid: this.euid, cwd: this.cwd, env: { ...this.env }, exported: new Set(this.exported), aliases: { ...this.aliases }, functions: { ...this.functions }, login });
    const u = this.users.get(user)!;
    this.euid = user;
    const keep = login ? {} : Object.fromEntries([...this.exported].map((k) => [k, this.env[k]]));
    this.env = { ...keep, HOME: u.home, USER: user, LOGNAME: user, SHELL: "/bin/bash", LANG: "C.UTF-8", TERM: "xterm-256color", PATH: user === "root" ? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" : "/usr/local/bin:/usr/bin:/bin" };
    if (login) this.cwd = u.home;
    this.env.PWD = this.cwd;
    this.exported = new Set(Object.keys(this.env));
    this.aliases = {}; this.functions = {};
    this.frameChanged = true;
  }

  /** A new terminal window: a fresh bash (login variables, no shell variables, aliases or jobs) that reads ~/.bashrc. */
  async startWindow(emit: ((fd: 1 | 2, t: string) => void) | null) {
    for (const j of this.procs.liveJobs()) await this.procs.signal(j.pid, 1, "root", true);
    this.procs.notices();
    this.frames = [];
    this.euid = this.user;
    this.env = { ...(Object.keys(this.loginEnv).length ? this.loginEnv : this.env) };
    this.exported = new Set(this.loginExported.size ? this.loginExported : Object.keys(this.env));
    this.aliases = {}; this.functions = {};
    this.cwd = this.home;
    this.env.PWD = this.home;
    const rc = `${this.home}/.bashrc`;
    if (await this.asRoot(() => this.fs.exists(rc))) {
      this.segments = [];
      const ast = this.bash.transform(`source ${sq(rc)}`).ast as unknown as Ast;
      const r = await this.exec(":", ast.statements[0].pipelines[0], undefined, `source ${rc}`);
      if (emit) for (const c of order(r, this.segments)) emit(c.fd, c.text);
    }
    this.cwd = joinPath("/", this.setup.cwd ?? this.home);
    this.env.PWD = this.cwd;
  }

  /** «Новое окно терминала» from the UI. */
  newWindow(onChunk?: (c: Chunk) => void) {
    return this.locked(() => this.startWindow((fd, text) => onChunk?.({ fd, text })));
  }

  /** Ctrl+C / Ctrl+Z from the terminal: the signal goes to the foreground program, if it is one of ours. */
  async interrupt(kind: "INT" | "TSTP") {
    const p = this.procs.fg;
    this.cancelLine = true;
    if (p) await this.procs.signal(p.pid, kind === "INT" ? 2 : 20, "root", true);
    return !!p;
  }
  /** set by Ctrl+C / Ctrl+Z: the rest of the line does not run */
  private cancelLine = false;

  /** Statements that recreate the shell's state before each pipeline: $?, aliases, functions, shell variables. */
  private prelude(): unknown[] {
    const lines = ["shopt -s expand_aliases"];
    for (const [k, v] of Object.entries(this.aliases)) lines.push(`BASH_ALIAS_${k}=${sq(v)}`);
    for (const [k, v] of Object.entries(this.env)) if (!this.exported.has(k) && isVarName(k)) lines.push(`${k}=${sq(v)}`);
    lines.push(...Object.values(this.functions));
    // last: an assignment or a definition would reset $?
    lines.push(`(exit ${this.lastCode})`);
    const key = lines.join("\n");
    let st = this.preludeCache.get(key);
    if (!st) {
      try { st = (this.bash.transform(key).ast as unknown as Ast).statements; } catch { st = []; }
      if (this.preludeCache.size > 50) this.preludeCache.clear();
      this.preludeCache.set(key, st);
    }
    return st;
  }

  /** One pipeline (or a whole line when `pipeline` is null) with the session's variables, folder, aliases and `$?`. */
  private async exec(script: string, pipeline: unknown, signal?: AbortSignal, sourceText?: string) {
    if (pipeline) {
      await this.rewrite(pipeline);
      this.nextAst = { type: "Script", statements: [...this.prelude(), { type: "Statement", pipelines: [pipeline], operators: [], background: false }] };
    }
    this.frameChanged = false;
    const envIn: Record<string, string> = {};
    for (const k of this.exported) if (this.env[k] !== undefined) envIn[k] = this.env[k];
    let r;
    try {
      r = await this.bash.exec(script, { env: envIn, replaceEnv: true, cwd: this.cwd, signal });
    } catch (e) {
      // a redirection the user may not do: bash says «Permission denied» and skips the command
      this.nextAst = null;
      const code = errCode(e);
      const path = /'([^']+)'/.exec(String((e as Error).message))?.[1] ?? "";
      const shown = redirectionShown(pipeline, path, this.cwd) ?? path;
      const msg = code === "EACCES" ? "Permission denied" : code === "EPERM" ? "Operation not permitted" : String((e as Error).message);
      this.lastCode = 1;
      return { stdout: "", stderr: `bash: ${shown}: ${msg}\n`, exitCode: 1 };
    }
    this.nextAst = null;
    if (!this.frameChanged) {
      const env: Record<string, string> = {};
      const aliases: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.env ?? {})) {
        if (k.startsWith("BASH_ALIAS_")) aliases[k.slice(11)] = v;
        else if (isVarName(k) && !SPECIAL_VARS.has(k)) env[k] = v;
      }
      this.env = env;
      this.aliases = aliases;
      if (pipeline) await this.track(pipeline, sourceText);
      for (const k of [...this.exported]) if (!(k in env)) this.exported.delete(k);
      this.exported.add("PWD"); this.exported.add("OLDPWD");
      if (env.PWD && (await this.asRoot(() => this.fs.exists(env.PWD)))) this.cwd = env.PWD;
    }
    this.frameChanged = false;
    this.lastCode = r.exitCode;
    return r;
  }

  /** export / unset / function definitions / source of the pipeline → the session's state. */
  private async track(pipeline: unknown, sourceText?: string) {
    const cmds = ((pipeline as { commands?: AnyNode[] }).commands ?? []);
    for (const c of cmds) {
      if (c.type === "FunctionDef") { if (sourceText && cmds.length === 1) this.functions[String(c.name)] = sourceText; continue; }
      if (c.type !== "SimpleCommand" || !c.name) continue;
      const name = wordText(c.name);
      const args = ((c.args as unknown[]) ?? []).map((a) => wordText(a));
      if (name === "export" || ((name === "declare" || name === "typeset") && args.includes("-x"))) {
        const remove = args.includes("-n");
        for (const a of args) if (a && !a.startsWith("-")) { const k = a.split("=")[0].replace(/\+$/, ""); if (remove) this.exported.delete(k); else this.exported.add(k); }
      } else if (name === "unset") {
        const fn = args.includes("-f");
        for (const a of args) if (a && !a.startsWith("-")) { if (fn) delete this.functions[a]; else { this.exported.delete(a); delete this.env[a]; if (!args.includes("-v")) delete this.functions[a]; } }
      } else if (name === "source" || name === ".") {
        const file = args[0];
        if (!file) continue;
        const text = await this.asRoot(() => this.fs.readFile(joinPath(this.cwd, file.replace(/^~(?=\/|$)/, this.env.HOME ?? this.home)))).catch(() => "");
        for (const m of text.matchAll(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) this.exported.add(m[1]);
        for (const m of text.matchAll(/^\s*([A-Za-z_][\w-]*)\s*\(\)\s*\{[\s\S]*?^\}/gm)) this.functions[m[1]] = m[0];
      }
    }
  }

  /** Path commands (./x, ~/bin/x) go through __exec (x bit, shebang, CRLF); `cd` into a folder without x is refused. */
  private async rewrite(pipeline: unknown) {
    // $! — the last background job's PID (the interpreter has no jobs of its own)
    walk(pipeline, (n) => {
      if (n.type === "ParameterExpansion" && n.parameter === "!") { for (const k of Object.keys(n)) delete n[k]; n.type = "Literal"; n.value = this.procs.lastBg; }
    });
    for (const c of ((pipeline as { commands?: AnyNode[] }).commands ?? [])) {
      if (c.type !== "SimpleCommand" || !c.name) continue;
      const name = wordText(c.name);
      if (name && name.includes("/") && !name.startsWith("__")) {
        (c.args as unknown[]).unshift(c.name);
        c.name = literalWord("__exec");
      } else if (name === "cd") {
        const args = ((c.args as unknown[]) ?? []).map((a) => wordText(a));
        const target = args[0] === undefined ? this.env.HOME ?? this.home : args[0] === "-" ? this.env.OLDPWD : args[0];
        if (target === null || target === undefined) continue;
        const p = joinPath(this.cwd, target.replace(/^~(?=\/|$)/, this.env.HOME ?? this.home));
        const st = await this.fs.stat(p).catch(() => null);
        if (st?.isDirectory && !(await this.fs.can(p, 1))) {
          c.name = literalWord("__deny");
          c.args = [literalWord(`cd: ${target}: Permission denied`)];
        }
      }
    }
  }

  /** The prompt: who and where (~ for the effective user's home). */
  promptUser() { return this.euid; }
  promptPath() {
    const home = this.users.get(this.euid)?.home ?? this.home;
    return this.cwd === home ? "~" : this.cwd.startsWith(home + "/") ? "~" + this.cwd.slice(home.length) : this.cwd;
  }

  /** Text of the last command line that printed something (for «find and print» tasks). */
  lastOutput() {
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].out.trim()) return this.log[i].out;
    return "";
  }

  async snapshot(): Promise<FsSnap> {
    return this.asRoot(async () => {
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
    });
  }

  private async loadSnap(snap: FsSnap) {
    // the layout from init() may have been changed by the learner: the snapshot is the truth
    for (const p of this.fs.getAllPaths().sort().reverse()) if (p !== "/" && !isSystem(p) && !snap[p]) await this.fs.rm(p, { recursive: true, force: true });
    for (const [p, e] of Object.entries(snap)) {
      if (e.t === "d") await this.fs.mkdir(p, { recursive: true });
      else if (e.t === "f") { await this.fs.mkdir(parentOf(p), { recursive: true }); await this.fs.writeFile(p, e.c); }
      else { await this.fs.mkdir(parentOf(p), { recursive: true }); if (!(await this.fs.exists(p))) await this.fs.symlink(e.to, p); }
    }
    for (const [p, e] of Object.entries(snap)) {
      if (e.t !== "l") await this.fs.chmod(p, e.m);
      if (e.t !== "l") await this.fs.utimes(p, new Date(e.d), new Date(e.d));
    }
  }

  async state(): Promise<ShellState> {
    return this.locked(async () => ({
      fs: await this.snapshot(), cwd: this.cwd, env: { ...this.env }, history: [...this.history], log: [...this.log], owners: {},
      meta: Object.fromEntries(this.fs.meta), exported: [...this.exported], aliases: { ...this.aliases }, functions: { ...this.functions },
      procs: { procs: this.procs.procs.map((p) => ({ ...p, wake: undefined })), jobs: this.procs.jobs, signals: this.procs.signals },
    }));
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
    return this.sys(async () => {
      const build = async (p: string, depth: number): Promise<TreeNode> => {
        const st = await this.fs.stat(p).catch(() => null);
        const name = p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1);
        const m = this.fs.metaOf(p);
        const info = { owner: m.o, group: m.g, mode: (st?.mode ?? 0) & 0o7777 };
        if (!st?.isDirectory) return { name, path: p, dir: false, size: st?.size ?? 0, ...info };
        const names = depth > 8 ? [] : (await this.fs.readdir(p)).filter((n) => !isSystem(joinPath(p, n)));
        const kids = await Promise.all(names.map((n) => build(joinPath(p, n), depth + 1)));
        kids.sort((a, b) => Number(b.dir) - Number(a.dir) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return { name, path: p, dir: true, children: kids, ...info };
      };
      return build(root, 0);
    });
  }
}

export type TreeNode = { name: string; path: string; dir: boolean; size?: number; children?: TreeNode[]; owner?: string; group?: string; mode?: number };

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

/** `sleep` arguments (5, 1.5, 2m, 1h) → milliseconds; null if one is not a time. */
export function sleepMs(args: string[]): number | null {
  if (!args.length) return null;
  let ms = 0;
  for (const a of args) {
    const m = /^(\d+(?:\.\d+)?|\.\d+)([smhd]?)$/.exec(a);
    if (!m) return null;
    ms += Number(m[1]) * { "": 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "" | "s"];
  }
  return ms;
}

type AnyNode = { type: string; [k: string]: unknown };
function walk(node: unknown, f: (n: AnyNode & { name?: unknown }) => void) {
  if (Array.isArray(node)) { for (const x of node) walk(x, f); return; }
  if (!node || typeof node !== "object") return;
  const n = node as AnyNode;
  if (typeof n.type === "string") f(n);
  for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, f);
}
const literalWord = (value: string) => ({ type: "Word", parts: [{ type: "Literal", value }] });

/** `exit [N]` / `logout` as the whole pipeline. */
function exitWord(pl: unknown): { code: number | null } | null {
  const cmds = (pl as { commands?: AnyNode[] }).commands ?? [];
  if (cmds.length !== 1 || cmds[0].type !== "SimpleCommand" || !cmds[0].name) return null;
  const n = wordText(cmds[0].name);
  if (n !== "exit" && n !== "logout") return null;
  const a = ((cmds[0].args as unknown[]) ?? []).map((x) => wordText(x))[0];
  return { code: a && /^\d+$/.test(a) ? Number(a) % 256 : null };
}

/** The redirection target as the learner typed it, for «bash: f: Permission denied». */
function redirectionShown(pipeline: unknown, abs: string, cwd: string): string | null {
  let found: string | null = null;
  walk(pipeline, (n) => {
    if (n.type !== "Redirection" || found) return;
    const t = wordText(n.target);
    if (t && joinPath(cwd, t) === abs) found = t;
  });
  return found;
}

/** Literal text of a word (quotes removed); null if it has expansions. */
export function wordText(w: unknown): string | null {
  const parts = (w as { parts?: { type: string; value?: string; parts?: unknown[] }[] })?.parts ?? [];
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
      if (!name || !["ls", "man", "less", "top"].includes(name)) return;
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
