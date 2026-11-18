import { useId } from "react";
import { usePageState } from "@syllabus/sdk";

/**
 * One neuron of the spam filter from intro1.history.2: two inputs (0/1) times their weights, the sum, the threshold, the answer.
 * The learner toggles the inputs and the weights «before / after training» and sees the sum and the answer change.
 * With `plane` it also draws the four possible letters as points on a plane and the straight line the neuron draws between
 * «спам» and «не спам». Both copies on a page share the same state.
 * MDX: <NeuronDiagram /> or <NeuronDiagram plane />
 */
type Bit = 0 | 1;
const THRESHOLD = 1;
const WEIGHTS = { before: 0.5, after: 1 } as const;
type Stage = keyof typeof WEIGHTS;
const INPUTS = [
  { name: "слово «выигрыш»", on: "есть", off: "нет" },
  { name: "отправитель", on: "незнакомый", off: "знакомый" },
];

/** Russian number: decimal comma, real minus sign. */
export const num = (n: number) => String(n).replace(".", ",").replace("-", "−");

const font = { fontFamily: "var(--f-text)" } as const;

export function NeuronDiagram({ plane = false }: { plane?: boolean }) {
  const [x, setX] = usePageState<Bit[]>("neuron-spam-inputs", [1, 1]);
  const [stage, setStage] = usePageState<Stage>("neuron-spam-weights", "before");
  const w = WEIGHTS[stage];
  const sum = w * x[0] + w * x[1];
  const spam = sum > THRESHOLD;
  const flip = (k: number) => setX(x.map((v, i) => (i === k ? (1 - v) as Bit : v)));

  return (
    <figure style={{ margin: "22px 0 26px", padding: "20px 18px 18px", borderRadius: "var(--r-l)", background: "var(--card)", boxShadow: "var(--sh-soft)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 14 }}>
        <button className={`chip ${stage === "before" ? "lav" : ""}`} onClick={() => setStage("before")}>веса до обучения: 0,5 и 0,5</button>
        <button className={`chip ${stage === "after" ? "lav" : ""}`} onClick={() => setStage("after")}>после обучения: 1 и 1</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 18 }}>
        <div style={{ overflowX: "auto", flex: "1 1 340px", maxWidth: 460 }}>
          <svg viewBox="0 0 420 200" width="100%" style={{ minWidth: 330, display: "block" }} role="img"
            aria-label={`Нейрон: входы ${x[0]} и ${x[1]}, веса ${num(w)}, сумма ${num(sum)}, порог ${THRESHOLD}, ответ — ${spam ? "спам" : "не спам"}`}>
            {/* edges from inputs to the neuron, with the weight written on each */}
            {[50, 150].map((y, k) => (
              <g key={k}>
                <line x1={96} y1={y} x2={212} y2={100 + (k ? 16 : -16)} strokeWidth={x[k] ? 2.4 : 1.4}
                  style={{ stroke: x[k] ? "var(--lav)" : "var(--line-2)" }} />
                <rect x={128} y={k ? 122 : 56} width={52} height={22} rx={11} style={{ fill: "var(--paper)", stroke: "var(--line-2)" }} />
                <text x={154} y={k ? 138 : 72} textAnchor="middle" fontSize="13" {...font} style={{ fill: "var(--ink-2)" }}>× {num(w)}</text>
              </g>
            ))}
            {/* inputs: click to switch 0/1 */}
            {[50, 150].map((y, k) => (
              <g key={k} role="button" tabIndex={0} aria-label={`${INPUTS[k].name}: переключить`} style={{ cursor: "pointer" }}
                onClick={() => flip(k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(k); } }}>
                <circle cx={70} cy={y} r={24} strokeWidth="1.8"
                  style={{ fill: x[k] ? "var(--lav-soft)" : "var(--paper)", stroke: x[k] ? "var(--lav)" : "var(--ink-3)" }} />
                <text x={70} y={y + 7} textAnchor="middle" fontSize="20" fontWeight="700" {...font} style={{ fill: x[k] ? "var(--lav)" : "var(--ink-3)" }}>{x[k]}</text>
                <text x={70} y={k ? y + 42 : y - 32} textAnchor="middle" fontSize="12" {...font} style={{ fill: "var(--ink-2)" }}>{INPUTS[k].name}</text>
              </g>
            ))}
            {/* the neuron: sum and threshold */}
            <circle cx={250} cy={100} r={42} strokeWidth="1.8" style={{ fill: "var(--paper)", stroke: "var(--ink-2)" }} />
            <text x={250} y={88} textAnchor="middle" fontSize="11.5" {...font} style={{ fill: "var(--ink-3)" }}>сумма</text>
            <text x={250} y={110} textAnchor="middle" fontSize="20" fontWeight="700" {...font} style={{ fill: "var(--ink)" }}>{num(sum)}</text>
            <text x={250} y={127} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>порог {THRESHOLD}</text>
            {/* arrow to the answer */}
            <line x1={292} y1={100} x2={318} y2={100} strokeWidth="1.8" style={{ stroke: "var(--ink-3)" }} />
            <polyline points="312,95 319,100 312,105" fill="none" strokeWidth="1.8" style={{ stroke: "var(--ink-3)" }} />
            <rect x={324} y={82} width={88} height={36} rx={18} strokeWidth="1.8"
              style={{ fill: spam ? "var(--green-soft)" : "var(--paper)", stroke: spam ? "var(--green)" : "var(--line-2)" }} />
            <text x={368} y={105} textAnchor="middle" fontSize="14" fontWeight="700" {...font} style={{ fill: spam ? "var(--green)" : "var(--ink-2)" }}>{spam ? "спам" : "не спам"}</text>
          </svg>
        </div>
        {plane && <Plane x={x} w={w} />}
      </div>

      <div className="tnum" style={{ textAlign: "center", margin: "12px auto 4px", fontSize: 15, color: "var(--ink)" }}>
        {num(w)} × {x[0]} + {num(w)} × {x[1]} = {num(sum)}
        <span style={{ color: "var(--ink-2)" }}> — {spam ? `больше ${THRESHOLD}` : `не больше ${THRESHOLD}`}, ответ «{spam ? "спам" : "не спам"}»</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 12 }}>
        {INPUTS.map((inp, k) => (
          <button key={k} className="btn soft sm" onClick={() => flip(k)}>{inp.name}: {x[k] ? inp.on : inp.off}</button>
        ))}
      </div>
      <figcaption style={{ textAlign: "center", margin: "12px auto 0", maxWidth: 520, color: "var(--ink-2)", fontSize: 14, lineHeight: 1.5 }}>
        {plane
          ? "Каждое письмо — точка. Зелёная область — «спам». Её граница — прямая: на ней сумма ровно равна порогу. Переключите веса: прямая сдвинется, но останется прямой."
          : "Нажимайте на входы или кнопки: каждый вход умножается на свой вес, произведения складываются, сумма сравнивается с порогом."}
      </figcaption>
    </figure>
  );
}

