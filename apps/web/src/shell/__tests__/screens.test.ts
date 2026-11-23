import { describe, expect, it } from "vitest";
import sample from "./fixtures/sh-sample-backup/task.yaml";
import { headlessUI, ShellSession } from "../engine";
import { runChecks, runSolution, type ShellTaskDef } from "../checks";
import { validate } from "../headless";
import { Nano, Pager, Vim } from "../screens";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const screen = (app: { render(c: number, r: number): { lines: string[] } }) => app.render(80, 24).lines.map(strip);
async function keys(app: { key(k: string): unknown }, ks: string[]) { for (const k of ks) await app.key(k); }
const type = (t: string) => [...t];

describe("nano", () => {
  it("looks like nano: title, status, shortcuts", () => {
    const n = new Nano("hello\n", "a.txt", "Read 1 line", async () => null);
    const s = screen(n);
    expect(s[0]).toMatch(/^ {2}GNU nano 7\.2 +a\.txt +$/);
    expect(s[1]).toBe("hello");
    expect(s[21].trim()).toBe("[ Read 1 line ]");
    expect(s[22]).toMatch(/^\^G Help +\^O Write Out +\^W Where Is +\^K Cut/);
    expect(s[23]).toMatch(/^\^X Exit +\^R Read File/);
  });
  it("^X on a modified buffer asks «Save modified buffer?», Y → file name → Enter saves and exits", async () => {
    const saved: [string, string][] = [];
    const n = new Nano("", "notes.txt", "New File", async (f, b) => { saved.push([f, b]); return null; });
    await keys(n, [...type("line one"), "Enter", ...type("two"), "C-x"]);
    expect(screen(n)[0]).toContain("Modified");
    expect(screen(n)[21]).toMatch(/^Save modified buffer\?/);
    await n.key("y");
    expect(screen(n)[21]).toMatch(/^File Name to Write: notes\.txt/);
    await n.key("Enter");
    expect(saved).toEqual([["notes.txt", "line one\ntwo\n"]]);
    expect(n.done).toBe(true);
  });
  it("^X then N leaves without saving; ^C cancels the question", async () => {
    const saved: string[] = [];
    const n = new Nano("x\n", "f", "", async (_f, b) => { saved.push(b); return null; });
    await keys(n, ["a", "C-x", "C-c"]);
    expect(n.done).toBe(false);
    expect(screen(n)[21].trim()).toBe("[ Cancelled ]");
    await keys(n, ["C-x", "n"]);
    expect(n.done).toBe(true);
    expect(saved).toEqual([]);
  });
  it("^O writes and stays, ^S saves at once, reports «Wrote N lines»", async () => {
    const saved: string[] = [];
    const n = new Nano("a\nb\n", "f.txt", "", async (_f, b) => { saved.push(b); return null; });
    await keys(n, ["End", "1", "C-o", "Enter"]);
    expect(saved).toEqual(["a1\nb\n"]);
    expect(screen(n)[21].trim()).toBe("[ Wrote 2 lines ]");
    expect(n.done).toBe(false);
    await keys(n, ["Down", "2", "C-s"]);
    expect(saved[1]).toBe("a1\nb2\n");
  });
  it("^W (and F6, ^F) search; not found message", async () => {
    const n = new Nano("alpha\nbeta\ngamma beta\n", "f", "", async () => null);
    await keys(n, ["C-w", ...type("beta"), "Enter"]);
    expect([n.row, n.col]).toEqual([1, 0]);
    await keys(n, ["M-w"]);
    expect([n.row, n.col]).toEqual([2, 6]);
    await keys(n, ["F6", ...type("zeta"), "Enter"]);
    expect(screen(n)[21].trim()).toBe('[ "zeta" not found ]');
  });
  it("^K cuts lines (consecutive cuts stack), ^U pastes", async () => {
    const n = new Nano("1\n2\n3\n", "f", "", async () => null);
    await keys(n, ["C-k", "C-k", "C-u", "C-u"]);
    expect(n.text).toBe("1\n2\n1\n2\n3\n");
  });
  it("saving into a missing folder reports nano's error", async () => {
    const n = new Nano("", "nodir/x", "New File", async () => "No such file or directory");
    await keys(n, ["a", "C-s"]);
    expect(screen(n)[21].trim()).toBe("[ Error writing nodir/x: No such file or directory ]");
  });
  it("^G help, M-G go to line, ^C position", async () => {
    const n = new Nano("a\nb\nc\n", "f", "", async () => null);
    await n.key("C-g");
    expect(screen(n)[1].trim()).toBe("Main nano help text");
    await n.key("C-x");
    await keys(n, ["M-g", "3", "Enter"]);
    expect(n.row).toBe(2);
    await n.key("C-c");
    expect(screen(n)[21]).toContain("line 3/4");
  });
  it("runs as a command: the file is written into the session's file system", async () => {
    const s = await ShellSession.create({});
    s.ui = headlessUI([], [...type("port=8080"), "C-o", "Enter", "C-x"]);
    await s.run("nano app.conf");
    expect(await s.fs.readFile(s.abs("app.conf"))).toBe("port=8080\n");
  });
});

