/**
 * The terminal of the simulator on xterm.js: prompt `student@forge:~/path$`, line editing, history (↑ ↓),
 * Tab completion, Ctrl+C / Ctrl+L, full-screen programs (nano, less, man) and `-i` questions.
 * Browser shortcuts that clash with the terminal (Ctrl+S, Ctrl+O, Ctrl+F, Ctrl+K, F1…) are taken from the
 * browser while the terminal has focus; Ctrl+W, Ctrl+T, Ctrl+N the browser keeps — except in full screen,
 * where the Keyboard Lock API gives them to the page (Chromium browsers).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { RunResult, ScreenApp, ShellSession, ShellUI } from "./engine";
import { complete, keysOf } from "./complete";
import { columns } from "./commands";

export type TerminalHandle = {
  focus(): void;
  /** types a command line visibly and runs it (theory: <Shell script>) */
  type(line: string, delayMs?: number): Promise<void>;
  /** runs a line without typing it out (replaying earlier steps) */
  runQuiet(line: string): Promise<void>;
  clear(): void;
  fullscreen(): Promise<void>;
  /** «Новое окно терминала»: a fresh bash that reads ~/.bashrc */
  newWindow(): Promise<void>;
};

const visibleLen = (s: string) => [...s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")].length;

function themeFromCss() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    background: v("--term-bg", "#fbf8f2"), foreground: v("--term-fg", "#27231d"), cursor: v("--term-cursor", "#27231d"), cursorAccent: v("--term-bg", "#fbf8f2"),
    selectionBackground: v("--term-selection", "#add6ff"),
    black: v("--term-black", "#000000"), red: v("--term-red", "#cd3131"), green: v("--term-green", "#107c10"), yellow: v("--term-yellow", "#949800"),
    blue: v("--term-blue", "#0451a5"), magenta: v("--term-magenta", "#bc05bc"), cyan: v("--term-cyan", "#0598bc"), white: v("--term-white", "#555555"),
    brightBlack: v("--term-bright-black", "#666666"), brightRed: v("--term-red", "#cd3131"), brightGreen: v("--term-green", "#107c10"), brightYellow: v("--term-yellow", "#949800"),
    brightBlue: v("--term-blue", "#0451a5"), brightMagenta: v("--term-magenta", "#bc05bc"), brightCyan: v("--term-cyan", "#0598bc"), brightWhite: v("--term-fg", "#27231d"),
  };
}

type Props = { session: ShellSession; onCommand?: (line: string, r: RunResult) => void; greeting?: string; rows?: number };

export const ShellTerminal = forwardRef<TerminalHandle, Props>(function ShellTerminal({ session, onCommand, greeting, rows = 22 }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const ctl = useRef<Controller | null>(null);
  const onCmd = useRef(onCommand);
  onCmd.current = onCommand;

  useEffect(() => {
    const c = new Controller(host.current!, session, (l, r) => onCmd.current?.(l, r), rows);
    ctl.current = c;
    if (greeting) c.writeln(greeting);
    c.prompt();
    return () => { c.dispose(); ctl.current = null; };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    focus: () => ctl.current?.term.focus(),
    type: (line, d) => ctl.current?.typeLine(line, d) ?? Promise.resolve(),
    runQuiet: (line) => ctl.current?.runQuiet(line) ?? Promise.resolve(),
    clear: () => ctl.current?.clearScreen(),
    fullscreen: () => ctl.current?.fullscreen() ?? Promise.resolve(),
    newWindow: () => ctl.current?.newWindow() ?? Promise.resolve(),
  }), []);

  return <div className="term-host" ref={host} />;
});

class Controller {
  term: Terminal;
  fit = new FitAddon();
  s: ShellSession;
  buf: string[] = [];
  cur = 0;
  /** where the prompt starts: the column (bash prints it right after output without a final newline) */
  promptCol = 0;
  rowOff = 0;
  histIdx: number | null = null;
  draft = "";
  busy = false;
  abort: AbortController | null = null;
  ask: { buf: string[]; resolve: (v: string | null) => void; secret: boolean } | null = null;
  private appTimer: ReturnType<typeof setInterval> | null = null;
  app: { app: ScreenApp; resolve: () => void } | null = null;
  tabs = 0;
  typeahead: string[] = [];
  running: Promise<void> = Promise.resolve();
  chain: Promise<void> = Promise.resolve();
  private disposers: (() => void)[] = [];
  private onCommand: (l: string, r: RunResult) => void;
  private el: HTMLElement;

  private rows: number;

