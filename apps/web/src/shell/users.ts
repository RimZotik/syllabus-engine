/**
 * Users, groups and the permission rule of the simulator (phase 2). The machine has root, the learner
 * (`student`: groups student, sudo) and `anna` (groups anna, team); a task adds users and groups in `setup.users`.
 * The rule is POSIX's: the owner's bits if you own the file, else the group's if you are in its group, else
 * the others'; root reads and writes anything and executes a file if any x bit is set.
 */
export type User = { name: string; uid: number; groups: string[]; home: string; password: string; shell: string };
export type UserSpec = { uid?: number; groups?: string[]; password?: string; home?: string };

const BASE_GROUPS: [string, number][] = [["root", 0], ["adm", 4], ["sudo", 27], ["shadow", 42], ["users", 100], ["student", 1000], ["anna", 1001], ["team", 1100]];

export class Users {
  users = new Map<string, User>();
  groups = new Map<string, number>();

  constructor(spec: Record<string, UserSpec> = {}, login = "student") {
    for (const [g, id] of BASE_GROUPS) this.groups.set(g, id);
    this.add("root", { uid: 0, groups: ["root"], home: "/root" });
    this.add("student", { uid: 1000, groups: ["student", "sudo"] });
    this.add("anna", { uid: 1001, groups: ["anna", "team"] });
    if (!this.users.has(login)) this.add(login, {});
    for (const [name, s] of Object.entries(spec)) this.add(name, s);
  }

  add(name: string, s: UserSpec) {
    const old = this.users.get(name);
    const uid = s.uid ?? old?.uid ?? Math.max(1000, ...[...this.users.values()].map((u) => u.uid)) + 1;
    if (!this.groups.has(name)) this.groups.set(name, uid);
    const groups = [name === "root" ? "root" : name, ...(s.groups ?? old?.groups ?? []).filter((g) => g !== name)];
    for (const g of groups) if (!this.groups.has(g)) this.groups.set(g, Math.max(1100, ...this.groups.values()) + 1);
    this.users.set(name, { name, uid, groups, home: s.home ?? old?.home ?? (name === "root" ? "/root" : `/home/${name}`), password: s.password ?? old?.password ?? (name === "root" ? "" : "forge"), shell: "/bin/bash" });
  }

  get(name: string) { return this.users.get(name); }
  byUid(uid: number) { return [...this.users.values()].find((u) => u.uid === uid); }
  gid(group: string) { return this.groups.get(group); }
  primary(user: string) { return this.users.get(user)?.groups[0] ?? user; }
  inGroup(user: string, group: string) { return !!this.users.get(user)?.groups.includes(group); }
  members(group: string) { return [...this.users.values()].filter((u) => u.groups.includes(group) && u.groups[0] !== group).map((u) => u.name); }

  /** /etc/passwd and /etc/group as on Ubuntu (a short version). */
  passwd() {
    const sys = "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n";
    const rows = [...this.users.values()].sort((a, b) => a.uid - b.uid).map((u) => `${u.name}:x:${u.uid}:${this.gid(u.groups[0])}:${u.name === "root" ? "root" : `${u.name},,,`}:${u.home}:${u.shell}\n`);
    return rows[0] + sys + rows.slice(1).join("");
  }
  group() {
    return [...this.groups.entries()].sort((a, b) => a[1] - b[1]).map(([g, id]) => `${g}:x:${id}:${this.members(g).join(",")}\n`).join("");
  }
}

/** May `user` have access `want` (4 read, 2 write, 1 execute/search) to an entry with this mode and owner? */
export function allowed(users: Users, user: string, mode: number, owner: string, group: string, want: number, isDir: boolean): boolean {
  const u = users.get(user);
  if (!u) return false;
  if (u.uid === 0) return want !== 1 || isDir || (mode & 0o111) !== 0;
  const bits = owner === user ? (mode >> 6) & 7 : u.groups.includes(group) ? (mode >> 3) & 7 : mode & 7;
  return (bits & want) === want;
}

/** rwxr-xr-x for a mode, with s/S and t/T where set. */
export function rwx(mode: number) {
  const b = (m: number, c: string) => (mode & m ? c : "-");
  let s = b(0o400, "r") + b(0o200, "w") + b(0o100, "x") + b(0o40, "r") + b(0o20, "w") + b(0o10, "x") + b(0o4, "r") + b(0o2, "w") + b(0o1, "x");
  const set = (i: number, bit: number, on: string, off: string) => { if (mode & bit) s = s.slice(0, i) + (s[i] === "x" ? on : off) + s.slice(i + 1); };
  set(2, 0o4000, "s", "S"); set(5, 0o2000, "s", "S"); set(8, 0o1000, "t", "T");
  return s;
}

/**
 * Applies a chmod mode (octal or symbolic: `u+x`, `go-w`, `a=r`, `+x`, `u=rwx,g=rx,o=`) to `mode`.
 * Without u/g/o/a the umask's bits are left alone, as in GNU chmod. Returns null for an invalid mode.
 */
export function applyMode(spec: string, mode: number, isDir: boolean, umask = 0o022): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) {
    const n = parseInt(spec, 8);
    // GNU keeps a directory's setuid/setgid bits unless 4 or 5 digits are given
    return spec.length <= 3 && isDir ? (mode & 0o6000) | n : n;
  }
  let m = mode & 0o7777;
  for (const clause of spec.split(",")) {
    const cm = /^([ugoa]*)((?:[-+=](?:[ugo]|[rwxXst]*))+)$/.exec(clause);
    if (!cm) return null;
    const who = cm[1] || "";
    const mask = who === "" ? ~umask & 0o7777 : 0o7777;
    const whoBits = (who === "" || who.includes("a") ? "ugo" : who);
    for (const op of cm[2].match(/[-+=](?:[ugo]|[rwxXst]*)/g) ?? []) {
      const sign = op[0], perms = op.slice(1);
      let bits = 0;
      if (/^[ugo]$/.test(perms)) {
        const src = perms === "u" ? (m >> 6) & 7 : perms === "g" ? (m >> 3) & 7 : m & 7;
        for (const w of whoBits) bits |= src << (w === "u" ? 6 : w === "g" ? 3 : 0);
      } else {
        for (const w of whoBits) {
          const sh = w === "u" ? 6 : w === "g" ? 3 : 0;
          for (const p of perms) {
            if (p === "r") bits |= 4 << sh;
            else if (p === "w") bits |= 2 << sh;
            else if (p === "x") bits |= 1 << sh;
            else if (p === "X" && (isDir || m & 0o111)) bits |= 1 << sh;
            else if (p === "s") bits |= w === "u" ? 0o4000 : w === "g" ? 0o2000 : 0;
            else if (p === "t") bits |= w === "o" || who === "" || who.includes("a") ? 0o1000 : 0;
          }
        }
      }
      bits &= mask;
      if (sign === "+") m |= bits;
      else if (sign === "-") m &= ~bits;
      else {
        let clear = 0;
        for (const w of whoBits) clear |= 7 << (w === "u" ? 6 : w === "g" ? 3 : 0);
        m = (m & ~(clear & mask)) | bits;
      }
    }
  }
  return m;
}