describe("less and man", () => {
  const text = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  it("pages with Space and b, G/g, q quits", async () => {
    const p = new Pager(text, "f.txt", false);
    expect(screen(p)[0]).toBe("line 1");
    expect(screen(p)[23]).toBe("f.txt");
    await p.key(" ");
    expect(screen(p)[0]).toBe("line 24");
    expect(screen(p)[23]).toBe(":");
    await p.key("G");
    expect(screen(p)[23]).toBe("(END)");
    await p.key("g");
    expect(screen(p)[0]).toBe("line 1");
    await p.key("q");
    expect(p.done).toBe(true);
  });
  it("/ searches, n repeats, a miss says so", async () => {
    const p = new Pager(text, "", false);
    await keys(p, ["/", ...type("line 3"), "Enter"]);
    expect(screen(p)[0]).toBe("line 3");
    await p.key("n");
    expect(screen(p)[0]).toBe("line 30");
    await keys(p, ["/", ...type("nothing"), "Enter"]);
    expect(screen(p)[23]).toBe("Pattern not found  (press RETURN)");
  });
  it("man shows its own prompt", () => {
    expect(screen(new Pager(text, "Manual page ls(1)", true))[23]).toMatch(/^ Manual page ls\(1\) line 1 \(press h for help or q to quit\)/);
  });
});

describe("vim (how to get out)", () => {
  it(":q with changes refuses, :q! leaves, :wq writes", async () => {
    const saved: string[] = [];
    const v = new Vim("", "f", false, async (b) => { saved.push(b); return null; });
    await keys(v, ["i", ...type("hi"), "Escape", ":", "q", "Enter"]);
    expect(screen(v)[23]).toBe("E37: No write since last change (add ! to override)");
    expect(v.done).toBe(false);
    await keys(v, [":", "w", "q", "Enter"]);
    expect(saved).toEqual(["hi\n"]);
    expect(v.done).toBe(true);
    const v2 = new Vim("x\n", "g", true, async () => null);
    await keys(v2, ["C-c"]);
    expect(screen(v2)[23]).toContain("Type  :qa!  and press <Enter>");
    await keys(v2, ["x", ":", "q", "!", "Enter"]);
    expect(v2.done).toBe(true);
  });
});

describe("checks and the sample task", () => {
  const task = sample as ShellTaskDef;
  it("the reference solution passes every check; an empty start fails some", async () => {
    const { results } = await validate({ tasks: [task] });
    const r = results[0] as { solution: { ok: boolean; name: string }[]; starter: { ok: boolean }[] };
    expect(r.solution.filter((c) => !c.ok)).toEqual([]);
    expect(r.starter.some((c) => !c.ok)).toBe(true);
  });
  it("copying instead of moving fails the forbid check; the trap `sort f > f` fails fs_content", async () => {
    const s = await ShellSession.create(task.setup);
    await runSolution(s, ["mkdir -p archive/2026", "cp reports/*.csv archive/2026/", "rm reports/*.csv", "wc -l < notes/todo.txt > count.txt", "grep срочно notes/todo.txt"]);
    const res = await runChecks(s, task.tests.checks);
    expect(res.filter((c) => !c.ok).map((c) => c.name)).toEqual(["Перенос, а не копирование"]);
    const s2 = await ShellSession.create({ files: { "n.txt": "3\n1\n2\n" } });
    await s2.run("sort n.txt > n.txt");
    const [c] = await runChecks(s2, [{ fs_content: { path: "n.txt", equals: "1\n2\n3\n" } }]);
    expect(c.ok).toBe(false);
    expect(c.message).toBe("Файл «n.txt» пустой.");
  });
  it("last_output_contains looks at the last command that printed something; run works on a copy", async () => {
    const s = await ShellSession.create({ files: { "f.txt": "secret 42\n" } });
    await s.run("grep secret f.txt");
    await s.run("cd /tmp");
    let [c] = await runChecks(s, [{ last_output_contains: "42" }]);
    expect(c.ok).toBe(true);
    await s.run("echo other");
    [c] = await runChecks(s, [{ last_output_contains: "42" }]);
    expect(c.ok).toBe(false);
    [c] = await runChecks(s, [{ run: "rm f.txt && ls", stdout: "" }]);
    expect(c.ok).toBe(true);
    expect(await s.fs.exists(s.abs("f.txt"))).toBe(true);
    [c] = await runChecks(s, [{ run: "cat nope", exit_code: 1, stderr_contains: "No such file" }]);
    expect(c.ok).toBe(true);
  });
});