/** The four letters as points (horizontal — «выигрыш», vertical — unknown sender) and the line where the sum equals the threshold. */
function Plane({ x, w }: { x: Bit[]; w: number }) {
  const clip = useId();
  const S = 80, X0 = 40, Y0 = 186; // domain [-0.5; 1.5] in both directions
  const px = (v: number) => X0 + (v + 0.5) * S;
  const py = (v: number) => Y0 - (v + 0.5) * S;
  const c = THRESHOLD / w; // the line: x + y = c
  const pt = (a: number, b: number) => `${px(a)},${py(b)}`;
  return (
    <svg viewBox="0 0 210 220" width="210" style={{ maxWidth: "100%", flex: "0 0 auto" }} role="img"
      aria-label="Четыре письма точками на плоскости и прямая, отделяющая спам">
      <defs><clipPath id={clip}><rect x={px(-0.5)} y={py(1.5)} width={2 * S} height={2 * S} /></clipPath></defs>
      <polygon clipPath={`url(#${clip})`} points={`${pt(c + 10, -10)} ${pt(-10, c + 10)} ${pt(c + 10, c + 10)}`} style={{ fill: "var(--green-soft)" }} />
      <line x1={px(0)} y1={py(-0.5)} x2={px(0)} y2={py(1.5)} strokeWidth="1" style={{ stroke: "var(--ink-3)" }} />
      <line x1={px(-0.5)} y1={py(0)} x2={px(1.5)} y2={py(0)} strokeWidth="1" style={{ stroke: "var(--ink-3)" }} />
      <line clipPath={`url(#${clip})`} x1={px(c + 10)} y1={py(-10)} x2={px(-10)} y2={py(c + 10)} strokeWidth="2" strokeDasharray="6 4" style={{ stroke: "var(--ink)" }} />
      <text x={px(0)} y={Y0 + 14} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>0</text>
      <text x={px(1)} y={Y0 + 14} textAnchor="middle" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>1</text>
      <text x={X0 - 6} y={py(0) + 4} textAnchor="end" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>0</text>
      <text x={X0 - 6} y={py(1) + 4} textAnchor="end" fontSize="11" {...font} style={{ fill: "var(--ink-3)" }}>1</text>
      <text x={px(0.5)} y={Y0 + 30} textAnchor="middle" fontSize="11.5" {...font} style={{ fill: "var(--ink-2)" }}>«выигрыш» →</text>
      <text x={14} y={py(0.5)} textAnchor="middle" fontSize="11.5" {...font} transform={`rotate(-90 14 ${py(0.5)})`} style={{ fill: "var(--ink-2)" }}>незнакомец →</text>
      {([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([a, b]) => {
        const yes = w * a + w * b > THRESHOLD, cur = a === x[0] && b === x[1];
        return <g key={`${a}${b}`}>
          {cur && <circle cx={px(a)} cy={py(b)} r={15} fill="none" strokeWidth="2.4" style={{ stroke: "var(--lav)" }} />}
          <circle cx={px(a)} cy={py(b)} r={8} strokeWidth="2" style={{ fill: yes ? "var(--green)" : "var(--paper)", stroke: yes ? "var(--green)" : "var(--ink-3)" }} />
        </g>;
      })}
    </svg>
  );
}
