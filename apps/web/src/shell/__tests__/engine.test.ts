import { describe, expect, it } from "vitest";
import { headlessUI, ShellSession, type ShellSetup } from "../engine";

const FILES: ShellSetup = {
  files: { "a.txt": "b\na\nb\n", "B.TXT": "Hi there\nhi\n", ".hidden": "x\n", "d/x.log": "q\n", "my file.txt": "пробел\n", "ru.txt": "привет мир\n" },
};
async function sh(setup: ShellSetup = FILES) { return ShellSession.create(setup); }
/** stdout and stderr of one line, plus the order they reached the terminal */
async function run(s: ShellSession, line: string) {
  const r = await s.run(line, { terminal: false });
  return { out: r.stdout, err: r.stderr, code: r.exitCode, all: r.chunks.map((c) => (c.fd === 2 ? `!${c.text}` : c.text)).join("") };
}

describe("redirection", () => {
  it("`>` empties the file before the command runs (sort f > f)", async () => {
    const s = await sh();
    await run(s, "sort a.txt > a.txt");
    expect(await s.fs.readFile(s.abs("a.txt"))).toBe("");
  });
  it("`>>` appends, `2>` takes only errors, `2>&1` after `>` merges, order matters", async () => {
    const s = await sh();
    await run(s, "echo one > f; echo two >> f");
    expect(await s.fs.readFile(s.abs("f"))).toBe("one\ntwo\n");
    let r = await run(s, "ls a.txt nope 2> err.txt");
    expect(r.out).toBe("a.txt\n");
    expect(await s.fs.readFile(s.abs("err.txt"))).toBe("ls: cannot access 'nope': No such file or directory\n");
    await run(s, "ls a.txt nope > both.txt 2>&1");
    expect(await s.fs.readFile(s.abs("both.txt"))).toContain("No such file");
    r = await run(s, "ls nope 2>&1 > only-out.txt");
    expect(r.out).toContain("cannot access");
    expect(await s.fs.readFile(s.abs("only-out.txt"))).toBe("");
  });
  it("/dev/null swallows output; `<` reads a file; a missing folder is an error", async () => {
    const s = await sh();
    expect((await run(s, "ls nope 2>/dev/null")).err).toBe("");
    expect((await run(s, "wc -l < a.txt")).out).toBe("3\n");
    const r = await run(s, "echo hi > nodir/x");
    expect(r.err).toBe("bash: nodir/x: No such file or directory\n");
    expect(r.code).toBe(1);
    expect((await run(s, "echo hi > d")).err).toBe("bash: d: Is a directory\n");
    expect((await s.fs.stat(s.abs("d"))).isDirectory).toBe(true);
  });
});

describe("exit codes and lists", () => {
  it("&&, || and $? follow exit codes", async () => {
    const s = await sh();
    expect((await run(s, "ls nope && echo yes || echo no")).out).toBe("no\n");
    expect((await run(s, "ls nope; echo $?")).out).toBe("2\n");
    expect((await run(s, "grep zzz a.txt; echo $?")).out).toBe("1\n");
    expect((await run(s, "true && echo ok")).out).toBe("ok\n");
    await run(s, "false");
    expect((await run(s, "echo $?")).out).toBe("1\n");
  });
  it("stdout and stderr reach the terminal in the real order", async () => {
    const s = await sh();
    expect((await run(s, "echo one; ls nope; echo two")).all).toBe("one\n!ls: cannot access 'nope': No such file or directory\ntwo\n");
    expect((await run(s, "cat a.txt nope")).all).toBe("b\na\nb\n!cat: nope: No such file or directory\n");
  });
  it("unknown command: 127", async () => {
    const s = await sh();
    const r = await run(s, "lss");
    expect(r.code).toBe(127);
    expect(r.err).toContain("lss: command not found");
  });
});

