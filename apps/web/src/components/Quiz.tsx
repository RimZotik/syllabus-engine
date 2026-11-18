import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react";
import { CheckCircle2, CircleAlert, Flag, LoaderCircle, MessageSquareText, Play, RotateCcw } from "lucide-react";
import { api } from "../api";
import { useApp } from "../state";
import type { Question, QuizData } from "../content/registry";
import { RichText } from "./RichText";
import { accepted, examStarted, fits, fresh, isPartial, isRight, optionMark, restartState, unanswered, type Saved } from "./quizLogic";
import { Modal } from "./Modal";

/** Grows with its text; the scrollbar appears only past ~3/4 of the screen height (CSS max-height). */
function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure without a scrollbar: a scrollbar narrows the text, which wraps more and leaves an empty line.
    el.style.overflowY = "hidden";
    el.style.height = "auto";
    const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    const h = el.scrollHeight + el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(h, max)}px`;
    el.style.overflowY = h > max ? "auto" : "hidden"; // scroll only once the field reached its maximum height
  }, [props.value]);
  return <textarea ref={ref} rows={3} spellCheck {...props} />;
}

/**
 * Topic test or section test. Auto-graded questions are checked here. Written answers go to the teacher
 * (Claude) right after «Сдать»; with Claude installed the test counts as passed only when every written
 * answer is accepted. Without Claude written questions are unavailable and never block progress.
 *
 * `exam` — a section test, stricter: it starts with a button and a warning, the topics are out of reach
 * while it runs, it is finished through a confirmation window (unanswered questions are named), and
 * below the threshold only the score is shown — the review of answers opens once the test is passed.
 */
export type ExamPhase = "intro" | "progress" | "result";
export function Quiz({ scope, data, onPassed, exam = false, onPhase }: { scope: string; data: QuizData; onPassed?: () => void; exam?: boolean; onPhase?: (p: ExamPhase) => void }) {
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
  const correct = auto.filter((q) => isRight(q, st.answers[q.id])).length;
  const phase: ExamPhase = st.done ? "result" : exam && !examStarted(st) ? "intro" : "progress";
  const review = !exam || score >= pass; // a failed section test shows only the score
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (loaded) onPhase?.(phase); }, [phase, loaded, onPhase]);
  // leaving the page in the middle of a section test asks first (reload, closing the tab)
  useEffect(() => {
    if (!exam || phase !== "progress") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [exam, phase]);

  // The saved state is read once per test. Not on every new `data` object from the parent: re-reading it
  // while the learner types put back the last saved draft (saved 0.7 s late) — the newest words vanished.
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    let alive = true;
    api.quizState<Saved>(scope).then(({ state, passed: wasPassed }) => {
      if (!alive) return;
      if (fits(state, dataRef.current)) { stRef.current = state; setSt(state); }
      if (wasPassed) reported.current = true;
    }).catch(() => {}).finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [scope]);

  useEffect(() => {
    if (passed && !reported.current) { reported.current = true; onPassed?.(); }
  }, [passed, onPassed]);

  /** Update local state and store it on the server (also works if the learner has already left the page). */
  function commit(next: Saved, isPassed: boolean) {
    stRef.current = next;
    setSt(next);
    api.saveQuizState(scope, next, isPassed).catch(() => {});
  }

  // Answers in progress are saved too (debounced), so an unfinished test survives a reload or restart.
  const draftTimer = useRef(0);
  function edit(patch: Partial<Saved>) {
    const next = { ...stRef.current, ...patch };
    stRef.current = next;
    setSt(next);
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => api.saveQuizState(scope, stRef.current, false).catch(() => {}), 700);
  }

  async function grade(q: Question) {
    setGrading((g) => ({ ...g, [q.id]: true }));
    setGradeErr((e) => { const { [q.id]: _, ...rest } = e; return rest; });
    try {
      const g = await api.grade({
        scope, item_id: q.id, question: q.q, rubric: q.rubric ?? [], wrong_answers: q.wrong_answers ?? [],
        answer: String(stRef.current.answers[q.id] ?? ""), confidence: null, // no self-rating: the teacher judges how well the answer is argued
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
    const at = new Date().toISOString();
    const prev = stRef.current;
    const history = [...(prev.history ?? []), { n: (prev.history?.length ?? 0) + 1, score, correct, total: auto.length, at, answers: prev.answers }];
    const next = { ...prev, done: true, score, submitted_at: at, history };
    // written answers are a separate part: checked in every attempt, so the learner sees what to fix
    const toCheck = open.filter((q) => written(q.id) && !accepted(next, q.id));
    const needsTeacher = teacher && toCheck.length > 0;
    commit(next, score >= pass && !needsTeacher);
    api.saveAttempts(auto.map((q) => ({
      scope, item_id: q.id, kind: q.type, answer: next.answers[q.id] ?? null, correct: isRight(q, next.answers[q.id]), seconds,
    }))).catch(() => {});
    if (teacher) toCheck.forEach((q) => void grade(q));
  }

  function restart() {
    reported.current = false;
    setGradeErr({});
    started.current = Date.now();
    const next = restartState(data, stRef.current);
    commit(exam ? { ...next, started: false } : next, false);
    window.scrollTo(0, 0);
  }

  function startExam() {
    started.current = Date.now();
    commit({ ...stRef.current, started: true }, false);
    window.scrollTo(0, 0);
  }

  function toggle(q: Question, i: number) {
    const now = stRef.current; // latest answers, so two quick clicks never overwrite each other
    if (now.done) return;
    const cur = now.answers[q.id];
    const value = q.type === "single" ? i : ((cur as number[]) ?? []).includes(i) ? (cur as number[]).filter((x) => x !== i) : [...((cur as number[]) ?? []), i];
    edit({ answers: { ...now.answers, [q.id]: value } });
  }

  if (!loaded) return <div className="faint" style={{ padding: "40px 0" }}>Загружаю проверку…</div>;

  const tries = st.history?.length ?? 0;
  const head = (
    <div className="quiz-head">
      <div><div className="eyebrow">{data.title ?? "Проверка темы"}</div><h2 style={{ marginTop: 10 }}>{data.questions.length} вопросов</h2></div>
      <span className="faint" style={{ fontSize: 14 }}>Порог {Math.round(pass * 100)}% · подсказки недоступны{exam && tries ? ` · попыток: ${tries}` : ""}</span>
    </div>
  );

  if (phase === "intro") return (
    <div>
      {head}
      <div className="exam-rules">
        <b>Перед началом</b>
        <ul>
          <li>Пока идёт контрольная, темы раздела и содержание недоступны: вернуться к теории можно только после сдачи.</li>
          <li>Сдать можно, не ответив на все вопросы, — вопросы без ответа засчитаются как неверные.</li>
          <li>Контрольная из двух частей. <b>Тестовая</b> — вопросы с выбором ответа, нужно {Math.round(pass * 100)}% верных. Если не наберёте порог, увидите только счёт, без разбора: перечитайте раздел и пройдите тестовую часть снова. Разбор откроется после сдачи.</li>
          {open.length > 0 && <li><b>Развёрнутые ответы</b> преподаватель проверяет сразу после сдачи в любой попытке: его замечания видны, ответ можно исправить и сдать снова. Принятые ответы сохраняются на следующие попытки.</li>}
          <li>Каждая попытка сохраняется{tries ? ` — это будет попытка ${tries + 1}` : ""}.</li>
        </ul>
        <button className="btn" onClick={startExam}><Play size={16} />Начать контрольную</button>
      </div>
    </div>
  );

  const missing = unanswered(st, data, teacher);
  // a section test's two parts, shown separately in its result
  const writtenOpen = open.filter((o) => written(o.id));
  const acceptedN = writtenOpen.filter((o) => accepted(st, o.id)).length;
  const parts = exam && st.done && (
    <div className="exam-parts">
      <div className={score >= pass ? "ok" : "bad"}><span>Тестовая часть</span><b className="tnum">верно {correct} из {auto.length}</b><span className="faint tnum">{Math.round(score * 100)}%, нужно {Math.round(pass * 100)}%</span></div>
      {open.length > 0 && teacher && <div className={pending ? "wait" : acceptedN === writtenOpen.length && writtenOpen.length ? "ok" : "bad"}><span>Развёрнутые ответы</span>
        <b className="tnum">{pending ? "проверяет преподаватель" : `принято ${acceptedN} из ${open.length}`}</b>
        <span className="faint">{pending ? "" : acceptedN < open.length ? "замечания — у вопросов ниже" : "всё принято"}</span></div>}
    </div>
  );
  // A failed test part: its questions are hidden (no review), the written answers stay with the teacher's comments.
  const shown = phase === "result" && !review ? st.order.filter((o) => byId.get(o.id)?.type === "open") : st.order;

  return (
    <div>
      {head}
      {phase === "result" && !review && (
        <>
          <div className="result fail">
            <CircleAlert size={28} />
            <div>
              <b>Попытка {tries} не засчитана</b>
              <div style={{ marginTop: 6 }}>Тестовая часть ниже порога. Её разбор откроется, когда контрольная будет сдана: так ошибки исправляются пониманием, а не запоминанием. Перечитайте темы раздела и пройдите тестовую часть снова — вопросы и варианты будут в другом порядке.{writtenOpen.length > 0 ? " Развёрнутые ответы ниже: поправьте их по замечаниям преподавателя, принятые сохранятся." : ""}</div>
            </div>
          </div>
          {parts}
          {shown.length > 0 && <div className="eyebrow" style={{ margin: "26px 0 4px" }}>Развёрнутые ответы</div>}
        </>
      )}
      {shown.map(({ id, perm }, n) => {
        const q = byId.get(id);
        if (!q) return null;
        const a = st.answers[q.id];
        const verdict = st.done ? isRight(q, a) : null;
        const g = st.grades[q.id];
        const busy = !!grading[q.id];
        // After «Сдать» a written answer stays editable until the teacher accepts it.
        const canRevise = st.done && !busy && g?.verdict !== "pass";
        const locked = g?.verdict === "pass"; // accepted earlier: kept through «Пройти заново», not checked again
        return (
          <div className="qitem" key={q.id}>
            <div className="qtitle"><b>{n + 1}. <RichText text={q.q} /></b><span className="chip">{q.type === "single" ? "один ответ" : q.type === "multi" ? "несколько ответов" : "развёрнутый ответ"}</span></div>
            {q.type === "open" ? (
              !claude ? (
                <div className="grading"><LoaderCircle size={18} />Проверяю, установлен ли Claude…</div>
              ) : teacher || written(q.id) ? (
                <AutoTextarea value={(a as string) ?? ""} disabled={(st.done && !canRevise) || locked || busy || !teacher}
                  placeholder="Ответьте своими словами — ответ сразу проверит преподаватель"
                  onChange={(e) => edit({ answers: { ...st.answers, [q.id]: e.target.value } })} />
              ) : (
                <div className="needs-claude"><b>Нужен Claude.</b> Этот вопрос проверяет преподаватель Claude. Установите Claude Code на компьютер и войдите в него — вопрос станет доступен. На прохождение проверки он не влияет.</div>
              )
            ) : perm.map((i) => {
              const chosen = q.type === "single" ? a === i : ((a as number[]) ?? []).includes(i);
              const mark = st.done ? optionMark(q, a, i) : "";
              return (
                <button key={i} className={`opt${mark ? " " + mark : ""}`} onClick={() => toggle(q, i)}>
                  <input type={q.type === "single" ? "radio" : "checkbox"} readOnly checked={chosen} tabIndex={-1} /><span className="opt-text"><RichText text={q.options![i]} /></span>
                </button>
              );
            })}
            {busy && <div className="grading"><LoaderCircle size={18} />Преподаватель проверяет ответ…</div>}
            {!busy && g && (
              <div className={`verdict ${g.verdict}`}>
                {g.verdict === "pass" ? <CheckCircle2 size={22} /> : <MessageSquareText size={22} />}
                <div>
                  <b>{g.verdict === "pass" ? "Ответ принят." : "Ответ нужно дополнить или исправить."}</b> {g.feedback}
                  {g.misconception && <> {g.misconception}</>}
                  <span className="meta">{g.verdict === "pass" ? `Принят с ${g.attempt}-й попытки` : `Попытка ${g.attempt} · отредактируйте ответ выше и сдайте снова`}</span>
                </div>
              </div>
            )}
            {!busy && gradeErr[q.id] && (
              <div className="verdict error"><CircleAlert size={22} /><div><b>Преподаватель не смог проверить ответ.</b> {gradeErr[q.id]}<span className="meta">Ответ сохранён. На прохождение проверки это не влияет.</span></div></div>
            )}
            {st.done && q.type === "open" && teacher && written(q.id) && canRevise && (
              <div className="qactions"><button className="btn sm" disabled={!written(q.id)} onClick={() => { commit(stRef.current, false); void grade(q); }}>Сдать ответ снова</button></div>
            )}
            {st.done && q.type !== "open" && <div className="explain">{verdict ? "Верно. " : isPartial(q, a) ? "Частично: вы отметили не все верные варианты — пропущенные подсвечены жёлтым. " : "Неверно. "}<RichText text={q.explain ?? ""} /></div>}
            {st.done && (q.traps ?? []).some((t) => (Array.isArray(a) ? a.includes(t) : a === t)) && (
              <div className="explain trap">Это ловушка: вариант звучит почти как фраза из лекции, но смысл в нём другой. Читайте каждый вариант до конца.</div>
            )}
          </div>
        );
      })}
      {phase === "result" && !review ? (
        <div className="quiz-foot"><button className="btn" onClick={restart} disabled={pending}><RotateCcw size={16} />Пройти тестовую часть снова</button></div>
      ) : !st.done ? (
        exam ? (
          <div className="reader-nav-wrap"><div className="reader-nav exam-nav">
            <span className="faint tnum">{missing.length ? `Без ответа: ${missing.length} из ${data.questions.length}` : "Все вопросы отвечены"}</span>
            <button className="btn" id="next" onClick={() => setConfirm(true)}><Flag size={16} />Закончить попытку</button>
          </div></div>
        ) : <button className="btn" onClick={submit} disabled={!complete}>Сдать</button>
      ) : (
        <>
          {parts}
          <div className={`result ${passed ? "pass" : pending ? "wait" : "fail"}`}>
            {passed ? <CheckCircle2 size={28} /> : pending ? <LoaderCircle size={28} className="spin" /> : <CircleAlert size={28} />}
            <div>
              <b className="tnum">{exam ? `Верно ${correct} из ${auto.length} · ` : ""}{Math.round(score * 100)}%</b>
              <div style={{ marginTop: 6 }}>
                {passed ? (exam ? `Контрольная сдана${tries > 1 ? ` с ${tries}-й попытки` : ""}. Ниже — разбор: посмотрите, где были ошибки, чтобы запомнить.` : "Проверка пройдена.")
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
      {confirm && (
        <Modal title="Сдать контрольную?" onClose={() => setConfirm(false)}
          actions={<><button className="btn soft" onClick={() => setConfirm(false)}>Вернуться к вопросам</button>
            <button className="btn" onClick={() => { setConfirm(false); void submit(); window.scrollTo(0, 0); }}>Сдать</button></>}>
          {missing.length
            ? <p>Вы ответили не на все вопросы: без ответа {missing.length === 1 ? "вопрос" : "вопросы"} <b className="tnum">№{missing.join(", №")}</b>. Они засчитаются как неверные.</p>
            : <p>Вы ответили на все {data.questions.length} вопросов.</p>}
          <p className="faint">После сдачи изменить ответы будет нельзя. Это попытка {tries + 1}.</p>
        </Modal>
      )}
    </div>
  );
}
