import { defineConfig } from "vite";
import { aliases } from "./aliases.ts";
import { cspFor } from "./csp.ts";

export default defineConfig({
  plugins: [
    {
      name: "litemd-csp",
      apply: "build",
      transformIndexHtml: () => [
        { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: cspFor() }, injectTo: "head-prepend" },
      ],
    },
  ],
  resolve: { alias: aliases },
  define: { __VMARK_VERSION__: JSON.stringify("litemd") },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
    // 键位表引用 internal/menu/testdata/accelerators.json（Go 菜单表导出）
    fs: { allow: [".."] },
  },
});
