import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, CircleDashed, Target } from "lucide-react";
import { api, type Results, type TimeStats } from "../api";
import { useApp } from "../state";
import { content } from "../content/registry";
import { fmtTime } from "../format";

const pct = (x?: number | null) => (x == null ? "" : `${Math.round(x * 100)}%`);

function Days({ days }: { days: TimeStats["days"] }) {
  // last 14 calendar days, empty ones included
  const list = useMemo(() => {
    const map = new Map(days.map((d) => [d.day, d.seconds]));
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - 13 + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { key, label: d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }), wd: d.toLocaleDateString("ru-RU", { weekday: "short" }), sec: map.get(key) ?? 0 };
    });
  }, [days]);
  const max = Math.max(...list.map((d) => d.sec), 1);
  return (
    <div className="rec-days" role="img" aria-label="Время занятий по дням за две недели">
      {list.map((d) => (
        <div key={d.key} className="rec-day" title={`${d.label}: ${d.sec ? fmtTime(d.sec) : "нет занятий"}`}>
          <div className="rec-bar"><b style={{ height: `${Math.max(d.sec ? 4 : 0, (d.sec / max) * 100)}%` }} /></div>
          <span>{d.wd}</span>
        </div>
      ))}
    </div>
  );
}

/** Record book: study time and results per course, discipline, section and topic. */
export function Record() {
  const { program, progress } = useApp();
  const [time, setTime] = useState<TimeStats | null>(null);
  const [results, setResults] = useState<Results>({});
  useEffect(() => {
    api.time().then(setTime).catch(() => {});
    api.results().then(setResults).catch(() => {});
  }, []);

  if (!program || !time) return <div className="wrap stub faint">Загружаю зачётку…</div>;
  const t = (id: string) => time.by_scope[id] ?? 0;

  return (
    <div className="wrap record">
      <div className="eyebrow">Зачётная книжка</div>
      <h1>Время и результаты</h1>
      <div className="rec-cards">
        <div className="rec-card"><span>Сегодня</span><b className="tnum">{fmtTime(time.today)}</b></div>
        <div className="rec-card"><span>За 7 дней</span><b className="tnum">{fmtTime(time.week)}</b></div>
        <div className="rec-card"><span>Всего</span><b className="tnum">{fmtTime(time.total)}</b></div>
      </div>
      <div className="rec-panel">
        <div className="eyebrow">Последние две недели</div>
        <Days days={time.days} />
        <p className="faint">Время идёт, пока вкладка открыта и вы занимаетесь. После 5 минут без действий и в свёрнутой вкладке отсчёт останавливается.</p>
      </div>

      {program.courses.map((c) => {
        const discs = c.disciplines.filter((d) => d.sections.some((s) => s.topics.some((x) => content.hasTopic(x.id) || progress[x.id] || t(x.id))));
        if (!discs.length) return null;
        return (
          <section key={c.id} className="rec-course">
            <h2>Курс {c.id} · {c.title}</h2>
            {discs.map((d) => {
              const dSec = d.sections.reduce((s, sec) => s + t(sec.id) + sec.topics.reduce((a, x) => a + t(x.id), 0), 0);
              return (
                <div key={d.id} className="rec-panel">
                  <div className="rec-disc"><h3>{d.name}</h3>{d.name !== d.title && <span className="muted">{d.title}</span>}<b className="tnum">{fmtTime(dSec)}</b></div>
                  {d.sections.map((s, si) => {
                    const test = content.sectionTest(s.id) ? results[s.id] : undefined;
                    return (
                      <div key={s.id} className="rec-sec">
                        <div className="rec-sec-h"><span className="toc-n">Раздел {si + 1}</span><b>{s.title}</b></div>
                        {s.topics.map((x, ti) => {
                          const r = results[x.id];
                          const done = progress[x.id]?.status === "done";
                          const icon = done ? <Check size={15} /> : progress[x.id] ? <BookOpen size={15} /> : <CircleDashed size={15} />;
                          return (
                            <Link key={x.id} to={`/learn/${x.id}`} className={`rec-row${done ? " done" : ""}`}>
                              <span className="toc-num">{si + 1}.{ti + 1}</span>{icon}<span className="rec-title">{x.title}</span>
                              <span className="rec-score tnum">{r?.done ? pct(r.score) : ""}</span>
                              <span className="rec-time tnum">{t(x.id) ? fmtTime(t(x.id)) : ""}</span>
                            </Link>
                          );
                        })}
                        {content.sectionTest(s.id) && (
                          <Link to={`/test/${s.id}`} className={`rec-row${test?.passed ? " done" : ""}`}>
                            <span className="toc-num" />{test?.passed ? <Check size={15} /> : <Target size={15} />}<span className="rec-title">Контрольная раздела</span>
                            <span className="rec-score tnum">{test?.done ? pct(test.score) : ""}</span>
                            <span className="rec-time tnum">{t(s.id) ? fmtTime(t(s.id)) : ""}</span>
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
