/**
 * Our own commands of the simulator, where the course needs GNU coreutils behaviour and wording exactly
 * (Ubuntu, English messages): ls, cat, head, tail, wc, cp, mv, rm, mkdir, rmdir, touch, tee, uniq; wrappers that
 * fix just-bash's messages for sort, cut, grep, find, file, tree; and the terminal programs history, man, less,
 * nano, vim, clear, help. `--help` of every phase-1 command prints our short Russian page (manpages.ts).
 */
import type { Command, ResolvedCommandContext } from "just-bash/browser";
import type { ShellSession } from "./engine.ts";
import { joinPath } from "./engine.ts";
import { helpText, manPage, MAN_NAMES } from "./manpages.ts";
import { Nano, Pager, Vim } from "./screens.ts";

type Ctx = ResolvedCommandContext;
type IO = {
  out(s: string): void;
  err(s: string): void;
  ctx: Ctx;
  path(p: string): string;
  stdinText(): string;
  ask(prompt: string): Promise<boolean>;
};
type Impl = (io: IO, args: string[]) => Promise<number>;

/** 'name' — coreutils' quoting of file names in messages (shell-escape style). */
export const q = (s: string) => (s.includes("'") ? `"${s}"` : `'${s}'`);
/** ‘name’ — the locale quoting some messages use (mkdir, find, invalid numbers). */
export const qc = (s: string) => `‘${s}’`;

const decoder = new TextDecoder();
const bytesToText = (b: unknown): string => {
  if (typeof b !== "string") return "";
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i) & 0xff;
  return decoder.decode(u);
};
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

let invocation = 0;

