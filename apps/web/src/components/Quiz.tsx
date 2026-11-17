import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, MessageSquareText, RotateCcw } from "lucide-react";
import { api, type Grade } from "../api";
import { useApp } from "../state";
import type { Question, QuizData } from "../content/registry";

type Answer = number | number[] | string | undefined;
/** What is stored on the server, so a finished test stays finished after leaving the page. */
type Saved = {
  order: { id: string; perm: number[] }[];
  answers: Record<string, Answer>;
  conf: Record<string, number>;
  done: boolean;
  grades: Record<string, Grade>;
};

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

// New order of questions and options on every attempt: no position bias, no memorising «the second one».
// Auto-graded questions are shuffled; questions with a written answer always go last.
function freshOrder(data: QuizData): Saved["order"] {
  return [...shuffled(data.questions.filter((q) => q.type !== "open")), ...data.questions.filter((q) => q.type === "open")]
    .map((q) => ({ id: q.id, perm: shuffled((q.options ?? []).map((_, i) => i)) }));
}

const fresh = (data: QuizData): Saved => ({ order: freshOrder(data), answers: {}, conf: {}, done: false, grades: {} });

/** A saved state is reused only if the test itself has not changed since (same questions, same option counts). */
function fits(s: Saved | null, data: QuizData): s is Saved {
  if (!s || !Array.isArray(s.order) || s.order.length !== data.questions.length) return false;
  const byId = new Map(data.questions.map((q) => [q.id, q]));
  return s.order.every((o) => byId.has(o.id) && o.perm.length === (byId.get(o.id)!.options ?? []).length);
}

/** Grows with its text; the scrollbar appears only past ~3/4 of the screen height (CSS max-height). */
function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={3} {...props} />;
}

/**
 * Topic test or section test. Auto-graded questions are checked here. Written answers go to the teacher
 * (Claude) right after «Сдать»; with Claude installed the test counts as passed only when every written
 * answer is accepted. Without Claude written questions are unavailable and never block progress.
 */
