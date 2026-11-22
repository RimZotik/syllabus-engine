/**
 * Tab completion of the simulator's prompt, as bash does it: the first word of a command — command names,
 * any other word — file and folder names (folders get «/», files a space; spaces in names are escaped).
 * And the keyboard: xterm's input bytes → key names of screens.ts.
 */
import { joinPath, type ShellSession } from "./engine.ts";

const BUILTINS = ["cd", "echo", "export", "unset", "alias", "exit", "type", "source", "pwd", "history", "help", "true", "false", "test"];
const OWN = ["nano", "less", "man", "vim", "vi", "clear"];

const escapeName = (n: string) => n.replace(/([ \\'"$`!&|;()<>*?[\]#~{}])/g, "\\$1");
const unescape = (w: string) => w.replace(/\\(.)/g, "$1").replace(/^['"]|['"]$/g, "");

export type Completion = { start: number; end: number; options: string[]; replacement: string | null };

/** Options for the word before the cursor; `replacement` — what to put instead of it (null — nothing to add). */
export async function complete(s: ShellSession, line: string, cursor: number): Promise<Completion> {
  let start = cursor;
  while (start > 0 && !(/[\s;|&<>]/.test(line[start - 1]) && line[start - 2] !== "\\")) start--;
  const word = line.slice(start, cursor);
  const before = line.slice(0, start).trimEnd();
  const isCommand = !before || /(\||;|&&|\|\||&|\()$/.test(before);
  const w = unescape(word);
  let options: string[];
  let dirPart = "";
  if (isCommand && !w.includes("/")) {
    const bin = await s.fs.readdir("/bin").catch(() => [] as string[]);
    options = [...new Set([...bin, ...BUILTINS, ...OWN])].filter((n) => n.startsWith(w) && !n.startsWith("html-") && !n.startsWith("__") && n !== "js-exec").sort();
    options = options.map((n) => n + " ");
  } else {
    dirPart = w.includes("/") ? w.slice(0, w.lastIndexOf("/") + 1) : "";
    const prefix = w.slice(dirPart.length);
    const dir = joinPath(s.cwd, (dirPart || ".").replace(/^~(?=\/|$)/, s.home));
    const names = await s.fs.readdir(dir).catch(() => [] as string[]);
    options = [];
    for (const n of names.sort()) {
      if (!n.startsWith(prefix) || (n.startsWith(".") && !prefix.startsWith("."))) continue;
      const st = await s.fs.stat(joinPath(dir, n)).catch(() => null);
      options.push(n + (st?.isDirectory ? "/" : " "));
    }
  }
  if (!options.length) return { start, end: cursor, options, replacement: null };
  const common = options.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
  const typed = w.slice(dirPart.length);
  const ext = options.length === 1 ? options[0] : common.replace(/ $/, "");
  if (ext.length <= typed.length && options.length > 1) return { start, end: cursor, options: options.map((o) => o.trimEnd()), replacement: null };
  const tail = ext.endsWith(" ") ? escapeName(ext.slice(0, -1)) + " " : escapeName(ext);
  return { start, end: cursor, options: options.map((o) => o.trimEnd()), replacement: escapeName(dirPart).replace(/^\\~/, "~") + tail };
}

const SEQ: Record<string, string> = {
  "\r": "Enter", "\x7f": "Backspace", "\x08": "Backspace", "\t": "Tab", "\x1b": "Escape",
  "\x1b[A": "Up", "\x1b[B": "Down", "\x1b[C": "Right", "\x1b[D": "Left", "\x1bOA": "Up", "\x1bOB": "Down", "\x1bOC": "Right", "\x1bOD": "Left",
  "\x1b[H": "Home", "\x1b[F": "End", "\x1bOH": "Home", "\x1bOF": "End", "\x1b[1~": "Home", "\x1b[4~": "End",
  "\x1b[3~": "Delete", "\x1b[5~": "PageUp", "\x1b[6~": "PageDown", "\x1b[2~": "Insert",
  "\x1bOP": "F1", "\x1bOQ": "F2", "\x1bOR": "F3", "\x1bOS": "F4", "\x1b[15~": "F5", "\x1b[17~": "F6", "\x1b[18~": "F7", "\x1b[19~": "F8", "\x1b[20~": "F9", "\x1b[21~": "F10", "\x1b[23~": "F11", "\x1b[24~": "F12",
};

/** Splits xterm's input (one key or a pasted text) into key names. */
export function keysOf(data: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] === "\x1b") {
      const m = /^\x1b(\[[0-9;]*[~A-Za-z]|O[A-Za-z])/.exec(data.slice(i));
      if (m) { const seq = m[0].replace(/^\x1b\[1;\d([A-D])$/, "\x1b[$1"); out.push(SEQ[seq] ?? SEQ[m[0]] ?? "Unknown"); i += m[0].length; continue; }
      const next = data[i + 1];
      if (next && next !== "\x1b") { out.push(`M-${next.toLowerCase()}`); i += 2; continue; }
      out.push("Escape"); i++; continue;
    }
    const ch = data[i];
    if (SEQ[ch]) { out.push(SEQ[ch]); i++; continue; }
    const c = ch.charCodeAt(0);
    if (c === 0x1f) { out.push("C-_"); i++; continue; }
    if (c === 0x1c) { out.push("C-\\"); i++; continue; }
    if (c === 0x0a) { out.push("Enter"); i++; continue; }
    if (c > 0 && c < 0x1b) { out.push(`C-${String.fromCharCode(c + 96)}`); i++; continue; }
    const cp = data.codePointAt(i)!;
    const s = String.fromCodePoint(cp);
    out.push(s); i += s.length;
  }
  return out;
}
