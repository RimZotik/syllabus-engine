import { useEffect, useRef } from "react";
import { usePageState } from "@syllabus/sdk";
import { Eraser } from "lucide-react";

/** "A model learns from points": click to add examples of two classes; the plane is coloured by k nearest neighbours. */
type P = { x: number; y: number; c: 0 | 1 };
const START: P[] = [
  { x: .2, y: .25, c: 0 }, { x: .3, y: .35, c: 0 }, { x: .25, y: .6, c: 0 }, { x: .4, y: .2, c: 0 },
  { x: .7, y: .7, c: 1 }, { x: .8, y: .55, c: 1 }, { x: .65, y: .85, c: 1 }, { x: .85, y: .8, c: 1 },
];

export function KnnDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  // remembered for this topic: the learner comes back to the same points and k
  const [pts, setPts] = usePageState<P[]>("knn-points", START);
  const [cls, setCls] = usePageState<0 | 1>("knn-class", 0);
  const [k, setK] = usePageState("knn-k", 3);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const css = getComputedStyle(document.documentElement);
    const colors = [css.getPropertyValue("--green").trim(), css.getPropertyValue("--lav").trim()];
    const ink = css.getPropertyValue("--ink-3").trim();
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const step = 12;
    if (pts.length) for (let px = 0; px < W; px += step) for (let py = 0; py < H; py += step) {
      const x = (px + step / 2) / W, y = (py + step / 2) / H;
      const near = [...pts].sort((p, q) => (p.x - x) ** 2 + (p.y - y) ** 2 - ((q.x - x) ** 2 + (q.y - y) ** 2)).slice(0, Math.min(k, pts.length));
      const vote = near.filter((p) => p.c === 1).length / near.length;
      ctx.fillStyle = vote === .5 ? ink : colors[vote > .5 ? 1 : 0]; ctx.globalAlpha = vote === .5 ? .08 : .13 + Math.abs(vote - .5) * .2; // a tie has no winner
      ctx.fillRect(px, py, step, step);
    }
    ctx.globalAlpha = 1;
    for (const p of pts) { ctx.beginPath(); if (p.c === 1) ctx.rect(p.x * W - 6.5, p.y * H - 6.5, 13, 13); else ctx.arc(p.x * W, p.y * H, 7, 0, 7); ctx.fillStyle = colors[p.c]; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = css.getPropertyValue("--card").trim(); ctx.stroke(); }
  }, [pts, k]);

  return (
    <div className="viz">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 14 }}>
        <span className="eyebrow">Нажмите на поле, чтобы добавить пример</span>
        <div className="row">
          <button className={`chip ${cls === 0 ? "green" : ""}`} onClick={() => setCls(0)}>класс «зелёные круги»</button>
          <button className={`chip ${cls === 1 ? "lav" : ""}`} onClick={() => setCls(1)}>класс «фиолетовые квадраты»</button>
        </div>
      </div>
      <canvas ref={ref} style={{ width: "100%", height: 340, borderRadius: 12, background: "var(--paper)", cursor: "crosshair", display: "block" }}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPts([...pts, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, c: cls }]); }} />
      <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 18 }}>
        <label className="muted" style={{ fontSize: 14, flex: 1, minWidth: 220 }}>Сколько соседей спрашивать: <b className="tnum">{k}</b>
          <input type="range" min="1" max="9" step="2" value={k} onChange={(e) => setK(+e.target.value)} style={{ width: "100%" }} /></label>
        <button className="btn sm soft" onClick={() => setPts([])}><Eraser size={15} />Очистить</button>
      </div>
    </div>
  );
}
