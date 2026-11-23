// Round 5: places where the simulator differed from bash 5.2 / coreutils 9.4 on Ubuntu 24.04 (found by the infra1.scripts authors).
import { describe, expect, it } from "vitest";
import { headlessUI, ShellSession, type ShellSetup } from "../engine";

async function sh(files: ShellSetup["files"] = {}) { const s = await ShellSession.create({ files }); s.ui = headlessUI(); return s; }
async function run(s: ShellSession, line: string) {
  const r = await s.run(line, { terminal: false });
  return { out: r.stdout, err: r.stderr, code: r.exitCode, all: r.chunks.map((c) => (c.fd === 2 ? `!${c.text}` : c.text)).join("") };
}
const X = (content: string) => ({ content, mode: "755" });

describe("round 5: file mode", () => {
  it("sed -i and > keep the mode of an existing file", async () => {
    const s = await sh({ "hello.sh": X("echo hi\r\n"), "n.sh": X("echo n\n") });
    await run(s, "sed -i 's/\r$//' hello.sh");
    expect((await run(s, "ls -l hello.sh")).out).toMatch(/^-rwxr-xr-x /);
    expect((await run(s, "./hello.sh")).out).toBe("hi\n");
    await run(s, "echo 'echo m' > n.sh");
    expect((await run(s, "ls -l n.sh")).out).toMatch(/^-rwxr-xr-x /);
    await run(s, "echo new > fresh.txt");
    expect((await run(s, "ls -l fresh.txt")).out).toMatch(/^-rw-r--r-- /);
  });
});

describe("round 5: messages inside a script carry «script: line N:»", () => {
  const SCRIPT = X("#!/bin/bash\ncd /nope\necho after\nfoo\nif true; then\n  kill 99999\nfi\n");
  it("./a.sh and bash a.sh", async () => {
    const s = await sh({ "a.sh": SCRIPT });
    expect((await run(s, "./a.sh")).err).toBe("./a.sh: line 2: cd: /nope: No such file or directory\n./a.sh: line 4: foo: command not found\n./a.sh: line 6: kill: (99999) - No such process\n");
    expect((await run(s, "bash a.sh")).err).toBe("a.sh: line 2: cd: /nope: No such file or directory\na.sh: line 4: foo: command not found\na.sh: line 6: kill: (99999) - No such process\n");
  });
  it("order of stdout and stderr is kept, $? survives, set -e is not disturbed", async () => {
    const s = await sh({ "b.sh": X("set -e\n[ -e nope ] && echo y\necho one\nfalse || echo $?\nls nope\necho not-here\n") });
    const r = await run(s, "./b.sh");
    expect(r.all).toBe("one\n1\n!ls: cannot access 'nope': No such file or directory\n");
    expect(r.code).toBe(2);
  });
  it("set -u: unbound variable; arguments reach the script", async () => {
    const s = await sh({ "c.sh": X("#!/bin/bash\nset -u\necho \"$1\"\necho $fiel\n") });
    const r = await run(s, "./c.sh a");
    expect(r.out).toBe("a\n");
    expect(r.err).toBe("./c.sh: line 4: fiel: unbound variable\n");
    expect(r.code).toBe(1);
  });
  it("heredocs, functions and loops survive; the interactive prompt keeps «bash:»", async () => {
    const s = await sh({ "d.sh": X("f() {\n  cd /nope\n}\ncat <<EOF\nline $((1+1))\nEOF\nfor i in 1 2; do\n  echo $i\ndone\nf\n") });
    const r = await run(s, "./d.sh");
    expect(r.out).toBe("line 2\n1\n2\n");
    expect(r.err).toBe("./d.sh: line 2: cd: /nope: No such file or directory\n");
    expect((await run(s, "cd /nope")).err).toBe("bash: cd: /nope: No such file or directory\n");
  });
});

describe("round 5: [ and test", () => {
  it("messages as in bash", async () => {
    const s = await sh();
    expect((await run(s, "[ a b c ]")).err).toBe("bash: [: too many arguments\n");
    expect((await run(s, "test a b c")).err).toBe("bash: test: too many arguments\n");
    expect((await run(s, "x=; [ $x = 1 ]; echo $?")).all).toBe("!bash: [: =: unary operator expected\n2\n");
    expect((await run(s, "[ 5 -eq abc ]; echo $?")).all).toBe("!bash: [: abc: integer expression expected\n2\n");
    expect((await run(s, "x=; [ \"$x\" -gt 3 ]; echo $?")).all).toBe("!bash: [: : integer expression expected\n2\n");
    expect((await run(s, "[ 5 -eq 5 ] && echo ok; [ 3 -lt 2 ]; echo $?; test -z '' && echo z")).all).toBe("ok\n1\nz\n");
  });
  it("inside a script", async () => {
    const s = await sh({ "s.sh": X("x=\nif [ $x = 1 ]; then echo a; fi\ntest $x -gt 3\necho done\n") });
    expect((await run(s, "./s.sh")).all).toBe("!./s.sh: line 2: [: =: unary operator expected\n!./s.sh: line 3: test: -gt: unary operator expected\ndone\n");
  });
  it("which [ and ls /usr/bin/[", async () => {
    const s = await sh();
    expect((await run(s, "which [ test")).out).toBe("/usr/bin/[\n/usr/bin/test\n");
    expect((await run(s, "ls /usr/bin/[")).out).toBe("/usr/bin/[\n");
  });
});

describe("round 5: stderr inside $(...)", () => {
  it("is not lost in a script", async () => {
    const s = await sh({ "g.sh": X("n=$(grep -c ERROR \"nope/*.log\" || true)\necho \"[$n]\"\n") });
    const r = await run(s, "./g.sh");
    expect(r.all).toBe("!grep: nope/*.log: No such file or directory" + String.fromCharCode(10) + "[]" + String.fromCharCode(10));
  });
});

describe("round 5: file names in coreutils messages", () => {
  it("wc, cat, sort, cut quote names with special characters like GNU", async () => {
    const s = await sh();
    expect((await run(s, "wc empty/*.csv")).err).toBe("wc: 'empty/*.csv': No such file or directory\n");
    expect((await run(s, "wc 'a b' plain")).err).toBe("wc: 'a b': No such file or directory\nwc: plain: No such file or directory\n");
    expect((await run(s, "cat 'a b'")).err).toBe("cat: 'a b': No such file or directory\n");
    expect((await run(s, "sort 'a b'")).err).toBe("sort: cannot read: 'a b': No such file or directory\n");
    expect((await run(s, "cut -c1 'a b'")).err).toBe("cut: 'a b': No such file or directory\n");
  });
});

describe("round 5: bash -x", () => {
  it("prints the commands with a plus, after expansion", async () => {
    const s = await sh({ "t.sh": X("x=3\necho \"a b\" $x\nif [ $x -gt 1 ]; then\n  echo big\nfi\n") });
    const r = await run(s, "bash -x t.sh");
    expect(r.all).toBe("!+ x=3\n!+ echo 'a b' 3\na b 3\n!+ '[' 3 -gt 1 ']'\n+ echo big\nbig\n");
  });
});

describe("round 5: ls inside $(...) is not a terminal", () => {
  it("names with spaces are not quoted and split into words, as in the lesson", async () => {
    const s = await sh({ "data/a b.csv": "x\n", "data/c.csv": "y\n" });
    const r = await s.run("for f in $(ls data); do wc -l \"data/$f\"; done", { terminal: true });
    expect(r.stderr).toBe("wc: data/a: No such file or directory\nwc: data/b.csv: No such file or directory\n");
    expect(r.stdout).toBe("1 data/c.csv\n");
  });
});
