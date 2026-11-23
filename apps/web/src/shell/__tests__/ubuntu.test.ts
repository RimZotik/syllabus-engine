// Phase 3: regressions for the places where the simulator differed from Ubuntu 24.04 (found by the course authors).
import { describe, expect, it } from "vitest";
import { headlessUI, ShellSession, UBUNTU_PATH, type ShellSetup } from "../engine";
import { Nano } from "../screens";
import { ttyName } from "../commands";

const SETUP: ShellSetup = { files: { "a.csv": "x\n", "b.csv": "y\n", "май.csv": "z\n", "a b.txt": "", "photos/p.jpg": "", "old/x": "" }, processes: [{ name: "hog", behavior: "busy" }] };
async function sh(setup: ShellSetup = SETUP) { const s = await ShellSession.create(setup); s.ui = headlessUI(); return s; }
async function run(s: ShellSession, line: string, terminal = false) {
  const r = await s.run(line, { terminal });
  return { out: r.stdout, err: r.stderr, code: r.exitCode, all: r.chunks.map((c) => (c.fd === 2 ? `!${c.text}` : c.text)).join("") };
}
const strip = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, "");

describe("Ubuntu 24.04 parity", () => {
  it("cp and mv into «dir/» that does not exist: Not a directory, no file is made", async () => {
    const s = await sh();
    expect((await run(s, "cp a.csv nodir/")).err).toBe("cp: cannot create regular file 'nodir/': Not a directory\n");
    expect((await run(s, "mv a.csv nodir/")).err).toBe("mv: cannot move 'a.csv' to 'nodir/': Not a directory\n");
    expect((await run(s, "cp a.csv b.csv/")).err).toBe("cp: failed to access 'b.csv/': Not a directory\n");
    expect(await s.fs.exists(s.abs("nodir"))).toBe(false);
    expect((await run(s, "cp a.csv old/ && ls old")).out).toBe("a.csv\nx\n");
  });
  it("full paths of system commands work with a broken PATH; the helpers stay hidden", async () => {
    const s = await sh();
    await run(s, "export PATH=$HOME/tools/bin");
    expect((await run(s, "ls")).err).toBe("bash: ls: command not found\n");
    expect((await run(s, "/usr/bin/ls -d old; /bin/whoami")).out).toBe("old\nstudent\n");
    await run(s, "export PATH=" + UBUNTU_PATH);
    expect((await run(s, "ls /usr/bin | grep -c __")).out).toBe("0\n");
    expect((await run(s, "ls -l /usr/bin/ls")).out).toMatch(/^-rwxr-xr-x 1 root root /);
  });
  it("the environment of a fresh Ubuntu session: no EDITOR, the long PATH, ls and grep aliased, .profile", async () => {
    const s = await sh();
    expect((await run(s, "echo [$EDITOR][$VISUAL]; echo $PATH")).out).toBe(`[][]\n${UBUNTU_PATH}\n`);
    expect((await run(s, "type ls; type grep")).out).toBe("ls is aliased to `ls --color=auto'\ngrep is aliased to `grep --color=auto'\n");
    expect((await run(s, "ls -A ~ | head -3")).out).toBe(".bash_logout\n.bashrc\n.profile\n");
    expect((await run(s, "grep --color=auto x a.csv")).out).toBe("x\n");
  });
  it("ls on a terminal quotes like GNU: any alphabet as is, spaces and shell characters in quotes, others shifted", () => {
    expect(ttyName("май.csv")).toBe("май.csv");
    expect(ttyName("a b.txt")).toBe("'a b.txt'");
    expect(ttyName("it's")).toBe(`"it's"`);
    expect(ttyName("run\r")).toBe("'run'$'\\r'");
    expect(ttyName("~x")).toBe("'~x'");
    expect(ttyName("a=b,c+d")).toBe("a=b,c+d");
  });
  it("ls columns: a space before unquoted names when some are quoted", async () => {
    const s = await sh({ files: { "notes.txt": "", "a b.txt": "" }, dirs: ["photos"] });
    expect(strip((await run(s, "ls", true)).out)).toBe("'a b.txt'   notes.txt   photos\n".replace("   notes", "   notes"));
    const l = strip((await run(s, "ls -l", true)).out).split("\n");
    expect(l[1]).toMatch(/ 'a b\.txt'$/);
    expect(l[2]).toMatch(/:\d\d  notes\.txt$/);
  });
  it("`*/` matches folders only, with the slash", async () => {
    const s = await sh();
    expect((await run(s, "echo */; ls -d */")).out).toBe("old/ photos/\nold/\nphotos/\n");
    expect((await run(s, "echo p*/ zz*/")).out).toBe("photos/ zz*/\n");
  });
  it("errors before the output: ls reports missing operands first; earlier pipeline stages before the last", async () => {
    const s = await sh();
    expect((await run(s, "ls a.csv nope")).all).toBe("!ls: cannot access 'nope': No such file or directory\na.csv\n");
    expect((await run(s, "cat a.csv nope | wc -l")).all).toBe("!cat: nope: No such file or directory\n1\n");
  });
  it("find with an unquoted pattern that the shell expanded: both findutils messages", async () => {
    const s = await sh();
    expect((await run(s, "find . -name *.csv")).err).toBe("find: paths must precede expression: `b.csv'\nfind: possible unquoted pattern after predicate `-name'?\n");
  });
  it("ps: the grep of the pipeline is listed, every ps has a new PID, VSZ is never below RSS", async () => {
    const s = await sh();
    const lines = (await run(s, "ps aux | grep hog")).out.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toMatch(/ grep --color=auto hog$/);
    const p1 = (await run(s, "ps")).out.split("\n")[2], p2 = (await run(s, "ps")).out.split("\n")[2];
    expect(p1.trim().split(/\s+/)[0]).not.toBe(p2.trim().split(/\s+/)[0]);
    for (const row of (await run(s, "ps aux")).out.trim().split("\n").slice(1)) {
      const c = row.trim().split(/\s+/);
      expect(Number(c[4])).toBeGreaterThanOrEqual(Number(c[5]));
    }
  });
  it("top: a screen every 3 seconds, columns under procps' headings", async () => {
    const s = await sh();
    const lines = (await run(s, "top -b")).out.split("\n");
    const head = strip(lines[6]);
    const row = lines[7];
    expect(row.indexOf("student")).toBe(head.indexOf("USER"));
    expect(row.indexOf("3001") + 4).toBe(head.indexOf("PID") + 3);
    expect(row.indexOf("99.7") + 4).toBe(head.indexOf("%CPU") + 4);
    expect(row.indexOf("hog")).toBe(head.indexOf("COMMAND"));
    let interval = 0;
    s.ui = { ...headlessUI(), screen: async (app) => { interval = app.interval ?? 0; app.done = true; } };
    s.ttyNames = new Set();
    await s.run("top");
    expect(interval).toBe(3000);
  });
  it("python: bash's «command not found» for python3, Ubuntu's hint for python", async () => {
    const s = await sh();
    expect((await run(s, "python3 train.py")).err).toBe("bash: python3: command not found\n");
    const p = await run(s, "python");
    expect(p.err).toBe("Command 'python' not found, did you mean:\n  command 'python3' from deb python3\n  command 'python' from deb python-is-python3\n");
    expect(p.code).toBe(127);
  });
  it("python3 is absent everywhere: type, which, command -v, /usr/bin, scripts", async () => {
    const s = await sh({ files: { "run.sh": "python3 app.py\n" } });
    const t = await run(s, "type python3");
    expect([t.out, t.err, t.code]).toEqual(["", "bash: type: python3: not found\n", 1]);
    expect((await run(s, "command -v python3; echo rc=$?")).out).toBe("rc=1\n");
    expect((await run(s, "which python3; echo rc=$?")).out).toBe("rc=1\n");
    expect((await run(s, "ls /usr/bin/python3")).err).toBe("ls: cannot access '/usr/bin/python3': No such file or directory\n");
    expect((await run(s, "bash run.sh")).err).toBe("run.sh: line 1: python3: command not found\n");
  });
});

