// 由 Node.js 直接执行（去除类型），只能用可去除类型的 TS 语法（技术方案 1.2 节）。
import type { defineConfig } from "./frontend/node_modules/mygo-cli/index.js";

type Config = Parameters<typeof defineConfig>[0];

const config: Config = {
  name: "LiteMd",
  slug: "litemd",
  identifier: "io.github.jorben.litemd",
  version: "0.1.0",
  copyright: "© 2026 Jorben",
  license: "Apache-2.0",
  devUrl: "http://localhost:5173",
  devCommand: "pnpm -C frontend dev:web",
  buildCommand: "pnpm -C frontend build:web",
  frontendDist: "frontend/dist",
  bindings: "frontend/src/mygo.ts",
  out: "build",
  fileAssociations: [
    { ext: ["md", "markdown", "mdown", "mkd"], name: "Markdown Document", mimeType: "text/markdown" },
  ],
  macos: { minimumSystemVersion: "13.0" },
};

export default config;
