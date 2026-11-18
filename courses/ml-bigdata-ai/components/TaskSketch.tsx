import type { ReactNode } from "react";

/**
 * Small line drawings of the main ML task types, in the site's palette.
 * Every colour is a theme token, so the drawings follow the light and dark themes by themselves.
 * MDX: <TaskSketch kind="classification" />
 */
type Kind = "classification" | "regression" | "ranking" | "clustering" | "generation";

const W = 380, H = 150;
const STROKE = "var(--ink-2)";
const font = { fontFamily: "var(--f-text)", fontSize: 11.5, fill: "var(--ink-2)" } as const;

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; y2: number; x2: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 6;
  const p = (da: number) => `${x2 - s * Math.cos(a + da)},${y2 - s * Math.sin(a + da)}`;
  return <g stroke="var(--ink-3)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1={x1} y1={y1} x2={x2} y2={y2} /><polyline points={`${p(0.5)} ${x2},${y2} ${p(-0.5)}`} />
  </g>;
}

function Model({ x, y, w = 76, h = 40 }: { x: number; y: number; w?: number; h?: number }) {
  return <g>
    <rect x={x} y={y} width={w} height={h} rx="10" fill="var(--lav-soft)" stroke="var(--lav)" strokeWidth="1.6" />
    <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" {...font} fill="var(--lav)" fontWeight="700">модель</text>
  </g>;
}

function Frame({ x, y, w, h, children, accent }: { x: number; y: number; w: number; h: number; children?: ReactNode; accent?: boolean }) {
  return <g>
    <rect x={x} y={y} width={w} height={h} rx="8" fill="var(--card)" stroke={accent ? "var(--green)" : "var(--line-2)"} strokeWidth={accent ? 2 : 1.4} />
    {children}
  </g>;
}

/** Cat face outline centred at (cx, cy); `hat` adds a top hat (the "new" picture in generation). */
function Cat({ cx, cy, k = 1, hat }: { cx: number; cy: number; k?: number; hat?: boolean }) {
  const P = (x: number, y: number) => `${cx + x * k},${cy + y * k}`;
  return <g stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
    <polygon points={`${P(-14, -7)} ${P(-12, -23)} ${P(-2, -15)}`} fill="var(--card)" />
    <polygon points={`${P(14, -7)} ${P(12, -23)} ${P(2, -15)}`} fill="var(--card)" />
    <circle cx={cx} cy={cy} r={16 * k} fill="var(--card)" />
    <circle cx={cx - 6 * k} cy={cy - 3 * k} r={1.6 * k} fill={STROKE} stroke="none" />
    <circle cx={cx + 6 * k} cy={cy - 3 * k} r={1.6 * k} fill={STROKE} stroke="none" />
    <polygon points={`${P(-2, 3)} ${P(2, 3)} ${P(0, 5.5)}`} fill={STROKE} />
    <g fill="none" strokeWidth="1">
      <line x1={cx - 4 * k} y1={cy + 5 * k} x2={cx - 20 * k} y2={cy + 2 * k} />
      <line x1={cx - 4 * k} y1={cy + 7 * k} x2={cx - 19 * k} y2={cy + 9 * k} />
      <line x1={cx + 4 * k} y1={cy + 5 * k} x2={cx + 20 * k} y2={cy + 2 * k} />
      <line x1={cx + 4 * k} y1={cy + 7 * k} x2={cx + 19 * k} y2={cy + 9 * k} />
    </g>
    {hat && <g fill="var(--lav-soft)" stroke="var(--lav)">
      <rect x={cx - 9 * k} y={cy - 33 * k} width={18 * k} height={16 * k} rx={2 * k} />
      <line x1={cx - 15 * k} y1={cy - 17 * k} x2={cx + 15 * k} y2={cy - 17 * k} strokeWidth="2" />
    </g>}
  </g>;
}

function Dog({ cx, cy }: { cx: number; cy: number }) {
  return <g stroke={STROKE} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="var(--card)">
    <circle cx={cx} cy={cy} r="16" />
    <path d={`M${cx - 13},${cy - 10} C${cx - 26},${cy - 10} ${cx - 25},${cy + 8} ${cx - 17},${cy + 10} Z`} />
    <path d={`M${cx + 13},${cy - 10} C${cx + 26},${cy - 10} ${cx + 25},${cy + 8} ${cx + 17},${cy + 10} Z`} />
    <circle cx={cx - 6} cy={cy - 3} r="1.6" fill={STROKE} stroke="none" />
    <circle cx={cx + 6} cy={cy - 3} r="1.6" fill={STROKE} stroke="none" />
    <ellipse cx={cx} cy={cy + 5} rx="4" ry="2.8" fill={STROKE} />
    <path d={`M${cx},${cy + 8} v3 M${cx - 4},${cy + 12} q4,3 8,0`} fill="none" strokeWidth="1.2" />
  </g>;
}

