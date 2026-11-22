/**
 * Phase 2 commands: users and permissions (whoami, id, groups, chmod, chown, chgrp, stat, umask, sudo, su),
 * processes and jobs (ps, pgrep, pkill, killall, kill, jobs, fg, bg, top, sleep), the environment (env and
 * printenv without the interpreter's own variables) and scripts (__exec runs ./script with the x bit, its
 * shebang and bash's message for a Windows line end; bash/sh emulate «$'\r': command not found»).
 * Wording is GNU coreutils / bash / sudo / procps as on Ubuntu 24.04.
 */
import type { Command } from "just-bash/browser";
import { errCode, isBuiltin, sleepMs, type ScreenApp, type ShellSession } from "./engine.ts";
import { makeDef, probe, q, qc, REASON, why, type IO } from "./commands.ts";
import { applyMode, rwx } from "./users.ts";
import { SIGNALS, sigNum, type Proc } from "./procs.ts";

const sq = (v: string) => (/^[\w@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);
const pad2 = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function makeCommands2(s: ShellSession): Command[] {
  const { def } = makeDef(s);
  const isRoot = () => s.euid === "root";
  const userOf = (name: string) => s.users.get(name);

  // ------------------------------------------------------------------------------------------ who am I
  const idLine = (name: string) => {
    const u = userOf(name)!;
    const g = s.users.gid(u.groups[0]);
    return `uid=${u.uid}(${u.name}) gid=${g}(${u.groups[0]}) groups=${u.groups.map((x) => `${s.users.gid(x)}(${x})`).join(",")}`;
  };

  // ------------------------------------------------------------------------------------------ chmod / chown / chgrp
  async function walkPaths(io: IO, op: string, rec: boolean, f: (p: string, shown: string) => Promise<void>) {
    const p = io.path(op);
    await f(p, op);
    if (!rec) return;
    const st = await s.fs.stat(p).catch(() => null);
    if (!st?.isDirectory) return;
    let names: string[];
    try { names = (await s.fs.readdir(p)).sort(); } catch (e) { io.err(`${io.ctx.cwd && ""}cannot read directory ${q(op)}: ${why(e)}\n`); return; }
    for (const n of names) await walkPaths(io, `${op.replace(/\/$/, "")}/${n}`, true, f);
  }

  async function chmod(io: IO, args: string[]) {
    const flags = new Set<string>();
    const rest: string[] = [];
    for (const a of args) {
      if (/^-[Rvcf]+$/.test(a)) for (const c of a.slice(1)) flags.add(c);
      else if (a === "--recursive") flags.add("R");
      else if (a === "--verbose") flags.add("v");
      else rest.push(a);
    }
    const [mode, ...files] = rest;
    if (!mode) { io.err("chmod: missing operand\nTry 'chmod --help' for more information.\n"); return 1; }
    if (!files.length) { io.err(`chmod: missing operand after ${qc(mode)}\nTry 'chmod --help' for more information.\n`); return 1; }
    if (applyMode(mode, 0o644, false) === null) { io.err(`chmod: invalid mode: ${qc(mode)}\nTry 'chmod --help' for more information.\n`); return 1; }
    let code = 0;
    for (const op of files) {
      await walkPaths(io, op, flags.has("R"), async (p, shown) => {
        const st = await s.fs.stat(p).catch((e: unknown) => ({ err: e }));
        if ("err" in st) { if (!flags.has("f")) io.err(`chmod: cannot access ${q(shown)}: ${why(st.err)}\n`); code = 1; return; }
        const next = applyMode(mode, st.mode & 0o7777, st.isDirectory)!;
        try { await s.fs.chmod(p, next); }
        catch (e) { if (!flags.has("f")) io.err(`chmod: changing permissions of ${q(shown)}: ${why(e)}\n`); code = 1; return; }
        const o8 = (m: number) => (m & 0o7777).toString(8).padStart(4, "0");
        if (flags.has("v") || (flags.has("c") && next !== (st.mode & 0o7777))) {
          io.out(next === (st.mode & 0o7777) ? `mode of ${q(shown)} retained as ${o8(next)} (${rwx(next)})\n` : `mode of ${q(shown)} changed from ${o8(st.mode)} (${rwx(st.mode)}) to ${o8(next)} (${rwx(next)})\n`);
        }
      });
    }
    return code;
  }

  async function chown(name: "chown" | "chgrp", io: IO, args: string[]) {
    const flags = new Set<string>();
    const rest: string[] = [];
    for (const a of args) {
      if (/^-[Rvcfh]+$/.test(a)) for (const c of a.slice(1)) flags.add(c);
      else if (a === "--recursive") flags.add("R");
      else rest.push(a);
    }
    const [spec, ...files] = rest;
    if (!spec) { io.err(`${name}: missing operand\nTry '${name} --help' for more information.\n`); return 1; }
    if (!files.length) { io.err(`${name}: missing operand after ${qc(spec)}\nTry '${name} --help' for more information.\n`); return 1; }
    let owner: string | undefined, group: string | undefined;
    if (name === "chgrp") group = spec;
    else {
      const m = /^([^:.]*)(?:[:.](.*))?$/.exec(spec)!;
      owner = m[1] || undefined;
      group = m[2] === undefined ? undefined : m[2] || (owner ? s.users.primary(owner) : undefined);
    }
    if (owner && !userOf(owner)) { io.err(`chown: invalid user: ${qc(spec)}\n`); return 1; }
    if (group && s.users.gid(group) === undefined) { io.err(name === "chgrp" ? `chgrp: invalid group: ${qc(group)}\n` : `chown: invalid group: ${qc(spec)}\n`); return 1; }
    let code = 0;
    for (const op of files) {
      await walkPaths(io, op, flags.has("R"), async (p, shown) => {
        const st = await s.fs.stat(p).catch((e: unknown) => ({ err: e }));
        if ("err" in st) { io.err(`${name}: cannot access ${q(shown)}: ${why(st.err)}\n`); code = 1; return; }
        const m = s.fs.metaOf(p);
        const nextO = owner ?? m.o, nextG = group ?? m.g;
        // only root gives files away; the owner may change the group to one of their own groups
        const ok = isRoot() || (nextO === m.o && m.o === s.euid && (nextG === m.g || s.users.inGroup(s.euid, nextG)));
        if (!ok) {
          io.err(name === "chgrp" || owner === undefined || owner === m.o ? `${name}: changing group of ${q(shown)}: Operation not permitted\n` : `${name}: changing ownership of ${q(shown)}: Operation not permitted\n`);
          code = 1; return;
        }
        s.fs.meta.set(p, { o: nextO, g: nextG });
        if (flags.has("v") || (flags.has("c") && (nextO !== m.o || nextG !== m.g))) {
          io.out(name === "chgrp" ? `changed group of ${q(shown)} from ${m.g} to ${nextG}\n` : `changed ownership of ${q(shown)} from ${m.o}:${m.g} to ${nextO}:${nextG}\n`);
        }
      });
    }
    return code;
  }

  // ------------------------------------------------------------------------------------------ stat
  const fmtTime = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.000000000 ${tz(d)}`;
  const tz = (d: Date) => { const o = -d.getTimezoneOffset(); return `${o >= 0 ? "+" : "-"}${pad2(Math.floor(Math.abs(o) / 60))}${pad2(Math.abs(o) % 60)}`; };
  const inode = (p: string) => { let h = 131000; for (const c of p) h = (h * 31 + c.charCodeAt(0)) % 900000; return h + 100000; };

  async function stat(io: IO, args: string[]) {
    let fmt: string | null = null;
    const ops: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-c" || args[i] === "--format") fmt = args[++i] ?? "";
      else if (args[i].startsWith("--format=")) fmt = args[i].slice(9);
      else if (args[i] === "-L") continue;
      else ops.push(args[i]);
    }
    if (!ops.length) { io.err("stat: missing operand\nTry 'stat --help' for more information.\n"); return 1; }
    let code = 0;
    for (const op of ops) {
      const p = io.path(op);
      const st = await s.fs.lstat(p).catch((e: unknown) => ({ err: e }));
      if ("err" in st) { io.err(`stat: cannot statx ${q(op)}: ${why(st.err)}\n`); code = 1; continue; }
      const m = s.fs.metaOf(p);
      const kind = st.isSymbolicLink ? "symbolic link" : st.isDirectory ? "directory" : st.size === 0 ? "regular empty file" : "regular file";
      const t = st.isSymbolicLink ? "l" : st.isDirectory ? "d" : "-";
      const size = st.isDirectory ? 4096 : st.size;
      const u = userOf(m.o), gid = s.users.gid(m.g);
      if (fmt !== null) {
        io.out(fmt.replace(/%[aAUGugnsFyxXYi%]/g, (k) => ({
          "%a": (st.mode & 0o7777).toString(8), "%A": t + rwx(st.mode), "%U": m.o, "%G": m.g, "%u": String(u?.uid ?? 0), "%g": String(gid ?? 0), "%n": op, "%s": String(size), "%F": kind,
          "%y": fmtTime(st.mtime), "%x": fmtTime(st.mtime), "%X": String(Math.floor(st.mtime.getTime() / 1000)), "%Y": String(Math.floor(st.mtime.getTime() / 1000)), "%i": String(inode(p)), "%%": "%",
        })[k] ?? k).replace(/\\n/g, "\n") + "\n");
        continue;
      }
      const links = st.isDirectory ? 2 : 1;
      io.out(`  File: ${op}\n  Size: ${String(size).padEnd(10)}\tBlocks: ${String(Math.ceil(size / 4096) * 8).padEnd(10)} IO Block: 4096   ${kind}\nDevice: 8,32\tInode: ${String(inode(p)).padEnd(11)} Links: ${links}\nAccess: (${(st.mode & 0o7777).toString(8).padStart(4, "0")}/${t}${rwx(st.mode)})  Uid: (${String(u?.uid ?? 0).padStart(5)}/${m.o.padStart(8)})   Gid: (${String(gid ?? 0).padStart(5)}/${m.g.padStart(8)})\nAccess: ${fmtTime(st.mtime)}\nModify: ${fmtTime(st.mtime)}\nChange: ${fmtTime(st.mtime)}\n Birth: ${fmtTime(st.mtime)}\n`);
    }
    return code;
  }

  // ------------------------------------------------------------------------------------------ sudo / su
  /** Runs a command line as another user: the effective user changes only for it (redirections stay the caller's). */
  async function runAs(io: IO, user: string, argv: string[]) {
    const u = userOf(user)!;
    const prev = s.euid;
    const base = io.ctx.exportedEnv ?? Object.fromEntries(io.ctx.env);
    const env: Record<string, string> = { ...base, HOME: u.home, USER: user, LOGNAME: user, SUDO_USER: prev, SUDO_UID: String(userOf(prev)?.uid ?? 1000), SUDO_COMMAND: argv.join(" ") };
    if (user === "root") env.PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin";
    s.euid = user;
    const mark = s.segments.length;
    try {
      const r = await io.ctx.exec!(argv.map(sq).join(" "), { cwd: io.ctx.cwd, env, replaceEnv: true, stdin: io.stdinText() });
      let err = r.stderr;
      if (r.exitCode === 127) err = err.replace(/^bash: (\S+): command not found$/m, "sudo: $1: command not found");
      s.segments.length = mark;
      io.out(r.stdout); io.err(err);
      return err !== r.stderr ? 1 : r.exitCode;
    } finally { s.euid = prev; }
  }

  async function authenticate(io: IO, who: string): Promise<boolean> {
    if (s.euid === "root") return true;
    if (Date.now() < s.sudoUntil) return true;
    const pass = who === s.user ? s.sudoPassword : userOf(who)?.password ?? "";
    for (let i = 0; i < 3; i++) {
      const a = await io.askLine(`[sudo] password for ${who}: `, true);
      if (a === null) { io.err("sudo: a password is required\n"); return false; }
      if (a === pass) { s.sudoUntil = Date.now() + 15 * 60_000; return true; }
      if (i < 2) io.err("Sorry, try again.\n");
    }
    io.err("sudo: 3 incorrect password attempts\n");
    return false;
  }

  async function sudo(io: IO, args: string[]) {
    let target = "root", login = false, shell = false, list = false, reset = false, validate = false;
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === "--") { i++; break; }
      if (!a.startsWith("-") || a === "-") break;
      if (a === "-u" || a === "--user") target = args[++i] ?? "";
      else if (a.startsWith("-u") && a.length > 2) target = a.slice(2);
      else if (a === "-i" || a === "--login") login = true;
      else if (a === "-s" || a === "--shell") shell = true;
      else if (a === "-l" || a === "--list") list = true;
      else if (a === "-k" || a === "-K") reset = true;
      else if (a === "-v") validate = true;
      else if (a === "-E" || a === "-H") continue;
      else { io.err(`sudo: invalid option -- '${a.replace(/^-+/, "")}'\nusage: sudo -h | -K | -k | -V\nusage: sudo [-u user] command\n`); return 1; }
    }
    const argv = args.slice(i);
    if (reset) { s.sudoUntil = 0; if (!argv.length) return 0; }
    if (!userOf(target)) { io.err(`sudo: unknown user ${target}\nsudo: error initializing audit plugin sudoers_audit\n`); return 1; }
    if (!argv.length && !login && !shell && !list && !validate) { io.err("usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user]\n            [-u user] [command [arg ...]]\nusage: sudo [-ABbEHkNnPS] [-C num] [-D directory]\n            [-g group] [-h host] [-p prompt] [-R directory] [-T timeout]\n            [-u user] [VAR=value] [-i | -s] [command [arg ...]]\n"); return 1; }
    if (!(await authenticate(io, s.euid))) return 1;
    if (s.euid !== "root" && !s.users.inGroup(s.euid, "sudo")) { io.err(`${s.euid} is not in the sudoers file.\n`); return 1; }
    if (validate) return 0;
    if (list) {
      io.out(`Matching Defaults entries for ${s.euid} on forge:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\\:/snap/bin, use_pty\n\nUser ${s.euid} may run the following commands on forge:\n    (ALL : ALL) ALL\n`);
      return 0;
    }
    if (!argv.length) { s.pushFrame(target, login); return 0; }
    // sudo su, sudo su -: a root shell
    if (argv[0] === "su") { const rest = argv.slice(1); const l = rest.includes("-") || rest.includes("-l") || rest.includes("--login"); const who = rest.find((x) => !x.startsWith("-")) ?? "root"; if (!userOf(who)) { io.err(`su: user ${who} does not exist or the user entry does not contain all the required fields\n`); return 1; } s.pushFrame(who, l); return 0; }
    if (isBuiltin(argv[0]) && !["echo", "printf", "true", "false", "test", "[", "kill", "pwd"].includes(argv[0])) { io.err(`sudo: ${argv[0]}: command not found\n`); return 1; }
    return runAs(io, target, argv);
  }

  async function su(io: IO, args: string[]) {
    const l = args.includes("-") || args.includes("-l") || args.includes("--login");
    const who = args.find((x) => !x.startsWith("-")) ?? "root";
    const u = userOf(who);
    if (!u) { io.err(`su: user ${who} does not exist or the user entry does not contain all the required fields\n`); return 1; }
    if (s.euid !== "root") {
      const a = await io.askLine("Password: ", true);
      // Ubuntu's root has no password: su to root always fails — that is what sudo is for
      if (a === null || u.uid === 0 || a !== u.password) { io.err("su: Authentication failure\n"); return 1; }
    }
    s.pushFrame(who, l);
    return 0;
  }

  // ------------------------------------------------------------------------------------------ processes
  const fmtCpuTime = (sec: number, long: boolean) => long ? `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}` : `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
  const startStr = (p: Proc) => { const d = new Date(p.start); return Date.now() - p.start < 86400_000 ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${MONTHS[d.getMonth()]}${pad2(d.getDate())}`; };
  const statStr = (p: Proc, self = false) => self ? "R+" : p.stat + (p.pid === 1 || p.pid === s.procs.shellPid ? "s" : "") + (p.tty === "pts/0" && s.procs.fg === p ? "+" : "");
  const rss = (p: Proc) => Math.round(p.mem * 39000) + 1200;
  // virtual size is always at least the resident one
  const vsz = (p: Proc) => rss(p) * 4 + ((p.pid * 7919) % 300000);

  /** The table with ps itself and the other commands of its pipeline (`ps aux | grep hog` lists the grep too). */
  function table(withSelf: string): Proc[] {
    const mk = (cmd: string): Proc => ({ pid: s.procs.newPid(), ppid: s.procs.shellPid, user: s.euid, name: cmd.split(" ")[0].replace(/^.*\//, ""), cmd, tty: "pts/0", stat: "R", cpu: 0, mem: 0.1, start: Date.now(), behavior: "idle", lastTick: Date.now(), pending: [] });
    const others = s.pipelineCmds.filter((c) => !/^ps( |$)/.test(c)).map((c) => ({ ...mk(c), stat: "S" as const }));
    const self = mk(withSelf);
    return [...s.procs.procs, self, ...others];
  }
  const sortBy = (xs: Proc[], key: string | undefined) => {
    xs.sort((a, b) => a.pid - b.pid);
    if (!key) return xs;
    const desc = key.startsWith("-");
    const k = key.replace(/^[-+]/, "");
    const val = (p: Proc) => (k === "%cpu" || k === "pcpu" ? p.cpu : k === "%mem" || k === "pmem" ? p.mem : k === "pid" ? p.pid : k === "user" ? p.user : p.cmd);
    xs.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
    return xs;
  };

  async function ps(io: IO, args: string[]) {
    await s.procs.tick();
    const joined = args.join(" ");
    const sortArg = /--sort[= ]([^\s]+)/.exec(joined)?.[1];
    const bsd = args.some((a) => /^-?a?u?x$|^aux$|^-aux$|^axu$/.test(a));
    const full = args.some((a) => /^-e?f$|^-ef$|^-fe$/.test(a));
    const all = bsd || full || args.some((a) => a === "-e" || a === "-A" || a === "ax");
    const uIdx = args.indexOf("-u");
    const onlyUser = uIdx >= 0 ? args[uIdx + 1] : undefined;
    const pIdx = args.indexOf("-p");
    const onlyPid = pIdx >= 0 ? Number(args[pIdx + 1]) : undefined;
    const cmdline = `ps${args.length ? " " + args.join(" ") : ""}`;
    let xs = table(cmdline);
    const self = xs.find((p) => p.cmd === cmdline)!;
    if (onlyPid !== undefined) xs = xs.filter((p) => p.pid === onlyPid);
    else if (onlyUser) xs = xs.filter((p) => p.user === onlyUser);
    else if (!all) xs = xs.filter((p) => p.tty === "pts/0" && p.user === s.euid);
    xs = sortBy(xs, sortArg);
    if (bsd) {
      let out = "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n";
      for (const p of xs) out += `${p.user.padEnd(10).slice(0, 10)} ${String(p.pid).padStart(6)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(vsz(p)).padStart(6)} ${String(rss(p)).padStart(5)} ${p.tty.padEnd(8)} ${statStr(p, p === self).padEnd(4)} ${startStr(p).padStart(5)} ${fmtCpuTime(s.procs.cpuTime(p), false).padStart(6)} ${p.cmd}\n`;
      io.out(out);
    } else if (full) {
      let out = "UID          PID    PPID  C STIME TTY          TIME CMD\n";
      for (const p of xs) out += `${p.user.padEnd(8).slice(0, 8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)} ${String(Math.round(p.cpu)).padStart(2)} ${startStr(p).padStart(5)} ${p.tty.padEnd(8)} ${fmtCpuTime(s.procs.cpuTime(p), true)} ${p.cmd}\n`;
      io.out(out);
    } else {
      let out = "    PID TTY          TIME CMD\n";
      for (const p of xs) out += `${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} ${fmtCpuTime(s.procs.cpuTime(p), true)} ${p.name.slice(0, 15)}\n`;
      io.out(out);
    }
    return onlyPid !== undefined && !xs.length ? 1 : 0;
  }

  /** pgrep / pkill: which processes a pattern selects (-f on the whole command, -x exact, -u user). */
  function select(args: string[]) {
    let full = false, exact = false, user: string | undefined, pattern: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-u") user = args[++i];
      else if (/^-[flaxn]+$/.test(a) && !/^-\d/.test(a)) { if (a.includes("f")) full = true; if (a.includes("x")) exact = true; rest.push(a); }
      else if (!a.startsWith("-")) pattern ??= a;
      else rest.push(a);
    }
    let re: RegExp;
    try { re = new RegExp(exact ? `^(?:${pattern ?? ""})$` : pattern ?? ""); } catch { re = /$^/; }
    const xs = s.procs.procs.filter((p) => p.pid > 2 && (!user || p.user === user) && re.test(full ? p.cmd : p.name)).sort((a, b) => a.pid - b.pid);
    return { xs, pattern, flags: rest.join("") };
  }

  async function sendSignal(io: IO, pid: number, sig: number, label: string) {
    const r = await s.procs.signal(pid, sig, s.euid, isRoot());
    if (r === "ESRCH") io.err(`bash: kill: (${label}) - No such process\n`);
    if (r === "EPERM") io.err(`bash: kill: (${label}) - Operation not permitted\n`);
    return r === "ok";
  }

  async function kill(io: IO, args: string[]) {
    await s.procs.tick();
    if (!args.length) { io.err("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n"); return 2; }
    if (args[0] === "-l" || args[0] === "-L" || args[0] === "--list") {
      if (args[1]) { const n = sigNum(args[1]); if (n === null) { io.err(`bash: kill: ${args[1]}: invalid signal specification\n`); return 1; } io.out(/^\d+$/.test(args[1]) ? `${SIGNALS[n]}\n` : `${n}\n`); return 0; }
      let out = "";
      for (let n = 1; n < SIGNALS.length; n++) out += `${String(n).padStart(2)}) SIG${SIGNALS[n]}${n % 5 === 0 ? "\n" : "\t"}`;
      io.out(out.replace(/\t$/, "\n"));
      return 0;
    }
    let sig = 15, i = 0;
    if (args[0] === "-s" || args[0] === "-n") { const n = sigNum(args[1] ?? ""); if (n === null) { io.err(`bash: kill: ${args[1]}: invalid signal specification\n`); return 1; } sig = n; i = 2; }
    else if (/^-\w+$/.test(args[0])) { const n = sigNum(args[0].slice(1)); if (n === null) { io.err(`bash: kill: ${args[0].slice(1)}: invalid signal specification\n`); return 1; } sig = n; i = 1; }
    let code = 0;
    const targets = args.slice(i);
    if (!targets.length) { io.err("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n"); return 2; }
    for (const t of targets) {
      if (t.startsWith("%")) {
        const job = s.procs.jobBySpec(t);
        if (!job) { io.err(`bash: kill: ${t}: no such job\n`); code = 1; continue; }
        if (!(await sendSignal(io, job.pid, sig, t))) code = 1;
        continue;
      }
      if (!/^-?\d+$/.test(t)) { io.err(`bash: kill: ${t}: arguments must be process or job IDs\n`); code = 1; continue; }
      if (!(await sendSignal(io, Number(t), sig, t))) code = 1;
    }
    return code;
  }

  async function pkill(io: IO, args: string[], killall: boolean) {
    await s.procs.tick();
    let sig = 15;
    const rest: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-s" || a === "--signal") { const n = sigNum(args[++i] ?? ""); if (n === null) { io.err(`${killall ? "killall" : "pkill"}: unknown signal; ${killall ? "killall -l" : "pkill -L"} lists signals.\n`); return 2; } sig = n; }
      else if (/^-[A-Z0-9]+$/i.test(a) && sigNum(a.slice(1)) !== null && !/^-[fxu]$/.test(a)) sig = sigNum(a.slice(1))!;
      else rest.push(a);
    }
    const sel = killall ? { xs: s.procs.procs.filter((p) => p.pid > 2 && p.name === rest.find((x) => !x.startsWith("-"))), pattern: rest.find((x) => !x.startsWith("-")) } : select(rest);
    if (!sel.pattern) { io.err(killall ? "Usage: killall [OPTION]... [--] NAME...\n" : "pkill: no matching criteria specified\nTry `pkill --help' for more information.\n"); return 2; }
    if (!sel.xs.length) { if (killall) io.err(`${sel.pattern}: no process found\n`); return 1; }
    let any = false;
    for (const p of sel.xs) {
      const r = await s.procs.signal(p.pid, sig, s.euid, isRoot());
      if (r === "ok") any = true;
      else if (r === "EPERM") io.err(killall ? `${sel.pattern}(${p.pid}): Operation not permitted\n` : `pkill: killing pid ${p.pid} failed: Operation not permitted\n`);
    }
    return any ? 0 : 1;
  }

  /** Waits for a foreground process: its end, a signal, or Ctrl+Z (stopped → becomes a job). */
  function waitFg(io: IO, p: Proc, cmd: string): Promise<number> {
    s.procs.fg = p;
    return new Promise<number>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => { if (s.procs.find(p.pid)) s.procs.exit(p, 130, "Interrupt"); };
      io.ctx.signal?.addEventListener("abort", onAbort);
      const finish = (r: number | "stopped") => {
        if (timer) clearTimeout(timer);
        io.ctx.signal?.removeEventListener("abort", onAbort);
        if (s.procs.fg === p) s.procs.fg = null;
        if (r === "stopped") {
          const job = p.job ? s.procs.jobs.find((j) => j.pid === p.pid) : s.procs.addJob(p, "Stopped", cmd);
          if (job) { job.state = "Stopped"; job.notified = false; io.out(`\n${s.procs.jobLine(job)}\n`); job.notified = true; }
          resolve(148);
        } else {
          // a job brought back with fg ends without a «Done» notice
          const job = s.procs.jobs.find((j) => j.pid === p.pid);
          if (job) job.notified = true;
          resolve(r);
        }
      };
      p.wake = finish;
      if (p.endAt !== undefined) timer = setTimeout(() => { if (s.procs.find(p.pid)) s.procs.exit(p, 0, "Done"); }, Math.max(0, p.endAt - Date.now()));
    });
  }

  async function sleep(io: IO, args: string[]) {
    if (!args.length) { io.err("sleep: missing operand\nTry 'sleep --help' for more information.\n"); return 1; }
    const bad = args.find((a) => sleepMs([a]) === null);
    if (bad !== undefined) { io.err(`sleep: invalid time interval ${qc(bad)}\nTry 'sleep --help' for more information.\n`); return 1; }
    const ms = sleepMs(args)!;
    const p = s.procs.spawn(s.euid, "sleep", `sleep ${args.join(" ")}`, "sleep", { endAt: Date.now() + ms });
    return waitFg(io, p, p.cmd);
  }

  async function jobs(io: IO, args: string[]) {
    await s.procs.tick();
    const long = args.includes("-l"), pids = args.includes("-p");
    for (const j of s.procs.liveJobs()) io.out(pids ? `${j.pid}\n` : s.procs.jobLine(j, long) + "\n");
    io.out(s.procs.notices());
    return 0;
  }

  async function fg(io: IO, args: string[]) {
    await s.procs.tick();
    const job = s.procs.jobBySpec(args[0]);
    if (!job) { io.err(args[0] ? `bash: fg: ${args[0]}: no such job\n` : "bash: fg: current: no such job\n"); return 1; }
    const p = s.procs.find(job.pid);
    io.out(`${job.cmd}\n`);
    if (!p) { job.notified = true; return 0; }
    if (p.stat === "T") await s.procs.signal(p.pid, 18, "root", true);
    job.state = "Running";
    return waitFg(io, p, job.cmd);
  }

  async function bg(io: IO, args: string[]) {
    await s.procs.tick();
    const job = s.procs.jobBySpec(args[0]);
    if (!job) { io.err(args[0] ? `bash: bg: ${args[0]}: no such job\n` : "bash: bg: current: no such job\n"); return 1; }
    if (job.state === "Running") { io.err(`bash: bg: job ${job.id} already in background\n`); return 0; }
    await s.procs.signal(job.pid, 18, "root", true);
    io.out(`[${job.id}]${s.procs.mark(job)} ${job.cmd} &\n`);
    return 0;
  }

  // ------------------------------------------------------------------------------------------ scripts
  /** ./script, ~/bin/tool: the x bit, the shebang, CRLF; then bash runs it as a child process. */
  async function execPath(io: IO, args: string[]) {
    const [shown, ...rest] = args;
    const p = io.path(shown.replace(/^~(?=\/|$)/, io.ctx.env.get("HOME") ?? s.home));
    const st = await s.fs.stat(p).catch((e: unknown) => ({ err: e }));
    if ("err" in st) { const c = errCode(st.err); io.err(`bash: ${shown}: ${why(st.err)}\n`); return c === "ENOENT" ? 127 : 126; }
    if (st.isDirectory) { io.err(`bash: ${shown}: Is a directory\n`); return 126; }
    if (!(await s.fs.can(p, 1))) { io.err(`bash: ${shown}: Permission denied\n`); return 126; }
    let text: string;
    try { text = await s.fs.readFile(p); } catch { io.err(`bash: ${shown}: Permission denied\n`); return 126; }
    // a command of the system (/usr/bin/ls): run it by its path — it must work even when PATH is broken
    if (/^#!\/bin\/bash\n# Built-in command: /.test(text)) {
      const mark = s.segments.length;
      const r = await io.ctx.exec!([p, ...rest].map(sq).join(" "), { cwd: io.ctx.cwd, stdin: io.ctx.stdinProvided ? io.stdinText() : undefined });
      s.segments.length = mark;
      io.out(r.stdout); io.err(r.stderr);
      return r.exitCode;
    }
    const first = text.split("\n")[0];
    const m = /^#!\s*(\S+)(?:[ \t]+(\S+))?/.exec(first);
    if (m) {
      const interp = m[1], arg = m[2];
      if (first.endsWith("\r")) { io.err(`bash: ${shown}: ${first.slice(2).trim()}^M: bad interpreter: No such file or directory\n`); return 126; }
      const prog = interp.endsWith("/env") ? arg ?? "" : interp.replace(/^.*\//, "");
      if (/^python/.test(prog)) { io.err(`bash: ${shown}: ${prog}: Python is not available in this simulator\n`); return 127; }
      if (!["bash", "sh", "dash"].includes(prog)) { io.err(`bash: ${shown}: ${interp}: bad interpreter: No such file or directory\n`); return 126; }
    }
    const mark = s.segments.length;
    const r = await io.ctx.exec!(["bash", shown, ...rest].map(sq).join(" "), { cwd: io.ctx.cwd, stdin: io.ctx.stdinProvided ? io.stdinText() : undefined });
    s.segments.length = mark;
    io.out(r.stdout); io.err(r.stderr);
    return r.exitCode;
  }

  /** bash FILE: as just-bash runs it, except for Windows line ends, which break the way they break in real bash. */
  async function bashScript(name: "bash" | "sh", io: IO, args: string[]) {
    const fileIdx = args.findIndex((a) => !a.startsWith("-"));
    if (args.includes("-c") || fileIdx < 0) { const r = await io.ctx.origCommand!(args); io.out(r.stdout); io.err(r.stderr); return r.exitCode; }
    const file = args[fileIdx];
    const c = await probe(io, file);
    if (c !== "ok") { io.err(`${name}: ${file}: ${REASON[c]}\n`); return c === "ENOENT" ? 127 : 126; }
    const text = await s.fs.readFile(io.path(file));
    if (!text.includes("\r")) { const r = await io.ctx.origCommand!(args); io.out(r.stdout); io.err(r.stderr); return r.exitCode; }
    const lines = text.split("\n");
    const body = lines.map((l, i) => (/^\s*\r$/.test(l) ? `__cr ${i + 1} ${sq(file)}` : l)).join("\n");
    const r = await io.ctx.origCommand!([...args.slice(0, fileIdx), "-c", body, file, ...args.slice(fileIdx + 1)]);
    // `cd dir\r`: bash names the word with its \r the way bash quotes it: $'dir\r'
    const err = r.stderr.replace(/^bash: (\S+): (.*)\r: (.*)$/gm, (_m, cmd: string, word: string, msg: string) => {
      const n = lines.findIndex((l) => l.includes(`${cmd} ${word}\r`)) + 1;
      return `${file}: line ${n || "?"}: ${cmd}: $'${word}\\r': ${msg}`;
    }).replace(/^bash: (.*)\r: command not found$/gm, (_m, w: string) => `${file}: line ${lines.findIndex((l) => l.startsWith(w + "\r")) + 1}: $'${w}\\r': command not found`);
    io.out(r.stdout); io.err(err);
    return r.exitCode;
  }

  // ------------------------------------------------------------------------------------------ the list
  const exportedOf = (io: IO): Record<string, string> => {
    const all = io.ctx.exportedEnv ?? Object.fromEntries(io.ctx.env);
    return Object.fromEntries(Object.entries(all).filter(([k]) => !/^(OSTYPE|MACHTYPE|HOSTTYPE|BASHOPTS|SHELLOPTS|BASH_ALIAS_\w+|IFS|OPTIND|PPID|\?)$/.test(k)));
  };
  const hideEnv = (out: string) => out.split("\n").filter((l) => !/^(OSTYPE|MACHTYPE|HOSTTYPE|BASH_ALIAS_\w+|BASHOPTS|SHELLOPTS)=/.test(l)).join("\n");

  return [
    def("whoami", async (io) => { io.out(`${s.euid}\n`); return 0; }),
    def("id", async (io, a) => {
      const who = a.find((x) => !x.startsWith("-")) ?? s.euid;
      const u = userOf(who);
      if (!u) { io.err(`id: ${qc(who)}: no such user\n`); return 1; }
      const fl = a.filter((x) => x.startsWith("-")).join("");
      const nm = fl.includes("n");
      if (fl.includes("u")) io.out(`${nm ? u.name : u.uid}\n`);
      else if (fl.includes("G")) io.out(u.groups.map((g) => (nm ? g : s.users.gid(g))).join(" ") + "\n");
      else if (fl.includes("g")) io.out(`${nm ? u.groups[0] : s.users.gid(u.groups[0])}\n`);
      else io.out(idLine(who) + "\n");
      return 0;
    }),
    def("groups", async (io, a) => {
      if (!a.length) { io.out(userOf(s.euid)!.groups.join(" ") + "\n"); return 0; }
      let code = 0;
      for (const w of a) { const u = userOf(w); if (!u) { io.err(`groups: ${qc(w)}: no such user\n`); code = 1; continue; } io.out(`${w} : ${u.groups.join(" ")}\n`); }
      return code;
    }),
    def("chmod", chmod),
    def("chown", (io, a) => chown("chown", io, a)),
    def("chgrp", (io, a) => chown("chgrp", io, a)),
    def("stat", stat),
    def("umask", async (io, a) => { io.out(a.includes("-S") ? "u=rwx,g=rx,o=rx\n" : "0022\n"); return 0; }),
    def("sudo", sudo),
    def("su", su),
    def("ps", ps),
    def("pgrep", async (io, a) => {
      await s.procs.tick();
      const { xs, pattern, flags } = select(a);
      if (!pattern) { io.err("pgrep: no matching criteria specified\nTry `pgrep --help' for more information.\n"); return 2; }
      for (const p of xs) io.out(flags.includes("a") ? `${p.pid} ${p.cmd}\n` : flags.includes("l") ? `${p.pid} ${p.name}\n` : `${p.pid}\n`);
      return xs.length ? 0 : 1;
    }),
    def("pkill", (io, a) => pkill(io, a, false)),
    def("killall", (io, a) => pkill(io, a, true)),
    def("kill", kill),
    def("jobs", jobs),
    def("fg", fg),
    def("bg", bg),
    def("sleep", sleep),
    def("top", async (io, a) => {
      if (!s.ttyNames.has("top") || a.includes("-b")) { io.out(topText(s, s.ui.cols, 30, "P").join("\n") + "\n"); return 0; }
      await s.ui.screen(new Top(s, io));
      return 0;
    }),
    // env and printenv show only exported variables — a shell variable without export is not in the environment
    def("env", async (io, a) => {
      if (a.length) { const r = await io.ctx.origCommand!(a); io.out(hideEnv(r.stdout)); io.err(r.stderr); return r.exitCode; }
      io.out(Object.entries(exportedOf(io)).map(([k, v]) => `${k}=${v}\n`).join(""));
      return 0;
    }),
    def("printenv", async (io, a) => {
      const env = exportedOf(io);
      if (!a.length) { io.out(Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join("")); return 0; }
      let code = 0;
      for (const k of a) { if (k in env) io.out(`${env[k]}\n`); else code = 1; }
      return code;
    }),
    def("__exec", execPath),
    def("bash", (io, a) => bashScript("bash", io, a)),
    def("sh", (io, a) => bashScript("sh", io, a)),
    def("__cr", async (io, a) => { io.err(`${a[1]}: line ${a[0]}: $'\\r': command not found\n`); return 127; }),
    def("__deny", async (io, a) => { io.err(`bash: ${a.join(" ")}\n`); return 1; }),
  ];
}

