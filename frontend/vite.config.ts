import { defineConfig } from "vite";
import { aliases } from "./aliases.ts";

export default defineConfig({
  resolve: { alias: aliases },
  define: { __VMARK_VERSION__: JSON.stringify("litemd") },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
