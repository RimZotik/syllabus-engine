import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Flag, List, NotebookPen } from "lucide-react";
import { api } from "../api";
import { useApp } from "../state";
import { content, type TopicModule } from "../content/registry";
import { mdxComponents, Page } from "../content/components";
import { Quiz } from "../components/Quiz";
import { Drawer, FeedbackDrawer, NotesDrawer } from "../components/Drawers";

type PageDef = { title: string; minutes?: number; node: ReactNode };

export function Reader() {
  const { topicId = "" } = useParams();
  const { place, allTopics, progress, refreshProgress } = useApp();
  const nav = useNavigate();
  const [search] = useSearchParams();
  const where = place(topicId);
  const [mod, setMod] = useState<TopicModule | null>(null);
  const [cur, setCur] = useState(0);
  const [panel, setPanel] = useState<"toc" | "notes" | "feedback" | null>(null);
  const since = useRef(Date.now());

  useEffect(() => {
    setMod(null); setCur(search.has("p") ? Number(search.get("p")) : progress[topicId]?.page ?? 0);
    content.loadTopic(topicId)?.then(setMod);
  }, [topicId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextTopic = useMemo(() => {
    const i = allTopics.findIndex((t) => t.id === topicId);
    return i >= 0 ? allTopics[i + 1] : undefined;
  }, [allTopics, topicId]);

  const pages: PageDef[] = useMemo(() => {
    if (!mod || !where) return [];
    const tree = (mod.default as unknown as (p: object) => ReactElement<{ children?: ReactNode }>)({ components: mdxComponents });
    const body: PageDef[] = Children.toArray(tree.props.children)
      .filter((el): el is ReactElement<{ title: string; minutes?: number }> => isValidElement(el) && el.type === Page)
      .map((el) => ({ title: el.props.title, minutes: el.props.minutes, node: el }));
    const quiz = content.quiz(topicId);
    const all = [...body];
    if (quiz) all.push({ title: "Проверка", minutes: quiz.minutes ?? 15, node: <Quiz scope={topicId} data={quiz} onPassed={() => api.setProgress(topicId, "done", all.length - 1, 0).then(refreshProgress)} /> });
    const plan: PageDef = {
      title: "План урока", node: (
        <>
          <div className="eyebrow">{where.discipline.name} · {where.section.title} · тема {where.index + 1}</div>
          <h1>{where.topic.title}</h1>
          {mod.meta?.lead && <p className="lead muted" style={{ fontSize: 20 }}>{mod.meta.lead}</p>}
          <div className="agenda"><div className="eyebrow">План урока · около {all.reduce((s, p) => s + (p.minutes ?? 0), 0)} минут</div>
            <ol>{all.map((p) => <li key={p.title}>{p.title}{p.minutes && <span>{p.minutes} мин</span>}</li>)}</ol></div>
        </>
      ),
    };
    return [plan, ...all];
  }, [mod, where, topicId, refreshProgress]);

  function go(i: number) {
    const next = Math.max(0, Math.min(pages.length - 1, i));
    const seconds = Math.round((Date.now() - since.current) / 1000);
    since.current = Date.now();
    api.setProgress(topicId, "started", next, Math.min(seconds, 1800)).then(refreshProgress).catch(() => {});
    setCur(next); window.scrollTo(0, 0);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea") || panel) return;
      if (e.key === "ArrowRight") go(cur + 1);
      if (e.key === "ArrowLeft") go(cur - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!where) return <div className="wrap stub"><h1>Нет такой темы</h1><Link className="btn" to="/learn">К учебному плану</Link></div>;
  if (!content.hasTopic(topicId)) return (
    <div className="wrap stub"><div className="eyebrow">{where.discipline.name}</div><h1>{where.topic.title}</h1>
      <p>Эта тема ещё не написана. Курс наполняется постепенно — на шаг впереди вас.</p><Link className="btn" to="/learn">К учебному плану</Link></div>
  );
  if (!pages.length) return <div className="wrap stub faint">Загружаю тему…</div>;

  const last = cur === pages.length - 1;
  const page = pages[Math.min(cur, pages.length - 1)];
  return (
    <div className="reader">
      <div className="reader-bar"><div className="wrap">
        <button className="icon-btn" aria-label="Содержание" title="Содержание" onClick={() => setPanel("toc")}><List size={18} /></button>
        <div className="crumb">{where.discipline.name} · {where.section.title} · <b>{where.topic.title}</b></div>
        <button className="icon-btn" aria-label="Заметки к теме" title="Заметки к теме" onClick={() => setPanel("notes")}><NotebookPen size={17} /></button>
        <button className="icon-btn" aria-label="Предложить правку" title="Предложить правку" onClick={() => setPanel("feedback")}><Flag size={17} /></button>
      </div></div>

      <div className="page" key={cur}><div className="read">{page.node}</div></div>

      <div className="reader-nav-wrap"><div className="read reader-nav">
        <button className="btn soft" id="prev" onClick={() => go(cur - 1)} disabled={cur === 0} aria-label="Назад"><ArrowLeft size={16} /><span className="pl">Назад</span></button>
        <div className="pager"><div className="dots">{pages.map((p, i) => <button key={i} title={p.title} aria-label={p.title} className={i < cur ? "done" : i === cur ? "on" : ""} onClick={() => go(i)} />)}</div><span className="tnum">{cur + 1} / {pages.length}</span></div>
        {!last ? <button className="btn" id="next" onClick={() => go(cur + 1)}><span>Далее: {pages[cur + 1].title}</span><ArrowRight size={16} /></button>
          : content.quiz(topicId) && progress[topicId]?.status !== "done" ? <button className="btn" id="next" disabled title="Следующая тема откроется после сдачи проверки"><span>Сдайте проверку, чтобы продолжить</span></button>
          : nextTopic ? <button className="btn" id="next" onClick={() => nav(`/learn/${nextTopic.id}`)}><span>Следующая тема</span><ArrowRight size={16} /></button>
          : <Link className="btn" id="next" to="/learn">К учебному плану</Link>}
      </div></div>

      {panel === "toc" && (
        <Drawer side="left" label={where.discipline.name} onClose={() => setPanel(null)}>
          <nav className="toc">{where.discipline.sections.map((s) => (
            <div key={s.id}><div className="grp">{s.title}</div>
              {s.topics.map((t) => <Link key={t.id} to={`/learn/${t.id}`} className={t.id === topicId ? "on" : ""} onClick={() => setPanel(null)}>{t.title}</Link>)}
              {content.sectionTest(s.id) && <Link to={`/test/${s.id}`} onClick={() => setPanel(null)}>Контрольная раздела</Link>}
            </div>
          ))}</nav>
        </Drawer>
      )}
      {panel === "notes" && <NotesDrawer topicId={topicId} onClose={() => setPanel(null)} />}
      {panel === "feedback" && <FeedbackDrawer topicId={topicId} onClose={() => setPanel(null)} />}
    </div>
  );
}

export function SectionTest() {
  const { sectionId = "" } = useParams();
  const data = content.sectionTest(sectionId);
  if (!data) return <div className="wrap stub"><h1>Контрольной нет</h1><Link className="btn" to="/learn">К учебному плану</Link></div>;
  return <div className="page"><div className="read"><Quiz scope={sectionId} data={{ ...data, title: data.title ?? "Контрольная раздела" }} /></div></div>;
}
