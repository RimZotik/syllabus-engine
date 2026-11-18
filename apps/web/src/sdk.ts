// What a course package's own components (courses/<id>/components/) may use from the platform.
// Import it as "@syllabus/sdk" — never by a relative path into apps/web.
import { useCallback, useRef, useState } from "react";
import { load, store } from "./persist";
import { currentPackage } from "./current";

type SetState<T> = (v: T | ((prev: T) => T)) => void;

/**
 * useState that remembers the value for this topic: leave the page, come back or reload — the demo is where
 * the learner left it. The key is the topic's address plus `name`, so two demos on one topic need two names.
 * Returns [value, set, reset]; `reset()` goes back to `initial` and forgets the saved value.
 */
export function usePageState<T>(name: string, initial: T): [T, SetState<T>, () => void] {
  // the address inside the package (/learn/<topic>): the same key as before packages had their own addresses
  const base = `/${currentPackage()}`, path = location.pathname;
  const inner = path === base || path.startsWith(base + "/") ? path.slice(base.length) : path;
  const key = useRef(`page:${inner}:${name}`).current;
  const [value, setValue] = useState<T>(() => load(key, initial));
  const set: SetState<T> = useCallback((v) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      store(key, next);
      return next;
    });
  }, [key]);
  const reset = useCallback(() => { setValue(initial); store(key, null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set, reset];
}
