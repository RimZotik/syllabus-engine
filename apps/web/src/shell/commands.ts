/**
 * Our own commands of the simulator, where the course needs GNU coreutils behaviour and wording exactly
 * (Ubuntu, English messages): ls, cat, head, tail, wc, cp, mv, rm, mkdir, rmdir, touch, tee, uniq; wrappers that
 * fix just-bash's messages for sort, cut, grep, find, file, tree; and the terminal programs history, man, less,
 * nano, vim, clear, help. `--help` of every phase-1 command prints our short Russian page (manpages.ts).
 */
import type { Command, ResolvedCommandContext } from "just-bash/browser";
import type { ShellSession } from "./engine.ts";
import { errCode, joinPath } from "./engine.ts";
import { rwx } from "./users.ts";
import { helpText, manPage, MAN_NAMES } from "./manpages.ts";
import { Nano, Pager, Vim } from "./screens.ts";

type Ctx = ResolvedCommandContext;
export type IO = {
  out(s: string): void;
  err(s: string): void;
  ctx: Ctx;
  path(p: string): string;
  stdinText(): string;
  ask(prompt: string): Promise<boolean>;
  /** a line from the terminal (sudo's password: secret) */
  askLine(prompt: string, secret?: boolean): Promise<string | null>;
};
export type Impl = (io: IO, args: string[]) => Promise<number>;

