import { describe, expect, it } from "vitest";
import { headlessUI, ShellSession, type ShellSetup } from "../engine";
import { runChecks } from "../checks";
import { applyMode, rwx } from "../users";
import { validate } from "../headless";
import admin from "./fixtures/sh-sample-admin/task.yaml";
import type { ShellTaskDef } from "../checks";

const SETUP: ShellSetup = {
  files: {
    "notes.txt": "hello\n",
    "secret.txt": { content: "top\n", mode: "600", owner: "anna" },
    "/etc/app.conf": { content: "port=80\n", mode: "644", owner: "root" },
    "/srv/team/plan.txt": { content: "plan\n", mode: "664", owner: "anna", group: "team" },
  },
  dirs: [{ path: "/srv/team", mode: "2775", owner: "anna", group: "team" }],
  processes: [
    { name: "hog", behavior: "busy" },
    { name: "stubborn", behavior: "ignore_term" },
    { name: "cleanup", behavior: "cleanup", file: "state.txt" },
    { name: "logger", behavior: "logger", file: "log.txt" },
    { name: "rootd", user: "root" },
  ],
};
async function sh(setup: ShellSetup = SETUP, answers: string[] = []) { const s = await ShellSession.create(setup); s.ui = headlessUI(answers); return s; }
async function run(s: ShellSession, line: string) {
  const r = await s.run(line, { terminal: false });
  return { out: r.stdout, err: r.stderr, code: r.exitCode };
}

describe("users and the permission rule", () => {
  it("chmod: octal and symbolic, with the umask for +x", () => {
    expect(applyMode("755", 0o644, false)).toBe(0o755);
    expect(applyMode("u+x", 0o644, false)).toBe(0o744);
    expect(applyMode("+x", 0o644, false)).toBe(0o755);
    expect(applyMode("+w", 0o444, false)).toBe(0o644);
    expect(applyMode("go-r", 0o644, false)).toBe(0o600);
    expect(applyMode("u=rwx,g=rx,o=", 0o644, false)).toBe(0o750);
    expect(applyMode("a=r", 0o755, false)).toBe(0o444);
    expect(applyMode("g=u", 0o640, false)).toBe(0o660);
    expect(applyMode("+t", 0o777, true)).toBe(0o1777);
    expect(applyMode("q+z", 0o644, false)).toBeNull();
    expect(rwx(0o1777)).toBe("rwxrwxrwt");
    expect(rwx(0o4755)).toBe("rwsr-xr-x");
  });
  it("whoami, id, groups", async () => {
    const s = await sh();
    expect((await run(s, "whoami")).out).toBe("student\n");
    expect((await run(s, "id")).out).toBe("uid=1000(student) gid=1000(student) groups=1000(student),27(sudo)\n");
    expect((await run(s, "groups; groups anna")).out).toBe("student sudo\nanna : anna team\n");
    expect((await run(s, "id bob")).err).toBe("id: ‘bob’: no such user\n");
    expect((await run(s, "cut -d: -f1 /etc/passwd | tail -2")).out).toBe("student\nanna\n");
  });
  it("read, write and search permissions with GNU and bash messages", async () => {
    const s = await sh();
    expect((await run(s, "cat secret.txt")).err).toBe("cat: secret.txt: Permission denied\n");
    expect((await run(s, "echo x > /etc/app.conf")).err).toBe("bash: /etc/app.conf: Permission denied\n");
    expect((await run(s, "echo x >> /etc/app.conf")).code).toBe(1);
    expect((await run(s, "touch /etc/new")).err).toBe("touch: cannot touch '/etc/new': Permission denied\n");
    expect((await run(s, "mkdir /etc/x")).err).toBe("mkdir: cannot create directory ‘/etc/x’: Permission denied\n");
    expect((await run(s, "ls /root")).err).toBe("ls: cannot open directory '/root': Permission denied\n");
    expect((await run(s, "cd /root")).err).toBe("bash: cd: /root: Permission denied\n");
    expect((await run(s, "head -1 secret.txt")).err).toBe("head: cannot open 'secret.txt' for reading: Permission denied\n");
    expect((await run(s, "grep x secret.txt")).err).toBe("grep: secret.txt: Permission denied\n");
    expect((await run(s, "cp secret.txt copy.txt")).err).toBe("cp: cannot open 'secret.txt' for reading: Permission denied\n");
    expect((await run(s, "cp notes.txt /etc/")).err).toBe("cp: cannot create regular file '/etc/notes.txt': Permission denied\n");
    expect((await run(s, "mv notes.txt /etc/")).err).toBe("mv: cannot move 'notes.txt' to '/etc/notes.txt': Permission denied\n");
    // a folder without x: nothing inside can be reached, even with read permission
    await run(s, "mkdir box && echo in > box/f && chmod 644 box");
    expect((await run(s, "cat box/f")).err).toBe("cat: box/f: Permission denied\n");
    expect((await run(s, "ls box")).out).toBe("f\n");
    expect((await run(s, "ls -l box")).err).toBe("ls: cannot access 'box/f': Permission denied\n");
    await run(s, "chmod 755 box && chmod 000 box/f");
    expect((await run(s, "cat box/f")).err).toBe("cat: box/f: Permission denied\n");
    // removing depends on the folder, not on the file
    expect((await run(s, "rm -f box/f; ls box")).out).toBe("");
  });
  it("the owner changes the mode; only root gives files away; group to one's own group", async () => {
    const s = await sh();
    expect((await run(s, "chmod 700 /etc/app.conf")).err).toBe("chmod: changing permissions of '/etc/app.conf': Operation not permitted\n");
    expect((await run(s, "chmod -v 640 notes.txt")).out).toBe("mode of 'notes.txt' changed from 0644 (rw-r--r--) to 0640 (rw-r-----)\n");
    expect((await run(s, "chmod 9z notes.txt")).err).toBe("chmod: invalid mode: ‘9z’\nTry 'chmod --help' for more information.\n");
    expect((await run(s, "chown anna notes.txt")).err).toBe("chown: changing ownership of 'notes.txt': Operation not permitted\n");
    expect((await run(s, "chown bob notes.txt")).err).toBe("chown: invalid user: ‘bob’\n");
    expect((await run(s, "chgrp sudo notes.txt; stat -c '%U:%G %a' notes.txt")).out).toBe("student:sudo 640\n");
    expect((await run(s, "chgrp team notes.txt")).err).toBe("chgrp: changing group of 'notes.txt': Operation not permitted\n");
    const l = (await run(s, "ls -l /srv/team")).out;
    expect(l).toContain("-rw-rw-r-- 1 anna team");
  });
  it("sticky /tmp: you may not delete someone else's file", async () => {
    const s = await sh({ files: { "/tmp/theirs": { content: "x", owner: "anna" } } });
    expect((await run(s, "rm -f /tmp/theirs")).err).toBe("rm: cannot remove '/tmp/theirs': Operation not permitted\n");
    expect((await run(s, "echo mine > /tmp/mine && rm /tmp/mine && echo ok")).out).toBe("ok\n");
    expect((await run(s, "ls -ld /tmp")).out).toMatch(/^drwxrwxrwt \d+ root root /);
  });
  it("rm asks about a write-protected file", async () => {
    const s = await sh(SETUP, ["n"]);
    await run(s, "chmod 444 notes.txt");
    await run(s, "rm notes.txt");
    expect(await s.fs.exists(s.abs("notes.txt"))).toBe(true);
    await run(s, "rm -f notes.txt");
    expect(await s.fs.exists(s.abs("notes.txt"))).toBe(false);
  });
});

