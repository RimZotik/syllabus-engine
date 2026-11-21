// Main-thread side of the Python runner: one worker kept warm, killed and replaced on timeout.
import type { WorkerRequest } from "./py.worker";

export type PyError = { type: string; line: number | null; msg: string };
export type RunResult = { stdout: string; error: PyError | null };
export type TestResult = { name: string; ok: boolean; error?: PyError; message?: string; stdin?: string; expected?: string; got?: string; hidden?: boolean };
export type CheckResult = { results: TestResult[]; stdout?: string | null };
export class Timeout extends Error {}

const spawn = () => new Worker(new URL("./py.worker.ts", import.meta.url), { type: "module" });
let worker: Worker | null = null;
let seq = 0;

/** Start loading Python in the background (the first load takes a few seconds). */
export function warmUp() { worker ??= spawn(); }

type Req = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;
function call<T>(req: Req, timeoutMs: number): Promise<T> {
  warmUp();
  const w = worker!;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      w.terminate();
      if (worker === w) worker = spawn(); // fresh warm worker for the next run
      reject(new Timeout());
    }, timeoutMs);
    const onMsg = (e: MessageEvent<{ id: number; ok: boolean; data?: T; error?: string }>) => {
      if (e.data.id !== id) return;
      window.clearTimeout(timer);
      w.removeEventListener("message", onMsg);
      if (e.data.ok) resolve(e.data.data as T); else reject(new Error(e.data.error));
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ ...req, id } as WorkerRequest);
  });
}

// The first call also waits for Python to load, so it gets a longer budget.
let booted = false;
const budget = (ms: number) => (booted ? ms : ms + 30_000);

/** `files` — the task's files (name → text), put into a fresh working folder for this run. */
export async function runPython(code: string, stdin: string, timeoutMs = 5000, files?: Record<string, string>): Promise<RunResult> {
  const r = await call<RunResult>({ kind: "run", code, stdin, files }, budget(timeoutMs));
  booted = true;
  return r;
}

/** Value in a trace: a plain value («p») or a reference to a numbered object («r»). */
export type TraceVal = { p: string } | { r: number };
export type TraceObj = { t: string; items: (TraceVal | [TraceVal, TraceVal])[]; more: boolean };
export type TraceStep = { line: number; event: "line" | "return"; frames: { name: string; vars: [string, TraceVal][] }[]; heap: Record<string, TraceObj | null>; out: string; ret?: TraceVal };
export type TraceResult = { steps: TraceStep[]; stdout: string; error: PyError | null; truncated: boolean };

export async function tracePython(code: string, stdin = "", timeoutMs = 8000, files?: Record<string, string>): Promise<TraceResult> {
  const r = await call<TraceResult>({ kind: "trace", code, stdin, files }, budget(timeoutMs));
  booted = true;
  return r;
}

export async function checkPython(code: string, tests: unknown, timeoutMs = 8000): Promise<CheckResult> {
  const r = await call<CheckResult>({ kind: "check", code, tests }, budget(timeoutMs));
  booted = true;
  return r;
}

/** Common Python errors explained in plain Russian. */
const ERRORS: Record<string, string> = {
  SyntaxError: "Синтаксическая ошибка: Python не смог прочитать строку. Проверьте скобки, кавычки, двоеточие и отступы.",
  IndentationError: "Ошибка отступа: строки одного блока должны начинаться с одинакового числа пробелов.",
  NameError: "Имя не найдено: переменная или функция используется до того, как ей дали значение, или в имени опечатка.",
  TypeError: "Ошибка типа: операция не подходит для этих значений — например, сложение строки и числа.",
  ValueError: "Неподходящее значение: тип верный, но значение не годится — например, int('abc').",
  ZeroDivisionError: "Деление на ноль.",
  IndexError: "Индекс за пределами списка или строки.",
  KeyError: "Такого ключа нет в словаре.",
  AttributeError: "У этого значения нет такого метода или свойства.",
  EOFError: "Программа ждала ещё одну строку ввода, а данные закончились.",
  RecursionError: "Слишком глубокая рекурсия: функция вызывает себя без остановки.",
};
export const explainError = (e: PyError) => ERRORS[e.type] ?? "Во время работы программы произошла ошибка.";
