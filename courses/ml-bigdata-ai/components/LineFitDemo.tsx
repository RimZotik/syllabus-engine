import { useEffect, useMemo, useRef, useState } from "react";
import { usePageState } from "@syllabus/sdk";
import { Play, RotateCcw } from "lucide-react";

/** Price of a flat vs area: the learner tunes the two "knobs" of a linear model and sees the error. */
const DATA: [number, number][] = [[28, 4.1], [33, 4.6], [38, 5.6], [42, 5.9], [47, 6.9], [52, 7.2], [58, 8.4], [63, 8.8], [71, 10.1], [78, 10.6]];
const W = 560, H = 300, PAD = 44;
const X0 = 20, X1 = 90, Y0 = 0, Y1 = 14;
const sx = (x: number) => PAD + ((x - X0) / (X1 - X0)) * (W - PAD - 16);
const sy = (y: number) => H - PAD - ((y - Y0) / (Y1 - Y0)) * (H - PAD - 16);
const mse = (a: number, b: number) => DATA.reduce((s, [x, y]) => s + (a * x + b - y) ** 2, 0) / DATA.length;

export function LineFitDemo() {
  // the knobs stay where the learner left them
  const [a, setA] = usePageState("line-a", 0.05);
  const [b, setB] = usePageState("line-b", 5);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);
  const err = useMemo(() => mse(a, b), [a, b]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function train() {
    // Gradient descent on scaled x so both knobs move at a similar pace.
    let ca = a, cb = b, step = 0;
    setRunning(true);
    const tick = () => {
      for (let k = 0; k < 4; k++) {
        let ga = 0, gb = 0;
        for (const [x, y] of DATA) { const e = ca * x + cb - y; ga += (2 * e * x) / DATA.length; gb += (2 * e) / DATA.length; }
        ca -= 0.00022 * ga; cb -= 0.06 * gb;
      }
      setA(ca); setB(cb);
      if (++step < 180) raf.current = requestAnimationFrame(tick); else setRunning(false);
    };
    raf.current = requestAnimationFrame(tick);
  }

  return (
    <div className="viz">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 14 }}>
        <span className="eyebrow">Модель: цена = a × площадь + b</span>
        <span className="chip lav tnum">ошибка на примерах: {err.toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }} role="img" aria-label="Точки — квартиры, линия — модель">
        {[0, 4, 8, 12].map((v) => <g key={v}><line x1={PAD} x2={W - 16} y1={sy(v)} y2={sy(v)} stroke="var(--line)" /><text x={PAD - 8} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{v}</text></g>)}
        {[30, 50, 70, 90].map((v) => <text key={v} x={sx(v)} y={H - PAD + 18} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{v}</text>)}
        <text x={W - 16} y={H - 8} textAnchor="end" fontSize="12" fill="var(--ink-2)">площадь, м²</text>
        <text x={PAD} y={12} fontSize="12" fill="var(--ink-2)">цена, млн ₽</text>
        {DATA.map(([x, y]) => <line key={`e${x}`} x1={sx(x)} x2={sx(x)} y1={sy(y)} y2={sy(a * x + b)} stroke="var(--bad)" strokeDasharray="3 3" opacity=".6" />)}
        <line x1={sx(X0)} y1={sy(a * X0 + b)} x2={sx(X1)} y2={sy(a * X1 + b)} stroke="var(--green)" strokeWidth="2.5" />
        {DATA.map(([x, y]) => <circle key={x} cx={sx(x)} cy={sy(y)} r="5" fill="var(--lav)" />)}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}>
        <label className="muted" style={{ fontSize: 14 }}>a (наклон) = <b className="tnum">{a.toFixed(3)}</b>
          <input type="range" min="0" max="0.25" step="0.001" value={a} onChange={(e) => setA(+e.target.value)} style={{ width: "100%" }} disabled={running} /></label>
        <label className="muted" style={{ fontSize: 14 }}>b (сдвиг) = <b className="tnum">{b.toFixed(2)}</b>
          <input type="range" min="-4" max="8" step="0.01" value={b} onChange={(e) => setB(+e.target.value)} style={{ width: "100%" }} disabled={running} /></label>
      </div>
      <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
        <button className="btn sm" onClick={train} disabled={running}><Play size={15} />Обучить автоматически</button>
        <button className="btn sm soft" onClick={() => { setA(0.05); setB(5); }} disabled={running}><RotateCcw size={15} />Сбросить</button>
      </div>
      <p className="faint" style={{ fontSize: 14, margin: "12px 0 0" }}>Красные пунктиры — ошибки модели на каждом примере. Обучение — это подбор a и b, при котором они в сумме минимальны.</p>
    </div>
  );
}
