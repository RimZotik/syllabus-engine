import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { to } from "../current";
import { useApp } from "../state";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

/** Loss landscape with gradient-descent trails. Paused when off-screen or the tab is hidden; ~30 fps. */
function Landscape() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, t = 0.5, last = 0, raf = 0, visible = true;
    const wells = [[.72, .42, .18, -1.1], [.86, .72, .12, -.8], [.55, .8, .14, -.6], [.95, .25, .1, -.5], [.62, .2, .09, .5]];
    const f = (x: number, y: number) => { let v = .35 * ((x - .75) ** 2 + (y - .5) ** 2); for (const [cx, cy, s, a] of wells) { const ox = cx + .025 * Math.sin(t * .6 + cy * 9), oy = cy + .025 * Math.cos(t * .5 + cx * 7); v += a * Math.exp(-((x - ox) ** 2 + (y - oy) ** 2) / (2 * s * s)); } return v; };
    const spawn = () => ({ x: .58 + Math.random() * .4, y: .08 + Math.random() * .84, tr: [] as number[][] });
    const parts = Array.from({ length: 12 }, spawn);
    const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const resize = () => { const d = Math.min(devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const draw = () => {
      ctx.clearRect(0, 0, W, H); const asp = W / H, nx = 80, ny = Math.round(80 / asp) + 1, gx = W / nx, gy = H / ny, sy = 1.6 / asp, g: number[][] = [];
      for (let j = 0; j <= ny; j++) { g[j] = []; for (let i = 0; i <= nx; i++) g[j][i] = f(i / nx, (j / ny) * sy); }
      for (let k = 0; k < 14; k++) {
        const L = -1 + 1.25 * k / 14; ctx.beginPath();
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const a = g[j][i], b = g[j][i + 1], c = g[j + 1][i + 1], d = g[j + 1][i], x = i * gx, y = j * gy, p: number[][] = [];
          if ((a < L) !== (b < L)) p.push([x + gx * (L - a) / (b - a), y]); if ((b < L) !== (c < L)) p.push([x + gx, y + gy * (L - b) / (c - b)]);
          if ((d < L) !== (c < L)) p.push([x + gx * (L - d) / (c - d), y + gy]); if ((a < L) !== (d < L)) p.push([x, y + gy * (L - a) / (d - a)]);
          if (p.length >= 2) { ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); } if (p.length === 4) { ctx.moveTo(p[2][0], p[2][1]); ctx.lineTo(p[3][0], p[3][1]); }
        }
        ctx.strokeStyle = css("--green"); ctx.globalAlpha = k % 4 === 0 ? .28 : .12; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.globalAlpha = 1; if (W < 700) return; const e = 1e-3, lav = css("--lav");
      for (const p of parts) {
        const gxv = (f(p.x + e, p.y * sy) - f(p.x - e, p.y * sy)) / (2 * e), gyv = (f(p.x, (p.y + e) * sy) - f(p.x, (p.y - e) * sy)) / (2 * e);
        let dx = -.0035 * gxv, dy = -.0035 * gyv / sy; const m = Math.hypot(dx, dy); if (m > .004) { dx *= .004 / m; dy *= .004 / m; }
        p.x += dx; p.y += dy; p.tr.push([p.x * W, p.y * H]); if (p.tr.length > 60) p.tr.shift();
        if ((Math.hypot(gxv, gyv) < .02 && p.tr.length >= 60) || p.x < .5 || p.x > 1 || p.y < 0 || p.y > 1) Object.assign(p, spawn());
        ctx.beginPath(); p.tr.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.strokeStyle = lav; ctx.globalAlpha = .6; ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = 1;
      }
    };
    const loop = (ts: number) => { raf = 0; if (!visible || document.hidden) return; if (ts - last > 33) { t += .012; draw(); last = ts; } raf = requestAnimationFrame(loop); };
    const kick = () => { if (!still && !raf) raf = requestAnimationFrame(loop); };
    const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; kick(); }); io.observe(cv);
    const onResize = () => { resize(); draw(); };
    addEventListener("resize", onResize); document.addEventListener("visibilitychange", kick);
    resize(); draw(); kick();
    return () => { io.disconnect(); cancelAnimationFrame(raf); removeEventListener("resize", onResize); document.removeEventListener("visibilitychange", kick); };
  }, []);
  return <canvas ref={ref} aria-hidden="true" />;
}