export function Quiz({ scope, data, onPassed }: { scope: string; data: QuizData; onPassed?: () => void }) {
  const { claude, refreshClaude } = useApp();
  const teacher = !!claude?.installed;
  const pass = data.pass ?? 0.85;
  const [st, setSt] = useState<Saved>(() => fresh(data));
  const [loaded, setLoaded] = useState(false);
  const [grading, setGrading] = useState<Record<string, boolean>>({});
  const [gradeErr, setGradeErr] = useState<Record<string, string>>({});
  const stRef = useRef(st);
  const reported = useRef(false);
  const started = useRef(Date.now());

  const byId = useMemo(() => new Map(data.questions.map((q) => [q.id, q])), [data]);
  const auto = data.questions.filter((q) => q.type !== "open");
  const open = data.questions.filter((q) => q.type === "open");
  const score = auto.length ? auto.filter((q) => isRight(q, st.answers[q.id])).length / auto.length : 1;
  const written = (id: string) => String(st.answers[id] ?? "").trim().length > 0;
  // An unchecked written answer blocks only while the teacher can actually check it.
  const openOk = !teacher || open.every((q) => !written(q.id) || st.grades[q.id]?.verdict === "pass" || !!gradeErr[q.id]);
  const pending = open.some((q) => grading[q.id]);
  const passed = st.done && score >= pass && openOk && !pending;
  const complete = data.questions.every((q) => q.type === "open"
    ? !teacher || written(q.id)
    : st.answers[q.id] !== undefined && (q.type !== "multi" || (st.answers[q.id] as number[]).length > 0));

  useEffect(() => {
    let alive = true;
    api.quizState<Saved>(scope).then(({ state, passed: wasPassed }) => {
      if (!alive) return;
      if (fits(state, data)) { stRef.current = state; setSt(state); }
      if (wasPassed) reported.current = true;
    }).catch(() => {}).finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [scope, data]);

  useEffect(() => {
    if (passed && !reported.current) { reported.current = true; onPassed?.(); }
  }, [passed, onPassed]);

  /** Update local state and store it on the server (also works if the learner has already left the page). */
  function commit(next: Saved, isPassed: boolean) {
    stRef.current = next;
    setSt(next);
    api.saveQuizState(scope, next, isPassed).catch(() => {});
  }

  function edit(patch: Partial<Saved>) { const next = { ...stRef.current, ...patch }; stRef.current = next; setSt(next); }

  async function grade(q: Question) {
    setGrading((g) => ({ ...g, [q.id]: true }));
    setGradeErr((e) => { const { [q.id]: _, ...rest } = e; return rest; });
    try {
      const g = await api.grade({
        scope, item_id: q.id, question: q.q, rubric: q.rubric ?? [], wrong_answers: q.wrong_answers ?? [],
        answer: String(stRef.current.answers[q.id] ?? ""), confidence: stRef.current.conf[q.id] ?? null,
      });
      const next = { ...stRef.current, grades: { ...stRef.current.grades, [q.id]: g } };
      const allOk = open.every((o) => !String(next.answers[o.id] ?? "").trim() || next.grades[o.id]?.verdict === "pass");
      commit(next, score >= pass && allOk);
      refreshClaude(); // the check spent some of the subscription: show fresh limits
    } catch (e) {
      setGradeErr((x) => ({ ...x, [q.id]: e instanceof Error ? e.message : "Преподаватель недоступен" }));
      refreshClaude();
    } finally {
      setGrading((g) => ({ ...g, [q.id]: false }));
    }
  }

  async function submit() {
    const seconds = Math.round((Date.now() - started.current) / 1000);
    const next = { ...stRef.current, done: true };
    const needsTeacher = teacher && open.some((q) => written(q.id));
    commit(next, score >= pass && !needsTeacher);
    api.saveAttempts(auto.map((q) => ({
      scope, item_id: q.id, kind: q.type, answer: next.answers[q.id] ?? null, correct: isRight(q, next.answers[q.id]), seconds,
    }))).catch(() => {});
    if (teacher) open.filter((q) => written(q.id)).forEach((q) => void grade(q));
  }

  function restart() {
    reported.current = false;
    setGradeErr({});
    started.current = Date.now();
    commit(fresh(data), false);
  }

  function toggle(q: Question, i: number) {
    if (st.done) return;
    const cur = st.answers[q.id];
    const value = q.type === "single" ? i : ((cur as number[]) ?? []).includes(i) ? (cur as number[]).filter((x) => x !== i) : [...((cur as number[]) ?? []), i];
    edit({ answers: { ...st.answers, [q.id]: value } });
  }

  if (!loaded) return <div className="faint" style={{ padding: "40px 0" }}>Загружаю проверку…</div>;

  return (
    <div>
      <div className="quiz-head">
        <div><div className="eyebrow">{data.title ?? "Проверка темы"}</div><h2 style={{ marginTop: 10 }}>{data.questions.length} вопросов</h2></div>
        <span className="faint" style={{ fontSize: 14 }}>Порог {Math.round(pass * 100)}% · подсказки недоступны</span>
      </div>
      {st.order.map(({ id, perm }, n) => {
        const q = byId.get(id)!;
        const a = st.answers[q.id];
        const verdict = st.done ? isRight(q, a) : null;
        const g = st.grades[q.id];
        const busy = !!grading[q.id];
        // After «Сдать» a written answer stays editable until the teacher accepts it.
        const canRevise = st.done && !busy && g?.verdict !== "pass";
        return (
          <div className="qitem" key={q.id}>
            <div className="qtitle"><b>{n + 1}. {q.q}</b><span className="chip">{q.type === "single" ? "один ответ" : q.type === "multi" ? "несколько ответов" : "развёрнутый ответ"}</span></div>
            {q.type === "open" ? (
              !claude ? (
                <div className="grading"><LoaderCircle size={18} />Проверяю, установлен ли Claude…</div>
              ) : teacher || written(q.id) ? (
                <AutoTextarea value={(a as string) ?? ""} disabled={(st.done && !canRevise) || busy || !teacher}
                  placeholder="Ответьте своими словами — ответ сразу проверит преподаватель"
                  onChange={(e) => edit({ answers: { ...st.answers, [q.id]: e.target.value } })} />
              ) : (
                <div className="needs-claude"><b>Нужен Claude.</b> Этот вопрос проверяет преподаватель Claude. Установите Claude Code на компьютер и войдите в него — вопрос станет доступен. На прохождение проверки он не влияет.</div>
              )
            ) : perm.map((i) => {
              const chosen = q.type === "single" ? a === i : ((a as number[]) ?? []).includes(i);
              const correct = q.type === "single" ? q.answer === i : (q.answer as number[]).includes(i);
              return (
                <button key={i} className={`opt${st.done && correct ? " right" : st.done && chosen ? " wrong" : ""}`} onClick={() => toggle(q, i)}>
                  <input type={q.type === "single" ? "radio" : "checkbox"} readOnly checked={chosen} tabIndex={-1} />{q.options![i]}
                </button>
              );
            })}
            {q.type === "open" && teacher && (!st.done || canRevise) && (
              <div className="conf">Насколько вы уверены?
                {[1, 2, 3, 4, 5].map((v) => <button key={v} className={st.conf[q.id] === v ? "on" : ""} onClick={() => edit({ conf: { ...st.conf, [q.id]: v } })}>{v}</button>)}
              </div>
            )}
            {busy && <div className="grading"><LoaderCircle size={18} />Преподаватель проверяет ответ…</div>}
            {!busy && g && (
              <div className={`verdict ${g.verdict}`}>
                {g.verdict === "pass" ? <CheckCircle2 size={22} /> : <MessageSquareText size={22} />}
                <div>
                  <b>{g.verdict === "pass" ? "Ответ принят." : "Ответ нужно дополнить или исправить."}</b> {g.feedback}
                  {g.misconception && <> {g.misconception}</>}
                  <span className="meta">Попытка {g.attempt}{g.verdict === "revise" ? " · отредактируйте ответ выше и сдайте снова" : ""}</span>
                </div>
              </div>
            )}
            {!busy && gradeErr[q.id] && (
              <div className="verdict error"><CircleAlert size={22} /><div><b>Преподаватель не смог проверить ответ.</b> {gradeErr[q.id]}<span className="meta">Ответ сохранён. На прохождение проверки это не влияет.</span></div></div>
            )}
            {st.done && q.type === "open" && teacher && written(q.id) && canRevise && (
              <div className="qactions"><button className="btn sm" disabled={!written(q.id)} onClick={() => { commit(stRef.current, false); void grade(q); }}>Сдать ответ снова</button></div>
            )}
            {st.done && q.type !== "open" && <div className="explain">{verdict ? "Верно. " : "Неверно. "}{q.explain}</div>}
            {st.done && (q.traps ?? []).some((t) => (Array.isArray(a) ? a.includes(t) : a === t)) && (
              <div className="explain trap">Это ловушка: вариант звучит почти как фраза из лекции, но смысл в нём другой. Читайте каждый вариант до конца.</div>
            )}
          </div>
        );
      })}
      {!st.done ? (
        <button className="btn" onClick={submit} disabled={!complete}>Сдать</button>
      ) : (
        <>
          <div className={`result ${passed ? "pass" : pending ? "wait" : "fail"}`}>
            {passed ? <CheckCircle2 size={28} /> : pending ? <LoaderCircle size={28} className="spin" /> : <CircleAlert size={28} />}
            <div>
              <b className="tnum">{Math.round(score * 100)}%</b>
              <div style={{ marginTop: 6 }}>
                {passed ? "Проверка пройдена."
                  : score < pass ? "Пока ниже порога. Перечитайте страницы с ошибками и пройдите проверку заново — вопросы будут в другом порядке."
                  : pending ? "Тестовая часть пройдена. Ждём, что скажет преподаватель о развёрнутом ответе."
                  : "Тестовая часть пройдена. Осталось довести развёрнутый ответ: исправьте его по замечанию и сдайте снова."}
              </div>
            </div>
          </div>
          <div className="quiz-foot">
            <button className="btn soft sm" onClick={restart} disabled={pending}><RotateCcw size={16} />Пройти заново</button>
          </div>
        </>
      )}
    </div>
  );
}
