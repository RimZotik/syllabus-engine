import { useId } from "react";
import { usePageState } from "@syllabus/sdk";
import { num } from "./NeuronDiagram";

/**
 * The staircase lamp (exclusive OR) from intro1.history.2 solved by three neurons in two layers.
 * Inputs — the two switches (click to raise or lower). Middle layer — «хотя бы один поднят» and «подняты оба».
 * Output neuron — the lamp. Every neuron shows its sum and fills in when it answers 1; under the drawing — each sum
 * written out, the table of all four cases and the plane with the two lines of the first layer and the lit band between them.
 * MDX: <XorNetwork />
 */
type Bit = 0 | 1;
type Neuron = { name: string; w: [number, number]; t: number };
const A: Neuron = { name: "хотя бы один поднят", w: [1, 1], t: 0 };
const B: Neuron = { name: "подняты оба", w: [1, 1], t: 1 };
const C: Neuron = { name: "лампа", w: [1, -1], t: 0 };
const SWITCHES = ["нижний", "верхний"];

const sumOf = (n: Neuron, x: Bit[]) => n.w[0] * x[0] + n.w[1] * x[1];
const fire = (n: Neuron, x: Bit[]): Bit => (sumOf(n, x) > n.t ? 1 : 0);
function run(x: Bit[]) {
  const h: Bit[] = [fire(A, x), fire(B, x)];
  return { h, out: fire(C, h) };
}
/** "1 × 1 + 1 × 0 = 1"; a negative weight goes in brackets. */
const calc = (n: Neuron, x: Bit[]) =>
  `${num(n.w[0])} × ${x[0]} + ${n.w[1] < 0 ? `(${num(n.w[1])})` : num(n.w[1])} × ${x[1]} = ${num(sumOf(n, x))}`;

const font = { fontFamily: "var(--f-text)" } as const;
const IN_X = 60, MID_X = 250, OUT_X = 400, ROW = [80, 220], OUT_Y = 150, R = 30;

function Edge({ x1, y1, x2, y2, on, w, t = 0.5 }: { x1: number; y1: number; x2: number; y2: number; on: boolean; w: number; t?: number }) {
  const lx = x1 + (x2 - x1) * t, ly = y1 + (y2 - y1) * t;
  return <g>
    <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={on ? 2.4 : 1.4} style={{ stroke: on ? "var(--lav)" : "var(--line-2)" }} />
    <rect x={lx - 17} y={ly - 11} width={34} height={22} rx={11} style={{ fill: "var(--paper)", stroke: "var(--line-2)" }} />
    <text x={lx} y={ly + 4.5} textAnchor="middle" fontSize="12.5" {...font} style={{ fill: "var(--ink-2)" }}>{num(w)}</text>
  </g>;
}

function Node({ cx, cy, sum, on, accent }: { cx: number; cy: number; sum: number; on: boolean; accent: "lav" | "green" }) {
  const col = accent === "lav" ? "var(--lav)" : "var(--green)";
  return <g>
    <circle cx={cx} cy={cy} r={R} strokeWidth="1.8"
      style={{ fill: on ? (accent === "lav" ? "var(--lav-soft)" : "var(--green-soft)") : "var(--paper)", stroke: on ? col : "var(--ink-3)" }} />
    <text x={cx} y={cy - 6} textAnchor="middle" fontSize="10.5" {...font} style={{ fill: "var(--ink-3)" }}>сумма</text>
    <text x={cx} y={cy + 14} textAnchor="middle" fontSize="18" fontWeight="700" {...font} style={{ fill: on ? col : "var(--ink)" }}>{num(sum)}</text>
  </g>;
}

function Lamp({ cx, cy, on }: { cx: number; cy: number; on: boolean }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    return `M${cx + 15 * c},${cy + 15 * s} L${cx + 21 * c},${cy + 21 * s}`;
  }).join(" ");
  return <g>
    {on && <path d={rays} strokeWidth="2" strokeLinecap="round" style={{ stroke: "var(--green)" }} />}
    <circle cx={cx} cy={cy} r={11} strokeWidth="2" style={{ fill: on ? "var(--green)" : "var(--paper)", stroke: on ? "var(--green)" : "var(--ink-3)" }} />
    <text x={cx} y={cy + 40} textAnchor="middle" fontSize="12" {...font} style={{ fill: on ? "var(--green)" : "var(--ink-2)" }}>{on ? "горит" : "темно"}</text>
  </g>;
}

