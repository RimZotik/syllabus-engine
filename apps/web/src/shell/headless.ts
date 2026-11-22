/**
 * Validator side of shell tasks, run by tools/program/build.py in Node (no bundler: `node headless.ts`).
 * stdin: JSON {tasks: [{id, setup, solution, tests}]} → stdout: JSON {results: [{id, solution, starter, transcript, error}]}.
 * `solution` — the checks after the reference solution (all must pass); `starter` — after no commands at all
 * (at least one must fail, or the task is already solved).
 */
import { ShellSession } from "./engine.ts";
import { runChecks, runSolution, type ShellTaskDef } from "./checks.ts";

// Node globals, declared here: the web app's types do not include Node's
declare const process: { argv: string[]; stdin: AsyncIterable<Uint8Array>; stdout: { write(s: string): void } };

type In = { tasks: Pick<ShellTaskDef, "id" | "setup" | "solution" | "tests">[] };

export async function validate(input: In) {
  const results = [];
  for (const t of input.tasks) {
    try {
      const s = await ShellSession.create(t.setup ?? {});
      const transcript = await runSolution(s, t.solution ?? []);
      const solution = await runChecks(s, t.tests.checks);
      const starter = await runChecks(await ShellSession.create(t.setup ?? {}), t.tests.checks);
      results.push({ id: t.id, solution, starter, transcript });
    } catch (e) {
      results.push({ id: t.id, error: String((e as Error)?.stack ?? e) });
    }
  }
  return { results };
}

const isMain = typeof process !== "undefined" && process.argv[1] && /headless\.ts$/.test(process.argv[1]);
if (isMain) {
  const chunks: Uint8Array[] = [];
  for await (const c of process.stdin) chunks.push(c);
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  const out = await validate(JSON.parse(new TextDecoder().decode(all)));
  process.stdout.write(JSON.stringify(out));
}