function Verdict({ x, y, ok, text }: { x: number; y: number; ok: boolean; text: string }) {
  const c = ok ? "var(--green)" : "var(--bad)";
  return <g>
    <rect x={x} y={y} width="104" height="30" rx="15" fill={ok ? "var(--green-soft)" : "var(--bad-soft)"} />
    <g stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
      {ok ? <polyline points={`${x + 13},${y + 15} ${x + 18},${y + 20} ${x + 27},${y + 10}`} />
        : <path d={`M${x + 14},${y + 10} l10,10 M${x + 24},${y + 10} l-10,10`} />}
    </g>
    <text x={x + 36} y={y + 19.5} {...font} fill={c} fontWeight="700">{text}</text>
  </g>;
}

function Classification() {
  return <>
    <Frame x={8} y={6} w={84} h={62}><Cat cx={50} cy={42} /></Frame>
    <Frame x={8} y={82} w={84} h={62}><Dog cx={50} cy={113} /></Frame>
    <Arrow x1={96} y1={37} x2={140} y2={66} />
    <Arrow x1={96} y1={113} x2={140} y2={86} />
    <Model x={144} y={56} />
    <Arrow x1={224} y1={66} x2={262} y2={37} />
    <Arrow x1={224} y1={86} x2={262} y2={113} />
    <Verdict x={268} y={22} ok text="кошка" />
    <Verdict x={268} y={98} ok={false} text="не кошка" />
  </>;
}

const PTS: [number, number][] = [[62, 108], [84, 104], [100, 92], [122, 96], [140, 80], [160, 84], [182, 68], [204, 70], [222, 58], [246, 56]];
const lineY = (x: number) => 114 - (x - 50) * 0.29;

function Regression() {
  const nx = 300, ny = lineY(nx);
  return <>
    <g stroke="var(--line-2)" strokeWidth="1.4"><line x1={44} y1={128} x2={360} y2={128} /><line x1={44} y1={128} x2={44} y2={8} /></g>
    <text x={360} y={144} textAnchor="end" {...font}>площадь квартиры</text>
    <text x={50} y={14} {...font}>цена</text>
    <line x1={50} y1={lineY(50)} x2={350} y2={lineY(350)} stroke="var(--green)" strokeWidth="2.4" strokeLinecap="round" />
    {PTS.map(([x, y]) => <circle key={x} cx={x} cy={y} r="4.5" fill="var(--lav)" />)}
    <line x1={nx} y1={128} x2={nx} y2={ny + 6} stroke="var(--amber)" strokeWidth="1.4" strokeDasharray="3 3" />
    <circle cx={nx} cy={ny} r="6" fill="var(--card)" stroke="var(--amber)" strokeWidth="2.4" />
    <text x={nx - 10} y={ny - 12} textAnchor="end" {...font} fill="var(--amber)" fontWeight="700">прогноз: 9,1 млн ₽</text>
  </>;
}

const ITEMS: [string, number][] = [["беговые кроссовки", 0.94], ["кроссовки для зала", 0.71], ["носки для бега", 0.38], ["зимние ботинки", 0.12]];

function Ranking() {
  return <>
    <Frame x={8} y={56} w={122} h={36}>
      <circle cx={24} cy={72} r="5" fill="none" stroke={STROKE} strokeWidth="1.5" />
      <line x1={28} y1={76} x2={32} y2={80} stroke={STROKE} strokeWidth="1.6" strokeLinecap="round" />
      <text x={38} y={78} {...font}>кроссовки</text>
    </Frame>
    <Arrow x1={134} y1={74} x2={160} y2={74} />
    {ITEMS.map(([name, s], i) => {
      const y = 8 + i * 35;
      return <g key={name}>
        <rect x={166} y={y} width={206} height={29} rx="8" fill="var(--card)" stroke="var(--line-2)" strokeWidth="1.2" />
        <circle cx={182} cy={y + 14.5} r="9" fill={i === 0 ? "var(--green)" : "var(--fill)"} />
        <text x={182} y={y + 18.5} textAnchor="middle" {...font} fontWeight="700" fill={i === 0 ? "var(--card)" : "var(--ink-2)"}>{i + 1}</text>
        <text x={197} y={y + 18.5} {...font}>{name}</text>
        <rect x={316} y={y + 11} width={48} height={7} rx="3.5" fill="var(--fill)" />
        <rect x={316} y={y + 11} width={48 * s} height={7} rx="3.5" fill="var(--green)" />
      </g>;
    })}
  </>;
}