describe("sudo and su", () => {
  it("asks the learner's password, three tries, remembers it", async () => {
    const s = await sh(SETUP, ["bad", "forge"]);
    const r = await run(s, "sudo cat secret.txt");
    expect(r.out).toBe("top\n");
    expect(r.err).toBe("Sorry, try again.\n");
    expect((await run(s, "sudo whoami")).out).toBe("root\n");
    s.ui = headlessUI(["a", "b", "c"]);
    expect((await run(s, "sudo -k; sudo ls")).err).toBe("Sorry, try again.\nSorry, try again.\nsudo: 3 incorrect password attempts\n");
  });
  it("the redirection trap: `sudo echo > file` fails, `| sudo tee` works; root's files stay root's", async () => {
    const s = await sh(SETUP, ["forge"]);
    expect((await run(s, "sudo echo port=8080 > /etc/app.conf")).err).toBe("bash: /etc/app.conf: Permission denied\n");
    await run(s, "echo port=8080 | sudo tee /etc/app.conf > /dev/null");
    expect(await s.fs.readFile("/etc/app.conf")).toBe("port=8080\n");
    const [own] = await runChecks(s, [{ fs_owner: { path: "/etc/app.conf", owner: "root", group: "root" } }]);
    expect(own.ok).toBe(true);
    expect((await run(s, "sudo cd /root")).err).toBe("sudo: cd: command not found\n");
    expect((await run(s, "sudo -u anna whoami")).out).toBe("anna\n");
  });
  it("only the sudo group may sudo", async () => {
    const s = await ShellSession.create({ user: "anna" });
    s.ui = headlessUI(["forge"]);
    expect((await run(s, "sudo ls")).err).toBe("anna is not in the sudoers file.\n");
  });
  it("sudo -i and su open a shell of another user; exit returns", async () => {
    const s = await sh(SETUP, ["forge", "forge"]);
    await run(s, "sudo -i");
    expect(s.euid).toBe("root");
    expect((await run(s, "pwd; cat /home/student/secret.txt")).out).toBe("/root\ntop\n");
    expect((await run(s, "exit")).out).toBe("logout\n");
    expect(s.euid).toBe("student");
    expect((await run(s, "su")).err).toBe("su: Authentication failure\n");
    s.ui = headlessUI(["forge"]);
    await run(s, "su - anna");
    expect((await run(s, "whoami; pwd")).out).toBe("anna\n/home/anna\n");
    await run(s, "exit");
    expect(s.euid).toBe("student");
  });
});

