import { Reference } from "./pages/Reference";
import { NavLink, Navigate, Route, Routes, Link } from "react-router-dom";
import { LoaderCircle, Moon, RefreshCw, Sun } from "lucide-react";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { load, store } from "./persist";
import { AppProvider, useApp } from "./state";
import { api, type Catalog as CatalogData, type LimitWindow } from "./api";
import { RESERVED, setCurrentPackage, to } from "./current";
import { Catalog } from "./pages/Catalog";
import { Home } from "./pages/Home";
import { Learn } from "./pages/Learn";
import { Reader, SectionTest } from "./pages/Reader";
import { Record } from "./pages/Record";
import { TermDrawer } from "./components/Drawers";

const limColor = (used: number) => (used >= 0.9 ? "var(--bad)" : used >= 0.7 ? "var(--amber)" : "var(--green)");

function resetText(w: LimitWindow, week: boolean): string {
  if (!w.resets_at) return "";
  const ms = w.resets_at * 1000 - Date.now();
  if (ms <= 0) return "Уже сбросился";
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  if (!week || h < 24) return `Сброс через ${h ? `${h} ч ` : ""}${m} мин`;
  const d = new Date(w.resets_at * 1000);
  return `Сброс ${d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

function LimitRow({ label, w, week }: { label: string; w: LimitWindow | null; week: boolean }) {
  if (!w) return null;
  const pct = Math.round(w.used * 100);
  return (
    <div className="lim">
      <div className="lim-row"><span>{label}</span><span className="tnum">{pct}%</span></div>
      <div className="lim-bar"><b style={{ width: `${Math.min(100, pct)}%`, background: limColor(w.used) }} /></div>
      <div className="lim-reset">{resetText(w, week)}</div>
    </div>
  );
}

function ago(ts: number): string {
  const min = Math.round((Date.now() / 1000 - ts) / 60);
  return min < 1 ? "только что" : `${min} мин назад`;
}

function TopBar() {
  const { claude, setClaude } = useApp();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const [pop, setPop] = useState(false);
  const [busy, setBusy] = useState(false);
  const lim = claude?.limits ?? null;
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pop) return;
    const away = (e: PointerEvent) => { if (!popRef.current?.contains(e.target as Node)) setPop(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [pop]);
  const refresh = () => { setBusy(true); api.refreshLimits().then(setClaude).catch(() => {}).finally(() => setBusy(false)); };
  const open = () => { const next = !pop; setPop(next); if (next && claude?.installed) refresh(); };
  const toggle = () => {
    const next = !dark; setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* storage unavailable */ }
  };
  const title = !claude ? "Проверяю Claude…" : !claude.installed ? "Claude Code не найден — платформа работает, развёрнутые ответы недоступны."
    : lim ? `Лимиты Claude: 5 часов — ${Math.round((lim.five_hour?.used ?? 0) * 100)}%, неделя — ${Math.round((lim.seven_day?.used ?? 0) * 100)}%` : `Claude Code ${claude.version ?? ""} найден`;
  return (
    <header className="top"><div className="wrap">
      <Link className="brand" to="/" aria-label="Syllabus Engine — главная">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20 L9 8 L13 14 L16 9 L21 20" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /><circle cx="16" cy="9" r="2.4" fill="var(--green)" /></svg>
        <span>Syllabus Engine</span>
      </Link>
      <nav className="nav">
        <NavLink to={to("/learn")}>Обучение</NavLink>
        <NavLink to={to("/reference")}>Справочник</NavLink>
        <NavLink to={to("/trainer")}>Тренажёр</NavLink>
        <NavLink to={to("/record")}>Зачётка</NavLink>
      </nav>
      <div className="top-right">
        <div style={{ position: "relative" }} ref={popRef}>
          <button className={`claude${claude?.installed ? " on" : ""}`} onClick={open} aria-expanded={pop} title={title}><span className="dot" /><span className="lbl">{!claude ? "Claude…" : claude.installed ? "Claude" : "Claude не найден"}</span>
            {lim && <span className="mini" aria-hidden="true">{[lim.five_hour, lim.seven_day].map((w, i) => <i key={i}><b style={{ width: `${Math.min(100, Math.round((w?.used ?? 0) * 100))}%`, background: limColor(w?.used ?? 0) }} /></i>)}</span>}</button>
          {pop && (
            <div className="claude-pop" role="dialog">
              {claude?.installed ? (<><b>Claude Code найден{claude.version ? ` · ${claude.version}` : ""}</b><p>Проверяет развёрнутые ответы и проводит устные экзамены. Нужно быть залогиненным в Claude Code: команда <code>claude</code> в терминале не должна просить входа.</p>
                {lim ? (<><LimitRow label="Лимит на 5 часов" w={lim.five_hour} week={false} /><LimitRow label="Лимит на неделю" w={lim.seven_day} week={true} /></>)
                  : <p>{busy ? "Узнаю лимиты подписки…" : "Лимиты подписки пока неизвестны."}</p>}
                <div className="lim-foot"><span>{lim ? `Обновлено ${ago(lim.updated_at)}` : ""}</span>
                  <button onClick={refresh} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}Обновить</button></div></>)
                : (<><b>Claude не найден</b><p>Курс полностью проходится без него: теория, тесты, контрольные, заметки и прогресс работают. Без Claude недоступны только развёрнутые ответы и устные экзамены — они не блокируют прохождение.</p><p>Чтобы подключить преподавателя: установите Claude Code (<code>npm install -g @anthropic-ai/claude-code</code>), выполните <code>claude</code> и войдите в свой аккаунт, — платформа заметит это сама в течение полуминуты, перезапускать ничего не нужно.</p></>)}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={toggle} aria-label="Сменить тему">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
      </div>
    </div></header>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) {
    fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: "error", message: `render: ${e.message}`, context: { path: location.pathname, stack: e.stack?.slice(0, 1500) } }) }).catch(() => {});
  }
  render() {
    return this.state.failed
      ? <div className="wrap stub"><div className="eyebrow">Ошибка</div><h1>Страница не открылась</h1><p>Ошибка уже записана в журнал платформы. Попробуйте открыть страницу ещё раз.</p><button className="btn" onClick={() => location.reload()}>Обновить страницу</button></div>
      : this.props.children;
  }
}

/** Remounts the boundary on every navigation, so one broken page does not break the next one. */
function Guard({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return <Boundary key={loc.pathname}>{children}</Boundary>;
}

/** Remembers the last place in the platform (any package); «/» uses it on the first visit (see Front). */
function RememberPlace() {
  const loc = useLocation();
  useEffect(() => {
    if (loc.pathname !== "/") store("last-place", loc.pathname + loc.search, true);
  }, [loc.pathname, loc.search]);
  return null;
}

/**
 * The platform's address «/». With one package: the first visit returns to the last place, later ones open
 * the package's home. With several: always the catalog (the brand link leads here).
 */
let firstLoad = true;
function Front({ catalog }: { catalog: CatalogData }) {
  const first = firstLoad;
  firstLoad = false;
  if (catalog.packages.length > 1) return <Catalog packages={catalog.packages} />;
  const last = first ? load<string | null>("last-place", null, true) : null;
  return <Navigate to={last && last !== "/" ? last : `/${catalog.default}`} replace />;
}

/**
 * Study clock: every 15 s while the tab is visible and the learner did something in the last 5 minutes,
 * 15 s go to the current place — the topic, the section test, or the site in general.
 */
const TICK = 15, IDLE_MS = 5 * 60_000;
function StudyClock() {
  const loc = useLocation();
  const where = useRef("site");
  const last = useRef(Date.now());
  useEffect(() => {
    const m = /^\/[^/]+\/(learn|test)\/([^/]+)/.exec(loc.pathname);
    where.current = m ? decodeURIComponent(m[2]) : "site";
  }, [loc.pathname]);
  useEffect(() => {
    const active = () => { last.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;
    events.forEach((e) => addEventListener(e, active, { passive: true }));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last.current < IDLE_MS) api.addTime(where.current, TICK).catch(() => {});
    }, TICK * 1000);
    return () => { events.forEach((e) => removeEventListener(e, active)); window.clearInterval(timer); };
  }, []);
  return null;
}

function Stub({ title, text }: { title: string; text: string }) {
  return <div className="wrap stub"><div className="eyebrow">Скоро</div><h1>{title}</h1><p>{text}</p><Link className="btn" to={to("/learn")}>К обучению</Link></div>;
}

/** Old addresses without a package (/learn/…, bookmarks, the remembered last place) open in the default package. */
function Legacy({ pkg }: { pkg: string }) {
  const loc = useLocation();
  return <Navigate to={`/${pkg}${loc.pathname}${loc.search}`} replace />;
}

/** A package id that is not installed. */
function UnknownPackage({ catalog }: { catalog: CatalogData }) {
  return <div className="wrap stub"><h1>Обучение не найдено</h1><p>Такого обучения на платформе нет.</p>
    <Link className="btn" to={catalog.packages.length > 1 ? "/" : `/${catalog.default}`}>{catalog.packages.length > 1 ? "К списку обучений" : "На главную"}</Link></div>;
}

export function App({ catalog, pkg }: { catalog: CatalogData; pkg: string }) {
  const known = catalog.packages.some((p) => p.id === pkg);
  return (
    <>
      <RememberPlace />
      <StudyClock />
      <TopBar />
      <Guard><Routes>
        <Route path="/" element={<Front catalog={catalog} />} />
        {["learn/*", "test/*", "record", "trainer", "reference"].map((p) => <Route key={p} path={`/${p}`} element={<Legacy pkg={catalog.default} />} />)}
        <Route path="/:pkg/*" element={known ? (
          <Routes>
            <Route index element={<Home />} />
            <Route path="learn" element={<Learn />} />
            <Route path="learn/:topicId" element={<Reader />} />
            <Route path="test/:sectionId" element={<SectionTest />} />
            <Route path="trainer" element={<Stub title="Тренажёр" text="Ежедневное повторение, билеты и марафон появятся на этапе 2, когда накопятся пройденные темы и вопросы к ним." />} />
            <Route path="record" element={<Record />} />
            <Route path="reference" element={<Reference />} />
            <Route path="*" element={<Stub title="Страница не найдена" text="Такой страницы нет." />} />
          </Routes>
        ) : <UnknownPackage catalog={catalog} />} />
      </Routes></Guard>
      <TermDrawer />
    </>
  );
}

/**
 * Loads the catalog of installed packages, takes the package from the first segment of the address
 * (/<package>/learn/…; anything else — the default package) and remounts the whole app for it, so no
 * state of one package leaks into another.
 */
export function Root() {
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loc = useLocation();
  useEffect(() => { api.packages().then(setCatalog).catch(() => setError("Сервер платформы не отвечает. Запустите его командой npm run dev.")); }, []);
  if (error) return <div className="wrap stub"><h1>Нет связи с сервером</h1><p>{error}</p></div>;
  if (!catalog) return null;
  let first = "";
  try { first = decodeURIComponent(loc.pathname.split("/")[1] ?? ""); } catch { /* malformed address: treat as unknown */ }
  const fallback = catalog.packages.some((p) => p.id === catalog.default) ? catalog.default : catalog.packages[0]?.id ?? catalog.default;
  const pkg = first && !RESERVED.includes(first) && catalog.packages.some((p) => p.id === first) ? first : fallback;
  setCurrentPackage(pkg);
  return <AppProvider key={pkg}><App catalog={catalog} pkg={first && !RESERVED.includes(first) ? first : pkg} /></AppProvider>;
}
