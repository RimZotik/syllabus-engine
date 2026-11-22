/**
 * Simulated processes (phase 2): a process table with PID, PPID, USER, %CPU, %MEM, STAT, COMMAND; the learner's
 * jobs (`&`, Ctrl+Z, fg, bg); signals with their real effects. A task starts «daemons» with a behaviour:
 *   busy        — holds the CPU (≈100 %), dies on TERM
 *   ignore_term — ignores TERM, INT and HUP; only KILL stops it
 *   logger      — appends a line to `file` every second (whether it is alive shows in the file system)
 *   cleanup     — on TERM/INT/HUP appends "saved" to `file`, then exits; KILL gives it no chance
 *   sleep, idle — just sleeps
 * Time is the real clock: what happened between commands is caught up by tick().
 */
export type Behavior = "busy" | "ignore_term" | "logger" | "cleanup" | "sleep" | "idle";
export type ProcSpec = { name: string; user?: string; cpu?: number; mem?: number; behavior?: Behavior; file?: string; line?: string; pid?: number; cmd?: string; tty?: string };
export type Proc = {
  pid: number; ppid: number; user: string; name: string; cmd: string; tty: string; stat: "R" | "S" | "T";
  cpu: number; mem: number; start: number; behavior: Behavior; file?: string; line?: string; lastTick: number;
  job?: number; endAt?: number; remaining?: number; pending: number[];
  /** a foreground program waiting for its end: a signal wakes it with the exit code (or "stopped") */
  wake?: (r: number | "stopped") => void;
};
export type Job = { id: number; pid: number; cmd: string; state: "Running" | "Stopped" | "Done" | "Terminated" | "Killed" | "Interrupt" | "Hangup" | "Quit" | string; notified: boolean; order: number };
export type SignalRec = { to: string; pid: number; sig: string; by: string; at: number };

export const SIGNALS = ["", "HUP", "INT", "QUIT", "ILL", "TRAP", "ABRT", "BUS", "FPE", "KILL", "USR1", "SEGV", "USR2", "PIPE", "ALRM", "TERM", "STKFLT", "CHLD", "CONT", "STOP", "TSTP", "TTIN", "TTOU", "URG", "XCPU", "XFSZ", "VTALRM", "PROF", "WINCH", "IO", "PWR", "SYS"];
/** "9", "KILL", "SIGKILL", "kill" → 9; null if unknown. */
export function sigNum(spec: string): number | null {
  if (/^\d+$/.test(spec)) { const n = Number(spec); return n >= 0 && n < SIGNALS.length ? n : null; }
  const name = spec.toUpperCase().replace(/^SIG/, "");
  const i = SIGNALS.indexOf(name);
  return i > 0 ? i : null;
}
const DEATH: Record<number, string> = { 1: "Hangup", 2: "Interrupt", 3: "Quit", 9: "Killed", 15: "Terminated" };

type Hooks = { append(path: string, text: string, user: string): Promise<void>; now(): number };

export class Procs {
  procs: Proc[] = [];
  jobs: Job[] = [];
  signals: SignalRec[] = [];
  shellPid = 2210;
  lastBg = "";
  fg: Proc | null = null;
  private nextPid = 4100;
  private jobOrder = 0;
  private hooks: Hooks;
  private bootAt: number;

  constructor(hooks: Hooks) {
    this.hooks = hooks;
    const now = hooks.now();
    this.bootAt = now - 2 * 86400_000 - 3 * 3600_000;
    const base: [number, string, string, string][] = [[1, "root", "init", "/sbin/init"], [2, "root", "kthreadd", "[kthreadd]"], [412, "root", "systemd-journal", "/usr/lib/systemd/systemd-journald"], [688, "root", "cron", "/usr/sbin/cron -f"], [1203, "root", "sshd", "/usr/sbin/sshd -D"]];
    for (const [pid, user, name, cmd] of base) this.add({ pid, ppid: pid === 1 ? 0 : pid === 2 ? 0 : 1, user, name, cmd, tty: "?", stat: "S", cpu: 0, mem: name === "init" ? 0.3 : 0.1, start: this.bootAt, behavior: "idle", lastTick: now, pending: [] });
  }