describe("nano 7.2 as on Ubuntu 24.04", () => {
  const screen = (n: Nano) => n.render(80, 24).lines.map(strip);
  it("six shortcuts a row at 80 columns", () => {
    const s = screen(new Nano("", "f", "New File", async () => null));
    expect(s[22]).toMatch(/\^C Location/);
    expect(s[23]).toMatch(/\^\/ Go To Line/);
  });
  it("^F and ^B move the cursor (search is ^W or F6), M-Q searches backwards", async () => {
    const n = new Nano("abc\nabc\n", "f", "", async () => null);
    await n.key("C-f");
    expect([n.row, n.col, n.mode]).toEqual([0, 1, "edit"]);
    await n.key("C-b");
    expect(n.col).toBe(0);
    await n.key("F6"); for (const c of "bc") await n.key(c); await n.key("Enter");
    expect([n.row, n.col]).toEqual([0, 1]);
    await n.key("M-w");
    expect([n.row, n.col]).toEqual([1, 1]);
    await n.key("M-q");
    expect([n.row, n.col]).toEqual([0, 1]);
  });
  it("a Windows file: read converted, written back with \\r\\n, [DOS Format] at the name prompt, M-D toggles", async () => {
    const s = await sh({ files: { "w.txt": "one\r\ntwo\r\n" } });
    let shown: string[] = [];
    s.ui = { ...headlessUI(), screen: async (app) => { shown = app.render(80, 24).lines.map(strip); for (const k of ["End", "!", "C-o"]) await app.key(k); shown = app.render(80, 24).lines.map(strip); for (const k of ["Enter", "C-x"]) await app.key(k); } };
    await s.run("nano w.txt");
    expect(shown[21]).toMatch(/^File Name to Write \[DOS Format\]: w\.txt/);
    expect(await s.fs.readFile(s.abs("w.txt"))).toBe("one!\r\ntwo\r\n");
    const n = new Nano("a\r\nb\r\n", "w", "", async () => null);
    await n.key("C-o"); await n.key("M-d");
    expect(screen(n)[21]).toMatch(/^File Name to Write: w/);
    expect(n.text).toBe("a\nb\n");
  });
  it("the status after reading a DOS file", async () => {
    const s = await sh({ files: { "w.txt": "one\r\ntwo\r\n" } });
    let status = "";
    s.ui = { ...headlessUI(), screen: async (app) => { status = strip(app.render(80, 24).lines[21]).trim(); await app.key("C-x"); } };
    await s.run("nano w.txt");
    expect(status).toBe("[ Read 2 lines (Converted from DOS format) ]");
  });
});

