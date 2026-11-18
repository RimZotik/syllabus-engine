// One command for development: API server (uvicorn, :8765) + web app (Vite, :5173).
// Refuses to start a second copy if the ports are already taken.
// A second copy (e.g. a dev worktree) can run on other ports: SYLLABUS_API_PORT, SYLLABUS_WEB_PORT, and SYLLABUS_DATA_DIR for its own database (FORGE_* names still work).
import { spawn } from "node:child_process";
import net from "node:net";

const env0 = (k) => process.env[`SYLLABUS_${k}`] ?? process.env[`FORGE_${k}`];
const API = Number(env0("API_PORT") ?? 8765), WEB = Number(env0("WEB_PORT") ?? 5173);

const busy = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
  });

for (const port of [API, WEB]) {
  if (await busy(port)) {
    console.error(`Порт ${port} уже занят — похоже, платформа уже запущена. Откройте http://127.0.0.1:${WEB}`);
    process.exit(1);
  }
}

const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
const commands = {
  "API": ["uv", ["run", "--project", "apps/server", "uvicorn", "syllabus_server.app:app", "--port", String(API), "--reload", "--reload-dir", "apps/server/syllabus_server"]],
  "сайт": ["npm", ["run", "dev", "-w", "apps/web"]],
};
const procs = new Map();
let stopping = false;
const restarts = [];

// Windows: a shell child's kill() leaves its children (uvicorn, vite) running and holding the port — kill the whole tree.
const killTree = (p) => {
  if (!p || p.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  else p.kill();
};

function start(name) {
  const [cmd, args] = commands[name];
  const p = spawn(cmd, args, { stdio: "inherit", shell: true, env });
  procs.set(name, p);
  p.on("exit", (code) => {
    if (stopping) return;
    // A part that fell over (e.g. Vite while restarting after a config change) is started again,
    // but not in an endless loop: more than 5 restarts a minute means something is really broken.
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
    if (restarts.length > 5) { console.error(`«${name}» падает снова и снова (код ${code}) — останавливаю платформу.`); stop(1); return; }
    console.error(`«${name}» остановился (код ${code}) — запускаю снова.`);
    setTimeout(() => start(name), 1000);
  });
}

function stop(code = 0) {
  stopping = true;
  for (const p of procs.values()) killTree(p);
  setTimeout(() => process.exit(code), 500);
}

for (const name of Object.keys(commands)) start(name);
console.log(`Syllabus Engine: http://127.0.0.1:${WEB}  (Ctrl+C — остановить)`);
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
