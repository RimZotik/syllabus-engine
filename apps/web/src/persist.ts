// Small per-browser memory for UI state that is not learning data: the last place in the course,
// scroll positions and unsent drafts. Learning data (answers, results) lives on the server.
import { useEffect, useRef, useState } from "react";
import { currentPackage } from "./current";

const PREFIX = "se:";
// Keys belong to the package of the open page (two packages may both have a topic draw1.line.2);
// `global` keys (the last place in the platform) are shared. Values saved before packages had their own
// addresses have no package in the key — they are still read, they belong to the only package of that time.
const full = (key: string, global: boolean) => (global ? PREFIX + key : `${PREFIX}${currentPackage()}:${key}`);

export function load<T>(key: string, fallback: T, global = false): T {
  try {
    const raw = localStorage.getItem(full(key, global)) ?? (global ? null : localStorage.getItem(PREFIX + key));
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function store(key: string, value: unknown, global = false): void {
  try {
    if (value === undefined || value === null || value === "") { localStorage.removeItem(full(key, global)); if (!global) localStorage.removeItem(PREFIX + key); }
    else localStorage.setItem(full(key, global), JSON.stringify(value));
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