describe("C.UTF-8 collation and nano's last line", () => {
  const files = { "b.txt": "", "A.txt": "", "a.txt": "", "B.txt": "", "_x": "", "d/z": "", "D/y": "" };
  it("LANG=C.UTF-8; ls, globs, find and tree in byte order: capitals before small letters", async () => {
    const s = await sh({ files });
    expect((await run(s, "echo $LANG")).out).toBe("C.UTF-8\n");
    expect((await run(s, "echo *")).out).toBe("A.txt B.txt D _x a.txt b.txt d\n");
    expect((await run(s, "ls | tr '\n' ' '")).out).toBe("A.txt B.txt D _x a.txt b.txt d ");
    expect((await run(s, "find . -name '*.txt' | tr '\n' ' '")).out).toBe("./A.txt ./B.txt ./a.txt ./b.txt ");
    expect((await run(s, "tree")).out).toBe(".\n├── A.txt\n├── B.txt\n├── D\n│   └── y\n├── _x\n├── a.txt\n├── b.txt\n└── d\n    └── z\n\n2 directories, 7 files\n");
  });
  it("sort: byte order, -f folds case, -u, -r, -n, -t/-k, -o in place", async () => {
    const s = await sh({ files: { "w.txt": "b\nA\na\nB\n_\n1\n", "p.csv": "x,10\ny,9\nz,100\n" } });
    expect((await run(s, "sort w.txt | tr '\n' ' '")).out).toBe("1 A B _ a b ");
    expect((await run(s, "sort -f w.txt | tr '\n' ' '")).out).toBe("1 A a B b _ ");
    expect((await run(s, "sort -fu w.txt | tr '\n' ' '")).out).toBe("1 A b _ "); // -u keeps the first of equal lines in input order
    expect((await run(s, "sort -r w.txt | tr '\n' ' '")).out).toBe("b a _ B A 1 ");
    expect((await run(s, "sort -t, -k2 -n p.csv")).out).toBe("y,9\nx,10\nz,100\n");
    expect((await run(s, "sort -t, -k2 p.csv")).out).toBe("x,10\nz,100\ny,9\n");
    expect((await run(s, "sort -t, -k2 -nr p.csv | head -1")).out).toBe("z,100\n");
    await run(s, "sort -o w.txt w.txt");
    expect(await s.fs.readFile(s.abs("w.txt"))).toBe("1\nA\nB\n_\na\nb\n");
    expect((await run(s, "sort nope")).err).toBe("sort: cannot read: nope: No such file or directory\n");
    expect((await run(s, "printf 'b\na\nb\n' | sort | uniq -c")).out).toBe("      1 a\n      2 b\n");
  });
  it("nano: an empty line after the last newline; saving keeps exactly one", async () => {
    const saved: string[] = [];
    const n = new Nano("a\nb\n", "f", "", async (_f, b) => { saved.push(b); return null; });
    expect(n.lines).toEqual(["a", "b", ""]);
    for (const k of ["Down", "Down", "n", "e", "w", "C-s"]) await n.key(k);
    expect(saved[0]).toBe("a\nb\nnew\n");
    expect(strip(n.render(80, 24).lines[21]).trim()).toBe("[ Wrote 3 lines ]");
    for (const k of ["Enter", "C-s"]) await n.key(k);
    expect(saved[1]).toBe("a\nb\nnew\n");
    const m = new Nano("no newline", "g", "", async (_f, b) => { saved.push(b); return null; });
    await m.key("C-s");
    expect(saved[2]).toBe("no newline\n");
    const e = new Nano("", "h", "New File", async (_f, b) => { saved.push(b); return null; });
    await e.key("C-s");
    expect(saved[3]).toBe("");
  });
});