describe("globbing and quotes", () => {
  it("* skips hidden files, ? and [ab] work, no match stays literal", async () => {
    const s = await sh();
    expect((await run(s, "echo *.txt")).out).toBe("a.txt my file.txt ru.txt\n");
    expect((await run(s, "echo ?.txt [aB]*")).out).toBe("a.txt B.TXT a.txt\n");
    const r = await run(s, "ls *.zzz");
    expect(r.err).toBe("ls: cannot access '*.zzz': No such file or directory\n");
    expect(r.code).toBe(2);
  });
  it("quotes: single keep everything, double expand variables, backslash escapes", async () => {
    const s = await sh();
    expect((await run(s, `echo '$HOME' "$HOME" \\$HOME "*"`)).out).toBe("$HOME /home/student $HOME *\n");
    expect((await run(s, "cat 'my file.txt'")).out).toBe("пробел\n");
    expect((await run(s, "cat my\\ file.txt")).out).toBe("пробел\n");
    expect((await run(s, "cat my file.txt")).err).toBe("cat: my: No such file or directory\ncat: file.txt: No such file or directory\n");
  });
});

describe("files and folders (GNU wording)", () => {
  it("cd and pwd keep the folder between lines; cd - and cd", async () => {
    const s = await sh();
    await run(s, "cd d");
    expect((await run(s, "pwd")).out).toBe("/home/student/d\n");
    expect((await run(s, "cd -")).out).toBe("/home/student\n");
    await run(s, "cd /tmp"); await run(s, "cd");
    expect(s.cwd).toBe("/home/student");
    expect((await run(s, "cd nope")).err).toBe("bash: cd: nope: No such file or directory\n");
  });
  it("ls: files first, then folders with headers; -a; -l", async () => {
    const s = await sh();
    expect((await run(s, "ls")).out).toBe("B.TXT\na.txt\nd\nmy file.txt\nru.txt\n");
    expect((await run(s, "ls d a.txt")).out).toBe("a.txt\n\nd:\nx.log\n");
    expect((await run(s, "ls -a d")).out).toBe(".\n..\nx.log\n");
    const l = (await run(s, "ls -l")).out.split("\n");
    expect(l[0]).toBe("total 20");
    expect(l[1]).toMatch(/^-rw-r--r-- 1 student student +12 \w{3} [ \d]\d \d\d:\d\d B\.TXT$/);
    expect(l.find((x) => x.endsWith(" d"))).toMatch(/^drwxr-xr-x 2 student student 4096 /);
  });
  it("ls in the terminal: columns and colours", async () => {
    const s = await sh();
    const r = await s.run("ls");
    expect(r.stdout).toContain("\x1b[01;34md\x1b[0m");
    expect(r.stdout).toContain("'my file.txt'");
    expect(r.stdout.split("\n").length).toBe(2);
  });
  it("mkdir, touch, rmdir, rm messages", async () => {
    const s = await sh();
    expect((await run(s, "mkdir d")).err).toBe("mkdir: cannot create directory ‘d’: File exists\n");
    expect((await run(s, "mkdir x/y")).err).toBe("mkdir: cannot create directory ‘x/y’: No such file or directory\n");
    expect((await run(s, "mkdir -pv x/y")).out).toBe("mkdir: created directory 'x'\nmkdir: created directory 'x/y'\n");
    expect((await run(s, "touch zz/q")).err).toBe("touch: cannot touch 'zz/q': No such file or directory\n");
    expect((await run(s, "rmdir d")).err).toBe("rmdir: failed to remove 'd': Directory not empty\n");
    expect((await run(s, "rm d")).err).toBe("rm: cannot remove 'd': Is a directory\n");
    expect((await run(s, "rm nope")).err).toBe("rm: cannot remove 'nope': No such file or directory\n");
    expect((await run(s, "rm -f nope")).code).toBe(0);
    expect((await run(s, "rm -rv d")).out).toBe("removed 'd/x.log'\nremoved directory 'd'\n");
    expect((await run(s, "rm")).err).toBe("rm: missing operand\nTry 'rm --help' for more information.\n");
  });
  it("cp and mv: -r, -v, into a folder, errors", async () => {
    const s = await sh();
    expect((await run(s, "cp d e")).err).toBe("cp: -r not specified; omitting directory 'd'\n");
    expect((await run(s, "cp -rv d e")).out).toBe("'d' -> 'e'\n'd/x.log' -> 'e/x.log'\n");
    expect((await run(s, "cp a.txt nodir/a")).err).toBe("cp: cannot create regular file 'nodir/a': No such file or directory\n");
    expect((await run(s, "cp nope x")).err).toBe("cp: cannot stat 'nope': No such file or directory\n");
    expect((await run(s, "mv -v a.txt d")).out).toBe("renamed 'a.txt' -> 'd/a.txt'\n");
    expect((await run(s, "mv d d/inner")).err).toBe("mv: cannot move 'd' to a subdirectory of itself, 'd/inner/d'\n".replace("/inner/d", "/inner"));
    expect((await run(s, "cp B.TXT ru.txt d")).code).toBe(0);
    expect((await run(s, "cp B.TXT ru.txt nofolder")).err).toBe("cp: target 'nofolder': No such file or directory\n");
  });
  it("-i asks (answers from the terminal or a pipe)", async () => {
    const s = await sh();
    s.ui = headlessUI(["n"]);
    await run(s, "rm -i a.txt");
    expect(await s.fs.exists(s.abs("a.txt"))).toBe(true);
    s.ui = headlessUI(["y"]);
    await run(s, "rm -i a.txt");
    expect(await s.fs.exists(s.abs("a.txt"))).toBe(false);
    const r = await run(s, "echo n | cp -i B.TXT ru.txt");
    expect(r.err).toBe("cp: overwrite 'ru.txt'? ");
    expect(await s.fs.readFile(s.abs("ru.txt"))).toBe("привет мир\n");
  });
  it("cat -n, head, tail", async () => {
    const s = await sh();
    expect((await run(s, "cat -n a.txt")).out).toBe("     1\tb\n     2\ta\n     3\tb\n");
    expect((await run(s, "cat d")).err).toBe("cat: d: Is a directory\n");
    expect((await run(s, "head -n 2 a.txt")).out).toBe("b\na\n");
    expect((await run(s, "head -1 a.txt")).out).toBe("b\n");
    expect((await run(s, "tail -n 1 a.txt")).out).toBe("b\n");
    expect((await run(s, "tail -n +2 a.txt")).out).toBe("a\nb\n");
    expect((await run(s, "head nope")).err).toBe("head: cannot open 'nope' for reading: No such file or directory\n");
    expect((await run(s, "head -n 1 a.txt B.TXT")).out).toBe("==> a.txt <==\nb\n\n==> B.TXT <==\nHi there\n");
  });
});

