import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import yaml from "@rollup/plugin-yaml";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { fileURLToPath } from "node:url";
import { createReadStream, cpSync, existsSync, readFileSync, statSync } from "node:fs";
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

// The active learning package: content/<id>/ (syllabus.yaml or $SYLLABUS_PACKAGE). Only it gets bundled.
function activePackage(): string {
  const fromEnv = process.env.SYLLABUS_PACKAGE;
  const cfg = join(repoRoot, "syllabus.yaml");
  const id = fromEnv ?? (existsSync(cfg) ? /^active:\s*([\w.-]+)/m.exec(readFileSync(cfg, "utf-8"))?.[1] : undefined);
  if (!id) throw new Error("Не выбрано обучение: укажите active: <папка> в syllabus.yaml");
  if (!existsSync(join(repoRoot, "content", id, "package.yaml"))) throw new Error(`Пакет обучения content/${id}/ не найден (нет package.yaml)`);
  return id;
}
const pkgDir = join(repoRoot, "content", activePackage());

export default defineConfig({
  plugins: [
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }) },
    yaml(),
    pyodideAssets(),
    react({ include: /\.(mdx|tsx?)$/ }),
  ],
  resolve: { alias: { "@pkg": pkgDir } },
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