describe("processes and signals", () => {
  it("ps shows the table; kill TERM / KILL; ignore_term needs KILL; others' processes refuse", async () => {
    const s = await sh();
    const aux = (await run(s, "ps aux")).out;
    expect(aux.split("\n")[0]).toBe("USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND");
    expect(aux).toMatch(/student +3001 99\.7 .* R +\S+ +\S+ hog/);
    expect((await run(s, "ps")).out).toMatch(/^ {4}PID TTY {10}TIME CMD\n +2210 pts\/0 +00:00:00 bash\n +\d+ pts\/0 +00:00:00 ps\n$/);
    expect((await run(s, "ps -ef | head -1")).out).toBe("UID          PID    PPID  C STIME TTY          TIME CMD\n");
    expect((await run(s, "pgrep -l hog")).out).toBe("3001 hog\n");
    await run(s, "kill 3001");
    expect((await run(s, "pgrep hog")).code).toBe(1);
    await run(s, "kill 3002");
    expect((await run(s, "pgrep stubborn")).out).toBe("3002\n");
    await run(s, "kill -9 3002");
    expect((await run(s, "pgrep stubborn")).code).toBe(1);
    expect((await run(s, "kill 3005")).err).toBe("bash: kill: (3005) - Operation not permitted\n");
    expect((await run(s, "kill 4242")).err).toBe("bash: kill: (4242) - No such process\n");
    expect((await run(s, "kill -FOO 1")).err).toBe("bash: kill: FOO: invalid signal specification\n");
    expect((await run(s, "kill -l | head -1")).out).toBe(" 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP\n");
    expect((await run(s, "killall nope")).err).toBe("nope: no process found\n");
    const res = await runChecks(s, [{ process_absent: "hog" }, { signal_sent: { to: "stubborn", signal: "KILL", after: "TERM" } }, { process_alive: "logger" }, { signal_sent: { to: "hog", signal: "KILL" } }]);
    expect(res.map((r) => r.ok)).toEqual([true, true, true, false]);
  });
  it("cleanup saves on TERM but not on KILL; logger writes every second", async () => {
    const s = await sh();
    await run(s, "kill -TERM 3003");
    expect(await s.fs.readFile(s.abs("state.txt"))).toBe("saved\n");
    const s2 = await sh();
    await run(s2, "kill -KILL 3003");
    expect(await s2.fs.exists(s2.abs("state.txt"))).toBe(false);
    await run(s2, "sleep 1.1");
    expect((await s2.fs.readFile(s2.abs("log.txt"))).split("\n").length).toBeGreaterThan(1);
  });
  it("jobs: &, $!, jobs, kill %1, Done notices", async () => {
    const s = await sh();
    const r = await run(s, "sleep 30 & echo pid=$!");
    expect(r.out).toMatch(/^\[1\] (\d+)\npid=\1\n$/);
    expect((await run(s, "jobs")).out).toBe("[1]+  Running                 sleep 30 &\n");
    expect((await run(s, "kill %1")).out).toBe("[1]+  Terminated              sleep 30\n");
    await run(s, "sleep 0.2 &");
    expect((await run(s, "sleep 0.4")).out).toBe("[1]+  Done                    sleep 0.2\n");
    expect((await run(s, "fg")).err).toBe("bash: fg: current: no such job\n");
  });
  it("Ctrl+Z stops the foreground program, bg and fg resume it; Ctrl+C gives 130", async () => {
    const s = await sh();
    const p = s.run("sleep 5", { terminal: false });
    await new Promise((res) => setTimeout(res, 50));
    await s.interrupt("TSTP");
    const r = await p;
    expect(r.stdout).toBe("\n[1]+  Stopped                 sleep 5\n");
    expect(r.exitCode).toBe(148);
    expect((await run(s, "jobs")).out).toBe("[1]+  Stopped                 sleep 5\n");
    expect((await run(s, "ps aux | grep 'sleep 5' | grep -c ' T '")).out).toBe("1\n");
    expect((await run(s, "bg")).out).toBe("[1]+ sleep 5 &\n");
    const f = s.run("fg %1", { terminal: false });
    await new Promise((res) => setTimeout(res, 50));
    await s.interrupt("INT");
    const fr = await f;
    expect(fr.stdout).toBe("sleep 5\n");
    expect(fr.exitCode).toBe(130);
    expect((await run(s, "echo $?")).out).toBe("130\n");
  });
});

