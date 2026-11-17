/** Thin client for the platform server (apps/server). */

export type Topic = { id: string; title: string };
export type Section = { id: string; title: string; topics: Topic[] };
export type Level = { level: number; title: string; course: string };
export type Discipline = {
  id: string; subject: string; subjectTitle: string; level: number; name: string; title: string;
  hours: number; summary: string; unlocks: string[]; levels: Level[]; sections: Section[];
};
export type Course = { id: string; title: string; tagline: string; project: string | null; hours: number; disciplines: Discipline[] };
export type Stage = { id: string; title: string; gate: string };
export type Program = { title: string; levels: Stage[]; courses: Course[] };
/** Passport of the active learning package (content/<id>/package.yaml). */
export type Package = {
  id: string; title: string; language: string; summary: string;
  landing: { headline: string; lead: string; cta: string; subjects_lead: string; highlight_subject: string | null };
};
export type Progress = Record<string, { status: "started" | "done"; page: number; seconds: number }>;
export type LimitWindow = { used: number; resets_at: number | null; status: string | null };
export type ClaudeLimits = { five_hour: LimitWindow | null; seven_day: LimitWindow | null; updated_at: number };
export type ClaudeStatus = { installed: boolean; version: string | null; limits: ClaudeLimits | null };
export type Attempt = { scope: string; item_id: string; kind: "single" | "multi" | "open" | "code"; answer: unknown; correct?: boolean | null; confidence?: number | null; seconds?: number | null };
export type Note = { id: number; topic_id: string | null; term_id: string | null; text: string; created_at: string };
export type Grade = { verdict: "pass" | "revise"; feedback: string; misconception?: string | null; attempt: number };
export type GradeRequest = { scope: string; item_id: string; question: string; rubric: string[]; wrong_answers: string[]; answer: string; confidence: number | null };
export type TimeStats = { total: number; today: number; week: number; days: { day: string; seconds: number }[]; by_scope: Record<string, number> };
export type Results = Record<string, { passed: boolean; score: number | null; done: boolean; updated_at: string }>;
export type FeedbackKind = "content_issue" | "bug" | "idea" | "question";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => (typeof j?.detail === "string" ? j.detail : null)).catch(() => null);
    throw new Error(detail ?? `${method} ${url}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  program: () => call<Program>("GET", "/api/program"),
  package: () => call<Package>("GET", "/api/package"),
  progress: () => call<Progress>("GET", "/api/progress"),
  setProgress: (topicId: string, status: "started" | "done", page: number, seconds: number) =>
    call("PUT", `/api/progress/${encodeURIComponent(topicId)}`, { status, page, seconds }),
  claude: () => call<ClaudeStatus>("GET", "/api/claude/status"),
  refreshLimits: () => call<ClaudeStatus>("POST", "/api/claude/limits/refresh"),
  saveAttempts: (items: Attempt[]) => call("POST", "/api/attempts", items),
  addTime: (scope: string, seconds: number) => call("POST", "/api/time", { scope, seconds }),
  time: () => call<TimeStats>("GET", "/api/time"),
  results: () => call<Results>("GET", "/api/results"),
  grade: (g: GradeRequest) => call<Grade>("POST", "/api/grade", g),
  quizState: <T,>(scope: string) => call<{ state: T | null; passed: boolean }>("GET", `/api/quiz-state/${encodeURIComponent(scope)}`),
  saveQuizState: (scope: string, state: unknown, passed: boolean) => call("PUT", `/api/quiz-state/${encodeURIComponent(scope)}`, { state, passed }),
  notes: (q: { topic_id?: string; term_id?: string }) =>
    call<Note[]>("GET", "/api/notes?" + new URLSearchParams(q as Record<string, string>)),
  addNote: (n: { topic_id?: string; term_id?: string; text: string }) => call("POST", "/api/notes", n),
  feedback: (kind: FeedbackKind, text: string, topic_id?: string, quote?: string, page?: number) =>
    call("POST", "/api/feedback", { kind, source: "learner", text, topic_id, quote: quote || null, page: page ?? null }),
};

/** Every client-side error goes to the server journal (events table + server.log). */
export function installErrorReporting() {
  const send = (message: string, context: Record<string, unknown>) =>
    fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: "error", message, context }) }).catch(() => {});
  window.addEventListener("error", (e) => send(e.message, { source: e.filename, line: e.lineno, path: location.pathname }));
  window.addEventListener("unhandledrejection", (e) => send(String(e.reason), { path: location.pathname }));
}
