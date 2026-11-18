import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { askTeacher, pageScope, recordAttempt, usePageState } from "../sdk";
import { store } from "../persist";

// No browser here: a minimal localStorage and location are enough for the hook.
const mem = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
  location: { pathname: "/learn/intro1.what.4" },
});

function Demo() {
  const [k] = usePageState("knn-k", 3);
  return <span>{k}</span>;
}

describe("usePageState keeps a demo's state for the topic", () => {
  beforeEach(() => mem.clear());
  it("starts from the initial value", () => {
    expect(renderToStaticMarkup(<Demo />)).toBe("<span>3</span>");
  });
  it("restores what was saved for this topic", () => {
    store("page:/learn/intro1.what.4:knn-k", 7);
    expect(renderToStaticMarkup(<Demo />)).toBe("<span>7</span>");
  });
  it("does not pick up another topic's value", () => {
    store("page:/learn/intro1.what.3:knn-k", 9);
    expect(renderToStaticMarkup(<Demo />)).toBe("<span>3</span>");
  });
});


describe("a package's own exercise reports to the platform", () => {
  it("knows the topic or section test of the page", () => {
    expect(pageScope("/ml-bigdata-ai/learn/law1.subjects.2")).toBe("law1.subjects.2");
    expect(pageScope("/ml-bigdata-ai/test/law1.subjects")).toBe("law1.subjects");
    expect(pageScope("/ml-bigdata-ai")).toBe("site");
  });
  it("saves an attempt and asks the teacher through the same API as tests and written answers", async () => {
    const calls: { url: string; body: unknown }[] = [];
    Object.assign(globalThis, {
      location: { pathname: "/law/learn/law1.subjects.2" },
      fetch: async (url: string, init: { body?: string }) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
        return { ok: true, json: async () => ({ verdict: "pass", feedback: "ok", attempt: 1 }) };
      },
    });
    await recordAttempt("roles", { answer: { "Иванов": "субъект" }, correct: true });
    const g = await askTeacher("roles", { question: "Кто здесь субъект?", rubric: ["названы субъект и объект"], answer: "Иванов — субъект" });
    expect(calls[0]).toEqual({ url: "/api/attempts", body: [{ scope: "law1.subjects.2", item_id: "roles", kind: "exercise", answer: { "Иванов": "субъект" }, correct: true, seconds: null }] });
    expect(calls[1].url).toBe("/api/grade");
    expect(calls[1].body).toMatchObject({ scope: "law1.subjects.2", item_id: "roles", rubric: ["названы субъект и объект"], answer: "Иванов — субъект", wrong_answers: [] });
    expect(g.verdict).toBe("pass");
  });
});