const GROUPS: [number, number][][] = [
  [[26, 34], [38, 26], [44, 42], [30, 48], [52, 32]],
  [[100, 30], [114, 40], [106, 52], [122, 28], [94, 46]],
  [[56, 92], [70, 102], [80, 88], [62, 110], [86, 106], [72, 84]],
];
const HULLS: [number, number, number, number][] = [[39, 37, 22, 17], [108, 39, 22, 17], [71, 97, 24, 19]];

function Clustering() {
  const dx = 216;
  return <>
    <Frame x={6} y={8} w={142} h={116}>
      {GROUPS.flat().map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.5" fill="var(--ink-3)" opacity=".55" />)}
    </Frame>
    <text x={77} y={142} textAnchor="middle" {...font}>только объекты</text>
    <Arrow x1={158} y1={66} x2={212} y2={66} />
    <Frame x={6 + dx} y={8} w={142} h={116}>
      {HULLS.map(([cx, cy, rx, ry], g) => <ellipse key={g} cx={cx + dx} cy={cy} rx={rx} ry={ry} fill="none" stroke={`var(--o${g + 1})`} strokeWidth="1.4" strokeDasharray="4 3" />)}
      {GROUPS.map((pts, g) => pts.map(([x, y], i) => <circle key={`${g}-${i}`} cx={x + dx} cy={y} r="4.5" fill={`var(--o${g + 1})`} />))}
    </Frame>
    <text x={77 + dx} y={142} textAnchor="middle" {...font}>найденные группы</text>
  </>;
}

function Sparkle({ x, y, r }: { x: number; y: number; r: number }) {
  const q = r * 0.28;
  return <path d={`M${x},${y - r} Q${x + q},${y - q} ${x + r},${y} Q${x + q},${y + q} ${x},${y + r} Q${x - q},${y + q} ${x - r},${y} Q${x - q},${y - q} ${x},${y - r} Z`} fill="var(--amber)" />;
}

function Generation() {
  return <>
    {[0, 1, 2].map((i) => <Frame key={i} x={8 + i * 6} y={10 + i * 8} w={70} h={58} />)}
    <Cat cx={55} cy={58} k={0.85} />
    <text x={55} y={108} textAnchor="middle" {...font}>тысячи</text>
    <text x={55} y={122} textAnchor="middle" {...font}>примеров</text>
    <Arrow x1={102} y1={60} x2={140} y2={60} />
    <Model x={144} y={40} />
    <Arrow x1={224} y1={60} x2={262} y2={60} />
    <Frame x={266} y={14} w={96} h={92} accent><Cat cx={314} cy={72} k={1.05} hat /></Frame>
    <Sparkle x={352} y={26} r={8} />
    <text x={314} y={126} textAnchor="middle" {...font} fill="var(--green)" fontWeight="700">новая картинка</text>
  </>;
}

const DRAW: Record<Kind, [() => ReactNode, string]> = {
  classification: [Classification, "Модель смотрит на фото и выбирает класс из заранее известного списка: «кошка» или «не кошка»"],
  regression: [Regression, "Точки — квартиры с известной ценой, линия — модель. Для новой квартиры модель выдаёт число"],
  ranking: [Ranking, "По запросу модель оценивает, насколько подходит каждый товар, и выстраивает их по убыванию"],
  clustering: [Clustering, "Слева никто не сказал, какие бывают группы. Модель сама нашла три группы похожих объектов"],
  generation: [Generation, "Модель изучила много примеров и создаёт новый объект, которого в примерах не было"],
};

export function TaskSketch({ kind }: { kind: Kind }) {
  const [Draw, caption] = DRAW[kind];
  return (
    <figure style={{ margin: "16px 0 4px" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}
        style={{ width: "100%", maxWidth: 440, display: "block", margin: "0 auto", background: "var(--paper)", borderRadius: "var(--r-m)", padding: 8, boxSizing: "border-box" }}>
        <Draw />
      </svg>
      <figcaption className="faint" style={{ fontSize: 13.5, textAlign: "center", marginTop: 8, lineHeight: 1.4 }}>{caption}</figcaption>
    </figure>
  );
}