describe("pipes and text tools", () => {
  it("wc widths as in GNU", async () => {
    const s = await sh();
    expect((await run(s, "wc a.txt")).out).toBe("3 3 6 a.txt\n");
    expect((await run(s, "wc -l a.txt B.TXT")).out).toBe(" 3 a.txt\n 2 B.TXT\n 5 total\n");
    expect((await run(s, "cat a.txt | wc")).out).toBe("      3       3       6\n");
    expect((await run(s, "cat a.txt | wc -l")).out).toBe("3\n");
    expect((await run(s, "wc -c ru.txt; wc -m ru.txt")).out).toBe("20 ru.txt\n11 ru.txt\n");
  });
  it("sort | uniq -c | sort -rn — frequencies", async () => {
    const s = await sh();
    expect((await run(s, "sort a.txt | uniq -c | sort -rn")).out).toBe("      2 b\n      1 a\n");
    expect((await run(s, "uniq a.txt")).out).toBe("b\na\nb\n");
    expect((await run(s, "printf '10\\n9\\n100\\n' | sort -n")).out).toBe("9\n10\n100\n");
    expect((await run(s, "printf '10\\n9\\n100\\n' | sort")).out).toBe("10\n100\n9\n");
    expect((await run(s, "printf 'x,3\\ny,1\\n' | sort -t, -k2 -n")).out).toBe("y,1\nx,3\n");
    expect((await run(s, "sort nope")).err).toBe("sort: cannot read: nope: No such file or directory\n");
  });
  it("grep flags", async () => {
    const s = await sh();
    expect((await run(s, "grep -i hi B.TXT")).out).toBe("Hi there\nhi\n");
    expect((await run(s, "grep -w hi B.TXT")).out).toBe("hi\n");
    expect((await run(s, "grep -c b a.txt")).out).toBe("2\n");
    expect((await run(s, "grep -n b a.txt")).out).toBe("1:b\n3:b\n");
    expect((await run(s, "grep -v b a.txt")).out).toBe("a\n");
    expect((await run(s, "grep -o 'h[a-z]*' B.TXT")).out).toBe("here\nhi\n");
    expect((await run(s, "grep -E 'a|q' a.txt d/x.log")).out).toBe("a.txt:a\nd/x.log:q\n");
    expect((await run(s, "grep -r q .")).out).toBe("./d/x.log:q\n");
    expect((await run(s, "grep -rn q")).out).toBe("d/x.log:1:q\n");
    expect((await run(s, "grep привет ru.txt")).out).toBe("привет мир\n");
  });
  it("find flags", async () => {
    const s = await sh();
    expect((await run(s, "find . -name '*.log'")).out).toBe("./d/x.log\n");
    expect((await run(s, "find . -iname 'b.*'")).out).toBe("./B.TXT\n");
    expect((await run(s, "find . -type d")).out).toBe(".\n./d\n");
    expect((await run(s, "find . -name '*.log' -exec cat {} \\;")).out).toBe("q\n");
    expect((await run(s, "find nope")).err).toBe("find: ‘nope’: No such file or directory\n");
  });
  it("cut, tee, head in a pipeline", async () => {
    const s = await sh({ files: { "p.csv": "id,name\n1,ann\n2,bob\n" } });
    expect((await run(s, "cut -d, -f2 p.csv | tail -n +2")).out).toBe("ann\nbob\n");
    expect((await run(s, "cut -d, -f1 p.csv | tee ids.txt | wc -l")).out).toBe("3\n");
    expect(await s.fs.readFile(s.abs("ids.txt"))).toBe("id\n1\n2\n");
    expect((await run(s, "echo x | tee nodir/f")).err).toBe("tee: nodir/f: No such file or directory\n");
  });
});