describe("environment", () => {
  it("a shell variable is not seen by a child process until export", async () => {
    const s = await sh();
    await run(s, "X=1");
    expect((await run(s, "echo $X; bash -c 'echo [$X]'")).out).toBe("1\n[]\n");
    expect((await run(s, "printenv X")).code).toBe(1);
    await run(s, "export X");
    expect((await run(s, "bash -c 'echo [$X]'; printenv X")).out).toBe("[1]\n1\n");
    expect((await run(s, "Y=2 bash -c 'echo $Y'; echo [$Y]")).out).toBe("2\n[]\n");
    await run(s, "unset X");
    expect((await run(s, "echo [$X]")).out).toBe("[]\n");
    expect((await run(s, "env | grep -c OSTYPE")).out).toBe("0\n");
  });
  it("PATH: search left to right, `command not found`, ./prog, which and type", async () => {
    const s = await sh({ files: { "bin/hello": { content: "#!/bin/bash\necho hi from bin\n", mode: "755" }, "tool": { content: "#!/bin/bash\necho local tool\n", mode: "755" } } });
    expect((await run(s, "hello")).err).toBe("bash: hello: command not found\n");
    expect((await run(s, "tool")).code).toBe(127);
    expect((await run(s, "./tool")).out).toBe("local tool\n");
    await run(s, 'export PATH="$PATH:$HOME/bin"');
    expect((await run(s, "hello; which hello; type hello; type cd")).out).toBe("hi from bin\n/home/student/bin/hello\nhello is /home/student/bin/hello\ncd is a shell builtin\n");
    await run(s, "PATH=/nowhere");
    expect((await run(s, "ls")).err).toBe("bash: ls: command not found\n");
  });
  it("aliases and functions live until the window closes; ~/.bashrc gives ll; source runs in this shell", async () => {
    const s = await sh({ files: { "vars.sh": "export GREETING=hello\ncd /tmp\n" } });
    expect((await run(s, "type ll")).out).toBe("ll is aliased to `ls -alF'\n");
    await run(s, "alias hi='echo HI'");
    expect((await run(s, "hi there")).out).toBe("HI there\n");
    await run(s, "greet() { echo \"hello, $1\"; }");
    expect((await run(s, "greet anna")).out).toBe("hello, anna\n");
    await run(s, "source vars.sh");
    expect(s.cwd).toBe("/tmp");
    expect((await run(s, "bash -c 'echo $GREETING'")).out).toBe("hello\n");
    await run(s, "Z=shell-only");
    await s.newWindow();
    expect(s.cwd).toBe("/home/student");
    expect((await run(s, "echo [$Z][$GREETING]; type hi")).out).toBe("[][]\n");
    expect((await run(s, "type ll")).out).toBe("ll is aliased to `ls -alF'\n");
  });
  it("a line added to ~/.bashrc works in a new window", async () => {
    const s = await sh();
    // Ubuntu 24.04 sets no EDITOR; a line in ~/.bashrc takes effect in the next window
    expect((await run(s, "echo [$EDITOR]")).out).toBe("[]\n");
    await run(s, "echo 'export EDITOR=vim' >> ~/.bashrc");
    expect((await run(s, "echo [$EDITOR]")).out).toBe("[]\n");
    await s.newWindow();
    expect((await run(s, "printenv EDITOR")).out).toBe("vim\n");
  });
});

