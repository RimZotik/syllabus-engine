// Small per-browser memory for UI state that is not learning data: the last place in the course,
// scroll positions and unsent drafts. Learning data (answers, results) lives on the server.
import { useEffect, useRef, useState } from "react";

const PREFIX = "se:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function store(key: string, value: unknown): void {
  try {
    if (value === undefined || value === null || value === "") localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private window) — drafts just are not kept */
  }
}

/** useState that survives reloads and restarts. `clear()` drops the draft (after sending/saving). */
export function useDraft<T>(key: string, initial: T): [T, (v: T) => void, () => void] {
  const [value, setValue] = useState<T>(() => load(key, initial));
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) { keyRef.current = key; setValue(load(key, initial)); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: T) => { setValue(v); store(key, v); };
  const clear = () => { setValue(initial); store(key, null); };
  return [value, set, clear];
}
