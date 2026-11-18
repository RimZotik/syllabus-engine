/** How well a search query matches a title (and the text under it). Pure, so it is unit-tested. */

const words = (q: string) => q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** Word stems, so «классы» finds «классификация» (Russian endings change, the start stays). */
const stem = (w: string) => (w.length > 3 ? w.slice(0, Math.max(3, w.length - 2)) : w);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordStart = (hay: string, s: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(s)}`, "u").test(hay);

/**
 * 0 — no match; 1 — only the text has it; 2 — a word of the title starts with the stem;
 * 3 — a word of the title starts with the whole query word; 4 — the title itself starts with it.
 */
export function score(query: string, title: string, text = ""): number {
  const ws = words(query);
  if (!ws.length) return 0;
  const t = title.toLowerCase(), x = text.toLowerCase();
  // a short word must match whole, or «слой» would find «словами»
  const key = (w: string) => (w.length > 5 ? stem(w) : w);
  if (!ws.every((w) => wordStart(t, key(w)) || wordStart(x, key(w)))) return 0;
  if (ws.every((w) => wordStart(t, w))) return t.startsWith(ws[0] ?? "") ? 4 : 3;
  if (ws.every((w) => wordStart(t, key(w)))) return 2;
  return 1;
}
