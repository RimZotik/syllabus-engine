import { NavLink, Route, Routes, Link } from "react-router-dom";
import { LoaderCircle, Moon, RefreshCw, Sun } from "lucide-react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { load, store } from "./persist";
import { useApp } from "./state";
import { api, type LimitWindow } from "./api";
import { Home } from "./pages/Home";
import { Learn } from "./pages/Learn";
import { Reader, SectionTest } from "./pages/Reader";
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
        <NavLink to="/learn">Обучение</NavLink>
        <NavLink to="/trainer">Тренажёр</NavLink>
        <NavLink to="/record">Зачётка</NavLink>
      </nav>
      <div className="top-right">
        <div style={{ position: "relative" }}>
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

/** Opening the platform at its address returns to the last place in the course (later visits to «/» stay on the home page). */
let firstLoad = true;
function RememberPlace() {
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (firstLoad) {
      firstLoad = false;
      const last = load<string | null>("last-place", null);
      if (loc.pathname === "/" && last && last !== "/") { nav(last, { replace: true }); return; }
    }
    if (loc.pathname !== "/") store("last-place", loc.pathname + loc.search);
  }, [loc.pathname, loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Stub({ title, text }: { title: string; text: string }) {
  return <div className="wrap stub"><div className="eyebrow">Скоро</div><h1>{title}</h1><p>{text}</p><Link className="btn" to="/learn">К обучению</Link></div>;
}

export function App() {
  return (
    <>
      <RememberPlace />
      <TopBar />
      <Guard><Routes>
        <Route path="/" element={<Home />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/learn/:topicId" element={<Reader />} />
        <Route path="/test/:sectionId" element={<SectionTest />} />
        <Route path="/trainer" element={<Stub title="Тренажёр" text="Ежедневное повторение, билеты и марафон появятся на этапе 2, когда накопятся пройденные темы и вопросы к ним." />} />
        <Route path="/record" element={<Stub title="Зачётная книжка" text="Оценки за контрольные и экзамены появятся вместе с первыми рубежами и подключением преподавателя." />} />
        <Route path="*" element={<Stub title="Страница не найдена" text="Такой страницы нет." />} />
      </Routes></Guard>
      <TermDrawer />
    </>
  );
}
