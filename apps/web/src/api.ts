/** Thin client for the platform server (apps/server). */

export type Topic = { id: string; title: string };
export type Section = { id: string; title: string; topics: Topic[] };
export type Level = { level: number; title: string; course: string };
export type Discipline = {
  id: string; subject: string; subjectTitle: string; level: number; name: string; title: string;
  hours: number; summary: string; unlocks: string[]; levels: Level[]; sections: Section[];
};
export type Course = { id: string; title: string; tagline: string; project: string | null; hours: number; disciplines: Discipline[] };
export type Program = { title: string; courses: Course[] };
export type Progress = Record<string, { status: "started" | "done"; page: number; seconds: number }>;
export type ClaudeStatus = { installed: boolean; version: string | null; limits: null | { session: number; week: number } };
export type Attempt = { scope: string; item_id: string; kind: "single" | "multi" | "open"; answer: unknown; correct?: boolean | null; confidence?: number | null; seconds?: number | null };
export type Note = { id: number; topic_id: string | null; term_id: string | null; text: string; created_at: string };
export type FeedbackKind = "content_issue" | "bug" | "idea" | "question";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  program: () => call<Program>("GET", "/api/program"),
  progress: () => call<Progress>("GET", "/api/progress"),
  setProgress: (topicId: string, status: "started" | "done", page: number, seconds: number) =>
    call("PUT", `/api/progress/${encodeURIComponent(topicId)}`, { status, page, seconds }),
  claude: () => call<ClaudeStatus>("GET", "/api/claude/status"),
  saveAttempts: (items: Attempt[]) => call("POST", "/api/attempts", items),
  notes: (q: { topic_id?: string; term_id?: string }) =>
    call<Note[]>("GET", "/api/notes?" + new URLSearchParams(q as Record<string, string>)),
  addNote: (n: { topic_id?: string; term_id?: string; text: string }) => call("POST", "/api/notes", n),
  feedback: (kind: FeedbackKind, text: string, topic_id?: string) => call("POST", "/api/feedback", { kind, source: "learner", text, topic_id }),
};

/** Every client-side error goes to the server journal (events table + server.log). */
export function installErrorReporting() {
  const send = (message: string, context: Record<string, unknown>) =>
    fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: "error", message, context }) }).catch(() => {});
  window.addEventListener("error", (e) => send(e.message, { source: e.filename, line: e.lineno, path: location.pathname }));
  window.addEventListener("unhandledrejection", (e) => send(String(e.reason), { path: location.pathname }));
}