export function XorNetwork() {
  const [x, setX] = usePageState<Bit[]>("xor-net-switches", [1, 0]);
  const { h, out } = run(x);
  const flip = (k: number) => setX(x.map((v, i) => (i === k ? (1 - v) as Bit : v)));
  const mid = [A, B];
  const cases: Bit[][] = [[0, 0], [1, 0], [0, 1], [1, 1]];

  return (
    <figure style={{ margin: "22px 0 26px", padding: "20px 18px 18px", borderRadius: "var(--r-l)", background: "var(--card)", boxShadow: "var(--sh-soft)" }}>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox="0 0 512 316" width="100%" style={{ minWidth: 340, maxWidth: 620, display: "block", margin: "0 auto" }} role="img"
          aria-label={`Сеть из трёх нейронов: нижний выключатель ${x[0] ? "поднят" : "опущен"}, верхний ${x[1] ? "поднят" : "опущен"}; «хотя бы один поднят» — ${h[0]}, «подняты оба» — ${h[1]}; лампа ${out ? "горит" : "не горит"}`}>
          {/* column titles, under the drawing */}
          <text x={IN_X} y={310} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>входы</text>
          <text x={MID_X} y={310} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>первый слой</text>
          <text x={OUT_X} y={310} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>второй слой</text>

          {/* switches → middle layer: every switch goes to both neurons */}
          {mid.map((n, j) => [0, 1].map((k) => (
            <Edge key={`${j}${k}`} x1={IN_X + 24} y1={ROW[k]} x2={MID_X - R} y2={ROW[j]} on={x[k] === 1} w={n.w[k]} t={0.72} />
          )))}
          {/* middle layer → lamp neuron */}
          {[0, 1].map((j) => (
            <Edge key={j} x1={MID_X + R} y1={ROW[j]} x2={OUT_X - R} y2={OUT_Y} on={h[j] === 1} w={C.w[j]} />
          ))}
          <line x1={OUT_X + R} y1={OUT_Y} x2={448} y2={OUT_Y} strokeWidth={out ? 2.4 : 1.4} style={{ stroke: out ? "var(--green)" : "var(--line-2)" }} />

          {/* switches: click to raise or lower */}
          {[0, 1].map((k) => (
            <g key={k} role="button" tabIndex={0} aria-label={`${SWITCHES[k]} выключатель: переключить`} style={{ cursor: "pointer" }}
              onClick={() => flip(k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(k); } }}>
              <circle cx={IN_X} cy={ROW[k]} r={24} strokeWidth="1.8"
                style={{ fill: x[k] ? "var(--lav-soft)" : "var(--paper)", stroke: x[k] ? "var(--lav)" : "var(--ink-3)" }} />
              <text x={IN_X} y={ROW[k] + 7} textAnchor="middle" fontSize="20" fontWeight="700" {...font} style={{ fill: x[k] ? "var(--lav)" : "var(--ink-3)" }}>{x[k]}</text>
              <text x={IN_X} y={k ? ROW[k] + 42 : ROW[k] - 32} textAnchor="middle" fontSize="12" {...font} style={{ fill: "var(--ink-2)" }}>
                {SWITCHES[k]}: {x[k] ? "поднят" : "опущен"}
              </text>
            </g>
          ))}

          {/* middle layer: name and rule above the top neuron, below the bottom one */}
          {mid.map((n, j) => {
            const y0 = j ? ROW[j] + R + 18 : ROW[j] - R - 26;
            return <g key={j}>
              <Node cx={MID_X} cy={ROW[j]} sum={sumOf(n, x)} on={h[j] === 1} accent="lav" />
              <text x={MID_X} y={y0} textAnchor="middle" fontSize="12.5" fontWeight="700" {...font} style={{ fill: "var(--ink)" }}>«{n.name}»</text>
              <text x={MID_X} y={y0 + 15} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-2)" }}>1, если сумма больше {n.t}</text>
            </g>;
          })}

          {/* output neuron and the lamp */}
          <Node cx={OUT_X} cy={OUT_Y} sum={sumOf(C, h)} on={out === 1} accent="green" />
          <text x={OUT_X} y={OUT_Y - R - 40} textAnchor="middle" fontSize="12.5" fontWeight="700" {...font} style={{ fill: "var(--ink)" }}>«лампа»</text>
          <text x={OUT_X} y={OUT_Y - R - 26} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-2)" }}>1, если сумма больше {C.t}</text>
          <Lamp cx={468} cy={OUT_Y} on={out === 1} />
        </svg>
      </div>

      {/* each sum written out */}
      <div className="tnum" style={{ display: "grid", gap: 4, maxWidth: 520, margin: "10px auto 0", fontSize: 14.5, lineHeight: 1.45 }}>
        {[...mid.map((n, j) => ({ n, inp: x, o: h[j] })), { n: C, inp: h, o: out }].map(({ n, inp, o }) => (
          <div key={n.name} style={{ color: "var(--ink-2)" }}>
            <b style={{ color: "var(--ink)" }}>«{n.name}»:</b> {calc(n, inp)} — {o ? "больше" : "не больше"} {n.t}, ответ <b style={{ color: o ? (n === C ? "var(--green)" : "var(--lav)") : "var(--ink)" }}>{o}</b>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 14 }}>
        {SWITCHES.map((s, k) => (
          <button key={k} className="btn soft sm" onClick={() => flip(k)}>{s}: {x[k] ? "поднят" : "опущен"}</button>
        ))}
      </div>

      {/* all four cases; the current one is highlighted, a click on a row sets the switches */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 18, marginTop: 14 }}>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table className="tnum" style={{ borderCollapse: "collapse", margin: "0 auto", fontSize: 13.5, textAlign: "center" }}>
          <thead>
            <tr style={{ color: "var(--ink-3)" }}>
              {["нижний", "верхний", "«хотя бы один»", "«оба»", "лампа"].map((t) => (
                <th key={t} style={{ fontWeight: 600, padding: "4px 10px", borderBottom: "1px solid var(--line-2)" }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const r = run(c), cur = c[0] === x[0] && c[1] === x[1];
              return (
                <tr key={c.join("")} onClick={() => setX(c)} style={{ cursor: "pointer", background: cur ? "var(--lav-soft)" : "transparent", color: cur ? "var(--ink)" : "var(--ink-2)" }}>
                  <td style={{ padding: "4px 10px" }}>{c[0]}</td>
                  <td style={{ padding: "4px 10px" }}>{c[1]}</td>
                  <td style={{ padding: "4px 10px" }}>{r.h[0]}</td>
                  <td style={{ padding: "4px 10px" }}>{r.h[1]}</td>
                  <td style={{ padding: "4px 10px", fontWeight: 700, color: r.out ? "var(--green)" : "inherit" }}>{r.out ? "горит" : "темно"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <XorPlane x={x} pick={setX} />
      </div>

      <figcaption style={{ textAlign: "center", margin: "12px auto 0", maxWidth: 540, color: "var(--ink-2)", fontSize: 14, lineHeight: 1.5 }}>
        Нажимайте на выключатели, строки таблицы или точки. Число на линии — вес. Закрашенный нейрон отвечает 1, пустой — 0. На плоскости: пунктир 1 — прямая первого нейрона, пунктир 2 — второго; зелёная полоса между ними — там лампа горит.
      </figcaption>
    </figure>
  );
}

/**
 * The four switch positions as points (horizontal — lower switch, vertical — upper), the line of each first-layer neuron
 * and the band between them where the lamp is lit. The sums here are only 0, 1 or 2, so each line is drawn halfway
 * between neighbouring sums (x + y = 0,5 and 1,5): the answers are the same, the picture is clearer.
 */
function XorPlane({ x, pick }: { x: Bit[]; pick: (v: Bit[]) => void }) {
  const clip = useId();
  const S = 80, X0 = 40, Y0 = 186; // domain [-0.5; 1.5] in both directions
  const px = (v: number) => X0 + (v + 0.5) * S;
  const py = (v: number) => Y0 - (v + 0.5) * S;
  const pt = (a: number, b: number) => `${px(a)},${py(b)}`;
  const lines = [0.5, 1.5];
  const badge = [[-0.3, 0.8], [0.3, 1.2]] as const; // where the "1" and "2" labels sit on their lines
  const cases: Bit[][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
  return (
    <svg viewBox="0 0 210 222" width="210" style={{ maxWidth: "100%", flex: "0 0 auto" }} role="img"
      aria-label="Четыре положения выключателей точками на плоскости, две прямые нейронов первого слоя и полоса между ними, где лампа горит">
      <defs><clipPath id={clip}><rect x={px(-0.5)} y={py(1.5)} width={2 * S} height={2 * S} /></clipPath></defs>
      <polygon clipPath={`url(#${clip})`} points={`${pt(10.5, -10)} ${pt(-10, 10.5)} ${pt(-10, 11.5)} ${pt(11.5, -10)}`} style={{ fill: "var(--green-soft)" }} />
      <line x1={px(0)} y1={py(-0.5)} x2={px(0)} y2={py(1.5)} strokeWidth="1" style={{ stroke: "var(--ink-3)" }} />
      <line x1={px(-0.5)} y1={py(0)} x2={px(1.5)} y2={py(0)} strokeWidth="1" style={{ stroke: "var(--ink-3)" }} />
      {lines.map((c, i) => (
        <g key={c}>
          <line clipPath={`url(#${clip})`} x1={px(c + 10)} y1={py(-10)} x2={px(-10)} y2={py(c + 10)} strokeWidth="2" strokeDasharray="6 4" style={{ stroke: "var(--ink)" }} />
          <circle cx={px(badge[i][0])} cy={py(badge[i][1])} r={9} strokeWidth="1.4" style={{ fill: "var(--paper)", stroke: "var(--ink-2)" }} />
          <text x={px(badge[i][0])} y={py(badge[i][1]) + 4} textAnchor="middle" fontSize="11" fontWeight="700" {...font} style={{ fill: "var(--ink)" }}>{i + 1}</text>
        </g>
      ))}
      <text x={px(0)} y={Y0 + 14} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>0</text>
      <text x={px(1)} y={Y0 + 14} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>1</text>
      <text x={X0 - 6} y={py(0) + 4} textAnchor="end" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>0</text>
      <text x={X0 - 6} y={py(1) + 4} textAnchor="end" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>1</text>
      <text x={px(0.5)} y={Y0 + 30} textAnchor="middle" fontSize="11.5" {...font} style={{ fill: "var(--ink-2)" }}>нижний →</text>
      <text x={14} y={py(0.5)} textAnchor="middle" fontSize="11.5" {...font} transform={`rotate(-90 14 ${py(0.5)})`} style={{ fill: "var(--ink-2)" }}>верхний →</text>
      {cases.map((c) => {
        const lit = run(c).out === 1, cur = c[0] === x[0] && c[1] === x[1];
        const cx = px(c[0]), cy = py(c[1]);
        const rays = Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4, co = Math.cos(a), si = Math.sin(a);
          return `M${cx + 12 * co},${cy + 12 * si} L${cx + 17 * co},${cy + 17 * si}`;
        }).join(" ");
        return <g key={c.join("")} role="button" tabIndex={0} aria-label={`нижний ${c[0]}, верхний ${c[1]}`} style={{ cursor: "pointer" }}
          onClick={() => pick(c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(c); } }}>
          {cur && <circle cx={cx} cy={cy} r={21} fill="none" strokeWidth="2.4" style={{ stroke: "var(--lav)" }} />}
          {lit && <path d={rays} strokeWidth="2" strokeLinecap="round" style={{ stroke: "var(--green)" }} />}
          <circle cx={cx} cy={cy} r={8} strokeWidth="2" style={{ fill: lit ? "var(--green)" : "var(--paper)", stroke: lit ? "var(--green)" : "var(--ink-3)" }} />
        </g>;
      })}
    </svg>
  );
}