describe("engine bugs round 4", () => {
  it("source ~/.bashrc and $HOME/.bashrc register the exports (printenv, child process)", async () => {
    for (const p of ["~/.bashrc", "$HOME/.bashrc", '"$HOME/.bashrc"', "./.bashrc"]) {
      const s = await sh();
      await run(s, "echo 'export VISUAL=nano' >> ~/.bashrc");
      await run(s, `source ${p}`);
      expect((await run(s, "printenv VISUAL")).out, p).toBe("nano\n");
      expect((await run(s, "bash -c 'echo $VISUAL'")).out, p).toBe("nano\n");
    }
  });
  it("export A=1 B=2 and export A B export every name, also from a sourced file", async () => {
    const s = await sh();
    await run(s, "export A=1 B=2 C=3");
    expect((await run(s, "bash -c 'echo $A$B$C'")).out).toBe("123\n");
    await run(s, "X=1; Y=2; export X Y");
    expect((await run(s, "bash -c 'echo $X$Y'")).out).toBe("12\n");
    await run(s, "printf 'export P=1 Q=2\nexport R S=4\nR=r\n' > e.sh; source e.sh");
    expect((await run(s, "bash -c 'echo $P$Q$R$S'")).out).toBe("12r4\n");
  });
  it("a non-executable file found via PATH: Permission denied, 126", async () => {
    const s = await sh();
    await run(s, "mkdir -p ~/bin; printf '#!/bin/bash\necho hi\n' > ~/bin/tool; chmod 644 ~/bin/tool; export PATH=$HOME/bin:$PATH");
    const r = await run(s, "tool");
    expect(r.err).toBe("bash: tool: Permission denied\n");
    expect(r.code).toBe(126);
    await run(s, "chmod +x ~/bin/tool");
    expect((await run(s, "tool")).out).toBe("hi\n");
  });
  it("sudo ./non-exec: sudo's own «command not found», exit 1", async () => {
    const s = await sh();
    await run(s, "printf '#!/bin/bash\necho hi\n' > tool; chmod 644 tool");
    const r = await run(s, "sudo ./tool");
    expect(r.err).toMatch(/sudo: \.\/tool: command not found\n$/);
    expect(r.code).toBe(1);
  });
  it("nano: Down moves onto the empty line after the final newline", async () => {
    const n = new Nano("a\nb\n", "f", "", async () => null);
    for (const k of ["Down", "Down", "Down"]) await n.key(k);
    expect(n.row).toBe(2);
    expect(n.lines[2]).toBe("");
  });
});

