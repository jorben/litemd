// LiteMd 自己的前端代码的 lint（迁入的 src/vmark/ 保持 vmark 原样，不在这里检查；见 THIRD_PARTY.md）。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/vmark/**", "src/mygo.ts", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error", "log"] }],
    },
  },
  {
    files: ["**/*.test.ts", "test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
