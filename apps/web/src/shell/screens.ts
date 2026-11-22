/**
 * Full-screen programs of the simulator: nano (the editor of the course), less (the pager, also man's) and a
 * minimal vim — only enough to learn how to get out of it. Pure logic: keys in, screen rows out; the terminal
 * (Terminal.tsx) maps keyboard input to key names and draws the rows. Keys: a printable character, "Enter",
 * "Backspace", "Delete", "Tab", "Escape", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
 * "C-x" (Ctrl+X), "M-g" (Alt+G), "F1"…"F12".
 */
import type { ScreenApp } from "./engine.ts";

const INV = "\x1b[7m", OFF = "\x1b[0m", BOLD = "\x1b[1m";
const TAB = 8;

/** Display width of a line with tabs expanded (one cell per character — enough for Latin and Cyrillic). */
function expand(line: string): string {
  let out = "";
  for (const ch of line) out += ch === "\t" ? " ".repeat(TAB - (out.length % TAB)) : ch;
  return out;
}
const xOf = (line: string, col: number) => expand(line.slice(0, col)).length;
const fit = (s: string, w: number) => (s.length > w ? s.slice(0, w) : s + " ".repeat(w - s.length));

/** Shortcut rows at the bottom of nano: «^G» in inverse, then the label, items in equal columns. */
function shortcutRows(rows: [string, string][][], cols: number): string[] {
  return rows.map((items) => {
    // nano 7.2: six shortcuts a row on an 80-column terminal
    const n = Math.max(1, Math.min(items.length, Math.floor(cols / 13)));
    const w = Math.floor(cols / n);
    let line = "";
    for (const [k, label] of items.slice(0, n)) line += INV + k + OFF + " " + fit(label, Math.max(0, w - k.length - 1));
    return line;
  });
}

const EDIT_KEYS: [string, string][][] = [
  [["^G", "Help"], ["^O", "Write Out"], ["^W", "Where Is"], ["^K", "Cut"], ["^T", "Execute"], ["^C", "Location"], ["M-U", "Undo"], ["M-A", "Set Mark"], ["M-]", "To Bracket"], ["M-Q", "Previous"]],
  [["^X", "Exit"], ["^R", "Read File"], ["^\\", "Replace"], ["^U", "Paste"], ["^J", "Justify"], ["^/", "Go To Line"], ["M-E", "Redo"], ["M-6", "Copy"], ["^B", "Where Was"], ["M-W", "Next"]],
];
const SAVE_KEYS: [string, string][][] = [[[" Y", "Yes"]], [[" N", "No"], ["^C", "Cancel"]]];
const NAME_KEYS: [string, string][][] = [[["^G", "Help"], ["M-D", "DOS Format"], ["M-A", "Append"], ["M-B", "Backup File"]], [["^C", "Cancel"], ["M-M", "Mac Format"], ["M-P", "Prepend"], ["^T", "Browse"]]];
const SEARCH_KEYS: [string, string][][] = [[["^G", "Help"], ["M-C", "Case Sens"], ["M-B", "Backwards"], ["^R", "Replace"]], [["^C", "Cancel"], ["M-R", "Reg.exp."], ["^P", "Older"], ["^N", "Newer"]]];
const HELP_KEYS: [string, string][][] = [[["^L", "Refresh"], ["^Y", "Prev Page"], ["^P", "Prev Line"], ["M-\\", "First Line"]], [["^X", "Close"], ["^V", "Next Page"], ["^N", "Next Line"], ["M-/", "Last Line"]]];

