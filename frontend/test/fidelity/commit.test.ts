// @vitest-environment jsdom
// 技术方案 6.3 节第 6 步：推送后不重新解析，改写的单元并成一个、其后的单元平移。
// 在真实编辑器里连续编辑两处、每处之后推送一次：每次输出只在被改的块内与上一次不同，
// 平移得到的基线可用（不退回重新解析），且不比「推送后重新解析建基线」（旧做法）差：两者不同时，只能是旧做法改了被改单元之外的字节。
import { describe, expect, it } from "vitest";
import { WysiwygEditor } from "../../src/editor/wysiwyg";
import { __testShiftUnits, loadBaseline, serializeWithBaseline, type Baseline } from "../../src/fidelity/writeback";
import { loadCorpus } from "./corpus";

type Internals = { baseline: Baseline; schema: import("@tiptap/pm/model").Schema; lastMode?: string };

describe("连续推送（基线平移）", () => {
  it("两次编辑各推送一次：diff 局部、平移成功、不比重新解析差", () => {
    const corpus = loadCorpus();
    let total = 0, local = 0, shifted = 0, same = 0, refWorse = 0;
    const fails: string[] = [];
    corpus.forEach(({ name, text }, idx) => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const ed = new WysiwygEditor({ element: el, text, editable: true });
      const it = ed as unknown as Internals;
      const paras: Array<{ top: number }> = [];
      ed.doc.forEach((node, _o, i) => {
        if (node.type.name === "paragraph" && node.textContent.length > 0) paras.push({ top: i });
      });
      if (paras.length < 2) return ed.destroy();
      total++;
      let prev = text;
      let ok = true;
      let step = 0;
      for (const k of [idx % paras.length, (idx * 7 + 3) % paras.length]) {
        step++;
        const top = paras[k]!.top;
        let end = 0;
        ed.doc.forEach((node, offset, i) => {
          if (i === top) end = offset + node.nodeSize - 1;
        });
        const u = it.baseline.units.find((x) => top >= x.first && top < x.first + x.count)!;
        ed.editor.chain().focus().insertContentAt(end, "改").run();
        const doc = ed.doc;
        const res = serializeWithBaseline(it.schema, it.baseline, doc);
        if (res.mode === "local" || res.mode === "expanded") {
          if (__testShiftUnits(it.schema, it.baseline, doc, res)) shifted++;
          else fails.push(`${name}: 平移失败`);
        }
        // 旧做法的对照：按上一次输出重新解析建基线，节点换成当前文档的同一对象
        const ref = loadBaseline(it.schema, prev);
        const refText = ref.doc.childCount === it.baseline.doc.childCount
          ? serializeWithBaseline(it.schema, { ...ref, doc: it.baseline.doc }, doc).text : null;
        const out = ed.serialize();
        // 两者不同时，必须是旧做法在被改单元之外改了字节（如重排未改动的表格、给 $ 加转义），平移保留原文
        const isLocal = (x: string) => x.startsWith(prev.slice(0, u.from)) && x.endsWith(prev.slice(u.end));
        if (refText !== null && refText !== out && isLocal(refText)) {
          same--;
          fails.push(`${name}: 平移的输出比重新解析的差`);
        }
        if (refText !== null && refText !== out) refWorse++;
        if (!(out.startsWith(prev.slice(0, u.from)) && out.endsWith(prev.slice(u.end)))) {
          ok = false;
          fails.push(`${name}: 不局部（第 ${step} 次，mode=${it.lastMode ?? ""}, ref=${refText === null ? "无" : isLocal(refText)}）`);
        }
        prev = out;
      }
      if (ok) local++;
      same++;
      ed.destroy();
      el.remove();
    });
    console.log("[commit]", { total, local, shifted, same, refWorse, fails: fails.slice(0, 8) });
    expect(local / total).toBeGreaterThanOrEqual(0.98);
    expect(shifted / (total * 2)).toBeGreaterThanOrEqual(0.95);
    expect(same).toBe(total);
  });
});
