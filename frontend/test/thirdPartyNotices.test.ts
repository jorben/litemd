import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 随应用打包的第三方许可声明（scripts/third-party-notices.mjs 生成）要跟上依赖：
// 升级或新增生产依赖后没有运行 make notices 时这里失败
describe("THIRD_PARTY_NOTICES.txt", () => {
  const frontend = join(__dirname, "..");
  const notices = readFileSync(join(frontend, "public/THIRD_PARTY_NOTICES.txt"), "utf8");
  const lines = new Set(notices.split("\n"));
  const pkg = JSON.parse(readFileSync(join(frontend, "package.json"), "utf8")) as { dependencies: Record<string, string> };

  it("列出每个生产依赖的已安装版本", () => {
    const missing: string[] = [];
    for (const name of Object.keys(pkg.dependencies)) {
      const { version } = JSON.parse(readFileSync(join(frontend, "node_modules", name, "package.json"), "utf8")) as { version: string };
      if (!lines.has(`${name} ${version}`)) missing.push(`${name} ${version}`);
    }
    expect(missing).toEqual([]);
  });

  it("包含 vmark 的 ISC 许可与 go.mod 直接依赖", () => {
    expect(notices).toContain("Copyright (c) 2026 Xiaolai Li");
    const gomod = readFileSync(join(frontend, "../go.mod"), "utf8");
    const direct = [...gomod.matchAll(/^\t(\S+) (v\S+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(direct.length).toBeGreaterThan(0);
    for (const mod of direct) expect(lines.has(mod), mod).toBe(true);
  });
});
