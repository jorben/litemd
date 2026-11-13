// @vitest-environment jsdom
// 技术方案 6.4 节：载入时的规范化。真实 Tiptap 编辑器（LiteMd 全部扩展、插件的 appendTransaction）
// 载入每份语料后不做编辑，序列化必须逐字节等于原文；并统计载入后与解析结果不同的顶层块（目标 0）。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WysiwygEditor } from "../../src/editor/wysiwyg";
import { loadCorpus } from "./corpus";

describe("真实编辑器载入语料", () => {
  it("载入后不编辑：逐字节等于原文", () => {
    const corpus = loadCorpus();
    const bad: Array<{ name: string; changedBlocks: number[]; mode: string }> = [];
    const normalized: Array<{ name: string; blocks: number[] }> = [];
    for (const { name, text } of corpus) {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const ed = new WysiwygEditor({ element: el, text, editable: true });
      const res = ed.peek();
      if (ed.normalizedOnLoad.length) normalized.push({ name, blocks: ed.normalizedOnLoad });
      if (res.text !== text) {
        const base = (ed as unknown as { baseline: { doc: import("@tiptap/pm/model").Node } }).baseline.doc;
        const changed: number[] = [];
        for (let i = 0; i < Math.min(base.childCount, ed.doc.childCount); i++) if (!base.child(i).eq(ed.doc.child(i))) changed.push(i);
        if (base.childCount !== ed.doc.childCount) changed.push(-1);
        bad.push({ name, changedBlocks: changed.slice(0, 10), mode: res.mode });
      }
      ed.destroy();
      el.remove();
    }
    const dir = resolve(import.meta.dirname, "../../test-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "editor-load.json"), JSON.stringify({ total: corpus.length, bad, normalized }, null, 1));
    console.log("[editor load]", corpus.length, "files,", bad.length, "not identical;", normalized.length, "normalized by plugins on load");
    expect(normalized.filter((n) => n.blocks.includes(-1))).toEqual([]);
    expect(bad).toEqual([]);
  });

  it("真实编辑器里输入、撤销（编辑器自己的历史）：输入只改该块，撤销逐字节回到原文", () => {
    const corpus = loadCorpus();
    let local = 0, undone = 0, total = 0;
    const fails: string[] = [];
    corpus.forEach(({ name, text }, idx) => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const ed = new WysiwygEditor({ element: el, text, editable: true });
      // 找第 (idx % n) 个有文字的顶层段落
      const paras: Array<{ top: number; end: number }> = [];
      let pos = 0;
      ed.doc.forEach((node, offset, i) => {
        if (node.type.name === "paragraph" && node.textContent.length > 0) paras.push({ top: i, end: offset + node.nodeSize - 1 });
        pos = offset;
      });
      void pos;
      if (paras.length) {
        total++;
        const p = paras[idx % paras.length]!;
        const units = (ed as unknown as { baseline: { units: Array<{ first: number; count: number; from: number; end: number }> } }).baseline.units;
        const u = units.find((x) => p.top >= x.first && p.top < x.first + x.count)!;
        ed.editor.chain().focus().insertContentAt(p.end, "改").run();
        const out = ed.peek().text;
        // diff 只落在被改的块（单元）内：单元之前、之后的原文逐字节保留
        if (out.startsWith(text.slice(0, u.from)) && out.endsWith(text.slice(u.end)) && out.includes("改")) local++;
        else fails.push(name + " (edit)");
        ed.editor.commands.undo();
        if (ed.peek().text === text) undone++;
        else fails.push(name + " (undo)");
      }
      ed.destroy();
      el.remove();
    });
    console.log("[editor edit]", { total, local, undone, fails: fails.slice(0, 10) });
    expect(undone).toBe(total);
    expect(local / total).toBeGreaterThanOrEqual(0.98);
  });
});
