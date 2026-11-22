/**
 * Checks of a shell task (task.yaml → tests.checks): the final state of the file system, what the learner printed,
 * which commands they used, and test commands run on a COPY of their file system. Messages are for the learner.
 */
import { headlessUI, type ShellSession, type ShellSetup } from "./engine.ts";

export type ShellCheck = {
  name?: string; hidden?: boolean; message?: string;
  fs_exists?: string; type?: "file" | "dir";
  fs_absent?: string;
  fs_content?: { path: string; equals?: string; contains?: string | string[]; not_contains?: string | string[]; regex?: string };
  fs_mode?: { path: string; mode: string };
  fs_owner?: { path: string; owner?: string; group?: string };
  /** a process with this name (or {name, user}) is running / is gone */
  process_alive?: string | { name: string; user?: string };
  process_absent?: string | { name: string; user?: string };
  /** `signal` was sent to the process `to`; with `after` — and before it `after` was (TERM before KILL) */
  signal_sent?: { to: string; signal: string; after?: string };
  last_output_contains?: string | string[];
  run?: string; stdin?: string; cwd?: string;
  stdout?: string; stdout_contains?: string | string[]; stderr?: string; stderr_contains?: string | string[]; exit_code?: number;
  command_used?: string | string[];
  forbid_commands?: string[];
};
export const CHECK_KINDS = ["fs_exists", "fs_absent", "fs_content", "fs_mode", "fs_owner", "last_output_contains", "run", "command_used", "forbid_commands", "process_alive", "process_absent", "signal_sent"] as const;
export type ShellTests = { checks: ShellCheck[] };
/** One step of a reference solution: a command line, optionally with answers to its questions or keys for nano. */
export type SolutionStep = string | { cmd: string; input?: string | string[]; keys?: string[] };
export type ShellTaskDef = { id: string; title: string; sandbox: "shell"; statement: string; difficulty?: number; concepts?: string[]; setup?: ShellSetup; solution?: SolutionStep[]; tests: ShellTests; hints?: { level: number; text: string }[] };

export type CheckResult = { name: string; ok: boolean; hidden?: boolean; message?: string; expected?: string; got?: string };