describe("terminal programs", () => {
  it("history numbers lines, ignores a leading space and repeats", async () => {
    const s = await sh();
    await s.run("ls"); await s.run("ls"); await s.run(" secret"); await s.run("pwd");
    expect((await run(s, "history")).out).toBe("    1  ls\n    2  pwd\n    3  history\n");
  });
  it("man and --help are Russian", async () => {
    const s = await sh();
    expect((await run(s, "man ls")).out).toContain("ИМЯ\n       ls — показать содержимое папки");
    expect((await run(s, "grep --help")).out).toContain("Использование: grep");
    expect((await run(s, "man nosuch")).err).toBe("No manual entry for nosuch\n");
  });
  it("the commands a line used are recorded (by meaning, not by text)", async () => {
    const s = await sh();
    await s.run("cat a.txt | sort | \\uniq -c > out.txt && /bin/rm out.txt");
    expect(s.log[0].commands).toEqual(["cat", "sort", "uniq", "rm"]);
  });
  it("state survives a save and restore; a copy does not touch the original", async () => {
    const s = await sh();
    await s.run("mkdir new && cd new && echo hi > f");
    const st = await s.state();
    const s2 = await ShellSession.restore(FILES, JSON.parse(JSON.stringify(st)));
    expect(s2.cwd).toBe("/home/student/new");
    expect(await s2.fs.readFile("/home/student/new/f")).toBe("hi\n");
    const c = await s2.copy();
    await c.run("rm -r /home/student/new");
    expect(await s2.fs.exists("/home/student/new/f")).toBe(true);
  });
});