  constructor(el: HTMLElement, s: ShellSession, onCommand: (l: string, r: RunResult) => void, rows: number) {
    this.el = el;
    this.rows = rows;
    this.s = s;
    this.onCommand = onCommand;
    this.term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, Consolas, monospace', fontSize: 14, lineHeight: 1.15, rows,
      cursorBlink: true, theme: themeFromCss(), scrollback: 2000, allowProposedApi: false, convertEol: false,
    });
    this.term.loadAddon(this.fit);
    this.term.open(el);
    this.fitNow();
    s.ui = this.ui();
    this.term.attachCustomKeyEventHandler((e) => this.keyFilter(e));
    const d = this.term.onData((data) => { this.chain = this.chain.then(() => this.input(data)).catch(() => {}); });
    const r = this.term.onResize(() => { this.s.ui.cols = this.term.cols; this.s.ui.rows = this.term.rows; if (this.app) this.drawApp(); });
    const ro = new ResizeObserver(() => this.fitNow());
    ro.observe(el);
    const mo = new MutationObserver(() => { this.term.options.theme = themeFromCss(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const fs = () => setTimeout(() => this.fitNow(), 50);
    document.addEventListener("fullscreenchange", fs);
    // the web font arrives after the first measurement: measure again
    document.fonts?.ready.then(() => { this.term.options.fontFamily = this.term.options.fontFamily + ""; this.fitNow(); });
    this.disposers.push(() => d.dispose(), () => r.dispose(), () => ro.disconnect(), () => mo.disconnect(), () => document.removeEventListener("fullscreenchange", fs));
  }

  dispose() {
    this.abort?.abort();
    this.ask?.resolve(null);
    if (this.app) { this.app.app.done = true; this.app.resolve(); }
    if (this.appTimer) clearInterval(this.appTimer);
    for (const f of this.disposers) f();
    this.term.dispose();
  }

  /** Width follows the box; the height stays `rows` lines (in full screen — the whole screen). */
  private fitNow() {
    try {
      const d = this.fit.proposeDimensions();
      if (d && d.cols > 0) this.term.resize(d.cols, document.fullscreenElement ? Math.max(5, d.rows) : this.rows);
    } catch { /* not visible yet */ }
    this.s.ui.cols = this.term.cols;
    this.s.ui.rows = this.term.rows;
  }

  /** Which keys the browser must not get while the terminal has focus. */
  private keyFilter(e: KeyboardEvent): boolean {
    if (e.type !== "keydown") return true;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyC" && this.term.hasSelection()) return false; // copy
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyV") return false; // paste — the browser's paste event
    if (e.ctrlKey && !e.altKey && /^Key[A-Z]$|^Slash$|^Backslash$|^Minus$/.test(e.code)) e.preventDefault();
    if (e.altKey && !e.ctrlKey && /^Key[A-Z]$|^Digit\d$|^Slash$|^BracketRight$/.test(e.code)) e.preventDefault();
    if (/^F([1-9]|10)$/.test(e.key)) e.preventDefault();
    return true;
  }

  private ui(): ShellUI {
    return {
      cols: this.term.cols, rows: this.term.rows,
      // a secret answer (a password) is not echoed, as in a real terminal
      ask: (prompt, opts) => new Promise((resolve) => { this.term.write(prompt.replace(/\n/g, "\r\n")); this.ask = { buf: [], resolve, secret: !!opts?.secret }; }),
      screen: (app) => new Promise((resolve) => {
        this.term.write("\x1b[?1049h\x1b[H\x1b[2J");
        this.app = { app, resolve };
        this.drawApp();
        if (app.interval) this.appTimer = setInterval(() => { void (async () => { await app.tick?.(); this.drawApp(); })(); }, app.interval);
      }),
    };
  }

  writeln(t: string) { this.term.write(t.replace(/\n/g, "\r\n") + "\r\n"); }

  private promptText() {
    const u = this.s.promptUser();
    return `\x1b[1;32m${u}@forge\x1b[0m:\x1b[1;34m${this.s.promptPath()}\x1b[0m${u === "root" ? "#" : "$"} `;
  }

  /** `col` — where the cursor is now (after output without a final newline bash prints the prompt right there) */
  prompt(col = 0) {
    this.buf = []; this.cur = 0; this.rowOff = 0; this.histIdx = null;
    this.promptCol = col;
    this.term.write(this.promptText());
  }

  /** Redraws the input line after any change (it may wrap over several rows). */
  private redraw() {
    const cols = this.term.cols;
    const pl = this.promptCol + visibleLen(this.promptText());
    let out = "";
    if (this.rowOff > 0) out += `\x1b[${this.rowOff}A`;
    out += `\r\x1b[${this.promptCol + 1}G\x1b[J` + this.promptText() + this.buf.join("");
    const total = pl + this.buf.length;
    if (total > 0 && total % cols === 0) out += "\r\n";
    const endRow = Math.floor(total / cols);
    const t = pl + this.cur;
    const tRow = Math.floor(t / cols), tCol = t % cols;
    if (endRow > tRow) out += `\x1b[${endRow - tRow}A`;
    out += `\x1b[${tCol + 1}G`;
    this.rowOff = tRow;
    this.term.write(out);
  }

  private setLine(text: string) { this.buf = [...text]; this.cur = this.buf.length; this.redraw(); }

  private drawApp() {
    if (!this.app) return;
    const { cols, rows } = this.term;
    const { lines, cursor } = this.app.app.render(cols, rows);
    let out = "\x1b[?25l\x1b[H";
    for (let i = 0; i < rows; i++) out += (lines[i] ?? "") + "\x1b[0m\x1b[K" + (i < rows - 1 ? "\r\n" : "");
    if (cursor) out += `\x1b[${cursor[0] + 1};${cursor[1] + 1}H\x1b[?25h`;
    this.term.write(out);
  }

  private writeOut(fd: 1 | 2, text: string) {
    const t = text.replace(/\r?\n/g, "\r\n");
    this.term.write(fd === 2 ? `\x1b[31m${t}\x1b[0m` : t);
  }

  private async input(data: string) {
    const keys = keysOf(data);
    if (this.app) {
      for (const k of keys) { await this.app.app.key(k); if (this.app.app.done) break; }
      if (this.app.app.done) {
        const done = this.app;
        this.app = null;
        if (this.appTimer) { clearInterval(this.appTimer); this.appTimer = null; }
        this.term.write("\x1b[?1049l\x1b[?25h");
        done.resolve();
      } else this.drawApp();
      return;
    }
    if (this.ask) {
      for (const k of keys) {
        const a = this.ask;
        if (!a) break;
        if (k === "Enter") { this.term.write("\r\n"); this.ask = null; a.resolve(a.buf.join("")); }
        else if (k === "C-c") { this.term.write("^C\r\n"); this.ask = null; this.abort?.abort(); a.resolve(null); }
        else if (k === "Backspace") { if (a.buf.length) { a.buf.pop(); if (!a.secret) this.term.write("\b \b"); } }
        else if ([...k].length === 1 && k >= " ") { a.buf.push(k); if (!a.secret) this.term.write(k); }
      }
      return;
    }
    if (this.busy) {
      // Ctrl+C: SIGINT to the foreground program and the line stops; Ctrl+Z: SIGTSTP — a sleeping program becomes a stopped job
      if (keys.includes("C-c")) { this.term.write("^C"); void this.s.interrupt("INT"); this.abort?.abort(); this.typeahead = []; }
      // Ctrl+Z: the stopped program reports «Stopped» itself; the rest of the line is dropped by the session
      else if (keys.includes("C-z")) { this.term.write("^Z"); void this.s.interrupt("TSTP"); this.typeahead = []; }
      // typed ahead while a command runs: a real terminal keeps it for the next prompt
      else this.typeahead.push(...keys);
      return;
    }
    await this.keys(keys);
  }

  /** Line editing; a command started by Enter runs detached, so nano/less and `-i` questions get their keys. */
  private async keys(keys: string[]) {
    for (let i = 0; i < keys.length; i++) {
      if (this.busy) { this.typeahead.push(...keys.slice(i)); return; }
      await this.key(keys[i]);
    }
  }

  private async key(k: string) {
    if (k !== "Tab") this.tabs = 0;
    const b = this.buf;
    switch (k) {
      case "Enter": void this.enter(); return;
      case "Left": if (this.cur > 0) { this.cur--; this.redraw(); } return;
      case "Right": if (this.cur < b.length) { this.cur++; this.redraw(); } return;
      case "Home": case "C-a": this.cur = 0; this.redraw(); return;
      case "End": case "C-e": this.cur = b.length; this.redraw(); return;
      case "Backspace": if (this.cur > 0) { b.splice(this.cur - 1, 1); this.cur--; this.redraw(); } return;
      case "Delete": if (this.cur < b.length) { b.splice(this.cur, 1); this.redraw(); } return;
      case "C-d": if (!b.length) { this.writeln(""); this.writeln("\x1b[2m(в настоящем терминале Ctrl+D на пустой строке закрыл бы сеанс)\x1b[0m"); this.prompt(); } else if (this.cur < b.length) { b.splice(this.cur, 1); this.redraw(); } return;
      case "C-u": b.splice(0, this.cur); this.cur = 0; this.redraw(); return;
      case "C-k": b.splice(this.cur); this.redraw(); return;
      case "C-w": { let i = this.cur; while (i > 0 && b[i - 1] === " ") i--; while (i > 0 && b[i - 1] !== " ") i--; b.splice(i, this.cur - i); this.cur = i; this.redraw(); return; }
      case "C-c": this.term.write("^C\r\n"); this.prompt(); return;
      case "C-l": this.clearScreen(); return;
      case "Up": case "C-p": {
        const h = this.s.history;
        if (!h.length) return;
        if (this.histIdx === null) { this.draft = b.join(""); this.histIdx = h.length - 1; } else if (this.histIdx > 0) this.histIdx--; else return;
        this.setLine(h[this.histIdx]);
        return;
      }
      case "Down": case "C-n": {
        if (this.histIdx === null) return;
        const h = this.s.history;
        if (this.histIdx < h.length - 1) { this.histIdx++; this.setLine(h[this.histIdx]); } else { this.histIdx = null; this.setLine(this.draft); }
        return;
      }
      case "Tab": await this.tab(); return;
    }
    if ([...k].length === 1 && k >= " ") { b.splice(this.cur, 0, k); this.cur++; this.redraw(); }
  }

  private async tab() {
    const line = this.buf.join("");
    const r = await complete(this.s, line, this.cur);
    if (r.replacement !== null) {
      const next = line.slice(0, r.start) + r.replacement + line.slice(r.end);
      const cur = r.start + r.replacement.length;
      this.buf = [...next]; this.cur = [...next.slice(0, cur)].length; this.redraw();
      this.tabs = 0;
      return;
    }
    if (!r.options.length) { this.term.write("\x07"); return; }
    if (++this.tabs < 2) { this.term.write("\x07"); return; }
    this.tabs = 0;
    const list = columns(r.options.map((o) => ({ text: o, width: [...o].length })), this.term.cols);
    const keep = { buf: this.buf, cur: this.cur };
    this.term.write("\r\n" + list.replace(/\n/g, "\r\n"));
    this.prompt();
    this.buf = keep.buf; this.cur = keep.cur; this.redraw();
  }

  clearScreen() {
    this.term.write("\x1b[H\x1b[2J\x1b[3J");
    this.term.clear();
    this.promptCol = 0; this.rowOff = 0;
    this.redraw();
  }

  private async enter() {
    const line = this.buf.join("");
    this.cur = this.buf.length; this.redraw();
    this.term.write("\r\n");
    this.running = this.run(line);
    await this.running;
  }

  private async run(line: string) {
    this.busy = true;
    this.abort = new AbortController();
    let r: RunResult;
    try {
      r = await this.s.run(line, { signal: this.abort.signal, onChunk: (c) => this.writeOut(c.fd, c.text) });
    } catch (e) {
      this.writeOut(2, `bash: ${String((e as Error)?.message ?? e)}\n`);
      r = { stdout: "", stderr: String(e), exitCode: 1, chunks: [] };
    }
    const all = r.chunks.map((c) => c.text).join("");
    const tail = all.slice(all.lastIndexOf("\n") + 1);
    let col = /\x1b\[(2J|H)/.test(tail) ? 0 : visibleLen(tail) % this.term.cols;
    if (this.abort.signal.aborted) { this.term.write("\r\n"); col = 0; }
    this.busy = false;
    this.abort = null;
    if (line.trim()) this.onCommand(line, r);
    this.prompt(col);
    if (this.typeahead.length) { const ks = this.typeahead; this.typeahead = []; this.chain = this.chain.then(() => this.keys(ks)).catch(() => {}); }
  }

  async typeLine(line: string, delay = 35) {
    await this.chain;
    await this.running;
    for (const ch of line) { this.buf.splice(this.cur, 0, ch); this.cur++; this.redraw(); await new Promise((r) => setTimeout(r, delay)); }
    await new Promise((r) => setTimeout(r, 200));
    await this.enter();
  }

  async runQuiet(line: string) {
    this.buf = [...line]; this.cur = this.buf.length;
    await this.enter();
  }

  async newWindow() {
    await this.chain;
    await this.running;
    this.term.write("\r\n\x1b[2m──────── новое окно терминала ────────\x1b[0m\r\n");
    const chunks: { fd: 1 | 2; text: string }[] = [];
    await this.s.newWindow((c) => { chunks.push(c); this.writeOut(c.fd, c.text); });
    this.prompt();
  }

  async fullscreen() {
    const box = this.el.closest(".shell") as HTMLElement | null ?? this.el;
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await box.requestFullscreen?.();
    // Chromium: in full screen the page may take Ctrl+W, Ctrl+T, Ctrl+N from the browser
    const kb = (navigator as unknown as { keyboard?: { lock?: (keys: string[]) => Promise<void> } }).keyboard;
    await kb?.lock?.(["KeyW", "KeyT", "KeyN", "KeyS", "KeyO", "KeyF", "KeyR"]).catch(() => {});
    this.term.focus();
  }
}
