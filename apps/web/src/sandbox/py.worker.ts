/// <reference lib="webworker" />
// Python runner: Pyodide inside a Web Worker. The main thread kills the worker on timeout (endless loops).
import { loadPyodide, type PyodideInterface } from "pyodide";

import DRIVER from "./driver.py?raw";

let ready: Promise<PyodideInterface> | null = null;
function boot(): Promise<PyodideInterface> {
  ready ??= loadPyodide({ indexURL: "/pyodide/" }).then(async (py) => {
    await py.runPythonAsync(DRIVER);
    return py;
  });
  return ready;
}
void boot();

export type WorkerRequest = { id: number; kind: "run" | "trace"; code: string; stdin: string } | { id: number; kind: "check"; code: string; tests: unknown };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    const py = await boot();
    const fn = py.globals.get(msg.kind);
    const raw: string = msg.kind === "check" ? fn(msg.code, JSON.stringify(msg.tests)) : fn(msg.code, msg.stdin);
    fn.destroy?.();
    self.postMessage({ id: msg.id, ok: true, data: JSON.parse(raw) });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
