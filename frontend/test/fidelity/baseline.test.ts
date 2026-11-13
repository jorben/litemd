// M0 V3：vmark 规范管线在保真语料上的往返基线（解析 → ProseMirror → 序列化）。
// 这组数据衡量「不经保真写回层」时管线自身会改写多少原文，是 D3 的风险来源；
// 它不是验收指标，验收指标在 writeback.test.ts。结果写到 test-results/fidelity-baseline.json。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { getProductionSchema } from "@/test/productionSchema";
import { loadCorpus } from "./corpus";

interface Row {
  name: string;
  identical: boolean;
  changedLines: number;
  categories: string[];
  sample?: [string, string] | undefined;
  error?: string;
}

/** 按差异行的形态粗分原因，作为改进方向（技术方案 6.5 节「输出原因分类」）。 */
function classify(a: string, b: string): string[] {
  const s = new Set<string>();
  const t = `${a}\n${b}`;
  if (a.trim() === b.trim()) s.add("whitespace");
  if (/^\s*\|/.test(a) || /^\s*\|/.test(b)) s.add("table");
  if (/^\s*([-*+]|\d+[.)])\s/.test(a) || /^\s*([-*+]|\d+[.)])\s/.test(b)) s.add("list");
  if (/\\[\\`*_{}[\]()#+\-.!|~<>]/.test(t)) s.add("escape");
  if (/^(=+|-+)\s*$/.test(a) || /^(=+|-+)\s*$/.test(b)) s.add("setext");
  if (/^\s*(\*\s*){3,}$|^\s*(_\s*){3,}$|^\s*(-\s*){3,}$/.test(a)) s.add("thematic-break");
  if (/[*_]{1,2}\S/.test(t)) s.add("emphasis");
  if (/^\s*(```|~~~)/.test(a) || /^\s*(```|~~~)/.test(b)) s.add("code-fence");
  if (/</.test(t)) s.add("html");
  if (/\[[^\]]*\]:/.test(t) || /\]\[/.test(t)) s.add("reference-link");
  if (!s.size) s.add("other");
  return [...s];
}

function lineDiff(a: string, b: string): { changed: number; first: [string, string] | undefined } {
  const A = a.split("\n");
  const B = b.split("\n");
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let qa = A.length - 1;
  let qb = B.length - 1;
  while (qa >= p && qb >= p && A[qa] === B[qb]) {
    qa--;
    qb--;
  }
  const changed = Math.max(qa - p + 1, 0) + Math.max(qb - p + 1, 0);
  return { changed, first: changed ? [A[p] ?? "", B[p] ?? ""] : undefined };
}

describe("V3 往返基线（vmark 规范管线，不经保真写回层）", () => {
  const corpus = loadCorpus();
  const schema = getProductionSchema();

  it(`语料不少于 200 份（当前 ${corpus.length}）`, () => {
    expect(corpus.length).toBeGreaterThanOrEqual(200);
  });

  it("逐份记录往返结果", () => {
    const rows: Row[] = corpus.map(({ name, text }) => {
      try {
        const out = serializeMarkdown(schema, parseMarkdown(schema, text));
        if (out === text) return { name, identical: true, changedLines: 0, categories: [] };
        const d = lineDiff(text, out);
        return {
          name,
          identical: false,
          changedLines: d.changed,
          categories: d.first ? classify(d.first[0], d.first[1]) : ["trailing-newline"],
          sample: d.first,
        };
      } catch (e) {
        return { name, identical: false, changedLines: -1, categories: ["error"], error: String(e).slice(0, 300) };
      }
    });
    const identical = rows.filter((r) => r.identical).length;
    const byCat: Record<string, number> = {};
    for (const r of rows) for (const c of r.categories) byCat[c] = (byCat[c] ?? 0) + 1;
    const summary = {
      total: rows.length,
      identical,
      identicalRate: +(identical / rows.length).toFixed(4),
      errors: rows.filter((r) => r.error).length,
      byCategory: byCat,
    };
    const dir = resolve(__dirname, "../../test-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "fidelity-baseline.json"), JSON.stringify({ summary, rows }, null, 1));
    console.log("[V3 baseline]", JSON.stringify(summary));
    // 基线只记录，不设门槛；解析不能抛错
    expect(summary.errors).toBe(0);
  });
});
