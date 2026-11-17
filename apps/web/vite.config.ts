import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import yaml from "@rollup/plugin-yaml";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { fileURLToPath } from "node:url";
import { createReadStream, cpSync, existsSync, statSync } from "node:fs";
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

export default defineConfig({
  plugins: [
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }) },
    yaml(),
    pyodideAssets(),
    react({ include: /\.(mdx|tsx?)$/ }),
  ],
  optimizeDeps: { exclude: ["pyodide"] },
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.FORGE_WEB_PORT ?? 5173),
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: { "/api": `http://127.0.0.1:${process.env.FORGE_API_PORT ?? 8765}` },
  },
});