/** 'name' — coreutils' quoting of file names in messages (shell-escape style). */
export const q = (s: string) => (s.includes("'") ? `"${s}"` : `'${s}'`);
/** ‘name’ — the locale quoting some messages use (mkdir, find, invalid numbers). */
export const qc = (s: string) => `‘${s}’`;
/** coreutils quotef: a name is quoted only when the shell would need it (wc: 'a b': …, wc: plain: …). */
export const qf = (s: string) => (s === "" || /[\s!"$&'()*;<>?[\\\]^`{|}]/.test(s) || /^[#~]/.test(s) ? q(s) : s);

const decoder = new TextDecoder();
export const bytesToText = (b: unknown): string => {
  if (typeof b !== "string") return "";
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i) & 0xff;
  return decoder.decode(u);
};
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

let invocation = 0;

/** def — our own command (with the Russian --help); wrap — a bundled one with corrected output. */
export function makeDef(s: ShellSession) {
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
        askLine: (prompt, secret) => s.ui.ask(prompt, { secret }),
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

  return { def, wrap };
}

export function makeCommands(s: ShellSession): Command[] {
  const { def, wrap } = makeDef(s);
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
    def("sort", sort),
    wrap("cut", async (_io, _a, r) => ({ ...r, stderr: await rewriteLines(r.stderr, /^cut: (.+): No such file or directory$/, async (m) => { const c = await probe(_io, m[1]); return `cut: ${qf(m[1])}: ${REASON[c === "ok" ? "ENOENT" : c]}`; }) })),
    wrap("find", async (_io, a, r) => {
      let stderr = await rewriteLines(r.stderr, /^find: (.+): No such file or directory$/, async (m) => `find: ${qc(m[1].replace(/^[‘']|[’']$/g, ""))}: No such file or directory`);
      // an unquoted -name pattern that the shell expanded into several names: findutils 4.9 adds a hint
      const i = a.findIndex((x) => x === "-name" || x === "-iname");
      if (/paths must precede expression/.test(stderr) && i >= 0 && a[i + 2] && !a[i + 2].startsWith("-")) stderr = stderr.replace(/\n?$/, `\nfind: possible unquoted pattern after predicate \`${a[i]}'?\n`);
      return { ...r, stderr };
    }),
    wrap("file", async (_io, _a, r) => ({ ...r, stdout: r.stdout.replace(/^(.+): cannot open \(No such file or directory\)$/gm, "$1: cannot open `$1' (No such file or directory)") })),
    def("tree", (io, a) => tree(s, io, a)),
    wrap("grep", async (_io, a, r0) => {
      const r = { ...r0, stderr: await rewriteLines(showGlobs(r0.stderr), /^grep: (.+): No such file or directory$/, async (m) => { const c = await probe(_io, m[1]); return `grep: ${m[1]}: ${REASON[c === "ok" ? "ENOENT" : c]}`; }) };
      // GNU prints «./dir/file:line» for an explicit «.» operand
      const ops = grepOperands(a);
      if (/^-\w*r|^-\w*R|^--recursive/.test(a.filter((x) => x.startsWith("-")).join(" ")) || a.some((x) => /^-[a-zA-Z]*[rR]/.test(x))) {
        if (ops.length === 1 && ops[0] === "." && !a.some((x) => /^-[a-zA-Z]*[hc]/.test(x) && x.includes("h"))) return { ...r, stdout: r.stdout.replace(/^(?=.)/gm, "./") };
      }
      return r;
    }, async (_io, a0) => {
      // --color=auto (Ubuntu's alias) colours only a terminal; the interpreter's grep does not know the option
      const a = a0.filter((x) => !/^--colou?r(=.*)?$/.test(x));
      // `grep -r pattern` without a folder searches the current one
      const rec = a.some((x) => /^-[a-zA-Z]*[rR]/.test(x) || x === "--recursive");
      if (rec && grepOperands(a).length === 0) return [...a, "."];
      const idx = new Set(grepOperandIdx(a));
      return a.map((x, i) => (idx.has(i) ? hideGlobs(x) : x));
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
        const r = await readOp(io, files[0]);
        if ("error" in r) { io.err(r.error === "EISDIR" ? `${files[0]} is a directory\n` : `${files[0]}: ${REASON[r.error]}\n`); return 1; }
        text = r.text; title = files[0];
      }
      if (!s.ttyNames.has("less")) { io.out(text); return 0; }
      await s.ui.screen(new Pager(text.replace(/\n$/, "").split("\n"), title, false));
      return 0;
    }),
    def("nano", async (io, a) => {
      const name = a.filter((x) => !x.startsWith("-") && !x.startsWith("+"))[0] ?? "";
      const p = name ? io.path(name) : "";
      let text = "", notice: string;
      const code = p ? await probe(io, name) : "ENOENT";
      if (code === "EISDIR") notice = `"${name}" is a directory`;
      else if (code === "EACCES") notice = `Error reading ${name}: Permission denied`;
      else if (code === "ok") {
        text = await s.fs.readFile(p);
        const n = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
        const dos = text.includes("\r\n") ? " (Converted from DOS format)" : "";
        notice = (await s.fs.can(p, 2)) ? `Read ${n} line${n === 1 ? "" : "s"}${dos}` : `File '${name}' is unwritable`;
      } else notice = "New File";
      const nano = new Nano(text, name, notice, async (file, body) => {
        const target = io.path(file);
        try { await s.fs.writeFile(target, body); return null; }
        catch (e) {
          const code = (e as { code?: string }).code;
          return code === "EISDIR" ? "Is a directory" : code === "ENOTDIR" ? "Not a directory" : code === "EACCES" ? "Permission denied" : "No such file or directory";
        }
      }, (file) => s.fs.exists(io.path(file)));
      await s.ui.screen(nano);
      return 0;
    }),
    // compression needs Node's zlib, which the browser does not have
    ...["gzip", "gunzip", "zcat"].map((n) => def(n, async (io) => { io.err(`${n}: not available in this simulator\n`); return 1; })),
    ...["vim", "vi"].map((n) => def(n, async (io, a) => {
      const name = a.filter((x) => !x.startsWith("-"))[0] ?? "";
      const p = name ? io.path(name) : "";
      const text = p && (await probe(io, name)) === "ok" ? await s.fs.readFile(p) : "";
      await s.ui.screen(new Vim(text, name, p ? await s.fs.exists(p) : false, async (body) => {
        try { await s.fs.writeFile(p, body); return null; } catch { return `"${name}" E212: Can't open file for writing`; }
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
function grepOperandIdx(a: string[]) {
  const ops: number[] = [];
  let pattern = a.some((x) => x === "-e" || x.startsWith("--regexp")) ;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--") { for (let j = i + 1; j < a.length; j++) ops.push(j); break; }
    if (x.startsWith("-") && x.length > 1) { if (GREP_WITH_ARG.has(x)) i++; continue; }
    if (!pattern) { pattern = true; continue; }
    ops.push(i);
  }
  return ops;
}
const grepOperands = (a: string[]) => grepOperandIdx(a).map((i) => a[i]);
/** grep never expands wildcards itself (the shell did); the interpreter's grep does — its operands get look-alike characters and are restored in the messages */
const GLOB_HIDE: Record<string, string> = { "*": String.fromCharCode(0xe001), "?": String.fromCharCode(0xe002), "[": String.fromCharCode(0xe003) };
const hideGlobs = (x: string) => x.replace(/[*?[]/g, (c) => GLOB_HIDE[c]);
const showGlobs = (x: string) => Object.entries(GLOB_HIDE).reduce((t, [k, v]) => t.split(v).join(k), x);

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
      if (m === undefined) { r.bad ??= `unrecognized option '${x}'`; continue; }
      if (m === "") continue; // accepted and ignored (--color=auto: colours depend on the terminal anyway)
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
/** The reason text of a file system error, as GNU tools print it. */
export const why = (e: unknown) => {
  const c = errCode(e);
  return c === "EACCES" ? "Permission denied" : c === "EPERM" ? "Operation not permitted" : c === "ENOTDIR" ? "Not a directory" : c === "EISDIR" ? "Is a directory" : c === "EEXIST" ? "File exists" : c === "ENOTEMPTY" ? "Directory not empty" : "No such file or directory";
};
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
/**
 * How GNU ls shows a name on a terminal (quoting style shell-escape): letters of any alphabet as they are;
 * quotes around a name with a space or a character special to the shell; control characters as $'\r'.
 */
export function ttyName(n: string) {
  const special = /[\s!"$&'()*;<>?[\\\]^`{|}]/.test(n) || /^[#~]/.test(n);
  const control = /[\x00-\x1f\x7f]/.test(n);
  if (!special && !control) return n;
  if (control) {
    // 'a'$'\r' — printable runs in quotes, control characters in $'…'
    const esc: Record<string, string> = { "\r": "\\r", "\n": "\\n", "\t": "\\t" };
    return n.split(/([\x00-\x1f\x7f]+)/).filter(Boolean).map((part) => /^[\x00-\x1f\x7f]/.test(part)
      ? "$'" + [...part].map((c) => esc[c] ?? "\\" + c.charCodeAt(0).toString(8).padStart(3, "0")).join("") + "'"
      : "'" + part.replace(/'/g, "'\\''") + "'").join("");
  }
  if (n.includes("'") && !/["$`\\!]/.test(n)) return `"${n}"`;
  return "'" + n.replace(/'/g, "'\\''") + "'";
}

type Ent = { name: string; path: string; kind: "d" | "-" | "l"; mode: number; size: number; mtime: Date; target?: string; links: number; unknown?: boolean };

async function ls(s: ShellSession, io: IO, args: string[]): Promise<number> {
  const o = parse(args, "alhR1tSrdAF", "", { "--all": "a", "--recursive": "R", "--human-readable": "h", "--reverse": "r", "--directory": "d", "--almost-all": "A", "--color": "", "--classify": "F" });
  if (o.bad) { usage(io, "ls", o.bad); return 2; }
  const f = o.flags;
  const tty = s.tty && !f.has("1");
  let code = 0;
  let lastErr = "ENOENT";

  const ent = async (path: string, name: string): Promise<Ent | null> => {
    const st = await s.fs.lstat(path).catch((e) => { lastErr = errCode(e); return null; });
    if (!st) return null;
    const kind = st.isSymbolicLink ? "l" : st.isDirectory ? "d" : "-";
    let links = 1;
    // link count of a folder: 2 + its subfolders (the platform counts them even where the learner may not look)
    if (kind === "d") links = 2 + (await s.asRoot(async () => (await Promise.all((await s.fs.readdir(path)).map((n) => s.fs.stat(joinPath(path, n)).then((x) => x.isDirectory).catch(() => false)))).filter(Boolean).length));
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
    // Ubuntu's dircolors: sticky other-writable folders (/tmp) on green, folders blue, links cyan, executables green
    const c = e.kind === "d" ? ((e.mode & 0o1002) === 0o1002 ? "30;42" : (e.mode & 0o2) ? "34;42" : "01;34") : e.kind === "l" ? "01;36" : e.mode & 0o4000 ? "37;41" : e.mode & 0o111 ? "01;32" : "";
    return c ? `\x1b[${c}m${shown}\x1b[0m` : shown;
  };
  const suffix = (e: Ent) => (!f.has("F") ? "" : e.kind === "d" ? "/" : e.kind === "l" ? "@" : e.mode & 0o111 ? "*" : "");
  // when some names on the screen are quoted, GNU ls puts a space before the others to keep them aligned
  let pad = "";
  const label = (e: Ent) => { const q = tty ? ttyName(e.name) : e.name; return (q === e.name ? pad : "") + color(e, q) + suffix(e); };
  const shownWidth = (e: Ent) => { const q = tty ? ttyName(e.name) : e.name; return [...((q === e.name ? pad : "") + q + suffix(e))].length; };

  const render = (xs: Ent[], withTotal: boolean): string => {
    pad = tty && xs.some((e) => ttyName(e.name) !== e.name) ? " " : "";
    if (f.has("l")) {
      const sizes = xs.map((e) => (f.has("h") ? human(e.size) : String(e.size)));
      const w = { links: Math.max(1, ...xs.map((e) => String(e.links).length)), own: Math.max(1, ...xs.map((e) => s.ownerOf(e.path).length)), grp: Math.max(1, ...xs.map((e) => s.groupOf(e.path).length)), size: Math.max(1, ...sizes.map((x) => x.length)) };
      let out = "";
      if (withTotal) {
        const blocks = xs.reduce((t, e) => t + (e.kind === "d" ? 4 : e.kind === "l" ? 0 : Math.ceil(e.size / 4096) * 4), 0);
        out += `total ${f.has("h") ? (blocks ? human(blocks * 1024) : "0") : blocks}\n`;
      }
      xs.forEach((e, i) => {
        if (e.unknown) { out += `-????????? ${"?".padStart(w.links)} ${"?".padEnd(w.own)} ${"?".padEnd(w.grp)} ${"?".padStart(w.size)} ${"?".padStart(12)} ${e.name}\n`; return; }
        out += `${e.kind}${rwx(e.kind === "l" ? 0o777 : e.mode)} ${String(e.links).padStart(w.links)} ${s.ownerOf(e.path).padEnd(w.own)} ${s.groupOf(e.path).padEnd(w.grp)} ${sizes[i].padStart(w.size)} ${lsDate(e.mtime)} ${label(e)}${e.target ? ` -> ${e.target}` : ""}\n`;
      });
      return out;
    }
    if (!tty) return xs.map((e) => label(e) + "\n").join("");
    return columns(xs.map((e) => ({ text: label(e), width: shownWidth(e) })), s.ui.cols);
  };

  const listDir = async (path: string, shownDir = "."): Promise<Ent[] | null> => {
    const all = await s.fs.readdir(path).catch((e) => { lastErr = errCode(e); return null; });
    if (!all) return null;
    const names = path === "/bin" || path === "/usr/bin" ? all.filter((n) => !n.startsWith("__")) : all;
    const shown = names.filter((n) => f.has("a") || f.has("A") || !n.startsWith("."));
    // entries of a folder you may read but not enter: names only; `ls -l` cannot stat them
    const xs = (await Promise.all(shown.map(async (n) => (await ent(joinPath(path, n), n)) ?? ({ name: n, path: joinPath(path, n), kind: "-", mode: 0, size: 0, mtime: new Date(0), links: 0, unknown: true } as Ent)))).filter((x): x is Ent => !!x);
    if (f.has("l")) for (const e of xs) if (e.unknown) { io.err(`ls: cannot access ${q(shownDir === "." ? e.name : `${shownDir.replace(/\/$/, "")}/${e.name}`)}: Permission denied\n`); code = 1; }
    if (f.has("a")) { const d = await ent(path, "."); const p = await ent(joinPath(path, ".."), ".."); if (d) xs.push(d); if (p) xs.push(p); }
    return sortEnts(xs);
  };

  const ops = o.ops.length ? o.ops : ["."];
  const files: Ent[] = [], dirs: { op: string; e: Ent }[] = [];
  const missing: [string, string][] = [];
  for (const op of ops) {
    const e = await ent(io.path(op), op);
    if (!e) { missing.push([op, lastErr]); continue; }
    if (e.kind === "l" && !f.has("l") && !f.has("d")) {
      const real = await s.fs.stat(io.path(op)).catch(() => null);
      if (real?.isDirectory) { dirs.push({ op, e: { ...e, kind: "d" } }); continue; }
    }
    if (e.kind === "d" && !f.has("d")) dirs.push({ op, e }); else files.push(e);
  }
  for (const [m, c] of missing.sort()) { io.err(`ls: cannot access ${q(m)}: ${c === "EACCES" ? "Permission denied" : c === "ENOTDIR" ? "Not a directory" : "No such file or directory"}\n`); code = 2; }
  const parts: string[] = [];
  if (files.length) parts.push(render(sortEnts(files), false));
  const header = ops.length > 1 || f.has("R");
  const sortedDirs = dirs.sort((a, b) => (a.op < b.op ? -1 : 1));
  if (f.has("r")) sortedDirs.reverse();
  const walkDir = async (op: string, path: string) => {
    const xs = await listDir(path, op);
    if (!xs) {
      io.err(`ls: cannot open directory ${q(op)}: ${lastErr === "EACCES" ? "Permission denied" : "No such file or directory"}\n`);
      code = 2;
      if (header) parts.push(`${op}:\n`);
      return;
    }
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
type ReadErr = "ENOENT" | "EISDIR" | "EACCES" | "ENOTDIR";
async function readOp(io: IO, op: string): Promise<{ text: string } | { error: ReadErr }> {
  if (op === "-") return { text: io.stdinText() };
  const c = await probe(io, op);
  if (c !== "ok") return { error: c };
  try { return { text: await io.ctx.fs.readFile(io.path(op)) }; } catch (e) { return { error: errCode(e) as ReadErr }; }
}
/** Can the effective user read this operand? "ok" or why not (as a real open() reports it). */
export async function probe(io: IO, op: string): Promise<"ok" | ReadErr> {
  const fs = io.ctx.fs;
  const p = io.path(op);
  let st;
  try { st = await fs.stat(p); } catch (e) { const c = errCode(e); return c === "EACCES" || c === "ENOTDIR" ? c : "ENOENT"; }
  if (st.isDirectory) return "EISDIR";
  try { await fs.readFileBuffer(p); return "ok"; } catch (e) { const c = errCode(e); return c === "EACCES" ? "EACCES" : "ENOENT"; }
}
export const REASON = { ENOENT: "No such file or directory", EISDIR: "Is a directory", EACCES: "Permission denied", ENOTDIR: "Not a directory" } as const;
const splitLines = (t: string) => { const xs = t.split("\n"); if (t.endsWith("\n")) xs.pop(); return t ? xs : []; };

async function cat(io: IO, args: string[]) {
  const o = parse(args, "nbAEsTv", "", { "--number": "n", "--number-nonblank": "b", "--show-all": "A", "--show-ends": "E", "--show-tabs": "T" });
  if (o.bad) { usage(io, "cat", o.bad); return 1; }
  let code = 0, n = 0;
  for (const op of o.ops.length ? o.ops : ["-"]) {
    const r = await readOp(io, op);
    if ("error" in r) { io.err(`cat: ${qf(op)}: ${REASON[r.error]}\n`); code = 1; continue; }
    let t = r.text;
    // -A = -vET: line ends as $, tabs as ^I, control characters (the \r of a Windows file) as ^M
    const A = o.flags.has("A");
    if (A || o.flags.has("v")) t = t.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => (c === "\x7f" ? "^?" : "^" + String.fromCharCode(c.charCodeAt(0) + 64)));
    if (A || o.flags.has("T")) t = t.replace(/\t/g, "^I");
    if (A || o.flags.has("E")) t = t.replace(/\n/g, "$\n");
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
      io.err(r.error === "EISDIR" ? `${name}: error reading ${q(op)}: Is a directory\n` : `${name}: cannot open ${q(op)} for reading: ${REASON[r.error]}\n`);
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
      errs.push({ at: rows.length, text: `wc: ${qf(op)}: ${REASON[r.error]}\n` });
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
  if (destOp.endsWith("/") && !destIsDir) {
    // a trailing slash says «a folder»: coreutils refuses to make a file of that name
    const exists = await fs.exists(dest);
    for (const op of o.ops.slice(0, -1)) {
      if (!(await fs.exists(io.path(op)))) { io.err(`${name}: cannot stat ${q(op)}: No such file or directory\n`); continue; }
      if (name === "cp") io.err(exists ? `cp: failed to access ${q(destOp)}: Not a directory\n` : `cp: cannot create regular file ${q(destOp)}: Not a directory\n`);
      else io.err(`mv: cannot move ${q(op)} to ${q(destOp)}: Not a directory\n`);
    }
    return 1;
  }
  if (srcs.length > 1 && !destIsDir) {
    io.err((await fs.exists(dest)) ? `${name}: target ${q(destOp)} is not a directory\n` : `${name}: target ${q(destOp)}: No such file or directory\n`);
    return 1;
  }
  let code = 0;
  const shownJoin = (d: string, b: string) => (d.endsWith("/") ? d + b : `${d}/${b}`);
  const copyTree = async (from: string, to: string, fromShown: string, toShown: string) => {
    const st = await fs.stat(from);
    if (st.isDirectory) {
      if (!(await fs.exists(to))) {
        try { await fs.mkdir(to); } catch (e) { io.err(`cp: cannot create directory ${q(toShown)}: ${why(e)}\n`); code = 1; return; }
      }
      if (f.has("v")) io.out(`${q(fromShown)} -> ${q(toShown)}\n`);
      let names: string[];
      try { names = (await fs.readdir(from)).sort(); } catch (e) { io.err(`cp: cannot access ${q(fromShown)}: ${why(e)}\n`); code = 1; return; }
      for (const n of names) await copyTree(joinPath(from, n), joinPath(to, n), shownJoin(fromShown, n), shownJoin(toShown, n));
    } else {
      let data: string;
      try { data = await fs.readFile(from); } catch (e) { io.err(`cp: cannot open ${q(fromShown)} for reading: ${why(e)}\n`); code = 1; return; }
      const created = !(await fs.exists(to));
      try { await fs.writeFile(to, data); } catch (e) { io.err(`cp: cannot create regular file ${q(toShown)}: ${why(e)}\n`); code = 1; return; }
      if (created) await fs.chmod(to, st.mode & 0o777 & ~0o022).catch(() => {});
      if (f.has("v")) io.out(`${q(fromShown)} -> ${q(toShown)}\n`);
    }
  };
  for (const op of srcs) {
    const src = io.path(op);
    const sst = await fs.stat(src).catch((e: unknown) => ({ err: e }));
    if ("err" in sst) { io.err(`${name}: cannot stat ${q(op)}: ${why(sst.err)}\n`); code = 1; continue; }
    const srcIsDir = sst.isDirectory;
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
        if ((await fs.readdir(target).catch(() => [""])).length) { io.err(`mv: cannot move ${q(op)} to ${q(targetShown)}: Directory not empty\n`); code = 1; continue; }
        try { await fs.rm(target, { recursive: true }); } catch (e) { io.err(`mv: cannot move ${q(op)} to ${q(targetShown)}: ${why(e)}\n`); code = 1; continue; }
      }
    }
    if (name === "cp") { await copyTree(src, target, op, targetShown); continue; }
    try {
      if (exists && !srcIsDir) await fs.rm(target);
      await fs.mv(src, target);
    } catch (e) { io.err(`mv: cannot move ${q(op)} to ${q(targetShown)}: ${why(e)}\n`); code = 1; continue; }
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
      let kids: string[];
      try { kids = (await fs.readdir(p)).sort(); } catch (e) { io.err(`rm: cannot remove ${q(shown)}: ${why(e)}\n`); code = 1; return false; }
      if (interactive && kids.length && !(await io.ask(`rm: descend into directory ${q(shown)}? `))) return false;
      let all = true;
      for (const n of kids) if (!(await removeTree(joinPath(p, n), `${shown.replace(/\/$/, "")}/${n}`))) all = false;
      if (!all) return false;
      if (interactive && !(await io.ask(`rm: remove directory ${q(shown)}? `))) return false;
      try { await fs.rm(p, { recursive: true }); } catch (e) { io.err(`rm: cannot remove ${q(shown)}: ${why(e)}\n`); code = 1; return false; }
      if (f.has("v")) io.out(`removed directory ${q(shown)}\n`);
    } else {
      const kind = st.size === 0 ? "regular empty file" : "regular file";
      // a file you may not write: rm asks first (unless -f), even though removing depends on the folder
      const prot = !force && !interactive && !io.ctx.stdinProvided && !(await fs.can(p, 2));
      if (prot && !(await io.ask(`rm: remove write-protected ${kind} ${q(shown)}? `))) return false;
      if (interactive && !(await io.ask(`rm: remove ${kind} ${q(shown)}? `))) return false;
      try { await fs.rm(p); } catch (e) { io.err(`rm: cannot remove ${q(shown)}: ${why(e)}\n`); code = 1; return false; }
      if (f.has("v")) io.out(`removed ${q(shown)}\n`);
    }
    return true;
  };
  for (const op of o.ops) {
    const p = io.path(op);
    const base = op.replace(/\/+$/, "").split("/").pop();
    if (base === "." || base === "..") { io.err(`rm: refusing to remove '.' or '..' directory: skipping ${q(op)}\n`); code = 1; continue; }
    if (p === "/" && rec) { io.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); code = 1; continue; }
    const st = await fs.lstat(p).catch((e: unknown) => ({ err: e }));
    if ("err" in st) { if (!force || errCode(st.err) !== "ENOENT") { io.err(`rm: cannot remove ${q(op)}: ${why(st.err)}\n`); code = 1; } continue; }
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
        try { await fs.mkdir(cur); } catch (e) { io.err(`mkdir: cannot create directory ${qc(shown)}: ${why(e)}\n`); failed = true; break; }
        if (o.flags.has("v")) io.out(`mkdir: created directory ${q(shown)}\n`);
      }
      if (failed) code = 1;
      continue;
    }
    try { await fs.mkdir(p); }
    catch (e) { io.err(`mkdir: cannot create directory ${qc(op)}: ${errCode(e) === "EEXIST" ? "File exists" : why(e)}\n`); code = 1; continue; }
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
    const st = await fs.lstat(p).catch((e: unknown) => ({ err: e }));
    const fail = (w: string) => { io.err(`rmdir: failed to remove ${q(op)}: ${w}\n`); code = 1; };
    if ("err" in st) { fail(why(st.err)); continue; }
    if (!st.isDirectory) { fail("Not a directory"); continue; }
    if (await s.asRoot(async () => (await fs.readdir(p)).length)) { fail("Directory not empty"); continue; }
    if (o.flags.has("v")) io.out(`rmdir: removing directory, ${q(op)}\n`);
    try { await fs.rm(p, { recursive: true }); } catch (e) { fail(why(e)); }
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
    try {
      if (await fs.exists(p)) { await fs.utimes(p, now, now); continue; }
      if (o.flags.has("c")) continue;
      await fs.writeFile(p, "");
    } catch (e) { io.err(`touch: cannot touch ${q(op)}: ${why(e)}\n`); code = 1; }
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
    catch (e) { io.err(`tee: ${op}: ${why(e)}\n`); code = 1; }
  }
  return code;
}

async function uniq(io: IO, args: string[]) {
  const o = parse(args, "cdui", "", { "--count": "c", "--repeated": "d", "--unique": "u", "--ignore-case": "i" });
  if (o.bad) { usage(io, "uniq", o.bad); return 1; }
  const [inp, outp] = o.ops;
  const r = await readOp(io, inp ?? "-");
  if ("error" in r) { io.err(`uniq: ${qf(inp)}: ${REASON[r.error]}\n`); return 1; }
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

// ---------------------------------------------------------------------------------------------- sort, tree (C.UTF-8)

/**
 * sort as GNU sort under LANG=C.UTF-8 (Ubuntu 24.04 in WSL and on servers): byte order — digits, then
 * capitals, then small letters; -f folds case; equal keys are broken by the whole line (unless -s or -u).
 */
async function sort(io: IO, args: string[]) {
  const o = parse(args, "nrufbshcMV", "tko", { "--numeric-sort": "n", "--reverse": "r", "--unique": "u", "--ignore-case": "f", "--ignore-leading-blanks": "b", "--stable": "s", "--human-numeric-sort": "h", "--check": "c", "--key": "k", "--field-separator": "t", "--output": "o" });
  if (o.bad) { usage(io, "sort", o.bad); return 2; }
  const f = o.flags;
  const keys: { from: number; to: number | null; n: boolean; r: boolean; f: boolean; h: boolean; b: boolean }[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let spec: string | null = null;
    if (a === "-k" || a === "--key") spec = args[i + 1] ?? "";
    else if (/^-k./.test(a)) spec = a.slice(2);
    else if (a.startsWith("--key=")) spec = a.slice(6);
    if (spec === null) continue;
    const m = /^(\d+)(?:\.\d+)?([bfhnr]*)(?:,(\d+)(?:\.\d+)?([bfhnr]*))?$/.exec(spec);
    if (!m || Number(m[1]) < 1) { io.err(`sort: invalid number at field start: invalid count at start of ${qc(spec)}\n`); return 2; }
    const opts = (m[2] ?? "") + (m[4] ?? "");
    const own = opts.length > 0;
    keys.push({ from: Number(m[1]), to: m[3] ? Number(m[3]) : null, n: own ? opts.includes("n") : f.has("n"), r: own ? opts.includes("r") : false, f: own ? opts.includes("f") : f.has("f"), h: own ? opts.includes("h") : f.has("h"), b: own ? opts.includes("b") : f.has("b") });
  }
  const sep = o.vals.get("t");
  if (sep !== undefined && [...sep].length !== 1) { io.err(`sort: multi-character tab ${qc(sep)}\n`); return 2; }
  let text = "";
  for (const op of o.ops.length ? o.ops : ["-"]) {
    const r = await readOp(io, op);
    if ("error" in r) { io.err(r.error === "EISDIR" ? `sort: read failed: ${qf(op)}: Is a directory\n` : `sort: cannot read: ${qf(op)}: ${REASON[r.error]}\n`); return 2; }
    text += r.text && !r.text.endsWith("\n") ? r.text + "\n" : r.text;
  }
  const rows = splitLines(text);
  const fields = (line: string): string[] => {
    if (sep !== undefined) return line.split(sep);
    // without -t a field is a run of blanks followed by non-blanks: the blanks belong to the field
    return line.match(/[ \t]*[^ \t]+|[ \t]+$/g) ?? [""];
  };
  const keyOf = (line: string, k: (typeof keys)[number]) => {
    const fs = fields(line);
    const part = fs.slice(k.from - 1, k.to === null ? undefined : k.to).join(sep ?? "");
    return k.b || k.n || k.h ? part.replace(/^[ \t]+/, "") : part;
  };
  const num = (t: string) => { const m = /^\s*(-?\d*\.?\d+)/.exec(t); return m ? Number(m[1]) : 0; };
  const hum = (t: string) => { const m = /^\s*(-?\d*\.?\d+)([KMGTPE]?)/i.exec(t); return m ? Number(m[1]) * 1024 ** " KMGTPE".indexOf((m[2] || " ").toUpperCase()) : 0; };
  const bytes = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const cmpKey = (a: string, b: string, k: { n: boolean; f: boolean; h: boolean }) => {
    if (k.n) return num(a) - num(b) || 0;
    if (k.h) return hum(a) - hum(b) || 0;
    return k.f ? bytes(a.toUpperCase(), b.toUpperCase()) : bytes(a, b);
  };
  const whole = { from: 1, to: null, n: f.has("n"), r: false, f: f.has("f"), h: f.has("h"), b: f.has("b") };
  const useKeys = keys.length ? keys : [whole];
  const cmpKeys = (a: string, b: string) => {
    for (const k of useKeys) {
      const c = keys.length ? cmpKey(keyOf(a, k), keyOf(b, k), k) : cmpKey(k.b ? a.replace(/^[ \t]+/, "") : a, k.b ? b.replace(/^[ \t]+/, "") : b, k);
      if (c) return k.r ? -c : c;
    }
    return 0;
  };
  const cmp = (a: string, b: string) => {
    const c = cmpKeys(a, b);
    if (c || f.has("s") || f.has("u")) return f.has("r") ? -c : c;
    // last resort: the whole line, byte by byte
    const l = bytes(a, b);
    return f.has("r") ? -l : l;
  };
  if (f.has("c")) {
    for (let i = 1; i < rows.length; i++) if (cmp(rows[i - 1], rows[i]) > 0 || (f.has("u") && cmp(rows[i - 1], rows[i]) === 0)) { io.err(`sort: ${o.ops[0] ?? "-"}:${i + 1}: disorder: ${rows[i]}\n`); return 1; }
    return 0;
  }
  const sorted = rows.map((l, i) => [l, i] as const).sort((x, y) => cmp(x[0], y[0]) || x[1] - y[1]).map((x) => x[0]);
  const out = f.has("u") ? sorted.filter((l, i) => i === 0 || cmpKeys(sorted[i - 1], l) !== 0) : sorted;
  const result = out.map((l) => l + "\n").join("");
  const dest = o.vals.get("o");
  if (dest !== undefined) {
    try { await io.ctx.fs.writeFile(io.path(dest), result); } catch (e) { io.err(`sort: open failed: ${dest}: ${why(e)}\n`); return 2; }
  } else io.out(result);
  return 0;
}

/** tree, sorted in C.UTF-8 byte order, with the box-drawing characters of a UTF-8 terminal. */
async function tree(s: ShellSession, io: IO, args: string[]) {
  const o = parse(args, "adfi", "L", { "--dirsfirst": "D" });
  if (o.bad) { usage(io, "tree", o.bad); return 2; }
  const max = o.vals.has("L") ? Number(o.vals.get("L")) : Infinity;
  let dirs = 0, files = 0;
  let out = "";
  const walk = async (p: string, prefix: string, depth: number) => {
    let names: string[];
    try { names = (await s.fs.readdir(p)).filter((n) => o.flags.has("a") || !n.startsWith(".")).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); }
    catch (e) { out += `${prefix}[error opening dir]\n`; void e; return; }
    const ents: { n: string; dir: boolean }[] = [];
    for (const n of names) {
      const st = await s.fs.stat(joinPath(p, n)).catch(() => null);
      if (o.flags.has("d") && !st?.isDirectory) continue;
      ents.push({ n, dir: !!st?.isDirectory });
    }
    for (let i = 0; i < ents.length; i++) {
      const last = i === ents.length - 1;
      out += `${prefix}${last ? "└── " : "├── "}${ents[i].n}\n`;
      if (ents[i].dir) { dirs++; if (depth + 1 < max) await walk(joinPath(p, ents[i].n), prefix + (last ? "    " : "│   "), depth + 1); }
      else files++;
    }
  };
  const roots = o.ops.length ? o.ops : ["."];
  let code = 0;
  for (const r of roots) {
    const st = await s.fs.stat(io.path(r)).catch(() => null);
    if (!st?.isDirectory) { out += `${r}  [error opening dir]\n`; code = 2; continue; }
    out += r + "\n";
    await walk(io.path(r), "", 0);
  }
  out += `\n${dirs} director${dirs === 1 ? "y" : "ies"}${o.flags.has("d") ? "" : `, ${files} file${files === 1 ? "" : "s"}`}\n`;
  io.out(out);
  return code;
}
