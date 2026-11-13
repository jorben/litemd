import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./en";

// 外壳里每条 t("…") 文案、以及设置页选项表里的中文标签都要有英文（F12）
describe("英文文案表", () => {
  const dir = join(__dirname);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "en.ts");
  it("覆盖全部界面文案", () => {
    const missing: string[] = [];
    for (const f of files) {
      const s = readFileSync(join(dir, f), "utf8");
      const keys = [...s.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
      if (f === "settings.ts") keys.push(...[...s.matchAll(/"([^"\n]*[\u4e00-\u9fff][^"\n]*)"/g)].map((m) => m[1]!));
      for (const k of keys) if (!(k in EN)) missing.push(`${f}: ${k}`);
    }
    expect(missing).toEqual([]);
  });
  it("占位符一致", () => {
    for (const [k, v] of Object.entries(EN)) {
      const ph = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
      expect(ph(v), k).toBe(ph(k));
    }
  });
});