const NANO_HELP = `Main nano help text

 Команды nano: ^ — это Ctrl, M- — это Alt (или Esc, затем клавиша).

 ^G  F1      эта справка
 ^X  F2      выйти; если файл изменён — спросит, сохранить ли (Y / N / ^C)
 ^O  F3      записать файл (спросит имя — Enter, чтобы оставить прежнее)
 ^S          сохранить сразу, без вопросов
 ^W  F6      искать текст; M-W — следующее, M-Q — предыдущее совпадение
             (Ctrl+W браузер не отдаёт странице — в тренажёре ищите по F6)
 ^F / ^B     курсор на символ вперёд / назад (как стрелки)
 ^K          вырезать строку (несколько ^K подряд — несколько строк)
 ^U          вставить вырезанное
 ^C          где курсор: номер строки и столбца
 M-G  ^_     перейти к строке
 ^A / ^E     в начало / в конец строки
 стрелки, PgUp/PgDn, Home/End — перемещение

 ^X — закрыть эту справку`;

type SaveFn = (file: string, body: string) => Promise<string | null>;

/** nano 7.2 as on Ubuntu 24.04 — the keys of the course: ^O ^S ^X ^W ^K ^U ^G ^C M-G. */
export class Nano implements ScreenApp {
  lines: string[];
  row = 0;
  col = 0;
  top = 0;
  modified = false;
  done = false;
  file: string;
  status: string | null;
  mode: "edit" | "save?" | "name" | "search" | "goto" | "help" = "edit";
  input = "";
  exitAfterWrite = false;
  lastSearch = "";
  cutBuf: string[] = [];
  lastWasCut = false;
  helpTop = 0;
  private save: SaveFn;
  private height = 20;

  /** the file had Windows line ends: nano converts them on reading and writes them back (M-D toggles at the name prompt) */
  dos = false;

  constructor(text: string, file: string, notice: string, save: SaveFn) {
    if (text.includes("\r\n")) { this.dos = true; text = text.replace(/\r\n/g, "\n"); }
    this.lines = text.replace(/\n$/, "").split("\n");
    this.file = file;
    this.status = notice;
    this.save = save;
  }

  get text() { const t = this.lines.join(this.dos ? "\r\n" : "\n"); return t ? t + (this.dos ? "\r\n" : "\n") : ""; }

  render(cols: number, rows: number) {
    this.height = Math.max(1, rows - 4);
    const out: string[] = [];
    const title = "  GNU nano 7.2";
    const name = this.file || "New Buffer";
    const right = this.modified ? "Modified  " : "";
    let bar = fit(title, cols);
    const mid = Math.max(title.length + 1, Math.floor((cols - name.length) / 2));
    bar = (bar.slice(0, mid) + name + bar.slice(mid + name.length)).slice(0, cols);
    if (right) bar = bar.slice(0, cols - right.length) + right;
    out.push(INV + fit(bar, cols) + OFF);

    let cursor: [number, number] | null = null;
    if (this.mode === "help") {
      const help = NANO_HELP.split("\n");
      for (let i = 0; i < this.height; i++) out.push(fit(help[this.helpTop + i] ?? "", cols));
      out.push("");
      out.push(...shortcutRows(HELP_KEYS, cols));
      return { lines: out, cursor: null };
    }
    if (this.row < this.top) this.top = this.row;
    if (this.row >= this.top + this.height) this.top = this.row - this.height + 1;
    for (let i = 0; i < this.height; i++) {
      const li = this.top + i;
      if (li >= this.lines.length) { out.push(""); continue; }
      const shown = expand(this.lines[li]);
      if (li === this.row) {
        const x = xOf(this.lines[li], this.col);
        const start = x >= cols - 1 ? x - (x % (cols - 2)) : 0;
        let seg = shown.slice(start, start + cols);
        if (start > 0) seg = "<" + seg.slice(1);
        if (shown.length > start + cols) seg = seg.slice(0, cols - 1) + ">";
        out.push(seg);
        cursor = [i + 1, x - start];
      } else out.push(shown.length > cols ? shown.slice(0, cols - 1) + ">" : shown);
    }
    // the status / prompt line
    const prompts: Record<string, string> = {
      "save?": "Save modified buffer? ",
      name: this.dos ? "File Name to Write [DOS Format]: " : "File Name to Write: ",
      search: this.lastSearch ? `Search [${this.lastSearch}]: ` : "Search: ",
      goto: "Enter line number, column number: ",
    };
    if (prompts[this.mode]) {
      const p = prompts[this.mode] + (this.mode === "save?" ? "" : this.input);
      out.push(INV + fit(p, cols) + OFF);
      cursor = [rows - 3, Math.min(cols - 1, p.length)];
    } else if (this.status) {
      const s = `[ ${this.status} ]`;
      const pad = Math.max(0, Math.floor((cols - s.length) / 2));
      out.push(" ".repeat(pad) + INV + s + OFF);
    } else out.push("");
    const keys = this.mode === "save?" ? SAVE_KEYS : this.mode === "name" ? NAME_KEYS : this.mode === "search" || this.mode === "goto" ? SEARCH_KEYS : EDIT_KEYS;
    out.push(...shortcutRows(keys, cols));
    return { lines: out, cursor };
  }