describe("scripts", () => {
  const files = {
    "count.sh": "#!/bin/bash\n# counts lines of each file\nset -euo pipefail\nif [ $# -eq 0 ]; then\n  echo \"usage: $0 FILE...\" >&2\n  exit 2\nfi\nfor f in \"$@\"; do\n  if [[ -f \"$f\" ]]; then\n    n=$(wc -l < \"$f\")\n    echo \"$f: $n\"\n  else\n    echo \"$f: no such file\" >&2\n  fi\ndone\n",
    "a b.txt": "1\n2\n3\n",
    "names.txt": "anna 30\nbob 25\n",
    "kind.sh": "#!/bin/bash\ncase \"$1\" in\n  *.csv) echo table;;\n  *.py|*.sh) echo code;;\n  *) echo other;;\nesac\n",
    "loop.sh": "#!/bin/bash\nwhile read -r name age; do\n  echo \"$name is $(( age + 1 )) next year\"\ndone < names.txt\n",
    "fn.sh": "#!/bin/bash\nsquare() { echo $(( $1 * $1 )); }\nsquare 7\ncd /tmp\nX=inner\n",
    "win.sh": "#!/bin/bash\r\necho hi\r\n",
    "win2.sh": "echo start\r\n\r\ncd /tmp\r\n",
  };
  it("x bit and shebang; ./script vs bash script; $0 $# $@ quoting; exit codes", async () => {
    const s = await sh({ files });
    expect((await run(s, "./count.sh")).err).toBe("bash: ./count.sh: Permission denied\n");
    expect((await run(s, "./count.sh")).code).toBe(126);
    const b = await run(s, "bash count.sh 'a b.txt' missing.txt");
    expect(b.out).toBe("a b.txt: 3\n");
    expect(b.err).toBe("missing.txt: no such file\n");
    await run(s, "chmod +x count.sh");
    expect((await run(s, "./count.sh")).err).toBe("usage: ./count.sh FILE...\n");
    expect((await run(s, "./count.sh; echo $?")).out).toBe("2\n");
    expect((await run(s, "bash kind.sh x.csv; bash kind.sh y.py; bash kind.sh z")).out).toBe("table\ncode\nother\n");
    expect((await run(s, "bash loop.sh")).out).toBe("anna is 31 next year\nbob is 26 next year\n");
  });
  it("a script runs in a child: its cd and variables stay inside; source runs here", async () => {
    const s = await sh({ files });
    expect((await run(s, "bash fn.sh; pwd; echo [$X]")).out).toBe("49\n/home/student\n[]\n");
    await run(s, "source fn.sh");
    expect(s.cwd).toBe("/tmp");
  });
  it("Windows line ends break like in real bash", async () => {
    const s = await sh({ files });
    await run(s, "chmod +x win.sh");
    expect((await run(s, "./win.sh")).err).toBe("bash: ./win.sh: /bin/bash^M: bad interpreter: No such file or directory\n");
    const r = await run(s, "bash win2.sh");
    expect(r.err).toBe("win2.sh: line 2: $'\\r': command not found\nwin2.sh: line 3: cd: $'/tmp\\r': No such file or directory\n");
    expect((await run(s, "cat -A win.sh")).out).toBe("#!/bin/bash^M$\necho hi^M$\n");
  });
  it("set -e stops at the first error, set -u at an unset variable", async () => {
    const s = await sh({ files: { "e.sh": "set -e\nfalse\necho after\n", "u.sh": "set -u\necho $NOPE\necho after\n" } });
    expect((await run(s, "bash e.sh; echo rc=$?")).out).toBe("rc=1\n");
    const u = await run(s, "bash u.sh");
    expect(u.out).toBe("");
    expect(u.err).toContain("NOPE: unbound variable");
  });
});

describe("the sample admin task", () => {
  it("its reference solution passes; nothing done fails", async () => {
    const { results } = await validate({ tasks: [admin as ShellTaskDef] });
    const r = results[0] as { solution: { ok: boolean; name: string; message?: string }[]; starter: { ok: boolean }[] };
    expect(r.solution.filter((c) => !c.ok)).toEqual([]);
    expect(r.starter.some((c) => !c.ok)).toBe(true);
  });
});

describe("interrupts and top", () => {
  it("Ctrl+C stops the whole line; a job stopped, resumed with bg and killed is reported", async () => {
    const s = await sh();
    const p = s.run("sleep 5; echo after", { terminal: false });
    await new Promise((res) => setTimeout(res, 50));
    await s.interrupt("INT");
    expect((await p).stdout).toBe("");
    const z = s.run("sleep 5", { terminal: false });
    await new Promise((res) => setTimeout(res, 50));
    await s.interrupt("TSTP");
    await z;
    await run(s, "bg");
    expect((await run(s, "kill %1")).out).toBe("[1]+  Terminated              sleep 5\n");
  });
  it("top -b prints one screen, busiest first", async () => {
    const s = await sh();
    const lines = (await run(s, "top -b")).out.split("\n");
    expect(lines[0]).toMatch(/^top - \d\d:\d\d:\d\d up 2 days/);
    expect(lines[7]).toMatch(/^ +3001 student .* R +99\.7 .* hog$/);
  });
});