const list = (x: string | string[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const perm = (m: number) => ["r", "w", "x", "r", "w", "x", "r", "w", "x"].map((c, i) => (m & (0o400 >> i) ? c : "-")).join("");
const kindOf = (c: ShellCheck) => CHECK_KINDS.find((k) => c[k] !== undefined);

/** A readable default name of a check (the task may give its own). */
export function checkName(c: ShellCheck): string {
  if (c.name) return c.name;
  switch (kindOf(c)) {
    case "fs_exists": return `Есть ${c.type === "dir" ? "папка" : c.type === "file" ? "файл" : ""} ${c.fs_exists}`.replace("  ", " ");
    case "fs_absent": return `Нет ${c.fs_absent}`;
    case "fs_content": return `Содержимое ${c.fs_content!.path}`;
    case "fs_mode": return `Права ${c.fs_mode!.path}`;
    case "fs_owner": return `Владелец ${c.fs_owner!.path}`;
    case "process_alive": return `Процесс ${procName(c.process_alive!)} работает`;
    case "process_absent": return `Процесса ${procName(c.process_absent!)} нет`;
    case "signal_sent": return `Сигнал ${c.signal_sent!.signal} процессу ${c.signal_sent!.to}`;
    case "last_output_contains": return "Ответ выведен в терминал";
    case "run": return `Команда ${c.run}`;
    case "command_used": return `Использована команда ${list(c.command_used).join(" или ")}`;
    case "forbid_commands": return `Без команд ${c.forbid_commands!.join(", ")}`;
    default: return "Проверка";
  }
}

const procName = (x: string | { name: string }) => (typeof x === "string" ? x : x.name);
const sigName = (x: string) => x.toUpperCase().replace(/^SIG/, "").replace(/^9$/, "KILL").replace(/^15$/, "TERM").replace(/^2$/, "INT").replace(/^1$/, "HUP");

/** The checks look at everything as the platform, not as the learner: no permission limits (runs when no command does). */
export async function runChecks(s: ShellSession, checks: ShellCheck[]): Promise<CheckResult[]> {
  await s.procs.tick();
  return s.asRoot(() => runChecksAsRoot(s, checks));
}

async function runChecksAsRoot(s: ShellSession, checks: ShellCheck[]): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const used = new Set(s.log.flatMap((e) => e.commands));
  for (const c of checks) {
    const r: CheckResult = { name: checkName(c), ok: false, hidden: c.hidden };
    const fail = (msg: string, expected?: string, got?: string) => { r.message = c.message ?? msg; r.expected = expected; r.got = got; };
    const kind = kindOf(c);
    try {
      if (kind === "fs_exists") {
        const p = s.abs(c.fs_exists!);
        const st = await s.fs.stat(p).catch(() => null);
        if (!st) fail(`${c.type === "dir" ? "Папки" : "Файла"} «${c.fs_exists}» нет.`);
        else if (c.type === "dir" && !st.isDirectory) fail(`«${c.fs_exists}» — файл, а нужна папка.`);
        else if (c.type === "file" && st.isDirectory) fail(`«${c.fs_exists}» — папка, а нужен файл.`);
        else r.ok = true;
      } else if (kind === "fs_absent") {
        if (await s.fs.exists(s.abs(c.fs_absent!))) fail(`«${c.fs_absent}» всё ещё на месте.`); else r.ok = true;
      } else if (kind === "fs_content") {
        const fc = c.fs_content!;
        const p = s.abs(fc.path);
        const st = await s.fs.stat(p).catch(() => null);
        if (!st) fail(`Файла «${fc.path}» нет.`);
        else if (st.isDirectory) fail(`«${fc.path}» — папка, а нужен файл.`);
        else {
          const t = await s.fs.readFile(p);
          const missing = list(fc.contains).find((x) => !t.includes(x));
          const extra = list(fc.not_contains).find((x) => t.includes(x));
          if (fc.equals !== undefined && t !== fc.equals) fail(t === "" ? `Файл «${fc.path}» пустой.` : `В «${fc.path}» не то содержимое.`, fc.equals, t);
          else if (missing !== undefined) fail(`В «${fc.path}» нет «${missing}».`, undefined, t);
          else if (extra !== undefined) fail(`В «${fc.path}» не должно быть «${extra}».`, undefined, t);
          else if (fc.regex !== undefined && !new RegExp(fc.regex, "m").test(t)) fail(`Содержимое «${fc.path}» не подходит под условие задачи.`, undefined, t);
          else r.ok = true;
        }
      } else if (kind === "fs_mode") {
        const p = s.abs(c.fs_mode!.path);
        const st = await s.fs.stat(p).catch(() => null);
        const want = parseInt(c.fs_mode!.mode, 8);
        if (!st) fail(`«${c.fs_mode!.path}» нет.`);
        else if ((st.mode & 0o777) !== want) fail(`Права «${c.fs_mode!.path}» — ${perm(st.mode)}, а нужны ${perm(want)}.`, perm(want), perm(st.mode));
        else r.ok = true;
      } else if (kind === "fs_owner") {
        const fo = c.fs_owner!;
        const p = s.abs(fo.path);
        if (!(await s.fs.exists(p))) fail(`«${fo.path}» нет.`);
        else {
          const m = s.fs.metaOf(p);
          if ((fo.owner && m.o !== fo.owner) || (fo.group && m.g !== fo.group)) fail(`Владелец «${fo.path}» — ${m.o}:${m.g}, а нужен ${fo.owner ?? m.o}:${fo.group ?? m.g}.`, `${fo.owner ?? m.o}:${fo.group ?? m.g}`, `${m.o}:${m.g}`);
          else r.ok = true;
        }
      } else if (kind === "process_alive" || kind === "process_absent") {
        const spec = (kind === "process_alive" ? c.process_alive : c.process_absent)!;
        const name = procName(spec), user = typeof spec === "string" ? undefined : spec.user;
        const alive = s.procs.byName(name).filter((p) => !user || p.user === user);
        if (kind === "process_alive") { if (!alive.length) fail(`Процесс ${name} не работает — а его нужно было оставить.`); else r.ok = true; }
        else if (alive.length) fail(`Процесс ${name} всё ещё работает (PID ${alive.map((p) => p.pid).join(", ")}).`); else r.ok = true;
      } else if (kind === "signal_sent") {
        const ss = c.signal_sent!;
        const want = sigName(ss.signal), before = ss.after ? sigName(ss.after) : null;
        const recs = s.procs.signals.filter((x) => x.to === ss.to);
        const at = recs.findIndex((x) => x.sig === want);
        if (at < 0) fail(`Процессу ${ss.to} не отправлен сигнал ${want}.`);
        else if (before && !recs.slice(0, at).some((x) => x.sig === before)) fail(`Сначала ${ss.to} нужно было вежливо попросить завершиться — ${before}, и только потом ${want}.`);
        else r.ok = true;
      } else if (kind === "last_output_contains") {
        const last = stripAnsi(s.lastOutput());
        const miss = list(c.last_output_contains).find((x) => !last.includes(x));
        if (miss !== undefined) fail(last ? "Последний вывод в терминале — не ответ. Выполните команду, которая печатает ответ, последней." : "В терминале пока ничего не выведено.", undefined, last);
        else r.ok = true;
      } else if (kind === "run") {
        const copy = await s.copy(headlessUI());
        if (c.cwd) copy.cwd = copy.abs(c.cwd);
        copy.env.PWD = copy.cwd;
        const res = await copy.run(c.stdin !== undefined ? `${c.run} <<'__FORGE_STDIN__'\n${c.stdin.replace(/\n$/, "")}\n__FORGE_STDIN__` : c.run!, { record: false, terminal: false });
        const so = stripAnsi(res.stdout), se = stripAnsi(res.stderr);
        const got = so + (se ? (so && !so.endsWith("\n") ? "\n" : "") + se : "");
        const bad =
          c.stdout !== undefined && so !== c.stdout ? "вывод не совпадает" :
          list(c.stdout_contains).some((x) => !so.includes(x)) ? "в выводе нет нужного" :
          c.stderr !== undefined && se !== c.stderr ? "сообщение об ошибке не совпадает" :
          list(c.stderr_contains).some((x) => !se.includes(x)) ? "нет ожидаемого сообщения об ошибке" :
          c.exit_code !== undefined && res.exitCode !== c.exit_code ? `код возврата ${res.exitCode}, а ожидался ${c.exit_code}` : null;
        if (bad) fail(`Проверочная команда «${c.run}»: ${bad}.`, c.stdout ?? c.stderr ?? (list(c.stdout_contains).join("\n") || undefined), got);
        else r.ok = true;
      } else if (kind === "command_used") {
        const want = list(c.command_used);
        if (!want.some((w) => used.has(w))) fail(`Задача решается командой ${want.join(" или ")} — в истории её нет.`); else r.ok = true;
      } else if (kind === "forbid_commands") {
        const hit = c.forbid_commands!.filter((w) => used.has(w));
        if (hit.length) fail(`В этой задаче нельзя пользоваться ${hit.join(", ")} — а вы её применили. Нажмите «Сбросить» и решите иначе.`); else r.ok = true;
      } else fail("Неизвестный вид проверки.");
    } catch (e) {
      fail(`Проверка не выполнилась: ${String((e as Error)?.message ?? e)}`);
    }
    out.push(r);
  }
  return out;
}

/** Runs a reference solution in a fresh session (used by the validator and the tests). */
export async function runSolution(s: ShellSession, steps: SolutionStep[]): Promise<string> {
  let transcript = "";
  for (const st of steps) {
    const step = typeof st === "string" ? { cmd: st } : st;
    s.ui = headlessUI(list(step.input), [...(step.keys ?? [])]);
    const r = await s.run(step.cmd);
    transcript += `$ ${step.cmd}\n${stripAnsi(r.chunks.map((c) => c.text).join(""))}`;
  }
  return transcript;
}