// ---------------------------------------------------------------------------------------------- top
const TOP_HEAD = "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND";
/** A row of top under its header: numbers end where their heading ends, USER, S and COMMAND start where theirs start. */
function topRow(v: string[]): string {
  const heads = ["PID", "USER", "PR", "NI", "VIRT", "RES", "SHR", "S", "%CPU", "%MEM", "TIME+", "COMMAND"];
  const left = new Set(["USER", "S", "COMMAND"]);
  let out = "", from = 0;
  heads.forEach((h, i) => {
    const at = TOP_HEAD.indexOf(h, from);
    from = at + h.length;
    if (left.has(h)) out = out.padEnd(at) + v[i];
    else out = out.padEnd(Math.max(out.length + 1, at + h.length - v[i].length)) + v[i];
  });
  return out;
}

function topText(s: ShellSession, cols: number, rows: number, sortKey: "P" | "M"): string[] {
  const now = new Date();
  const up = s.procs.uptime();
  const days = Math.floor(up / 86400_000), h = Math.floor(up / 3600_000) % 24, m = Math.floor(up / 60_000) % 60;
  const procs = [...s.procs.procs];
  const cpu = Math.min(100, procs.reduce((t, p) => t + (p.stat === "T" ? 0 : p.cpu), 0));
  const load = (cpu / 100 + 0.02).toFixed(2);
  const running = procs.filter((p) => p.stat === "R").length + 1, stopped = procs.filter((p) => p.stat === "T").length;
  const mem = procs.reduce((t, p) => t + p.mem, 0) * 39.1;
  const lines = [
    `top - ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} up ${days} days, ${String(h).padStart(2)}:${pad2(m)},  1 user,  load average: ${load}, ${load}, ${(Number(load) * 0.9).toFixed(2)}`,
    `Tasks: ${String(procs.length + 1).padStart(3)} total, ${String(running).padStart(3)} running, ${String(procs.length + 1 - running - stopped).padStart(3)} sleeping, ${String(stopped).padStart(3)} stopped,   0 zombie`,
    `%Cpu(s): ${cpu.toFixed(1).padStart(4)} us,  0.3 sy,  0.0 ni, ${(100 - cpu - 0.3 < 0 ? 0 : 100 - cpu - 0.3).toFixed(1).padStart(4)} id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st`,
    `MiB Mem :   3911.2 total, ${(2600 - mem).toFixed(1).padStart(8)} free, ${(900 + mem).toFixed(1).padStart(8)} used,    410.9 buff/cache`,
    "MiB Swap:   1024.0 total,   1024.0 free,      0.0 used.   2998.9 avail Mem",
    "",
    "\x1b[7m" + TOP_HEAD.padEnd(cols).slice(0, cols) + "\x1b[0m",
  ];
  procs.sort((a, b) => (sortKey === "M" ? b.mem - a.mem : b.cpu - a.cpu) || a.pid - b.pid);
  for (const p of procs.slice(0, Math.max(0, rows - lines.length))) {
    const t = s.procs.cpuTime(p);
    const shown = p.stat === "T" ? 0 : p.cpu;
    const res = Math.round(p.mem * 39000) + 1200;
    lines.push(topRow([String(p.pid), p.user.slice(0, 8), "20", "0", String(res * 4 + ((p.pid * 7919) % 300000)), String(res), String(900 + (p.pid % 500)), p.stat, shown.toFixed(1), p.mem.toFixed(1), `${Math.floor(t / 60)}:${pad2(t % 60)}.00`, p.name]).slice(0, cols));
  }
  // like the real top: a line wider than the terminal is cut, not wrapped
  return lines.map((l) => (l.startsWith("\x1b") ? l : l.slice(0, cols)));
}