  /** The learner's login shell and the task's daemons. */
  init(user: string, specs: ProcSpec[] = []) {
    const now = this.hooks.now();
    this.add({ pid: this.shellPid, ppid: 2205, user, name: "bash", cmd: "-bash", tty: "pts/0", stat: "S", cpu: 0, mem: 0.1, start: now - 600_000, behavior: "idle", lastTick: now, pending: [] });
    let pid = 3001;
    for (const s of specs) {
      const b = s.behavior ?? "idle";
      this.add({
        pid: s.pid ?? pid++, ppid: 1, user: s.user ?? user, name: s.name, cmd: s.cmd ?? s.name, tty: s.tty ?? "?", stat: b === "busy" ? "R" : "S",
        cpu: s.cpu ?? (b === "busy" ? 99.7 : b === "logger" ? 0.3 : 0), mem: s.mem ?? 0.2, start: now - 1800_000, behavior: b,
        file: s.file, line: s.line, lastTick: now, pending: [],
      });
    }
  }

  private add(p: Proc) { this.procs.push(p); return p; }
  find(pid: number) { return this.procs.find((p) => p.pid === pid); }
  /** A PID for a short-lived process (ps itself, the grep next to it): every new process gets the next number. */
  newPid() { return this.nextPid++; }
  byName(name: string) { return this.procs.filter((p) => p.name === name || p.cmd.split(/\s+/)[0].replace(/^.*\//, "") === name); }

  /** A new process of the learner (a foreground sleep, a background job). */
  spawn(user: string, name: string, cmd: string, behavior: Behavior, extra: Partial<Proc> = {}): Proc {
    const now = this.hooks.now();
    return this.add({ pid: this.nextPid++, ppid: this.shellPid, user, name, cmd, tty: "pts/0", stat: "S", cpu: 0, mem: 0.0, start: now, behavior, lastTick: now, pending: [], ...extra });
  }

  /** Makes `p` job %n of the shell. */
  addJob(p: Proc, state: "Running" | "Stopped", cmd = p.cmd) {
    const used = new Set(this.jobs.filter((j) => !j.notified || j.state === "Running" || j.state === "Stopped").map((j) => j.id));
    let id = 1;
    while (used.has(id)) id++;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    const job: Job = { id, pid: p.pid, cmd, state, notified: false, order: ++this.jobOrder };
    this.jobs.push(job);
    p.job = id;
    this.lastBg = String(p.pid);
    return job;
  }
  liveJobs() { return this.jobs.filter((j) => j.state === "Running" || j.state === "Stopped").sort((a, b) => a.id - b.id); }
  /** + is the most recent job, - the one before it (bash's «current» and «previous» jobs). */
  mark(job: Job) {
    const live = this.liveJobs().sort((a, b) => b.order - a.order);
    return live[0] === job ? "+" : live[1] === job ? "-" : " ";
  }
  jobLine(job: Job, withPid = false) {
    const status = job.state === "Running" ? "Running" : job.state;
    return `[${job.id}]${this.mark(job)}  ${withPid ? `${job.pid} ` : ""}${status.padEnd(24)}${job.cmd}${job.state === "Running" ? " &" : ""}`;
  }
  jobBySpec(spec?: string): Job | undefined {
    const live = this.liveJobs();
    if (!spec || spec === "%" || spec === "%%" || spec === "%+") return live.sort((a, b) => b.order - a.order)[0];
    if (spec === "%-") return live.sort((a, b) => b.order - a.order)[1];
    const n = Number(spec.replace(/^%/, ""));
    if (Number.isFinite(n)) return live.find((j) => j.id === n);
    const prefix = spec.replace(/^%/, "");
    return live.find((j) => j.cmd.startsWith(prefix));
  }

  /** «[1]+  Done   sleep 3» lines for jobs that ended since the last prompt. */
  notices(): string {
    let out = "";
    for (const j of this.jobs.filter((j) => !j.notified && j.state !== "Running" && j.state !== "Stopped")) {
      out += `[${j.id}]${j === this.jobs[this.jobs.length - 1] ? "+" : "-"}  ${j.state.padEnd(24)}${j.cmd}\n`;
      j.notified = true;
    }
    return out;
  }

  /** Catches up with the clock: loggers write their lines, background sleeps end. */
  async tick() {
    const now = this.hooks.now();
    for (const p of [...this.procs]) {
      if (p.stat === "T") { p.lastTick = now; continue; }
      if (p.behavior === "logger" && p.file) {
        const n = Math.min(60, Math.floor((now - p.lastTick) / 1000));
        if (n > 0) {
          let text = "";
          for (let i = n; i >= 1; i--) {
            const t = new Date(now - (i - 1) * 1000);
            text += (p.line ?? `${p.name}: still running`).replace("{time}", t.toTimeString().slice(0, 8)) + "\n";
          }
          await this.hooks.append(p.file, text, p.user);
          p.lastTick += n * 1000;
        }
      } else p.lastTick = now;
      if (p.endAt !== undefined && p.endAt <= now && !p.wake) this.exit(p, 0, "Done");
    }
  }

  /** The process ends: it leaves the table, its job (if any) gets the final state. */
  exit(p: Proc, code: number, state: string) {
    this.procs = this.procs.filter((x) => x !== p);
    const job = p.job ? this.jobs.find((j) => j.pid === p.pid) : undefined;
    if (job) { job.state = code === 0 || state === "Done" ? "Done" : state; job.notified = false; }
    if (p.wake) { const w = p.wake; p.wake = undefined; w(code); }
    if (this.fg === p) this.fg = null;
  }

  /** Sends signal `sig` to `pid` as `sender`; the result as bash's kill reports it. */
  async signal(pid: number, sig: number, sender: string, senderIsRoot: boolean): Promise<"ok" | "ESRCH" | "EPERM"> {
    const p = this.find(pid);
    if (!p) return "ESRCH";
    if (!senderIsRoot && p.user !== sender) return "EPERM";
    if (sig === 0) return "ok";
    this.signals.push({ to: p.name, pid, sig: SIGNALS[sig], by: sender, at: this.hooks.now() });
    await this.deliver(p, sig);
    return "ok";
  }

  private async deliver(p: Proc, sig: number) {
    // init and the login shell are protected the way the real ones are: TERM and INT do nothing to them
    if (p.pid === 1 || p.pid === 2 || p.pid === this.shellPid) return;
    const name = SIGNALS[sig];
    if (name === "KILL") { this.exit(p, 137, "Killed"); return; }
    if (name === "STOP" || name === "TSTP" || name === "TTIN" || name === "TTOU") {
      if (p.stat === "T") return;
      if (p.endAt !== undefined) p.remaining = Math.max(0, p.endAt - this.hooks.now());
      p.stat = "T";
      const job = this.jobs.find((j) => j.pid === p.pid && (j.state === "Running" || j.state === "Stopped"));
      if (job) job.state = "Stopped";
      if (p.wake) { const w = p.wake; p.wake = undefined; w("stopped"); }
      return;
    }
    if (name === "CONT") {
      if (p.stat !== "T") return;
      p.stat = p.behavior === "busy" ? "R" : "S";
      if (p.remaining !== undefined) { p.endAt = this.hooks.now() + p.remaining; p.remaining = undefined; }
      p.lastTick = this.hooks.now();
      const job = this.jobs.find((j) => j.pid === p.pid && j.state === "Stopped");
      if (job) job.state = "Running";
      const pending = p.pending; p.pending = [];
      for (const s of pending) await this.deliver(p, s);
      return;
    }
    if (name === "CHLD" || name === "WINCH" || name === "URG") return;
    // a stopped process gets other signals only when it continues
    if (p.stat === "T") { p.pending.push(sig); return; }
    if (p.behavior === "ignore_term" && (name === "TERM" || name === "INT" || name === "HUP")) return;
    if (p.behavior === "cleanup" && (name === "TERM" || name === "INT" || name === "HUP") && p.file) await this.hooks.append(p.file, "saved\n", p.user);
    this.exit(p, 128 + sig, DEATH[sig] ?? `Exit ${128 + sig}`);
  }

  /** Clock values for ps and top. */
  uptime() { return this.hooks.now() - this.bootAt; }
  cpuTime(p: Proc) { return Math.floor(((this.hooks.now() - p.start) / 1000) * (p.cpu / 100)); }
}