export function makeCommands(s: ShellSession): Command[] {
  const def = (name: string, impl: Impl, exitOnHelp = 0): Command =>
    s.lib.defineCommand(name, async (args, ctx) => {
      const id = ++invocation;
      let stdout = "", stderr = "";
      let answers: string[] | null = null;
      const io: IO = {
        ctx,
        out: (t) => { if (!t) return; stdout += t; s.segments.push({ id, fd: 1, text: t }); },
        err: (t) => { if (!t) return; stderr += t; s.segments.push({ id, fd: 2, text: t }); },
        path: (p) => joinPath(ctx.cwd, p),
        stdinText: () => bytesToText(ctx.stdin),
        async ask(prompt) {
          // answers come from a pipe if there is one (`yes | rm -i …`), else the terminal asks the learner
          if (ctx.stdinProvided) {
            answers ??= bytesToText(ctx.stdin).split("\n");
            io.err(prompt);
            return /^[yY]/.test(answers.shift() ?? "");
          }
          const a = await s.ui.ask(prompt);
          return /^[yY]/.test(a ?? "");
        },
      };
      if (args.includes("--help") && helpText(name)) { io.out(helpText(name)!); return { stdout, stderr, exitCode: exitOnHelp }; }
      let code: number;
      try { code = await impl(io, args); }
      catch (e) { io.err(`${name}: ${String((e as Error)?.message ?? e)}\n`); code = 1; }
      return { stdout, stderr, exitCode: code };
    });

  /** A bundled just-bash command with our help page and corrected messages. */
  const wrap = (name: string, fix: (io: IO, args: string[], r: { stdout: string; stderr: string; exitCode: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>, pre?: (io: IO, args: string[]) => Promise<string[]>): Command =>
    def(name, async (io, args) => {
      const a = pre ? await pre(io, args) : args;
      const r = await io.ctx.origCommand!(a);
      const f = await fix(io, args, { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode });
      io.out(f.stdout); io.err(f.stderr);
      return f.exitCode;
    });

  const isDir = async (p: string) => (await s.fs.exists(p)) && (await s.fs.stat(p)).isDirectory;

  return [
    def("ls", (io, a) => ls(s, io, a)),
    def("cat", cat),
    def("head", (io, a) => headTail("head", io, a)),
    def("tail", (io, a) => headTail("tail", io, a)),
    def("wc", wc),
    def("cp", (io, a) => cpMv(s, "cp", io, a)),
    def("mv", (io, a) => cpMv(s, "mv", io, a)),
    def("rm", (io, a) => rm(s, io, a)),
    def("mkdir", (io, a) => mkdir(s, io, a)),
    def("rmdir", (io, a) => rmdir(s, io, a)),
    def("touch", (io, a) => touch(s, io, a)),
    def("tee", tee),
    def("uniq", uniq),
    wrap("sort", async (_io, _a, r) => ({ ...r, stderr: await rewriteLines(r.stderr, /^sort: (.+): No such file or directory$/, async (m) => (await isDir(joinPath(_io.ctx.cwd, m[1])) ? `sort: read failed: ${m[1]}: Is a directory` : `sort: cannot read: ${m[1]}: No such file or directory`)) })),
    wrap("cut", async (_io, _a, r) => ({ ...r, stderr: await rewriteLines(r.stderr, /^cut: (.+): No such file or directory$/, async (m) => (await isDir(joinPath(_io.ctx.cwd, m[1])) ? `cut: ${m[1]}: Is a directory` : m[0])) })),
    wrap("find", async (_io, _a, r) => ({ ...r, stderr: await rewriteLines(r.stderr, /^find: (.+): No such file or directory$/, async (m) => `find: ${qc(m[1].replace(/^[‘']|[’']$/g, ""))}: No such file or directory`) })),
    wrap("file", async (_io, _a, r) => ({ ...r, stdout: r.stdout.replace(/^(.+): cannot open \(No such file or directory\)$/gm, "$1: cannot open `$1' (No such file or directory)") })),
    wrap("tree", async (_io, _a, r) => ({ ...r, stdout: r.stdout.replace(/^((?:\|   |    )*)(\|--|`--) /gm, (_m, pre: string, b: string) => pre.replace(/\|   /g, "│   ") + (b === "|--" ? "├── " : "└── ")) })),
    wrap("grep", async (_io, a, r) => {
      // GNU prints «./dir/file:line» for an explicit «.» operand
      const ops = grepOperands(a);
      if (/^-\w*r|^-\w*R|^--recursive/.test(a.filter((x) => x.startsWith("-")).join(" ")) || a.some((x) => /^-[a-zA-Z]*[rR]/.test(x))) {
        if (ops.length === 1 && ops[0] === "." && !a.some((x) => /^-[a-zA-Z]*[hc]/.test(x) && x.includes("h"))) return { ...r, stdout: r.stdout.replace(/^(?=.)/gm, "./") };
      }
      return r;
    }, async (_io, a) => {
      // `grep -r pattern` without a folder searches the current one
      const rec = a.some((x) => /^-[a-zA-Z]*[rR]/.test(x) || x === "--recursive");
      return rec && grepOperands(a).length === 0 ? [...a, "."] : a;
    }),
    def("history", async (io, a) => {
      if (a[0] === "-c") { s.history.length = 0; return 0; }
      const n = a[0] && /^\d+$/.test(a[0]) ? Number(a[0]) : s.history.length;
      const start = Math.max(0, s.history.length - n);
      io.out(s.history.slice(start).map((l, i) => `${String(start + i + 1).padStart(5)}  ${l}\n`).join(""));
      return 0;
    }),
    def("clear", async (io) => { io.out("\x1b[H\x1b[2J\x1b[3J"); return 0; }),
    def("help", async (io) => {
      io.out(`Команды тренажёра (подробно — man КОМАНДА или КОМАНДА --help):\n${wrapList(MAN_NAMES, 76)}\n`);
      return 0;
    }),
    def("man", async (io, a) => {
      const name = a.filter((x) => !x.startsWith("-")).pop();
      if (!name) { io.err("What manual page do you want?\nFor example, try 'man man'.\n"); return 1; }
      const page = manPage(name, s.ttyNames.has("man") ? s.ui.cols : 80);
      if (!page) { io.err(`No manual entry for ${name}\n`); return 16; }
      if (!s.ttyNames.has("man")) { io.out(page); return 0; }
      await s.ui.screen(new Pager(page.replace(/\n$/, "").split("\n"), `Manual page ${name}(1)`, true));
      return 0;
    }),
    def("less", async (io, a) => {
      const files = a.filter((x) => !x.startsWith("-"));
      let text: string, title: string;
      if (!files.length) { text = io.stdinText(); title = ""; }
      else {
        const p = io.path(files[0]);
        if (!(await s.fs.exists(p))) { io.err(`${files[0]}: No such file or directory\n`); return 1; }
        if (await isDir(p)) { io.err(`${files[0]} is a directory\n`); return 1; }
        text = await s.fs.readFile(p); title = files[0];
      }
      if (!s.ttyNames.has("less")) { io.out(text); return 0; }
      await s.ui.screen(new Pager(text.replace(/\n$/, "").split("\n"), title, false));
      return 0;
    }),
    def("nano", async (io, a) => {
      const name = a.filter((x) => !x.startsWith("-") && !x.startsWith("+"))[0] ?? "";
      const p = name ? io.path(name) : "";
      let text = "", notice: string;
      if (p && (await isDir(p))) notice = `"${name}" is a directory`;
      else if (p && (await s.fs.exists(p))) { text = await s.fs.readFile(p); const n = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0; notice = `Read ${n} line${n === 1 ? "" : "s"}`; }
      else notice = "New File";
      const nano = new Nano(text, name, notice, async (file, body) => {
        const target = io.path(file);
        try { await s.fs.writeFile(target, body); return null; }
        catch (e) {
          const code = (e as { code?: string }).code;
          return code === "EISDIR" ? "Is a directory" : code === "ENOTDIR" ? "Not a directory" : "No such file or directory";
        }
      });
      await s.ui.screen(nano);
      return 0;
    }),
    // compression needs Node's zlib, which the browser does not have
    ...["gzip", "gunzip", "zcat"].map((n) => def(n, async (io) => { io.err(`${n}: not available in this simulator\n`); return 1; })),
    ...["vim", "vi"].map((n) => def(n, async (io, a) => {
      const name = a.filter((x) => !x.startsWith("-"))[0] ?? "";
      const p = name ? io.path(name) : "";
      const text = p && (await s.fs.exists(p)) && !(await isDir(p)) ? await s.fs.readFile(p) : "";
      await s.ui.screen(new Vim(text, name, p ? await s.fs.exists(p) : false, async (body) => {
        try { await s.fs.writeFile(p, body); return null; } catch { return "E212: Can't open file for writing"; }
      }));
      return 0;
    })),
  ];
}

async function rewriteLines(text: string, re: RegExp, f: (m: RegExpMatchArray) => Promise<string>) {
  if (!text) return text;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) { const m = lines[i].match(re); if (m) lines[i] = await f(m); }
  return lines.join("\n");
}

const GREP_WITH_ARG = new Set(["-e", "-f", "-m", "-A", "-B", "-C", "--include", "--exclude", "--exclude-dir"]);
function grepOperands(a: string[]) {
  const ops: string[] = [];
  let pattern = a.some((x) => x === "-e" || x.startsWith("--regexp")) ;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--") { ops.push(...a.slice(i + 1)); break; }
    if (x.startsWith("-") && x.length > 1) { if (GREP_WITH_ARG.has(x)) i++; continue; }
    if (!pattern) { pattern = true; continue; }
    ops.push(x);
  }
  return ops;
}

function wrapList(names: string[], width: number) {
  const out: string[] = [];
  let line = "";
  for (const n of names) {
    if (line && line.length + n.length + 2 > width) { out.push(line); line = ""; }
    line += (line ? "  " : "  ") + n;
  }
  if (line) out.push(line);
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------- options

type Parsed = { flags: Set<string>; vals: Map<string, string>; ops: string[]; bad: string | null };
/** Short flags (combined: `-la`), flags with a value (`-n 5`, `-n5`), long names mapped to short ones. */
function parse(a: string[], flags: string, withVal = "", long: Record<string, string> = {}): Parsed {
  const r: Parsed = { flags: new Set(), vals: new Map(), ops: [], bad: null };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--") { r.ops.push(...a.slice(i + 1)); break; }
    if (x.startsWith("--")) {
      const [k, v] = x.split("=", 2);
      const m = long[k];
      if (!m) { r.bad ??= `unrecognized option '${x}'`; continue; }
      if (withVal.includes(m)) r.vals.set(m, v ?? a[++i] ?? ""); else r.flags.add(m);
      continue;
    }
    if (x.startsWith("-") && x.length > 1) {
      for (let j = 1; j < x.length; j++) {
        const c = x[j];
        if (withVal.includes(c)) { r.vals.set(c, x.slice(j + 1) || a[++i] || ""); break; }
        if (!flags.includes(c)) { r.bad ??= `invalid option -- '${c}'`; continue; }
        r.flags.add(c);
      }
      continue;
    }
    r.ops.push(x);
  }
  return r;
}
const usage = (io: IO, name: string, bad: string) => io.err(`${name}: ${bad}\nTry '${name} --help' for more information.\n`);

// ---------------------------------------------------------------------------------------------- ls

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function lsDate(d: Date) {
  const now = Date.now();
  const recent = now - d.getTime() < 182.5 * 86400_000 && d.getTime() - now < 3600_000;
  const tail = recent ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : ` ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${tail}`;
}
/** ls -h: 1023, 4.0K, 12K, 1.5M — rounded up, as GNU does. */
export function human(n: number) {
  if (n < 1024) return String(n);
  const units = "KMGTP";
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  if (v < 10) { const r = Math.ceil(v * 10) / 10; return r >= 10 ? `10${units[u]}` : `${r.toFixed(1)}${units[u]}`; }
  return `${Math.ceil(v)}${units[u]}`;
}
function permString(mode: number, kind: "d" | "-" | "l") {
  const b = (m: number, c: string) => (mode & m ? c : "-");
  return kind + b(0o400, "r") + b(0o200, "w") + b(0o100, "x") + b(0o40, "r") + b(0o20, "w") + b(0o10, "x") + b(0o4, "r") + b(0o2, "w") + b(0o1, "x");
}
/** How ls shows a name on a terminal: quoted if it has spaces or special characters. */
function ttyName(n: string) {
  if (/^[\w.,+@%:=^~/-]+$/u.test(n)) return n;
  return n.includes("'") ? `"${n}"` : `'${n}'`;
}

type Ent = { name: string; path: string; kind: "d" | "-" | "l"; mode: number; size: number; mtime: Date; target?: string; links: number };

async function ls(s: ShellSession, io: IO, args: string[]): Promise<number> {
  const o = parse(args, "alhR1tSrdAF", "", { "--all": "a", "--recursive": "R", "--human-readable": "h", "--reverse": "r", "--directory": "d", "--almost-all": "A", "--color": "", "--classify": "F" });
  if (o.bad) { usage(io, "ls", o.bad); return 2; }
  const f = o.flags;
  const tty = s.tty && !f.has("1");
  let code = 0;

  const ent = async (path: string, name: string): Promise<Ent | null> => {
    const st = await s.fs.lstat(path).catch(() => null);
    if (!st) return null;
    const kind = st.isSymbolicLink ? "l" : st.isDirectory ? "d" : "-";
    let links = 1;
    if (kind === "d") links = 2 + (await Promise.all((await s.fs.readdir(path)).map((n) => s.fs.stat(joinPath(path, n)).then((x) => x.isDirectory).catch(() => false)))).filter(Boolean).length;
    return { name, path, kind, mode: st.mode, size: kind === "d" ? 4096 : kind === "l" ? (await s.fs.readlink(path)).length : st.size, mtime: st.mtime, target: kind === "l" ? await s.fs.readlink(path) : undefined, links };
  };
  const sortEnts = (xs: Ent[]) => {
    xs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (f.has("t")) xs.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    if (f.has("S")) xs.sort((a, b) => b.size - a.size);
    if (f.has("r")) xs.reverse();
    return xs;
  };
  const color = (e: Ent, shown: string) => {
    if (!tty) return shown;
    const c = e.kind === "d" ? "01;34" : e.kind === "l" ? "01;36" : e.mode & 0o111 ? "01;32" : "";
    return c ? `\x1b[${c}m${shown}\x1b[0m` : shown;
  };
  const suffix = (e: Ent) => (!f.has("F") ? "" : e.kind === "d" ? "/" : e.kind === "l" ? "@" : e.mode & 0o111 ? "*" : "");
  const label = (e: Ent) => color(e, tty ? ttyName(e.name) : e.name) + suffix(e);

  const render = (xs: Ent[], withTotal: boolean): string => {
    if (f.has("l")) {
      const sizes = xs.map((e) => (f.has("h") ? human(e.size) : String(e.size)));
      const w = { links: Math.max(1, ...xs.map((e) => String(e.links).length)), own: Math.max(1, ...xs.map((e) => s.ownerOf(e.path).length)), size: Math.max(1, ...sizes.map((x) => x.length)) };
      let out = "";
      if (withTotal) {
        const blocks = xs.reduce((t, e) => t + (e.kind === "d" ? 4 : e.kind === "l" ? 0 : Math.ceil(e.size / 4096) * 4), 0);
        out += `total ${f.has("h") ? (blocks ? human(blocks * 1024) : "0") : blocks}\n`;
      }
      xs.forEach((e, i) => {
        const owner = s.ownerOf(e.path);
        out += `${permString(e.mode, e.kind)} ${String(e.links).padStart(w.links)} ${owner.padEnd(w.own)} ${owner.padEnd(w.own)} ${sizes[i].padStart(w.size)} ${lsDate(e.mtime)} ${label(e)}${e.target ? ` -> ${e.target}` : ""}\n`;
      });
      return out;
    }
    if (!tty) return xs.map((e) => label(e) + "\n").join("");
    return columns(xs.map((e) => ({ text: label(e), width: [...(ttyName(e.name) + suffix(e))].length })), s.ui.cols);
  };

  const listDir = async (path: string): Promise<Ent[]> => {
    const names = await s.fs.readdir(path);
    const shown = names.filter((n) => f.has("a") || f.has("A") || !n.startsWith("."));
    const xs = (await Promise.all(shown.map((n) => ent(joinPath(path, n), n)))).filter((x): x is Ent => !!x);
    if (f.has("a")) { const d = await ent(path, "."); const p = await ent(joinPath(path, ".."), ".."); if (d) xs.push(d); if (p) xs.push(p); }
    return sortEnts(xs);
  };

  const ops = o.ops.length ? o.ops : ["."];
  const files: Ent[] = [], dirs: { op: string; e: Ent }[] = [];
  const missing: string[] = [];
  for (const op of ops) {
    const e = await ent(io.path(op), op);
    if (!e) { missing.push(op); continue; }
    if (e.kind === "l" && !f.has("l") && !f.has("d")) {
      const real = await s.fs.stat(io.path(op)).catch(() => null);
      if (real?.isDirectory) { dirs.push({ op, e: { ...e, kind: "d" } }); continue; }
    }
    if (e.kind === "d" && !f.has("d")) dirs.push({ op, e }); else files.push(e);
  }
  for (const m of missing.sort()) { io.err(`ls: cannot access ${q(m)}: No such file or directory\n`); code = 2; }
  const parts: string[] = [];
  if (files.length) parts.push(render(sortEnts(files), false));
  const header = ops.length > 1 || f.has("R");
  const sortedDirs = dirs.sort((a, b) => (a.op < b.op ? -1 : 1));
  if (f.has("r")) sortedDirs.reverse();
  const walkDir = async (op: string, path: string) => {
    const xs = await listDir(path);
    parts.push((header ? `${op}:\n` : "") + render(xs, true));
    if (f.has("R")) for (const e of xs) if (e.kind === "d" && e.name !== "." && e.name !== "..") await walkDir(`${op === "/" ? "" : op.replace(/\/$/, "")}/${e.name}`, e.path);
  };
  for (const d of sortedDirs) await walkDir(d.op, io.path(d.op));
  io.out(parts.join("\n"));
  return code;
}

/** GNU ls columns: filled top to bottom, as many columns as fit, two spaces between them. */
export function columns(items: { text: string; width: number }[], cols: number): string {
  if (!items.length) return "";
  for (let nc = Math.min(items.length, Math.max(1, Math.floor(cols / 3))); nc >= 1; nc--) {
    const rows = Math.ceil(items.length / nc);
    const realCols = Math.ceil(items.length / rows);
    const widths: number[] = [];
    for (let c = 0; c < realCols; c++) widths.push(Math.max(...items.slice(c * rows, c * rows + rows).map((x) => x.width)));
    const total = widths.reduce((t, w) => t + w, 0) + 2 * (realCols - 1);
    if (total > cols && nc > 1) continue;
    let out = "";
    for (let r = 0; r < rows; r++) {
      const line: string[] = [];
      for (let c = 0; c < realCols; c++) {
        const it = items[c * rows + r];
        if (!it) continue;
        const last = c === realCols - 1 || !items[(c + 1) * rows + r];
        line.push(last ? it.text : it.text + " ".repeat(widths[c] - it.width + 2));
      }
      out += line.join("") + "\n";
    }
    return out;
  }
  return "";
}

// ---------------------------------------------------------------------------------------------- read helpers

/** Reads an operand: «-» or nothing — stdin; errors come back as GNU's reason text. */
async function readOp(io: IO, op: string): Promise<{ text: string } | { error: "ENOENT" | "EISDIR" }> {
  if (op === "-") return { text: io.stdinText() };
  const p = io.path(op);
  const fs = io.ctx.fs;
  if (!(await fs.exists(p))) return { error: "ENOENT" };
  if ((await fs.stat(p)).isDirectory) return { error: "EISDIR" };
  return { text: await fs.readFile(p) };
}
const REASON = { ENOENT: "No such file or directory", EISDIR: "Is a directory" } as const;
const splitLines = (t: string) => { const xs = t.split("\n"); if (t.endsWith("\n")) xs.pop(); return t ? xs : []; };

async function cat(io: IO, args: string[]) {
  const o = parse(args, "nbAEsT", "", { "--number": "n", "--number-nonblank": "b" });
  if (o.bad) { usage(io, "cat", o.bad); return 1; }
  let code = 0, n = 0;
  for (const op of o.ops.length ? o.ops : ["-"]) {
    const r = await readOp(io, op);
    if ("error" in r) { io.err(`cat: ${op}: ${REASON[r.error]}\n`); code = 1; continue; }
    let t = r.text;
    if (o.flags.has("n") || o.flags.has("b")) {
      t = t.split(/(?<=\n)/).map((l) => (o.flags.has("b") && l === "\n" ? l : `${String(++n).padStart(6)}\t${l}`)).join("");
    }
    io.out(t);
  }
  return code;
}

async function headTail(name: "head" | "tail", io: IO, args: string[]) {
  // `head -5` is `head -n 5`
  const norm = args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a));
  const o = parse(norm, "qvf", "nc", { "--lines": "n", "--bytes": "c", "--quiet": "q", "--verbose": "v", "--follow": "f" });
  if (o.bad) { usage(io, name, o.bad); return 1; }
  const raw = o.vals.get("n") ?? o.vals.get("c") ?? "10";
  const bytes = o.vals.has("c");
  if (!/^[+-]?\d+$/.test(raw)) { io.err(`${name}: invalid number of ${bytes ? "bytes" : "lines"}: ${qc(raw)}\n`); return 1; }
  const n = Math.abs(Number(raw));
  const fromStart = name === "tail" && raw.startsWith("+");
  const allBut = name === "head" && raw.startsWith("-");
  const ops = o.ops.length ? o.ops : ["-"];
  const headers = (ops.length > 1 && !o.flags.has("q")) || o.flags.has("v");
  let code = 0, first = true;
  for (const op of ops) {
    const r = await readOp(io, op);
    if ("error" in r) {
      io.err(r.error === "ENOENT" ? `${name}: cannot open ${q(op)} for reading: No such file or directory\n` : `${name}: error reading ${q(op)}: Is a directory\n`);
      code = 1; continue;
    }
    if (headers) io.out(`${first ? "" : "\n"}==> ${op === "-" ? "standard input" : op} <==\n`);
    first = false;
    if (bytes) {
      const b = new TextEncoder().encode(r.text);
      const part = name === "head" ? (allBut ? b.slice(0, Math.max(0, b.length - n)) : b.slice(0, n)) : fromStart ? b.slice(Math.max(0, n - 1)) : b.slice(Math.max(0, b.length - n));
      io.out(new TextDecoder().decode(part));
      continue;
    }
    const lines = r.text.split(/(?<=\n)/).filter((l) => l !== "");
    const part = name === "head" ? (allBut ? lines.slice(0, Math.max(0, lines.length - n)) : lines.slice(0, n)) : fromStart ? lines.slice(Math.max(0, n - 1)) : n === 0 ? [] : lines.slice(-n);
    io.out(part.join(""));
  }
  return code;
}

async function wc(io: IO, args: string[]) {
  const o = parse(args, "lwcm", "", { "--lines": "l", "--words": "w", "--bytes": "c", "--chars": "m" });
  if (o.bad) { usage(io, "wc", o.bad); return 1; }
  const f = o.flags.size ? o.flags : new Set(["l", "w", "c"]);
  const which = ["l", "w", "m", "c"].filter((k) => f.has(k));
  const ops = o.ops.length ? o.ops : ["-"];
  type Row = { counts: number[]; name: string; failed?: boolean };
  const rows: Row[] = [];
  let code = 0, regularTotal = 0, nonRegular = false;
  const errs: { at: number; text: string }[] = [];
  for (const op of ops) {
    const r = await readOp(io, op);
    if ("error" in r) {
      errs.push({ at: rows.length, text: `wc: ${op}: ${REASON[r.error]}\n` });
      code = 1;
      if (r.error === "EISDIR") rows.push({ counts: which.map(() => 0), name: op });
      continue;
    }
    const t = r.text;
    const c = { l: (t.match(/\n/g) ?? []).length, w: t.split(/\s+/).filter(Boolean).length, m: [...t].length, c: utf8Len(t) } as Record<string, number>;
    if (op === "-") nonRegular = true; else regularTotal += utf8Len(t);
    rows.push({ counts: which.map((k) => c[k]), name: op === "-" ? "" : op });
  }
  const total = which.map((_, i) => rows.reduce((t, r) => t + r.counts[i], 0));
  // GNU's width: one count of one input — no padding; else the digits of the total size, at least 7 for stdin
  let width = 1;
  if (!(which.length === 1 && ops.length === 1)) {
    for (let t = regularTotal; t >= 10; t = Math.floor(t / 10)) width++;
    if (nonRegular) width = Math.max(width, 7);
  }
  const line = (counts: number[], name: string) => counts.map((x) => String(x).padStart(width)).join(" ") + (name ? ` ${name}` : "") + "\n";
  let ri = 0;
  for (let i = 0; i <= rows.length; i++) {
    for (const e of errs.filter((x) => x.at === i)) io.err(e.text);
    if (i < rows.length) io.out(line(rows[i].counts, rows[i].name));
    ri++;
  }
  if (ops.length > 1) io.out(line(total, "total"));
  return code;
}

// ---------------------------------------------------------------------------------------------- cp, mv

async function cpMv(s: ShellSession, name: "cp" | "mv", io: IO, args: string[]) {
  const o = parse(args, name === "cp" ? "rRivfnaT" : "ivfnT", "", { "--recursive": "r", "--interactive": "i", "--verbose": "v", "--force": "f", "--no-clobber": "n" });
  if (o.bad) { usage(io, name, o.bad); return 1; }
  const f = o.flags;
  const rec = f.has("r") || f.has("R") || f.has("a") || name === "mv";
  if (o.ops.length === 0) { usage(io, name, "missing file operand"); return 1; }
  if (o.ops.length === 1) { usage(io, name, `missing destination file operand after ${q(o.ops[0])}`); return 1; }
  const fs = s.fs;
  const destOp = o.ops[o.ops.length - 1];
  const dest = io.path(destOp);
  const srcs = o.ops.slice(0, -1);
  const destIsDir = (await fs.exists(dest)) && (await fs.stat(dest)).isDirectory;
  if (srcs.length > 1 && !destIsDir) {
    io.err((await fs.exists(dest)) ? `${name}: target ${q(destOp)} is not a directory\n` : `${name}: target ${q(destOp)}: No such file or directory\n`);
    return 1;
  }
  let code = 0;
  const shownJoin = (d: string, b: string) => (d.endsWith("/") ? d + b : `${d}/${b}`);
  const copyTree = async (from: string, to: string, fromShown: string, toShown: string) => {
    const st = await fs.stat(from);
    if (st.isDirectory) {
      if (!(await fs.exists(to))) await fs.mkdir(to);
      if (f.has("v")) io.out(`${q(fromShown)} -> ${q(toShown)}\n`);
      for (const n of (await fs.readdir(from)).sort()) await copyTree(joinPath(from, n), joinPath(to, n), shownJoin(fromShown, n), shownJoin(toShown, n));
    } else {
      await fs.writeFile(to, await fs.readFile(from));
      await fs.chmod(to, st.mode & 0o777);
      if (f.has("v")) io.out(`${q(fromShown)} -> ${q(toShown)}\n`);
    }
    s.owners[to] = s.user;
  };
  for (const op of srcs) {
    const src = io.path(op);
    if (!(await fs.exists(src))) { io.err(`${name}: cannot stat ${q(op)}: No such file or directory\n`); code = 1; continue; }
    const srcIsDir = (await fs.stat(src)).isDirectory;
    if (srcIsDir && !rec) { io.err(`cp: -r not specified; omitting directory ${q(op)}\n`); code = 1; continue; }
    const base = src === "/" ? "/" : src.slice(src.lastIndexOf("/") + 1);
    const target = destIsDir ? joinPath(dest, base) : dest;
    const targetShown = destIsDir ? shownJoin(destOp, base) : destOp;
    if (target === src) { io.err(`${name}: ${q(op)} and ${q(targetShown)} are the same file\n`); code = 1; continue; }
    if (srcIsDir && (target + "/").startsWith(src + "/")) {
      io.err(name === "cp" ? `cp: cannot copy a directory, ${q(op)}, into itself, ${q(targetShown)}\n` : `mv: cannot move ${q(op)} to a subdirectory of itself, ${q(targetShown)}\n`);
      code = 1; continue;
    }
    const parent = target.replace(/\/[^/]*$/, "") || "/";
    if (!(await fs.exists(parent)) || !(await fs.stat(parent)).isDirectory) {
      const why = (await fs.exists(parent)) ? "Not a directory" : "No such file or directory";
      io.err(name === "cp" ? `cp: cannot create ${srcIsDir ? "directory" : "regular file"} ${q(targetShown)}: ${why}\n` : `mv: cannot move ${q(op)} to ${q(targetShown)}: ${why}\n`);
      code = 1; continue;
    }
    const exists = await fs.exists(target);
    if (exists) {
      const tDir = (await fs.stat(target)).isDirectory;
      if (tDir && !srcIsDir) { io.err(`${name}: cannot overwrite directory ${q(targetShown)} with non-directory\n`); code = 1; continue; }
      if (!tDir && srcIsDir) { io.err(`${name}: cannot overwrite non-directory ${q(targetShown)} with directory ${q(op)}\n`); code = 1; continue; }
      if (f.has("n")) continue;
      if (f.has("i") && !(await io.ask(`${name}: overwrite ${q(targetShown)}? `))) continue;
      if (tDir && srcIsDir && name === "mv") {
        if ((await fs.readdir(target)).length) { io.err(`mv: cannot move ${q(op)} to ${q(targetShown)}: Directory not empty\n`); code = 1; continue; }
        await fs.rm(target, { recursive: true });
      }
    }
    if (name === "cp") { await copyTree(src, target, op, targetShown); continue; }
    if (exists && !srcIsDir) await fs.rm(target);
    await fs.mv(src, target);
    for (const k of Object.keys(s.owners)) if (k === src || k.startsWith(src + "/")) { s.owners[target + k.slice(src.length)] = s.owners[k]; delete s.owners[k]; }
    if (f.has("v")) io.out(`renamed ${q(op)} -> ${q(targetShown)}\n`);
  }
  return code;
}

// ---------------------------------------------------------------------------------------------- rm, mkdir, rmdir, touch

async function rm(s: ShellSession, io: IO, args: string[]) {
  const o = parse(args, "rRfivd", "", { "--recursive": "r", "--force": "f", "--interactive": "i", "--verbose": "v", "--dir": "d", "--no-preserve-root": "" });
  if (o.bad) { usage(io, "rm", o.bad); return 1; }
  const f = o.flags;
  const rec = f.has("r") || f.has("R");
  // the last of -f and -i wins, as in GNU
  const lastFI = [...args].reverse().find((a) => /^-[a-zA-Z]*[fi]/.test(a)) ?? "";
  const interactive = f.has("i") && (!f.has("f") || lastFI.lastIndexOf("i") > lastFI.lastIndexOf("f"));
  const force = f.has("f") && !interactive;
  if (!o.ops.length) { if (force) return 0; usage(io, "rm", "missing operand"); return 1; }
  const fs = s.fs;
  let code = 0;
  const removeTree = async (p: string, shown: string): Promise<boolean> => {
    const st = await fs.lstat(p);
    if (st.isDirectory) {
      const kids = (await fs.readdir(p)).sort();
      if (interactive && kids.length && !(await io.ask(`rm: descend into directory ${q(shown)}? `))) return false;
      let all = true;
      for (const n of kids) if (!(await removeTree(joinPath(p, n), `${shown.replace(/\/$/, "")}/${n}`))) all = false;
      if (!all) return false;
      if (interactive && !(await io.ask(`rm: remove directory ${q(shown)}? `))) return false;
      await fs.rm(p, { recursive: true });
      if (f.has("v")) io.out(`removed directory ${q(shown)}\n`);
    } else {
      if (interactive && !(await io.ask(`rm: remove ${st.size === 0 ? "regular empty file" : "regular file"} ${q(shown)}? `))) return false;
      await fs.rm(p);
      if (f.has("v")) io.out(`removed ${q(shown)}\n`);
    }
    delete s.owners[p];
    return true;
  };
  for (const op of o.ops) {
    const p = io.path(op);
    const base = op.replace(/\/+$/, "").split("/").pop();
    if (base === "." || base === "..") { io.err(`rm: refusing to remove '.' or '..' directory: skipping ${q(op)}\n`); code = 1; continue; }
    if (p === "/" && rec) { io.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); code = 1; continue; }
    const st = await fs.lstat(p).catch(() => null);
    if (!st) { if (!force) { io.err(`rm: cannot remove ${q(op)}: No such file or directory\n`); code = 1; } continue; }
    if (st.isDirectory && !rec) {
      if (f.has("d") && !(await fs.readdir(p)).length) { await fs.rm(p, { recursive: true }); if (f.has("v")) io.out(`removed directory ${q(op)}\n`); continue; }
      io.err(`rm: cannot remove ${q(op)}: Is a directory\n`); code = 1; continue;
    }
    await removeTree(p, op);
  }
  return code;
}

async function mkdir(s: ShellSession, io: IO, args: string[]) {
  const o = parse(args, "pv", "m", { "--parents": "p", "--verbose": "v", "--mode": "m" });
  if (o.bad) { usage(io, "mkdir", o.bad); return 1; }
  if (!o.ops.length) { usage(io, "mkdir", "missing operand"); return 1; }
  const fs = s.fs;
  let code = 0;
  for (const op of o.ops) {
    const p = io.path(op);
    if (o.flags.has("p")) {
      const parts = p.split("/").filter(Boolean);
      let cur = "", shown = op.startsWith("/") ? "" : "";
      const opParts = op.split("/").filter(Boolean);
      const skip = parts.length - opParts.length;
      let failed = false;
      for (let i = 0; i < parts.length; i++) {
        cur += "/" + parts[i];
        if (i >= skip) shown += (shown || op.startsWith("/") ? "/" : "") + opParts[i - skip];
        const st = await fs.stat(cur).catch(() => null);
        if (st?.isDirectory) continue;
        if (st) { io.err(`mkdir: cannot create directory ${qc(op)}: ${i === parts.length - 1 ? "File exists" : "Not a directory"}\n`); failed = true; break; }
        await fs.mkdir(cur);
        s.owners[cur] = s.user;
        if (o.flags.has("v")) io.out(`mkdir: created directory ${q(shown)}\n`);
      }
      if (failed) code = 1;
      continue;
    }
    const parent = p.replace(/\/[^/]*$/, "") || "/";
    if (await fs.exists(p)) { io.err(`mkdir: cannot create directory ${qc(op)}: File exists\n`); code = 1; continue; }
    if (!(await fs.exists(parent))) { io.err(`mkdir: cannot create directory ${qc(op)}: No such file or directory\n`); code = 1; continue; }
    if (!(await fs.stat(parent)).isDirectory) { io.err(`mkdir: cannot create directory ${qc(op)}: Not a directory\n`); code = 1; continue; }
    await fs.mkdir(p);
    s.owners[p] = s.user;
    if (o.flags.has("v")) io.out(`mkdir: created directory ${q(op)}\n`);
  }
  return code;
}

async function rmdir(s: ShellSession, io: IO, args: string[]) {
  const o = parse(args, "pv", "", { "--parents": "p", "--verbose": "v" });
  if (o.bad) { usage(io, "rmdir", o.bad); return 1; }
  if (!o.ops.length) { usage(io, "rmdir", "missing operand"); return 1; }
  const fs = s.fs;
  let code = 0;
  for (const op of o.ops) {
    const p = io.path(op);
    const st = await fs.lstat(p).catch(() => null);
    const fail = (why: string) => { io.err(`rmdir: failed to remove ${q(op)}: ${why}\n`); code = 1; };
    if (!st) { fail("No such file or directory"); continue; }
    if (!st.isDirectory) { fail("Not a directory"); continue; }
    if ((await fs.readdir(p)).length) { fail("Directory not empty"); continue; }
    if (o.flags.has("v")) io.out(`rmdir: removing directory, ${q(op)}\n`);
    await fs.rm(p, { recursive: true });
    delete s.owners[p];
  }
  return code;
}

async function touch(s: ShellSession, io: IO, args: string[]) {
  const o = parse(args, "acm", "dt", { "--no-create": "c" });
  if (o.bad) { usage(io, "touch", o.bad); return 1; }
  if (!o.ops.length) { usage(io, "touch", "missing file operand"); return 1; }
  const fs = s.fs;
  let code = 0;
  const now = new Date();
  for (const op of o.ops) {
    const p = io.path(op);
    if (await fs.exists(p)) { await fs.utimes(p, now, now); continue; }
    if (o.flags.has("c")) continue;
    try { await fs.writeFile(p, ""); s.owners[p] = s.user; }
    catch (e) {
      const c = (e as { code?: string }).code;
      io.err(`touch: cannot touch ${q(op)}: ${c === "ENOTDIR" ? "Not a directory" : "No such file or directory"}\n`); code = 1;
    }
  }
  return code;
}

async function tee(io: IO, args: string[]) {
  const o = parse(args, "ai", "", { "--append": "a" });
  if (o.bad) { usage(io, "tee", o.bad); return 1; }
  const text = io.stdinText();
  io.out(text);
  let code = 0;
  for (const op of o.ops) {
    const p = io.path(op);
    try { if (o.flags.has("a")) await io.ctx.fs.appendFile(p, text); else await io.ctx.fs.writeFile(p, text); }
    catch (e) {
      const c = (e as { code?: string }).code;
      io.err(`tee: ${op}: ${c === "EISDIR" ? "Is a directory" : c === "ENOTDIR" ? "Not a directory" : "No such file or directory"}\n`); code = 1;
    }
  }
  return code;
}

async function uniq(io: IO, args: string[]) {
  const o = parse(args, "cdui", "", { "--count": "c", "--repeated": "d", "--unique": "u", "--ignore-case": "i" });
  if (o.bad) { usage(io, "uniq", o.bad); return 1; }
  const [inp, outp] = o.ops;
  const r = await readOp(io, inp ?? "-");
  if ("error" in r) { io.err(`uniq: ${inp}: ${REASON[r.error]}\n`); return 1; }
  const lines = splitLines(r.text);
  const key = (l: string) => (o.flags.has("i") ? l.toLowerCase() : l);
  let out = "";
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    while (j < lines.length && key(lines[j]) === key(lines[i])) j++;
    const n = j - i;
    if (!(o.flags.has("d") && n < 2) && !(o.flags.has("u") && n > 1)) out += (o.flags.has("c") ? `${String(n).padStart(7)} ` : "") + lines[i] + "\n";
    i = j;
  }
  if (outp) await io.ctx.fs.writeFile(io.path(outp), out); else io.out(out);
  return 0;
}