/** top: refreshes every second; q quits, P / M sort by CPU / memory, k kills (asks PID, then the signal). */
class Top implements ScreenApp {
  done = false;
  // procps-ng top: a new screen every 3 seconds
  interval = 3000;
  private sortKey: "P" | "M" = "P";
  private prompt: { stage: "pid" | "sig"; input: string; pid?: number } | null = null;
  private msg = "";
  private s: ShellSession;
  private io: IO;
  constructor(s: ShellSession, io: IO) { this.s = s; this.io = io; }
  async tick() { await this.s.procs.tick(); }
  render(cols: number, rows: number) {
    const lines = topText(this.s, cols, rows, this.sortKey);
    let cursor: [number, number] | null = null;
    if (this.prompt) {
      const top = [...this.s.procs.procs].sort((a, b) => b.cpu - a.cpu)[0];
      const text = this.prompt.stage === "pid" ? `PID to signal/kill [default pid = ${top?.pid ?? ""}] ${this.prompt.input}` : `Send pid ${this.prompt.pid} signal [15/sigterm] ${this.prompt.input}`;
      lines[5] = text;
      cursor = [5, text.length];
    } else if (this.msg) lines[5] = this.msg;
    return { lines, cursor };
  }
  async key(k: string) {
    if (this.prompt) {
      const pr = this.prompt;
      if (k === "Escape" || k === "C-c") { this.prompt = null; return; }
      if (k === "Backspace") { pr.input = pr.input.slice(0, -1); return; }
      if (k === "Enter") {
        if (pr.stage === "pid") {
          const def = [...this.s.procs.procs].sort((a, b) => b.cpu - a.cpu)[0]?.pid;
          const pid = pr.input ? Number(pr.input) : def;
          if (!pid || !Number.isFinite(pid)) { this.prompt = null; this.msg = " Unacceptable integer"; return; }
          this.prompt = { stage: "sig", input: "", pid };
          return;
        }
        const sig = pr.input ? sigNum(pr.input) : 15;
        this.prompt = null;
        if (sig === null) { this.msg = " Unacceptable signal value"; return; }
        const r = await this.s.procs.signal(pr.pid!, sig, this.s.euid, this.s.euid === "root");
        this.msg = r === "ok" ? "" : ` Failed signal pid '${pr.pid}' with '${sig}': ${r === "EPERM" ? "Operation not permitted" : "No such process"}`;
        return;
      }
      if (/^[\w-]$/.test(k)) pr.input += k;
      return;
    }
    this.msg = "";
    if (k === "q" || k === "C-c") this.done = true;
    else if (k === "P" || k === "M") this.sortKey = k;
    else if (k === "k") this.prompt = { stage: "pid", input: "" };
    void this.io;
  }
}
