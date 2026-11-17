import { useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { api } from "../api";
import { useApp } from "../state";
import type { Question, QuizData } from "../content/registry";

type Answer = number | number[] | string | undefined;

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function isRight(q: Question, a: Answer): boolean | null {
  if (q.type === "open") return null;
  if (q.type === "single") return a === q.answer;
  const want = [...((q.answer as number[]) ?? [])].sort().join(",");
  return [...((a as number[]) ?? [])].sort().join(",") === want;
}

/** Topic test or section test. Auto-graded questions are checked here; open answers wait for the teacher. */
export function Quiz({ scope, data, onPassed }: { scope: string; data: QuizData; onPassed?: () => void }) {
  const { claude } = useApp();
  const teacher = !!claude?.installed;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [conf, setConf] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);
  const started = useRef(Date.now());
  const pass = data.pass ?? 0.85;
  // New order of questions and options on every attempt: no position bias, no memorising «the second one».
  const [view] = useState(() => shuffled(data.questions).map((q) => ({ q, perm: shuffled((q.options ?? []).map((_, i) => i)) })));

  const auto = data.questions.filter((q) => q.type !== "open");
  const score = useMemo(() => (auto.length ? auto.filter((q) => isRight(q, answers[q.id])).length / auto.length : 1), [answers, auto]);
  // Open answers are checked by the teacher (Claude) later and never block passing the test.
  const complete = data.questions.every((q) => q.type === "open" ? !teacher || String(answers[q.id] ?? "").trim().length > 0 : answers[q.id] !== undefined && (q.type !== "multi" || (answers[q.id] as number[]).length > 0));

  async function submit() {
    setDone(true);
    const seconds = Math.round((Date.now() - started.current) / 1000);
    await api.saveAttempts(data.questions.filter((q) => q.type !== "open" || teacher).map((q) => ({
      scope, item_id: q.id, kind: q.type, answer: answers[q.id] ?? null, correct: isRight(q, answers[q.id]), confidence: conf[q.id] ?? null, seconds,
    }))).catch(() => {});
    if (score >= pass) onPassed?.();
  }

  function toggle(q: Question, i: number) {
    if (done) return;
    if (q.type === "single") setAnswers({ ...answers, [q.id]: i });
    else { const cur = (answers[q.id] as number[]) ?? []; setAnswers({ ...answers, [q.id]: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] }); }
  }

  return (
    <div>
      <div className="quiz-head">
        <div><div className="eyebrow">{data.title ?? "Проверка темы"}</div><h2 style={{ marginTop: 10 }}>{data.questions.length} вопросов</h2></div>
        <span className="faint" style={{ fontSize: 14 }}>Порог {Math.round(pass * 100)}% · подсказки недоступны</span>
      </div>
      {view.map(({ q, perm }, n) => {
        const verdict = done ? isRight(q, answers[q.id]) : null;
        return (
          <div className="qitem" key={q.id}>
            <div className="qtitle"><b>{n + 1}. {q.q}</b><span className="chip">{q.type === "single" ? "один ответ" : q.type === "multi" ? "несколько ответов" : "развёрнутый ответ"}</span></div>
            {q.type === "open" ? (
              teacher ? (
                <textarea value={(answers[q.id] as string) ?? ""} disabled={done} placeholder="Ответьте своими словами — ответ проверит преподаватель" onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
              ) : (
                <div className="needs-claude"><b>Нужен Claude.</b> Этот вопрос проверяет преподаватель Claude. Установите Claude Code на компьютер и войдите в него — вопрос станет доступен. На прохождение проверки он не влияет.</div>
              )
            ) : perm.map((i) => {
              const o = q.options![i];
              const chosen = q.type === "single" ? answers[q.id] === i : ((answers[q.id] as number[]) ?? []).includes(i);
              const correct = q.type === "single" ? q.answer === i : (q.answer as number[]).includes(i);
              return (
                <button key={i} className={`opt${done && correct ? " right" : done && chosen ? " wrong" : ""}`} onClick={() => toggle(q, i)}>
                  <input type={q.type === "single" ? "radio" : "checkbox"} readOnly checked={chosen} tabIndex={-1} />{o}
                </button>
              );
            })}
            {!done && q.type === "open" && teacher && (
              <div className="conf">Насколько вы уверены?
                {[1, 2, 3, 4, 5].map((v) => <button key={v} className={conf[q.id] === v ? "on" : ""} onClick={() => setConf({ ...conf, [q.id]: v })}>{v}</button>)}
              </div>
            )}
            {done && q.type === "open" && teacher && <div className="explain">Ответ сохранён. Его проверит преподаватель по критериям: {(q.rubric ?? []).join("; ")}.{q.explain ? ` Подсказка для самопроверки: ${q.explain}` : ""}</div>}
            {done && q.type !== "open" && <div className="explain">{verdict ? "Верно. " : "Неверно. "}{q.explain}</div>}
          </div>
        );
      })}
      {!done ? (
        <button className="btn" onClick={submit} disabled={!complete}>Сдать</button>
      ) : (
        <div className={`result ${score >= pass ? "pass" : "fail"}`}>
          {score >= pass ? <CheckCircle2 size={28} /> : <CircleAlert size={28} />}
          <div><b className="tnum">{Math.round(score * 100)}%</b><div style={{ marginTop: 6 }}>{score >= pass ? "Проверка пройдена." : "Пока ниже порога. Перечитайте страницы с ошибками и попробуйте снова — вопросы будут в другом порядке."}</div></div>
        </div>
      )}
    </div>
  );
}
