import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleDashed, Flag, List, NotebookPen, Target } from "lucide-react";
import { api, type Results } from "../api";
import { load, store } from "../persist";
import { to } from "../current";
import { useApp, type TopicPlace } from "../state";
import { content, type TopicModule } from "../content/registry";
import { mdxComponents, Page } from "../content/components";
import { Quiz, type ExamPhase } from "../components/Quiz";
import { isOpen, nextStep } from "../content/order";
import { ExamLock, useExamInProgress } from "../content/reference";
import { StepLocked, useStepOpen } from "../content/gate";
import { Drawer, FeedbackDrawer, NotesDrawer } from "../components/Drawers";

type PageDef = { title: string; minutes?: number; node: ReactNode };

/** During a section test (контрольная) the lessons are closed, as at a real exam. */
export function Reader() {
  const { topicId = "" } = useParams();
  const exam = useExamInProgress();
  const { open, next } = useStepOpen("topic", topicId);
  if (exam === undefined || open === undefined) return null;
  if (exam) return <ExamLock sectionId={exam} title="Тема закрыта" />;
  return open ? <TopicReader /> : <StepLocked next={next} />;
}

function TopicReader() {
  const { topicId = "" } = useParams();
  const { place, allTopics, progress, refreshProgress } = useApp();
  const nav = useNavigate();
  const [search] = useSearchParams();
  const where = place(topicId);
  const [loadedMod, setLoadedMod] = useState<{ id: string; mod: TopicModule } | null>(null);
  const mod = loadedMod?.id === topicId ? loadedMod.mod : null;
  const [rawCur, setCur] = useState(0);
  const [panel, setPanel] = useState<"toc" | "notes" | "feedback" | null>(() => (new URLSearchParams(location.search).has("toc") ? "toc" : null));

  useEffect(() => {
    setCur(search.has("p") ? Number(search.get("p")) : progress[topicId]?.page ?? 0);
    content.loadTopic(topicId)?.then((m) => setLoadedMod({ id: topicId, mod: m }));
  }, [topicId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextTopic = useMemo(() => {
    const i = allTopics.findIndex((t) => t.id === topicId);
    return i >= 0 ? allTopics[i + 1] : undefined;
  }, [allTopics, topicId]);
  // after the last topic of a section comes its section test (if it has one), then the next section
  const testAfter = where && where.index === where.section.topics.length - 1 && content.sectionTest(where.section.id) ? where.section.id : null;

  const pages: PageDef[] = useMemo(() => {
    if (!mod || !where) return [];
    const tree = (mod.default as unknown as (p: object) => ReactElement<{ children?: ReactNode }>)({ components: mdxComponents() });
    // a topic with a single <Page> comes back as that element itself, not as a list of pages
    const body: PageDef[] = (tree.type === Page ? [tree] : Children.toArray(tree.props.children))
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

  // a saved or linked page number can be past the end if the topic got shorter
  const cur = Math.min(rawCur, Math.max(0, pages.length - 1));

  // Scroll position inside the page is remembered and restored when the topic is opened again.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!pages.length) return;
    const key = `scroll:${topicId}:${cur}`;
    if (restored.current !== topicId) {
      restored.current = topicId;
      const y = load<number>(key, 0);
      if (y > 0) requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    }
    let t = 0;
    const onScroll = () => { window.clearTimeout(t); t = window.setTimeout(() => store(key, Math.round(window.scrollY) || null), 250); };
    addEventListener("scroll", onScroll, { passive: true });
    return () => { removeEventListener("scroll", onScroll); window.clearTimeout(t); };
  }, [topicId, cur, pages.length]);

  function go(i: number) {
    const next = Math.max(0, Math.min(pages.length - 1, i));
    api.setProgress(topicId, "started", next, 0).then(refreshProgress).catch(() => {});
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

  if (!where) return <div className="wrap stub"><h1>Нет такой темы</h1><Link className="btn" to={to("/learn")}>К учебному плану</Link></div>;
  if (!content.hasTopic(topicId)) return (
    <div className="wrap stub"><div className="eyebrow">{where.discipline.name}</div><h1>{where.topic.title}</h1>
      <p>Эта тема ещё не написана. Курс наполняется постепенно — на шаг впереди вас.</p><Link className="btn" to={to("/learn")}>К учебному плану</Link></div>
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
          : testAfter ? <button className="btn" id="next" onClick={() => nav(to(`/test/${testAfter}`))}><Target size={16} /><span>Контрольная раздела</span><ArrowRight size={16} /></button>
          : nextTopic ? <button className="btn" id="next" onClick={() => nav(to(`/learn/${nextTopic.id}`))}><span>Следующая тема</span><ArrowRight size={16} /></button>
          : <Link className="btn" id="next" to={to("/learn")}>К учебному плану</Link>}
      </div></div>

      {panel === "toc" && <TocDrawer place={where} current={topicId} progress={progress} onClose={() => setPanel(null)} />}
      {panel === "notes" && <NotesDrawer topicId={topicId} onClose={() => setPanel(null)} />}
      {panel === "feedback" && <FeedbackDrawer topicId={topicId} page={cur} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** The discipline's table of contents: sections, topics with their state, section tests. `current` — open topic or section test. */
function TocDrawer({ place: where, current, progress, onClose }: { place: TopicPlace; current: string; progress: Record<string, { status?: string } | undefined>; onClose: () => void }) {
  const { program, progress: prog } = useApp();
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => { api.results().then(setResults).catch(() => setResults({})); }, []);
  const passed: Record<string, boolean> = Object.fromEntries(Object.entries(results ?? {}).map(([k, v]) => [k, v.passed]));
  // only what is passed, the next step and the page that is open now can be opened from the contents
  const step = useMemo(() => nextStep(program, prog, results ?? {}), [program, prog, results]);
  const canOpen = (kind: "topic" | "test", id: string) => id === current || (!!results && isOpen({ kind, id }, step, prog, results));
  return (
    <Drawer side="left" label="Содержание" onClose={onClose}>
      <div className="toc-head"><span className="eyebrow">Курс {where.course.id} · {where.course.title}</span><h3>{where.discipline.name}</h3>{where.discipline.name !== where.discipline.title && <div className="muted">{where.discipline.title}</div>}</div>
      <nav className="toc">{where.discipline.sections.map((s, si) => (
        <section key={s.id} className={`toc-sec${s.id === where.section.id ? " cur" : ""}`}>
          <div className="toc-sec-h"><span className="toc-n">Раздел {si + 1}</span><b>{s.title}</b></div>
          <ol className="toc-topics">
            {s.topics.map((t, ti) => {
              const done = progress[t.id]?.status === "done";
              const written = content.hasTopic(t.id);
              const cls = t.id === current ? "on" : done ? "done" : !written ? "na" : "";
              const icon = done ? <Check size={15} /> : written ? <BookOpen size={15} /> : <CircleDashed size={15} />;
              const label = <><span className="toc-num">{si + 1}.{ti + 1}</span>{icon}<span>{t.title}</span></>;
              return <li key={t.id}>{!written ? <span className={`toc-item ${cls}`} title="Тема ещё не написана">{label}</span>
                : canOpen("topic", t.id) ? <Link to={to(`/learn/${t.id}`)} className={cls} onClick={onClose}>{label}</Link>
                : <span className="toc-item locked" title="Откроется, когда вы дойдёте до неё по программе">{label}</span>}</li>;
            })}
            {content.sectionTest(s.id) && <li>{canOpen("test", s.id)
              ? <Link to={to(`/test/${s.id}`)} className={`test${passed[s.id] ? " passed" : ""}${s.id === current ? " on" : ""}`} onClick={onClose}><span className="toc-num" /><Target size={15} /><span>Контрольная раздела {si + 1}</span></Link>
              : <span className="toc-item locked" title="Откроется, когда вы пройдёте темы раздела"><span className="toc-num" /><Target size={15} /><span>Контрольная раздела {si + 1}</span></span>}</li>}
          </ol>
        </section>
      ))}</nav>
    </Drawer>
  );
}

/** A section test opened by its address shows only when its topics are passed. */
export function SectionTest() {
  const { sectionId = "" } = useParams();
  const { open, next } = useStepOpen("test", sectionId);
  if (open === undefined) return null;
  return open || !content.sectionTest(sectionId) ? <SectionTestPage key={sectionId} /> : <StepLocked next={next} />;
}

function SectionTestPage() {
  const { sectionId = "" } = useParams();
  const { allTopics, place, progress } = useApp();
  const [panel, setPanel] = useState<"toc" | "notes" | "feedback" | null>(null);
  const [phase, setPhase] = useState<ExamPhase>("intro");
  const running = phase === "progress"; // during an attempt the topics are out of reach
  const [testPassed, setTestPassed] = useState(false);
  useEffect(() => { api.quizState(sectionId).then((r) => setTestPassed(r.passed)).catch(() => {}); }, [sectionId]);
  const raw = content.sectionTest(sectionId);
  const data = useMemo(() => (raw ? { ...raw, title: raw.title ?? "Контрольная раздела" } : undefined), [raw]);
  // the section's last topic (back) and the first topic after the section (forward)
  const lastIdx = allTopics.map((t) => t.id.startsWith(sectionId + ".")).lastIndexOf(true);
  const back = lastIdx >= 0 ? allTopics[lastIdx] : undefined;
  const next = lastIdx >= 0 ? allTopics[lastIdx + 1] : undefined;
  const nextSection = next ? place(next.id)?.section : undefined;
  const where = back ? place(back.id) : null;
  if (!data) return <div className="wrap stub"><h1>Контрольной нет</h1><Link className="btn" to={to("/learn")}>К учебному плану</Link></div>;
  return (
    <div className="reader">
      {where && (
        <div className="reader-bar"><div className="wrap">
          {running ? <span className="icon-btn" aria-hidden="true" /> : <button className="icon-btn" aria-label="Содержание" title="Содержание" onClick={() => setPanel("toc")}><List size={18} /></button>}
          <div className="crumb">{where.discipline.name} · {where.section.title} · <b>Контрольная раздела{running ? " — идёт попытка" : ""}</b></div>
          {running ? <span className="icon-btn" aria-hidden="true" /> : <button className="icon-btn" aria-label="Заметки к контрольной" title="Заметки к контрольной" onClick={() => setPanel("notes")}><NotebookPen size={17} /></button>}
          <button className="icon-btn" aria-label="Предложить правку" title="Предложить правку" onClick={() => setPanel("feedback")}><Flag size={17} /></button>
        </div></div>
      )}
      <div className="page"><div className="read"><Quiz key={sectionId} scope={sectionId} exam onPhase={setPhase} onPassed={() => setTestPassed(true)} data={data} /></div></div>
      {!running && <div className="reader-nav-wrap"><div className="read reader-nav">
        {back ? <Link className="btn soft" id="prev" to={to(`/learn/${back.id}`)} aria-label="К последней теме"><ArrowLeft size={16} /><span className="pl">К последней теме</span></Link> : <span />}
        {next && !testPassed ? <button className="btn" id="next" disabled title="Следующий раздел откроется после сдачи контрольной"><span>Сдайте контрольную, чтобы продолжить</span></button>
          : next ? <Link className="btn" id="next" to={to(`/learn/${next.id}`)}><span>Следующий раздел{nextSection ? `: ${nextSection.title}` : ""}</span><ArrowRight size={16} /></Link>
          : <Link className="btn" id="next" to={to("/learn")}>К учебному плану</Link>}
      </div></div>}
      {panel === "toc" && where && <TocDrawer place={where} current={sectionId} progress={progress} onClose={() => setPanel(null)} />}
      {panel === "notes" && <NotesDrawer topicId={sectionId} onClose={() => setPanel(null)} />}
      {panel === "feedback" && <FeedbackDrawer topicId={sectionId} onClose={() => setPanel(null)} />}
    </div>
  );
}
