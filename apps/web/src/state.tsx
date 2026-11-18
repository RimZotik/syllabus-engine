import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Package, type ClaudeStatus, type Course, type Discipline, type Program, type Progress, type Section, type Topic } from "./api";

export type TopicPlace = { course: Course; discipline: Discipline; section: Section; topic: Topic; index: number };

type Ctx = {
  program: Program | null;
  pkg: Package | null;
  progress: Progress;
  claude: ClaudeStatus | null;
  refreshClaude: () => void;
  setClaude: (s: ClaudeStatus) => void;
  error: string | null;
  refreshProgress: () => Promise<void>;
  place: (topicId: string) => TopicPlace | null;
  allTopics: Topic[];
  openTerm: (id: string) => void;
  termId: string | null;
  closeTerm: () => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [pkg, setPkg] = useState<Package | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null>(null);

  const refreshProgress = useCallback(async () => setProgress(await api.progress()), []);

  useEffect(() => {
    api.package().then((p) => {
      setPkg(p);
      document.title = `${p.title} · Syllabus Engine`;
      // the browser's spellchecker follows the page language: Russian for a Russian course, English for an English one
      document.documentElement.lang = p.language || "ru";
    })
      .catch((e) => setError(`Не удалось открыть обучение: ${e instanceof Error ? e.message : e}. Проверьте courses/active.yaml.`));
    api.program().then(setProgram).catch(() => setError("Сервер платформы не отвечает. Запустите его командой npm run dev."));
    refreshProgress().catch(() => {});
  }, [refreshProgress]);

  // Claude may be installed or logged in while the platform is open: re-check every 30 s while it is
  // missing and whenever the window regains focus — no restart needed.
  const refreshClaude = useCallback(() => { api.claude().then(setClaude).catch(() => {}); }, []);
  useEffect(() => {
    refreshClaude();
    window.addEventListener("focus", refreshClaude);
    return () => window.removeEventListener("focus", refreshClaude);
  }, [refreshClaude]);
  useEffect(() => {
    // While Claude is installed, a slower poll picks up limits updated by teacher checks.
    const t = window.setInterval(refreshClaude, claude?.installed ? 60_000 : 30_000);
    return () => window.clearInterval(t);
  }, [claude?.installed, refreshClaude]);

  const index = useMemo(() => {
    const m = new Map<string, TopicPlace>();
    const all: Topic[] = [];
    program?.courses.forEach((course) => course.disciplines.forEach((discipline) => discipline.sections.forEach((section) =>
      section.topics.forEach((topic, i) => { m.set(topic.id, { course, discipline, section, topic, index: i }); all.push(topic); }))));
    return { m, all };
  }, [program]);

  const value: Ctx = {
    program, pkg, progress, claude, refreshClaude, setClaude, error, refreshProgress,
    place: (id) => index.m.get(id) ?? null,
    allTopics: index.all,
    openTerm: setTermId, termId, closeTerm: () => setTermId(null),
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
