import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleDashed, Flag, List, NotebookPen, Target } from "lucide-react";
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
  const [loadedMod, setLoadedMod] = useState<{ id: string; mod: TopicModule } | null>(null);
  const mod = loadedMod?.id === topicId ? loadedMod.mod : null;
  const [cur, setCur] = useState(0);
  const [panel, setPanel] = useState<"toc" | "notes" | "feedback" | null>(() => (new URLSearchParams(location.search).has("toc") ? "toc" : null));
  const since = useRef(Date.now());

  useEffect(() => {
    setCur(search.has("p") ? Number(search.get("p")) : progress[topicId]?.page ?? 0);
    content.loadTopic(topicId)?.then((m) => setLoadedMod({ id: topicId, mod: m }));
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
    if (quiz) all.push({ title: "Проверка", minutes: quiz.minutes ?? 15, node: <Quiz key={topicId} scope={topicId} data={quiz} onPassed={() => api.setProgress(topicId, "done", all.length - 1, 0).then(refreshProgress)} /> });
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
        <Drawer side="left" label="Содержание" onClose={() => setPanel(null)}>
          <div className="toc-head"><span className="eyebrow">Курс {where.course.id} · {where.course.title}</span><h3>{where.discipline.name}</h3>{where.discipline.name !== where.discipline.title && <div className="muted">{where.discipline.title}</div>}</div>
          <nav className="toc">{where.discipline.sections.map((s, si) => (
            <section key={s.id} className={`toc-sec${s.id === where.section.id ? " cur" : ""}`}>
              <div className="toc-sec-h"><span className="toc-n">Раздел {si + 1}</span><b>{s.title}</b></div>
              <ol className="toc-topics">
                {s.topics.map((t, ti) => {
                  const done = progress[t.id]?.status === "done";
                  const written = content.hasTopic(t.id);
                  const cls = t.id === topicId ? "on" : done ? "done" : !written ? "na" : "";
                  const icon = done ? <Check size={15} /> : written ? <BookOpen size={15} /> : <CircleDashed size={15} />;
                  const label = <><span className="toc-num">{si + 1}.{ti + 1}</span>{icon}<span>{t.title}</span></>;
                  return <li key={t.id}>{written ? <Link to={`/learn/${t.id}`} className={cls} onClick={() => setPanel(null)}>{label}</Link> : <span className={`toc-item ${cls}`} title="Тема ещё не написана">{label}</span>}</li>;
                })}
                {content.sectionTest(s.id) && <li><Link to={`/test/${s.id}`} className="test" onClick={() => setPanel(null)}><span className="toc-num" /><Target size={15} /><span>Контрольная раздела {si + 1}</span></Link></li>}
              </ol>
            </section>
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
  return <div className="page"><div className="read"><Quiz key={sectionId} scope={sectionId} data={{ ...data, title: data.title ?? "Контрольная раздела" }} /></div></div>;
}
