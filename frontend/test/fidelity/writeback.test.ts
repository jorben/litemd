// M0 V4 / 第 6.5 节回归：保真写回层在全部语料上的指标。
//   ① 载入后不编辑 → 输出与原文逐字节相同：100%
//   ② 编辑后撤销 → 逐字节回到原文：100%
//   ③ 随机编辑一处（每份文件分别做插入字符 / 加粗 / 删除几个字 / 新增段落）→ diff 只落在被改的顶层块内：≥ 98%
// 同时检查③的输出语义正确（重新解析后与编辑后的文档结构一致），并记录退回整篇的次数。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { getProductionSchema } from "@/test/productionSchema";
import { docFingerprint } from "@/utils/markdownPipeline/__tests__/fidelity/docFingerprint";
import { loadBaseline, serializeWithBaseline, type Baseline } from "../../src/fidelity/writeback";
import { loadCorpus } from "./corpus";

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spot {
  top: number; // 顶层节点下标
  from: number; // 文本节点内的起点
  to: number; // 文本节点的终点
  block: PMNode;
}

/** 可编辑的文字位置：带文字的文本块中的文本节点。 */
function spots(doc: PMNode): Spot[] {
  const out: Spot[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock || !node.inlineContent) return true;
    node.forEach((child, offset) => {
      if (child.isText && (child.text ?? "").length >= 2) {
        const from = pos + 1 + offset;
        out.push({ top: doc.resolve(pos).index(0), from, to: from + child.nodeSize, block: node });
      }
    });
    return false;
  });
  return out;
}

type Kind = "insert" | "bold" | "delete" | "paragraph";
const KINDS: Kind[] = ["insert", "bold", "delete", "paragraph"];

function applyEdit(schema: Schema, doc: PMNode, kind: Kind, r: () => number): { tr: Transform; top: number } | null {
  const list = spots(doc);
  if (!list.length) return null;
  const s = list[Math.floor(r() * list.length)]!;
  const tr = new Transform(doc);
  const at = s.from + 1 + Math.floor(r() * Math.max(1, s.to - s.from - 1));
  switch (kind) {
    case "insert":
      tr.insert(Math.min(at, s.to), schema.text("改"));
      break;
    case "bold": {
      const bold = schema.marks.bold!;
      if (!s.block.type.allowsMarkType(bold)) tr.insert(Math.min(at, s.to), schema.text("改"));
      else {
        const end = Math.min(s.to, at + 2);
        if (doc.rangeHasMark(at - 1, end, bold)) tr.removeMark(at - 1, end, bold);
        else tr.addMark(at - 1, end, bold.create());
      }
      break;
    }
    case "delete":
      tr.delete(at - 1, Math.min(s.to, at + 1));
      break;
    case "paragraph": {
      const endOfTop = doc.content.child(s.top);
      let pos = 0;
      for (let i = 0; i <= s.top; i++) pos += doc.child(i).nodeSize;
      void endOfTop;
      tr.insert(pos, schema.nodes.paragraph!.create(null, schema.text("新增的一段。")));
      break;
    }
  }
  return { tr, top: s.top };
}

function unitOfTop(base: Baseline, top: number) {
  return base.units.find((u) => top >= u.first && top < u.first + u.count)!;
}

describe("V4 保真写回", () => {
  const corpus = loadCorpus();
  const schema = getProductionSchema();

  it("三项指标", () => {
    const rows: Record<string, unknown>[] = [];
    let noEdit = 0;
    let undoOk = 0;
    let undoBad = 0;
    let local = 0;
    let localTotal = 0;
    let semantic = 0;
    let full = 0;
    let coarse = 0;
    const failures: Record<string, unknown>[] = [];
    corpus.forEach(({ name, text }, idx) => {
      const base = loadBaseline(schema, text);
      if (base.coarse) coarse++;
      // ① 不编辑；再用一次全新的解析结果（不是同一对象）检验结构比较
      const r1 = serializeWithBaseline(schema, base, base.doc).text === text;
      const r1b = serializeWithBaseline(schema, base, parseMarkdown(schema, text)).text === text;
      if (r1 && r1b) noEdit++;
      void idx;
      const r = rng(name);
      for (const kind of KINDS) {
      // ② 编辑后撤销
      const e = applyEdit(schema, base.doc, kind, r);
      let r2 = true;
      if (e) {
        const undoTr = new Transform(e.tr.doc);
        for (let i = e.tr.steps.length - 1; i >= 0; i--) undoTr.step(e.tr.steps[i]!.invert(e.tr.docs[i]!));
        r2 = serializeWithBaseline(schema, base, undoTr.doc).text === text;
      }
      if (r2) undoOk++; else undoBad++;
      // ③ 随机编辑一处
      let r3: boolean | null = null;
      let mode = "";
      if (e) {
        localTotal++;
        const res = serializeWithBaseline(schema, base, e.tr.doc);
        mode = res.mode;
        if (res.mode === "full") full++;
        const u = unitOfTop(base, e.top);
        // 新增段落插在单元末尾时，原块本身也不应变化；插在合并单元中间时，整个单元就是最小粒度
        const atUnitEnd = e.top === u.first + u.count - 1;
        const prefix = kind === "paragraph" && atUnitEnd ? text.slice(0, u.end) : text.slice(0, u.from);
        const suffix = text.slice(u.end);
        r3 = res.text.startsWith(prefix) && res.text.endsWith(suffix) && res.text.length >= prefix.length + suffix.length - 0;
        if (r3) local++;
        // 语义：输出重新解析后与编辑后的文档结构相同。以编辑后的文档本身为准；
        // 被改的块经规范序列化本就会变（管线自身的往返差异）时，再以整篇规范序列化的解析结果为准
        const got = docFingerprint(parseMarkdown(schema, res.text));
        const ok =
          got === docFingerprint(e.tr.doc) ||
          got === docFingerprint(parseMarkdown(schema, serializeMarkdown(schema, e.tr.doc)));
        if (ok) semantic++;
        if (!r3 || !ok) failures.push({ name, kind, mode, local: r3, semantic: ok, unit: [u.from, u.end] });
      }
      rows.push({ name, coarse: base.coarse, units: base.units.length, noEdit: r1 && r1b, undo: r2, kind, local: r3, mode });
      }
    });
    const summary = {
      files: corpus.length,
      coarseFiles: coarse,
      noEditIdentical: `${noEdit}/${corpus.length}`,
      undoIdentical: `${undoOk}/${undoOk + undoBad}`,
      editLocal: `${local}/${localTotal}`,
      editLocalRate: +(local / Math.max(1, localTotal)).toFixed(4),
      editSemanticOk: `${semantic}/${localTotal}`,
      fellBackToFull: full,
    };
    const dir = resolve(__dirname, "../../test-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "fidelity-writeback.json"), JSON.stringify({ summary, failures, rows }, null, 1));
    console.log("[V4 writeback]", JSON.stringify(summary));
    expect(noEdit).toBe(corpus.length);
    expect(undoBad).toBe(0);
    expect(semantic).toBe(localTotal);
    expect(local / localTotal).toBeGreaterThanOrEqual(0.98);
  });
});
