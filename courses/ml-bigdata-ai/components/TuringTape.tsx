import { ChevronLeft, ChevronRight, ChevronsLeft } from "lucide-react";
import { usePageState } from "@syllabus/sdk";

/**
 * The Turing machine «add one» from intro1.history.1, step by step: an endless tape of cells with sticks,
 * the head above the current cell, the two rules with the one in action highlighted.
 */
type Step = { tape: string[]; head: number; rule: 0 | 1 | null; text: string; halted?: boolean };

const START = ["", "|", "|", "|", "", ""];
const STEPS: Step[] = [
  { tape: START, head: 1, rule: null, text: "Начало: на ленте число 3 — три палочки. Головка стоит на первой." },
  { tape: START, head: 1, rule: 0, text: "Головка видит палочку. По правилу 1 сдвигается вправо." },
  { tape: START, head: 2, rule: 0, text: "Снова палочка — снова вправо." },
  { tape: START, head: 3, rule: 0, text: "Третья палочка — ещё шаг вправо." },
  { tape: START, head: 4, rule: 1, text: "Пустая клетка. По правилу 2 головка пишет палочку и останавливается." },
  { tape: ["", "|", "|", "|", "|", ""], head: 4, rule: null, halted: true, text: "Готово: на ленте 4 палочки. Машина не знает, что такое число, — она только читала, писала и сдвигалась." },
];
const RULES = ["Вижу палочку → сдвигаюсь вправо", "Вижу пустую клетку → пишу палочку и останавливаюсь"];

const CELL = 46;

export function TuringTape() {
  const [i, setI] = usePageState("turing-step", 0);
  const s = STEPS[Math.min(i, STEPS.length - 1)];
  const last = STEPS.length - 1;
  return (
    <figure style={{ margin: "22px 0 26px", padding: "22px 22px 18px", borderRadius: "var(--r-l)", background: "var(--card)", boxShadow: "var(--sh-soft)" }}>
      {/* tape: cells with the head above the current one; the dots say it goes on in both directions */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 0, minWidth: "min-content", margin: "0 auto" }}>
          <span style={{ color: "var(--ink-3)", padding: "0 10px 12px", letterSpacing: 2 }}>…</span>
          {s.tape.map((c, k) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div aria-hidden="true" style={{ height: 22, color: s.halted ? "var(--green)" : "var(--lav)", visibility: k === s.head ? "visible" : "hidden" }}>
                <svg width="18" height="14" viewBox="0 0 18 14"><path d="M1 1h16L9 13z" fill="currentColor" /></svg>
              </div>
              <div style={{
                width: CELL, height: CELL, display: "grid", placeItems: "center",
                border: "1.5px solid var(--line-2)", marginLeft: k ? -1.5 : 0,
                background: k === s.head ? (s.halted ? "var(--green-soft)" : "var(--lav-soft)") : "var(--paper)",
                font: "600 22px/1 var(--f-mono)", color: "var(--ink)",
              }}>{c}</div>
            </div>
          ))}
          <span style={{ color: "var(--ink-3)", padding: "0 10px 12px", letterSpacing: 2 }}>…</span>
        </div>
      </div>

      <div style={{ display: "grid", gap: 6, maxWidth: 460, margin: "18px auto 0" }}>
        {RULES.map((r, k) => (
          <div key={k} style={{
            display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderRadius: "var(--r-s)", fontSize: 15,
            background: s.rule === k ? "var(--lav-soft)" : "transparent", color: s.rule === k ? "var(--ink)" : "var(--ink-2)",
            fontWeight: s.rule === k ? 600 : 400,
          }}>
            <span className="tnum" style={{ color: "var(--ink-3)", minWidth: 18 }}>{k + 1}.</span>{r}
          </div>
        ))}
      </div>

      <figcaption style={{ textAlign: "center", margin: "14px auto 12px", maxWidth: 520, color: "var(--ink-2)", fontSize: 15, lineHeight: 1.5, minHeight: 45 }}>{s.text}</figcaption>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
        <button className="icon-btn" onClick={() => setI(0)} disabled={i === 0} aria-label="В начало"><ChevronsLeft size={18} /></button>
        <button className="btn soft sm" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}><ChevronLeft size={16} />Назад</button>
        <span className="faint tnum" style={{ fontSize: 13, minWidth: 74, textAlign: "center" }}>шаг {i + 1} из {STEPS.length}</span>
        <button className="btn sm" onClick={() => setI(Math.min(last, i + 1))} disabled={i === last}>Вперёд<ChevronRight size={16} /></button>
      </div>
    </figure>
  );
}
