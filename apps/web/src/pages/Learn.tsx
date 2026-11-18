import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CircleDashed, Play, Target } from "lucide-react";
import { api, type Discipline, type Results } from "../api";
import { to } from "../current";
import { useApp } from "../state";
import { content } from "../content/registry";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

export function Learn() {
  const { program, progress, error } = useApp();
  const [courseId, setCourseId] = useState<string | null>(null);
  const [discId, setDiscId] = useState<string | null>(null);

  const [results, setResults] = useState<Results | null>(null); // null until loaded: no flash of a wrong «next»
  useEffect(() => { api.results().then(setResults).catch(() => setResults({})); }, []);

  // The next step in order: the first unfinished written topic — or, once a section's written topics are
  // all done, its section test if it is not passed yet (the next section comes after the test).
  const next = useMemo(() => {
    if (!results) return null;
    for (const c of program?.courses ?? []) for (const d of c.disciplines) for (const s of d.sections) {
      for (const t of s.topics) if (content.hasTopic(t.id) && progress[t.id]?.status !== "done") return { c, d, s, t, test: false };
      const written = s.topics.filter((t) => content.hasTopic(t.id));
      if (written.length && content.sectionTest(s.id) && !results[s.id]?.passed) return { c, d, s, t: { id: s.id, title: "Контрольная раздела" }, test: true };
    }
    return null;
  }, [program, progress, results]);

  useEffect(() => {
    if (program && results && !courseId) { setCourseId(next?.c.id ?? "0"); setDiscId(next?.d.id ?? program.courses[0].disciplines[0].id); }
  }, [program, results, next, courseId]);

  if (error) return <div className="wrap stub"><h1>Нет связи с сервером</h1><p>{error}</p></div>;
  if (!program || !courseId) return <div className="wrap stub faint">Загружаю учебный план…</div>;
  const course = program.courses.find((c) => c.id === courseId)!;
  const disc = course.disciplines.find((d) => d.id === discId) ?? course.disciplines[0];
  const discState = (d: Discipline) => {
    const ids = d.sections.flatMap((s) => s.topics.map((t) => t.id));
    const done = ids.filter((id) => progress[id]?.status === "done").length;
    return done === ids.length ? "done" : done > 0 || ids.some((id) => progress[id]) ? "cur" : "todo";
  };

  return (
    <div className="wrap">
      <div className="course-tabs" role="tablist">
        {program.courses.map((c) => (
          <button key={c.id} className={c.id === courseId ? "on" : ""} onClick={() => { setCourseId(c.id); setDiscId(c.disciplines[0].id); }}>{c.id} · {c.title}</button>
        ))}
      </div>
      <div className="plan">
        <div>
          <div className="intro">
            <div className="eyebrow">Курс {course.id} · {course.hours} ч · дисциплин: {course.disciplines.length}</div>
            <h1>{course.title}</h1>
            <p>Что вас ждёт: {course.tagline.charAt(0).toLowerCase() + course.tagline.slice(1)}.</p>
          </div>
          {next && (
            <div className="continue">
              <div><div className="eyebrow">{next.test ? "Следующий шаг" : progress[next.t.id] ? "Продолжить" : "Начать"}</div><h2>{next.t.title}</h2>
                <div className="muted" style={{ fontSize: 14 }}>{next.d.name} · {next.s.title}</div></div>
              {next.test
                ? <Link className="btn" to={to(`/test/${next.s.id}`)}><Target size={15} />К контрольной</Link>
                : <Link className="btn" to={to(`/learn/${next.t.id}`)}><Play size={15} />{progress[next.t.id] ? "Продолжить" : "Начать"}</Link>}
            </div>
          )}
          <div className="eyebrow" style={{ marginBottom: 8 }}>Дисциплины курса</div>
          {course.disciplines.map((d) => {
            const st = discState(d);
            return (
              <button key={d.id} className={`disc${d.id === disc.id ? " sel" : ""}`} onClick={() => setDiscId(d.id)}>
                <span className={`st ${st}`}>{st === "done" && <Check size={13} strokeWidth={3} />}</span>
                <span className="name">{d.name}{d.name !== d.title && <small>{d.title}</small>}</span>
                <span className="faint" style={{ fontSize: 13 }}>{d.hours} ч</span>
              </button>
            );
          })}
        </div>
        <aside className="info">
          <div className="eyebrow">Дисциплина</div>
          <h3>{disc.name}{disc.name !== disc.title ? ` — ${disc.title}` : ""}</h3>
          <p>{disc.summary}</p>
          {disc.levels.length > 0 && (<>
            <div className="eyebrow">Уровни предмета «{disc.subjectTitle}»</div>
            <ul className="levels">{disc.levels.map((l) => <li key={l.level} className={l.level === disc.level ? "cur" : ""}><b>{ROMAN[l.level]}</b>{l.title}<span>Курс {l.course}</span></li>)}</ul>
          </>)}
          <div className="eyebrow">Разделы и темы</div>
          <ul className="sections">
            <li><span className="topic-link na"><CircleDashed size={15} />0. Вводная лекция — появится вместе с темами дисциплины</span></li>
            {disc.sections.map((s, i) => (
              <li key={s.id}><b>{i + 1}. {s.title}</b>
                {s.topics.map((t) => content.hasTopic(t.id) ? (
                  <Link key={t.id} to={to(`/learn/${t.id}`)} className={`topic-link${progress[t.id]?.status === "done" ? " done" : ""}`}>
                    {progress[t.id]?.status === "done" ? <Check size={15} /> : <Play size={14} />}{t.title}</Link>
                ) : <span key={t.id} className="topic-link na"><CircleDashed size={15} />{t.title}</span>)}
                {content.sectionTest(s.id) && <Link to={to(`/test/${s.id}`)} className="topic-link"><Target size={15} />Контрольная раздела</Link>}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
