import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import yaml from "@rollup/plugin-yaml";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { fileURLToPath } from "node:url";
import { createReadStream, cpSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import type { Plugin } from "vite";

// Pyodide (Python in the browser) is served from the local npm package at /pyodide/ — no internet needed.
const pyodideDir = dirname(createRequire(import.meta.url).resolve("pyodide/package.json"));
const TYPES: Record<string, string> = { ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".zip": "application/zip" };
function pyodideAssets(): Plugin {
  return {
    name: "pyodide-assets",
    configureServer(server) {
      server.middlewares.use("/pyodide/", (req, res, next) => {
        const file = normalize(join(pyodideDir, decodeURIComponent((req.url ?? "").split("?")[0])));
        if (!file.startsWith(pyodideDir) || !existsSync(file) || !statSync(file).isFile()) return next();
        const ext = file.slice(file.lastIndexOf("."));
        res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      cpSync(pyodideDir, join(options.dir ?? "dist", "pyodide"), { recursive: true });
    },
  };
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const env = (k: string) => process.env[`SYLLABUS_${k}`] ?? process.env[`FORGE_${k}`];

// Every installed learning package (courses/<id>/ with a package.yaml) is bundled; the page's address
// picks one. The default one (courses/active.yaml or $SYLLABUS_PACKAGE) is still checked here, so a
// typo there fails at start-up with a clear message. Same rules as apps/server/syllabus_server/settings.py.
const coursesDir = join(repoRoot, "courses");
function activePackage(): string {
  const cfg = join(coursesDir, "active.yaml");
  const fromEnv = process.env.SYLLABUS_PACKAGE || undefined;
  const id = fromEnv ?? (existsSync(cfg) ? /^active:[ \t]*["']?([A-Za-z0-9_.-]+)/m.exec(readFileSync(cfg, "utf-8"))?.[1] : undefined);
  if (!id) throw new Error("Не выбрано обучение: укажите active: <папка> в courses/active.yaml");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new Error(`Недопустимое имя обучения ${JSON.stringify(id)}: только латиница, цифры, '-', '_', '.'`);
  if (!existsSync(join(coursesDir, id, "package.yaml"))) throw new Error(`Обучение courses/${id}/ не найдено (нет package.yaml)`);
  return id;
}
activePackage();

// The «Справочник» search index: every <Theorem> (definition, theorem, rule) of every topic, read from the
// topics' own MDX at build time — the lessons stay the only source, and the bundle carries only this list.
type TheoremEntry = { pkg: string; topicId: string; kind: string; title: string; text: string };
function theoremIndex(): TheoremEntry[] {
  const out: TheoremEntry[] = [];
  const dirs = (p: string) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);
  for (const pkg of dirs(coursesDir)) for (const disc of dirs(join(coursesDir, pkg, "lessons"))) for (const sec of dirs(join(coursesDir, pkg, "lessons", disc))) {
    for (const folder of dirs(join(coursesDir, pkg, "lessons", disc, sec))) {
      const file = join(coursesDir, pkg, "lessons", disc, sec, folder, "topic.mdx");
      const n = parseInt(folder, 10);
      if (!existsSync(file) || Number.isNaN(n)) continue;
      for (const m of readFileSync(file, "utf-8").matchAll(/<Theorem\b([^>]*)>([\s\S]*?)<\/Theorem>/g)) {
        const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(m[1])?.[1] ?? "";
        if (!attr("title")) continue;
        const body = m[2].replace(/<[^>]+>/g, " ").replace(/[*_$`]/g, "").replace(/\s+/g, " ").trim();
        out.push({ pkg, topicId: `${disc}.${sec}.${n}`, kind: attr("kind") || "definition", title: attr("title"), text: `${attr("formal")} ${body}`.trim() });
      }
    }
  }
  return out;
}
function theoremIndexPlugin(): Plugin {
  const ID = "virtual:theorems", RESOLVED = "\0virtual:theorems";
  return {
    name: "theorem-index",
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(theoremIndex())};` : undefined),
    handleHotUpdate({ file, server }) {
      if (file.endsWith("topic.mdx")) { const m = server.moduleGraph.getModuleById(RESOLVED); if (m) server.moduleGraph.invalidateModule(m); }
    },
  };
}

export default defineConfig({
  plugins: [
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }) },
    yaml(),
    theoremIndexPlugin(),
    pyodideAssets(),
    react({ include: /\.(mdx|tsx?)$/ }),
  ],
  resolve: { alias: { "@syllabus/sdk": fileURLToPath(new URL("./src/sdk.ts", import.meta.url)) } },
  optimizeDeps: { exclude: ["pyodide"] },
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    port: Number(env("WEB_PORT") ?? 5173),
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: { "/api": `http://127.0.0.1:${env("API_PORT") ?? 8765}` },
  },
});