describe("engine bugs round 4b", () => {
  it("builtins work with a broken PATH; /usr/bin/ls too; external commands do not", async () => {
    const s = await sh();
    await run(s, "export PATH=/nowhere");
    const r = await run(s, "echo hi; pwd; printf 'x\n'; type cd; cd old; pwd; export Z=1; echo $Z; kill -l >/dev/null; /usr/bin/ls -d .");
    expect(r.err).toBe("");
    expect(r.out).toContain("hi\n");
    expect(r.out).toContain("cd is a shell builtin\n");
    expect(r.out).toContain("/old\n");
    expect(r.out.endsWith(".\n")).toBe(true);
    expect((await run(s, "ls")).err).toBe("bash: ls: command not found\n");
  });
  it("nano: M-\ first line, M-/ last line", async () => {
    const n = new Nano("a\nbcd\nef\n", "f", "", async () => null);
    await n.key("M-/");
    expect([n.row, n.col]).toEqual([3, 0]);
    await n.key("Up"); await n.key("End");
    await n.key("M-\\");
    expect([n.row, n.col]).toEqual([0, 0]);
  });
});

describe("nano save under a different name", () => {
  it("asks «Save file under DIFFERENT NAME? » when the name differs; N returns to the name, Y writes", async () => {
    const saved: [string, string][] = [];
    const n = new Nano("x\n", "a.txt", "", async (f, b) => { saved.push([f, b]); return null; });
    await n.key("C-o");
    for (const k of ["Backspace", "Backspace", "Backspace", "Backspace", "Backspace", "b"]) await n.key(k);
    await n.key("Enter");
    expect(n.mode).toBe("diff?");
    expect(saved).toEqual([]);
    expect(n.render(80, 24).lines.some((l) => l.includes("Save file under DIFFERENT NAME? "))).toBe(true);
    await n.key("n");
    expect(n.mode).toBe("name");
    await n.key("Enter"); await n.key("y");
    expect(saved).toEqual([["b", "x\n"]]);
    await n.key("C-o"); await n.key("Enter");
    expect(saved.length).toBe(2);
  });
  it("same name: no question", async () => {
    const saved: string[] = [];
    const n = new Nano("x\n", "a.txt", "", async (f) => { saved.push(f); return null; });
    await n.key("C-o"); await n.key("Enter");
    expect(saved).toEqual(["a.txt"]);
  });
});

describe("nano OVERWRITE prompt", () => {
  it("a different name that exists asks «File \"x\" exists; OVERWRITE? »; unnamed buffer too; N goes back to the name", async () => {
    const saved: string[] = [];
    const ex = async (f: string) => f === "b";
    const n = new Nano("x\n", "a", "", async (f) => { saved.push(f); return null; }, ex);
    await n.key("C-o"); await n.key("Backspace"); await n.key("b"); await n.key("Enter");
    expect(n.mode).toBe("diff?");
    await n.key("y");
    expect(n.mode).toBe("over?");
    expect(n.render(80, 24).lines.some((l) => l.includes('File "b" exists; OVERWRITE? '))).toBe(true);
    await n.key("n");
    expect(n.mode).toBe("name");
    await n.key("Enter"); await n.key("y");
    expect(saved).toEqual(["b"]);
    const u = new Nano("x\n", "", "", async (f) => { saved.push(f); return null; }, ex);
    await u.key("C-o"); await u.key("b"); await u.key("Enter");
    expect(u.mode).toBe("over?");
    await u.key("y");
    expect(saved).toEqual(["b", "b"]);
  });
});
