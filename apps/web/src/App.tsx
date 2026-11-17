import { NavLink, Route, Routes, Link } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useApp } from "./state";
import { Home } from "./pages/Home";
import { Learn } from "./pages/Learn";
import { Reader, SectionTest } from "./pages/Reader";
import { TermDrawer } from "./components/Drawers";

function TopBar() {
  const { claude } = useApp();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const toggle = () => {
    const next = !dark; setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* storage unavailable */ }
  };
  const title = !claude ? "Проверяю Claude…" : claude.installed ? `Claude Code ${claude.version ?? ""} найден. Лимиты подписки появятся на этапе подключения преподавателя.` : "Claude Code не найден — платформа работает, устные ответы ждут проверки в очереди.";
  return (
    <header className="top"><div className="wrap">
      <Link className="brand" to="/" aria-label="Forge ML — главная">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20 L9 8 L13 14 L16 9 L21 20" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /><circle cx="16" cy="9" r="2.4" fill="var(--green)" /></svg>
        <span>Forge ML</span>
      </Link>
      <nav className="nav">
        <NavLink to="/learn">Обучение</NavLink>
        <NavLink to="/trainer">Тренажёр</NavLink>
        <NavLink to="/record">Зачётка</NavLink>
      </nav>
      <div className="top-right">
        <div className={`claude${claude?.installed ? " on" : ""}`} title={title}><span className="dot" /><span className="lbl">{claude?.installed ? "Claude" : "Claude не найден"}</span></div>
        <button className="icon-btn" onClick={toggle} aria-label="Сменить тему">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
      </div>
    </div></header>
  );
}

function Stub({ title, text }: { title: string; text: string }) {
  return <div className="wrap stub"><div className="eyebrow">Скоро</div><h1>{title}</h1><p>{text}</p><Link className="btn" to="/learn">К обучению</Link></div>;
}

export function App() {
  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/learn/:topicId" element={<Reader />} />
        <Route path="/test/:sectionId" element={<SectionTest />} />
        <Route path="/trainer" element={<Stub title="Тренажёр" text="Ежедневное повторение, билеты и марафон появятся на этапе 2, когда накопятся пройденные темы и вопросы к ним." />} />
        <Route path="/record" element={<Stub title="Зачётная книжка" text="Оценки за контрольные и экзамены появятся вместе с первыми рубежами и подключением преподавателя." />} />
        <Route path="*" element={<Stub title="Страница не найдена" text="Такой страницы нет." />} />
      </Routes>
      <TermDrawer />
    </>
  );
}
