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
    expect((await run(s, "bash run.sh")).err).toBe("bash: python3: command not found\n");
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