/** «текст *выделение* текст» → выделение цветом, как в заголовке главной. */
function Emph({ text }: { text: string }) {
  return <>{text.split(/(\*[^*]+\*)/).map((s, i) => (s.startsWith("*") && s.endsWith("*") ? <em key={i}>{s.slice(1, -1)}</em> : s))}</>;
}

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

/** Landing of the active learning package: texts from its package.yaml, structure from its program.yaml. */
export function Home() {
  const { program, pkg, error } = useApp();
  const subjects = new Map<string, { title: string; cells: Record<string, number[]> }>();
  program?.courses.forEach((c) => c.disciplines.forEach((d) => {
    const s = subjects.get(d.subject) ?? { title: d.subjectTitle, cells: {} };
    (s.cells[c.id] ??= []).push(d.level); subjects.set(d.subject, s);
  }));
  const courses = program?.courses.length ?? 0;
  const discCount = program?.courses.reduce((n, c) => n + c.disciplines.length, 0) ?? 0;
  const stages = program?.levels ?? [];
  const hl = pkg?.landing.highlight_subject;
  if (error) return <div className="wrap stub"><h1>Нет связи с обучением</h1><p>{error}</p></div>;
  if (!program || !pkg) return <div className="wrap stub faint">Загружаю…</div>;

  return (
    <main>
      <section className="hero"><Landscape /><div className="wrap">
        <div className="eyebrow">{pkg.title} · {courses} {plural(courses, "курс", "курса", "курсов")} · {subjects.size} {plural(subjects.size, "предмет", "предмета", "предметов")} · {discCount} {plural(discCount, "дисциплина", "дисциплины", "дисциплин")}</div>
        <h1><Emph text={pkg.landing.headline} /></h1>
        <p className="lead">{pkg.landing.lead}</p>
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}><Link className="btn" to={to("/learn")}>{pkg.landing.cta} <ArrowRight size={16} /></Link></div>
      </div></section>
      {stages.length > 0 && (
        <section className="sec tint"><div className="wrap">
          <div className="sec-head"><div><div className="eyebrow">Как устроено обучение</div><h2>Как в университете, только под одну цель</h2></div><p>{stages.map((s) => s.title).join(" → ")}. Пока ступень не сдана и не закреплена, следующая не откроется. Забытое возвращается в тренажёр ровно тогда, когда начинает стираться.</p></div>
          <div className="steps">
            {stages.map((s, i) => <div className="step" key={s.id}><div className="n">{String(i + 1).padStart(2, "0")} · {s.title.toLowerCase()}</div><h3>{s.title}</h3><p>{s.gate}</p></div>)}
          </div>
        </div></section>
      )}
      <section className="sec"><div className="wrap">
        <div className="sec-head"><div><div className="eyebrow">Предметы</div><h2>Предметы растут вместе с вами</h2></div>{pkg.landing.subjects_lead && <p>{pkg.landing.subjects_lead}</p>}</div>
        <div className="matrix-wrap"><table className="matrix">
          <thead><tr><th>Предмет</th>{program.courses.map((c) => <th key={c.id}>{c.id}</th>)}</tr></thead>
          <tbody>{[...subjects.entries()].map(([id, s]) => {
            const single = Object.values(s.cells).flat().length === 1;
            return <tr key={id}><td>{s.title}</td>{program.courses.map((c) => <td key={c.id}>{(s.cells[c.id] ?? []).map((l) => <span key={l} className={`lv${id === hl ? " lavv" : ""}`}>{single ? "•" : ROMAN[l]}</span>)}</td>)}</tr>;
          })}</tbody>
        </table></div>
      </div></section>
    </main>
  );
}
