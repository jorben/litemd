import { defineConfig } from "vitest/config";
import { aliases } from "./aliases.ts";

export default defineConfig({
  resolve: { alias: aliases },
  define: { __VMARK_VERSION__: JSON.stringify("0.0.0-test") },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
