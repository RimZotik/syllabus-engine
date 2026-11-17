import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import yaml from "@rollup/plugin-yaml";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] }) },
    yaml(),
    react({ include: /\.(mdx|tsx?)$/ }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: { "/api": "http://127.0.0.1:8765" },
  },
});
