// One command for development: API server (uvicorn, :8765) + web app (Vite, :5173).
// Refuses to start a second copy if the ports are already taken.
// A second copy (e.g. a dev worktree) can run on other ports: FORGE_API_PORT, FORGE_WEB_PORT, and FORGE_DATA_DIR for its own database.
import { spawn } from "node:child_process";
import net from "node:net";

const API = Number(process.env.FORGE_API_PORT ?? 8765), WEB = Number(process.env.FORGE_WEB_PORT ?? 5173);

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
const procs = [
  spawn("uv", ["run", "--project", "apps/server", "uvicorn", "forge_server.app:app", "--port", String(API), "--reload", "--reload-dir", "apps/server/forge_server"], { stdio: "inherit", shell: true, env }),
  spawn("npm", ["run", "dev", "-w", "apps/web"], { stdio: "inherit", shell: true, env }),
];
console.log(`Syllabus Engine: http://127.0.0.1:${WEB}  (Ctrl+C — остановить)`);

const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { if (code) { console.error(`Процесс завершился с кодом ${code}`); stop(); } });