  async key(k: string) {
    if (this.mode === "help") {
      if (k === "C-x" || k === "q" || k === "C-c" || k === "Escape") this.mode = "edit";
      else if (k === "Down" || k === "C-n") this.helpTop = Math.min(this.helpTop + 1, NANO_HELP.split("\n").length - 1);
      else if (k === "Up" || k === "C-p") this.helpTop = Math.max(0, this.helpTop - 1);
      return;
    }
    if (this.mode === "save?") {
      if (k === "y" || k === "Y") { this.mode = "name"; this.input = this.file; this.exitAfterWrite = true; }
      else if (k === "n" || k === "N") this.done = true;
      else if (k === "C-c") { this.mode = "edit"; this.status = "Cancelled"; }
      return;
    }
    if (this.mode === "name" || this.mode === "search" || this.mode === "goto") {
      if (k === "C-c") { this.mode = "edit"; this.status = "Cancelled"; this.exitAfterWrite = false; return; }
      if (k === "Backspace") { this.input = [...this.input].slice(0, -1).join(""); return; }
      if (k === "M-d" && this.mode === "name") { this.dos = !this.dos; return; }
      if (k === "Enter") { const m = this.mode; this.mode = "edit"; await this.submit(m); return; }
      if ([...k].length === 1 && k >= " ") this.input += k;
      return;
    }
    const cut = k === "C-k";
    if (!cut) this.lastWasCut = false;
    this.status = null;
    const line = this.lines[this.row];
    switch (k) {
      case "Up": if (this.row > 0) { this.row--; this.clampCol(); } break;
      case "Down": if (this.row < this.lines.length - 1) { this.row++; this.clampCol(); } break;
      case "Left": case "C-b": if (this.col > 0) this.col--; else if (this.row > 0) { this.row--; this.col = this.lines[this.row].length; } break;
      case "Right": case "C-f": if (this.col < line.length) this.col++; else if (this.row < this.lines.length - 1) { this.row++; this.col = 0; } break;
      case "Home": case "C-a": this.col = 0; break;
      case "End": case "C-e": this.col = line.length; break;
      case "PageUp": case "C-y": this.row = Math.max(0, this.row - this.height); this.top = Math.max(0, this.top - this.height); this.clampCol(); break;
      case "PageDown": case "C-v": this.row = Math.min(this.lines.length - 1, this.row + this.height); this.top = Math.min(Math.max(0, this.lines.length - 1), this.top + this.height); this.clampCol(); break;
      case "Enter":
        this.lines.splice(this.row, 1, line.slice(0, this.col), line.slice(this.col));
        this.row++; this.col = 0; this.modified = true; break;
      case "Backspace": case "C-h":
        if (this.col > 0) { this.lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col); this.col--; this.modified = true; }
        else if (this.row > 0) { const prev = this.lines[this.row - 1]; this.lines.splice(this.row - 1, 2, prev + line); this.row--; this.col = prev.length; this.modified = true; }
        break;
      case "Delete": case "C-d":
        if (this.col < line.length) { this.lines[this.row] = line.slice(0, this.col) + line.slice(this.col + 1); this.modified = true; }
        else if (this.row < this.lines.length - 1) { this.lines.splice(this.row, 2, line + this.lines[this.row + 1]); this.modified = true; }
        break;
      case "Tab": this.insert("\t"); break;
      case "C-o": case "F3": this.mode = "name"; this.input = this.file; this.exitAfterWrite = false; break;
      case "C-s":
        if (this.file) await this.write(this.file, false); else { this.mode = "name"; this.input = ""; this.exitAfterWrite = false; }
        break;
      case "C-x": case "F2":
        if (this.modified) this.mode = "save?"; else this.done = true;
        break;
      case "C-w": case "F6": this.mode = "search"; this.input = ""; break;
      case "M-w": case "F16": this.find(this.lastSearch); break;
      case "M-q": this.find(this.lastSearch, true); break;
      case "M-g": case "C-_": this.mode = "goto"; this.input = ""; break;
      case "C-g": case "F1": this.mode = "help"; this.helpTop = 0; break;
      case "C-k": {
        const taken = this.lines.length > 1 ? this.lines.splice(this.row, 1)[0] : (this.lines[0] = "", line);
        if (this.lines.length > 1 && this.row >= this.lines.length) this.row = this.lines.length - 1;
        if (!this.lastWasCut) this.cutBuf = [];
        this.cutBuf.push(taken);
        this.lastWasCut = true; this.col = 0; this.modified = true;
        break;
      }
      case "C-u":
        if (this.cutBuf.length) { this.lines.splice(this.row, 0, ...this.cutBuf); this.row += this.cutBuf.length; this.col = 0; this.modified = true; }
        break;
      case "C-c": {
        const chars = this.text.length;
        const before = this.lines.slice(0, this.row).reduce((t, l) => t + l.length + 1, 0) + this.col;
        const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`;
        this.status = `line ${this.row + 1}/${this.lines.length} (${pct(this.row + 1, this.lines.length)}), col ${this.col + 1}/${line.length + 1} (${pct(this.col + 1, line.length + 1)}), char ${before}/${chars} (${pct(before, chars)})`;
        break;
      }
      default:
        if ([...k].length === 1 && k >= " ") this.insert(k);
    }
  }

  private insert(t: string) {
    const line = this.lines[this.row];
    this.lines[this.row] = line.slice(0, this.col) + t + line.slice(this.col);
    this.col += t.length;
    this.modified = true;
  }
  private clampCol() { this.col = Math.min(this.col, this.lines[this.row].length); }

  private async submit(mode: string) {
    if (mode === "name") {
      if (!this.input) { this.status = "Cancelled"; this.exitAfterWrite = false; return; }
      await this.write(this.input, this.exitAfterWrite);
    } else if (mode === "search") {
      const what = this.input || this.lastSearch;
      if (!what) { this.status = "Cancelled"; return; }
      this.lastSearch = what;
      this.find(what);
    } else if (mode === "goto") {
      const [l, c] = this.input.split(/[,\s]+/).map(Number);
      if (!l) { this.status = "Invalid line or column number"; return; }
      this.row = Math.min(Math.max(1, l), this.lines.length) - 1;
      this.col = c ? Math.min(c - 1, this.lines[this.row].length) : 0;
    }
  }

  private async write(file: string, exit: boolean) {
    const err = await this.save(file, this.text);
    if (err) { this.status = `Error writing ${file}: ${err}`; this.exitAfterWrite = false; return; }
    this.file = file;
    this.modified = false;
    const n = this.text ? this.lines.length : 0;
    this.status = `Wrote ${n} line${n === 1 ? "" : "s"}`;
    if (exit) this.done = true;
  }

  private find(what: string, back = false) {
    if (!what) { this.status = "No current search pattern"; return; }
    const n = this.lines.length;
    if (back) {
      for (let i = 0; i <= n; i++) {
        const r = (this.row - i + n) % n;
        const upto = i === 0 ? this.col - 1 : this.lines[r].length;
        const at = upto < 0 ? -1 : this.lines[r].lastIndexOf(what, upto);
        if (at >= 0) { if (i > 0 && r > this.row) this.status = "Search Wrapped"; this.row = r; this.col = at; return; }
      }
      this.status = `"${what}" not found`;
      return;
    }
    for (let i = 0; i <= n; i++) {
      const r = (this.row + i) % n;
      const from = i === 0 ? this.col + 1 : 0;
      const at = this.lines[r].indexOf(what, from);
      if (at >= 0 && !(i === n && at >= this.col + 1)) {
        if (r < this.row || (r === this.row && i > 0)) this.status = r === this.row && at === this.col ? "This is the only occurrence" : "Search Wrapped";
        this.row = r; this.col = at;
        return;
      }
    }
    this.status = `"${what}" not found`;
  }
}

/** less: Space/b — pages, j/k — lines, g/G — start/end, /text — search, n/N — next/previous, q — quit. */
export class Pager implements ScreenApp {
  top = 0;
  done = false;
  mode: "view" | "search" | "notfound" | "help" = "view";
  input = "";
  pattern = "";
  private page = 23;
  private wrapped: { text: string; src: number }[] = [];
  private width = 0;
  private srcLines: string[];
  private title: string;
  private man: boolean;

  constructor(lines: string[], title: string, man: boolean) {
    this.srcLines = lines;
    this.title = title;
    this.man = man;
    this.layout(80);
  }

  private layout(cols: number) {
    if (cols === this.width) return;
    this.width = cols;
    this.wrapped = [];
    this.srcLines.forEach((l, src) => {
      const t = expand(l);
      if (!t) this.wrapped.push({ text: "", src });
      for (let i = 0; i < t.length; i += cols) this.wrapped.push({ text: t.slice(i, i + cols), src });
    });
  }
  private get maxTop() { return Math.max(0, this.wrapped.length - this.page); }

  render(cols: number, rows: number) {
    this.layout(cols);
    this.page = Math.max(1, rows - 1);
    this.top = Math.min(this.top, this.maxTop);
    const out: string[] = [];
    if (this.mode === "help") {
      const help = ["", "                   SUMMARY OF LESS COMMANDS", "", "  Пробел, f, PgDn   — страница вперёд", "  b, PgUp           — страница назад", "  j, Enter, ↓       — строка вперёд", "  k, ↑              — строка назад", "  g, <              — в начало", "  G, >              — в конец", "  /текст            — искать вперёд", "  n / N             — следующее / предыдущее совпадение", "  q                 — выйти"];
      for (let i = 0; i < this.page; i++) out.push(help[i] ?? "");
      out.push(INV + "HELP -- Press q when done" + OFF);
      return { lines: out, cursor: [rows - 1, 25] as [number, number] };
    }
    for (let i = 0; i < this.page; i++) {
      const w = this.wrapped[this.top + i];
      if (!w) { out.push(BOLD + "~" + OFF); continue; }
      out.push(this.pattern ? w.text.split(this.pattern).join(INV + this.pattern + OFF) : w.text);
    }
    const atEnd = this.top >= this.maxTop;
    let prompt: string;
    if (this.mode === "search") prompt = "/" + this.input;
    else if (this.mode === "notfound") prompt = INV + "Pattern not found  (press RETURN)" + OFF;
    else if (this.man) {
      const line = (this.wrapped[this.top]?.src ?? 0) + 1;
      prompt = INV + ` Manual page ${this.title.replace(/^Manual page /, "")} line ${line}${atEnd ? `/${this.srcLines.length} (END)` : ""} (press h for help or q to quit)` + OFF;
    } else if (atEnd) prompt = INV + "(END)" + OFF;
    else if (this.top === 0 && this.title) prompt = INV + this.title + OFF;
    else prompt = ":";
    out.push(prompt);
    const visible = prompt.replace(/\x1b\[[0-9;]*m/g, "").length;
    return { lines: out, cursor: [rows - 1, Math.min(cols - 1, visible)] as [number, number] };
  }

  key(k: string) {
    if (this.mode === "help") { if (k === "q" || k === "Q" || k === "Escape") this.mode = "view"; return; }
    if (this.mode === "notfound") { this.mode = "view"; return; }
    if (this.mode === "search") {
      if (k === "Enter") { this.mode = "view"; if (this.input) this.pattern = this.input; this.next(1); return; }
      if (k === "Escape" || k === "C-c") { this.mode = "view"; return; }
      if (k === "Backspace") { if (!this.input) this.mode = "view"; this.input = this.input.slice(0, -1); return; }
      if ([...k].length === 1 && k >= " ") this.input += k;
      return;
    }
    const half = Math.max(1, Math.floor(this.page / 2));
    switch (k) {
      case "q": case "Q": case "C-c": this.done = true; break;
      case " ": case "f": case "PageDown": case "C-f": case "C-v": case "z": this.top = Math.min(this.maxTop, this.top + this.page); break;
      case "b": case "PageUp": case "C-b": case "w": this.top = Math.max(0, this.top - this.page); break;
      case "j": case "Down": case "Enter": case "e": case "C-n": this.top = Math.min(this.maxTop, this.top + 1); break;
      case "k": case "Up": case "y": case "C-p": this.top = Math.max(0, this.top - 1); break;
      case "d": case "C-d": this.top = Math.min(this.maxTop, this.top + half); break;
      case "u": case "C-u": this.top = Math.max(0, this.top - half); break;
      case "g": case "<": case "Home": this.top = 0; break;
      case "G": case ">": case "End": this.top = this.maxTop; break;
      case "/": this.mode = "search"; this.input = ""; break;
      case "n": this.next(1); break;
      case "N": this.next(-1); break;
      case "h": case "H": this.mode = "help"; break;
    }
  }

  private next(dir: 1 | -1) {
    if (!this.pattern) return;
    for (let i = this.top + dir; i >= 0 && i < this.wrapped.length; i += dir) {
      if (this.wrapped[i].text.includes(this.pattern)) { this.top = Math.min(i, this.maxTop); if (i > this.maxTop) this.top = this.maxTop; return; }
    }
    this.mode = "notfound";
  }
}

/** vim, minimal: i/a/o, Esc, hjkl/arrows, x, :w :q :q! :wq :x — and the famous messages on the way out. */
export class Vim implements ScreenApp {
  lines: string[];
  row = 0;
  col = 0;
  top = 0;
  done = false;
  mode: "normal" | "insert" | "cmd" = "normal";
  cmd = "";
  msg: string;
  error = false;
  modified = false;
  private file: string;
  private save: (body: string) => Promise<string | null>;

  constructor(text: string, file: string, exists: boolean, save: (body: string) => Promise<string | null>) {
    this.lines = text.replace(/\n$/, "").split("\n");
    this.file = file;
    this.save = save;
    this.msg = !file ? "" : exists ? `"${file}" ${text ? this.lines.length : 0}L, ${new TextEncoder().encode(text).length}B` : `"${file}" [New]`;
  }

  render(cols: number, rows: number) {
    const h = rows - 1;
    if (this.row < this.top) this.top = this.row;
    if (this.row >= this.top + h) this.top = this.row - h + 1;
    const out: string[] = [];
    for (let i = 0; i < h; i++) {
      const l = this.lines[this.top + i];
      out.push(l === undefined ? "\x1b[34m~\x1b[0m" : expand(l).slice(0, cols));
    }
    let last = this.mode === "cmd" ? ":" + this.cmd : this.mode === "insert" ? BOLD + "-- INSERT --" + OFF : this.error ? "\x1b[97;41m" + this.msg + OFF : this.msg;
    if (this.mode !== "cmd" && this.mode !== "insert" && !this.error) last = fit(last, Math.max(0, cols - 18)) + `${this.row + 1},${this.col + 1}`.padEnd(14) + "All";
    out.push(last);
    const cursor: [number, number] = this.mode === "cmd" ? [rows - 1, this.cmd.length + 1] : [this.row - this.top, xOf(this.lines[this.row], this.col)];
    return { lines: out, cursor };
  }

  async key(k: string) {
    if (this.mode === "insert") {
      const line = this.lines[this.row];
      if (k === "Escape" || k === "C-c") { this.mode = "normal"; this.msg = ""; if (this.col > 0) this.col--; return; }
      if (k === "Enter") { this.lines.splice(this.row, 1, line.slice(0, this.col), line.slice(this.col)); this.row++; this.col = 0; this.modified = true; return; }
      if (k === "Backspace") {
        if (this.col > 0) { this.lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col); this.col--; this.modified = true; }
        return;
      }
      if (this.move(k)) return;
      const t = k === "Tab" ? "\t" : [...k].length === 1 && k >= " " ? k : "";
      if (t) { this.lines[this.row] = line.slice(0, this.col) + t + line.slice(this.col); this.col++; this.modified = true; }
      return;
    }
    if (this.mode === "cmd") {
      if (k === "Escape" || k === "C-c") { this.mode = "normal"; this.cmd = ""; return; }
      if (k === "Backspace") { if (!this.cmd) this.mode = "normal"; this.cmd = this.cmd.slice(0, -1); return; }
      if (k === "Enter") { const c = this.cmd.trim(); this.cmd = ""; this.mode = "normal"; await this.ex(c); return; }
      if ([...k].length === 1 && k >= " ") this.cmd += k;
      return;
    }
    this.error = false;
    if (this.move(k)) return;
    const line = this.lines[this.row];
    switch (k) {
      case "i": this.mode = "insert"; break;
      case "a": this.mode = "insert"; this.col = Math.min(line.length, this.col + 1); break;
      case "A": this.mode = "insert"; this.col = line.length; break;
      case "o": this.lines.splice(this.row + 1, 0, ""); this.row++; this.col = 0; this.mode = "insert"; this.modified = true; break;
      case "x": if (line) { this.lines[this.row] = line.slice(0, this.col) + line.slice(this.col + 1); this.col = Math.min(this.col, Math.max(0, this.lines[this.row].length - 1)); this.modified = true; } break;
      case ":": this.mode = "cmd"; this.cmd = ""; break;
      case "C-c": this.msg = "Type  :qa!  and press <Enter> to abandon all changes and exit Vim"; break;
      case "h": this.col = Math.max(0, this.col - 1); break;
      case "l": this.col = Math.min(Math.max(0, line.length - 1), this.col + 1); break;
      case "j": if (this.row < this.lines.length - 1) { this.row++; this.col = Math.min(this.col, this.lines[this.row].length); } break;
      case "k": if (this.row > 0) { this.row--; this.col = Math.min(this.col, this.lines[this.row].length); } break;
    }
  }

  private move(k: string) {
    if (k === "Left") this.col = Math.max(0, this.col - 1);
    else if (k === "Right") this.col = Math.min(this.lines[this.row].length, this.col + 1);
    else if (k === "Up" && this.row > 0) { this.row--; this.col = Math.min(this.col, this.lines[this.row].length); }
    else if (k === "Down" && this.row < this.lines.length - 1) { this.row++; this.col = Math.min(this.col, this.lines[this.row].length); }
    else return ["Up", "Down"].includes(k);
    return true;
  }

  private async ex(c: string) {
    const body = () => { const t = this.lines.join("\n"); return t ? t + "\n" : ""; };
    const fail = (m: string) => { this.msg = m; this.error = true; };
    if (c === "q" || c === "qa" || c === "quit") { if (this.modified) fail("E37: No write since last change (add ! to override)"); else this.done = true; return; }
    if (c === "q!" || c === "qa!" || c === "cq") { this.done = true; return; }
    if (c === "w" || c === "wq" || c === "x" || c === "wq!" || c === "x!") {
      if (!this.file) { fail("E32: No file name"); return; }
      const err = await this.save(body());
      if (err) { fail(err); return; }
      this.modified = false;
      this.msg = `"${this.file}" ${this.lines.length}L, ${new TextEncoder().encode(body()).length}B written`;
      if (c !== "w") this.done = true;
      return;
    }
    if (c === "") return;
    fail(`E492: Not an editor command: ${c}`);
  }
}
