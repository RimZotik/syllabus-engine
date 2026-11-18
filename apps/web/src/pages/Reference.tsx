import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookMarked, NotebookPen, Search } from "lucide-react";
import { api, type Note } from "../api";
import { to, currentPackage } from "../current";
import { useApp } from "../state";
import { content } from "../content/registry";
import { ExamLock, TopicTheorems, useExamInProgress } from "../content/reference";
import { allTerms, score, theorems, type Hit, type TheoremEntry } from "../content/search";
import { Modal } from "../components/Modal";
import { useDraft } from "../persist";

type Tab = "defs" | "notes";
const KIND = { definition: "Определение", theorem: "Теорема", rule: "Правило" } as const;

/**
 * «Справочник»: what the learner has already passed, in program order (discipline → section → topic):
 * glossary terms and the definitions, theorems and rules of finished topics — plus search over them and
 * all of the learner's notes. Everything is taken from the topics themselves. Closed during a section test.
 */
export function Reference() {
  const { program, progress, openTerm } = useApp();
  const exam = useExamInProgress();
  const nav = useNavigate();
  const [tab, setTab] = useDraft<Tab>(`reference-tab:${currentPackage()}`, "defs");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<TheoremEntry | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  useEffect(() => { if (exam === null) api.notes({}).then(setNotes).catch(() => setNotes([])); }, [exam]);

  // program order of every topic and section, and where each one sits
  const { order, where } = useMemo(() => {
    const order = new Map<string, number>(), where = new Map<string, string>();
    for (const c of program?.courses ?? []) for (const d of c.disciplines) for (const s of d.sections) {
      for (const t of s.topics) { order.set(t.id, order.size); where.set(t.id, `${d.name} · ${s.title} · ${t.title}`); }
      order.set(s.id, order.size); where.set(s.id, `${d.name} · ${s.title} · Контрольная раздела`);
    }
    return { order, where };
  }, [program]);
  const passed = (id: string) => content.hasTopic(id) && progress[id]?.status === "done";

  // a term whose topic also has a <Theorem> card for it is shown once — as the card, the fuller definition
  const carded = (termText: string, topicId: string) => theorems().some((e) => e.topicId === topicId && score(termText, e.title) >= 3);
  const termsBy = useMemo(() => {
    const by = new Map<string, ReturnType<typeof allTerms>>();
    for (const t of allTerms()) if (t.introduced_in && !carded(t.term, t.introduced_in)) by.set(t.introduced_in, [...(by.get(t.introduced_in) ?? []), t]);
    return by;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = (topicId: string) => (termsBy.get(topicId)?.length ?? 0) + theorems().filter((e) => e.topicId === topicId).length;

  // the map: every course and discipline with the number of entries already passed in it
  const map = useMemo(() => (program?.courses ?? []).map((c) => {
    const discs = c.disciplines.map((d) => {
      const sections = d.sections.map((s) => ({ s, topics: s.topics.filter((t) => passed(t.id)) })).filter((x) => x.topics.length);
      return { d, sections, count: sections.reduce((n, x) => n + x.topics.reduce((m, t) => m + entries(t.id), 0), 0) };
    });
    return { c, discs, count: discs.reduce((n, x) => n + x.count, 0) };
  }), [program, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useDraft<{ c: string; d: string } | null>(`reference-pick:${currentPackage()}`, null);
  // default: the latest course and discipline with something passed
  const fallback = useMemo(() => {
    for (const x of [...map].reverse()) { const d = [...x.discs].reverse().find((y) => y.count > 0); if (d) return { c: x.c.id, d: d.d.id }; }
    return null;
  }, [map]);
  const cur = map.find((x) => x.c.id === pick?.c && x.count > 0) ? pick : fallback;
  const course = map.find((x) => x.c.id === cur?.c);
  const disc = course?.discs.find((x) => x.d.id === cur?.d && x.count > 0) ?? course?.discs.find((x) => x.count > 0);

  // search: only what is passed; best match first, then what came earlier in the program
  const hits = useMemo((): Hit[] => {
    if (!query.trim() || !program) return [];
    const out: Hit[] = [];
    for (const c of program.courses) for (const d of c.disciplines) for (const s of d.sections) for (const t of s.topics) {
      if (!passed(t.id)) continue;
      const sc = score(query, t.title);
      if (sc) out.push({ kind: "topic", id: t.id, title: t.title, where: `${d.name} · ${s.title}`, score: sc, order: order.get(t.id) ?? 0 });
    }
    for (const x of allTerms()) {
      if (!x.introduced_in || !passed(x.introduced_in) || carded(x.term, x.introduced_in)) continue;
      const sc = score(query, `${x.term} ${x.en ?? ""}`, `${x.short} ${x.example ?? ""}`);
      if (sc) out.push({ kind: "term", id: x.id, title: x.term, text: x.short, where: where.get(x.introduced_in) ?? "", score: sc, order: order.get(x.introduced_in) ?? 0 });
    }
    for (const e of theorems()) {
      if (!passed(e.topicId)) continue;
      const sc = score(query, e.title, e.text);
      if (sc) out.push({ kind: "theorem", entry: e, title: e.title, text: e.text, where: where.get(e.topicId) ?? "", score: sc, order: order.get(e.topicId) ?? 0 });
    }
    return out.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 40);
  }, [query, program, progress, order, where]); // eslint-disable-line react-hooks/exhaustive-deps

  if (exam === undefined || !program) return <div className="wrap stub faint">Загружаю справочник…</div>;
  if (exam) return <ExamLock sectionId={exam} what="Справочник" />;

  // notes grouped by topic (a term note goes under the topic that introduces the term)
  const termOf = (id: string | null) => (id ? allTerms().find((t) => t.id === id) : undefined);
  const notesBy = new Map<string, Note[]>();
  for (const n of notes ?? []) {
    const k = n.topic_id ?? termOf(n.term_id)?.introduced_in ?? "-";
    notesBy.set(k, [...(notesBy.get(k) ?? []), n]);
  }
  const noteKeys = [...notesBy.keys()].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));

  const choose = (h: Hit) => {
    if (h.kind === "topic") nav(to(`/learn/${h.id}`));
    else if (h.kind === "term") openTerm(h.id);
    else setOpen(h.entry);
  };

  return (
    <div className="wrap reference">
      <div className="ref-head">
        <div className="eyebrow">Пополняется по мере прохождения</div>
        <h1>Справочник</h1>
      </div>
      <div className="course-tabs" role="tablist">
        <button className={tab === "defs" ? "on" : ""} onClick={() => setTab("defs")}><BookMarked size={15} />Определения и правила</button>
        <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}><NotebookPen size={15} />Мои заметки</button>
      </div>

      {tab === "defs" && (<>
        <label className="ref-search"><Search size={18} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти тему, термин, определение или правило" aria-label="Поиск по справочнику" />
        </label>
        {query.trim() && (
          <div className="ref-hits">
            {hits.length === 0 && <p className="faint">Среди пройденного такого нет.</p>}
            {hits.map((h, i) => (
              <button key={i} className="ref-hit" onClick={() => choose(h)}>
                <span className={`ref-kind k-${h.kind}`}>{h.kind === "topic" ? "Тема" : h.kind === "term" ? "Термин" : KIND[h.entry.kind]}</span>
                <span className="ref-body"><b>{h.title}</b><span>{h.kind === "topic" ? h.where : `${h.text} — ${h.where}`}</span></span>
              </button>
            ))}
          </div>
        )}
        {!query.trim() && (!course || !disc
          ? <p className="faint">Здесь появятся термины, определения и правила пройденных тем.</p>
          : <>
            <div className="ref-courses" role="tablist" aria-label="Курсы">
              {map.map(({ c, count }) => (
                <button key={c.id} className={`ref-course${c.id === course.c.id ? " on" : ""}`} disabled={!count} onClick={() => setPick({ c: c.id, d: "" })} title={count ? c.title : "Здесь пока ничего не пройдено"}>
                  <b>{c.id === "0" ? "0" : c.id}</b><span>{c.title}</span><small>{count || "—"}</small>
                </button>
              ))}
            </div>
            <div className="ref-discs" role="tablist" aria-label="Дисциплины">
              {course.discs.map(({ d, count }) => (
                <button key={d.id} className={d.id === disc.d.id ? "on" : ""} disabled={!count} onClick={() => setPick({ c: course.c.id, d: d.id })}>{d.name}<small>{count || ""}</small></button>
              ))}
            </div>
            <div className="ref-layout">
              <nav className="ref-toc" aria-label="Разделы и темы">
                {disc.sections.map(({ s, topics }) => (
                  <div key={s.id}>
                    <div className="eyebrow">{s.title}</div>
                    {topics.map((t) => <a key={t.id} href={`#ref-${t.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`ref-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{t.title}</a>)}
                  </div>
                ))}
              </nav>
              <div className="ref-main">
                {disc.sections.map(({ s, topics }) => (
                  <section key={s.id} className="ref-sec">
                    <h2>{s.title}</h2>
                    {topics.map((t) => (
                      <article key={t.id} id={`ref-${t.id}`} className="ref-topic">
                        <h3><Link to={to(`/learn/${t.id}`)}>{t.title}</Link></h3>
                        {(termsBy.get(t.id) ?? []).length > 0 && (
                          <dl className="ref-terms">
                            {(termsBy.get(t.id) ?? []).map((x) => (
                              <div key={x.id}><dt><button className="ref-term" onClick={() => openTerm(x.id)}>{x.term}</button>{x.en && <span className="ref-en">{x.en}</span>}</dt><dd>{x.short}</dd></div>
                            ))}
                          </dl>
                        )}
                        <TopicTheorems topicId={t.id} />
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </>)}
      </>)}

      {tab === "notes" && (notes === null ? <p className="faint">Загружаю заметки…</p>
        : noteKeys.length === 0 ? <p className="faint">Заметок пока нет. Их можно оставлять в любой теме и в справке по термину.</p>
        : noteKeys.map((k) => (
          <section key={k} className="ref-notes">
            <div className="eyebrow">{k === "-" ? "Без темы" : where.get(k) ?? k}</div>
            {notesBy.get(k)!.map((n) => (
              <div className="note" key={n.id}>
                {n.term_id && <div className="note-term">{termOf(n.term_id)?.term ?? n.term_id}</div>}
                {n.text}
              </div>
            ))}
          </section>
        )))}

      {open && (
        <Modal wide title={where.get(open.topicId)?.split(" · ").pop() ?? ""} onClose={() => setOpen(null)}
          actions={<><Link className="btn soft" to={to(`/learn/${open.topicId}`)}>Открыть тему</Link><button className="btn" onClick={() => setOpen(null)}>Закрыть</button></>}>
          <TopicTheorems topicId={open.topicId} only={open.title} />
        </Modal>
      )}
    </div>
  );
}
