import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 迁入的 vmark 代码用 "@/..." 引用 vmark 的 src/，这里指向 src/vmark/（技术方案 4.1 节）
  resolve: { alias: { "@": resolve(import.meta.dirname, "src/vmark") } },
  define: { __VMARK_VERSION__: JSON.stringify("0.0.0-test") },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
