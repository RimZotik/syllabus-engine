import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { usePageState } from "../sdk";
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
