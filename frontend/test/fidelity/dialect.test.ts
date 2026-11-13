// 方言用例（技术方案 4.3 节、6.5 节第 6 条；PRD D13、F4.1、F4.2、F4.11）。
import type { Node as PMNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { getProductionSchema } from "@/test/productionSchema";
import { loadBaseline, serializeWithBaseline } from "../../src/fidelity/writeback";

const schema = getProductionSchema();

function marksIn(doc: PMNode): string[] {
  const out = new Set<string>();
  doc.descendants((n) => {
    n.marks.forEach((m) => out.add(m.type.name));
  });
  return [...out];
}

describe("D13 方言", () => {
  it("~x~ 与 ~~x~~ 都是删除线（与 GitHub 一致）", () => {
    for (const md of ["一个 ~删除~ 词\n", "一个 ~~删除~~ 词\n"]) {
      expect(marksIn(parseMarkdown(schema, md))).toEqual(["strike"]);
    }
  });

  it.each(["这是 ==高亮== 文本", "x^2^ 上标", "++下划线++ 写法", "见 [[内部链接]] 一节", "[TOC]"])(
    "%s 按普通文本原样保留，规范序列化也不转义",
    (line) => {
      const md = `${line}\n`;
      const doc = parseMarkdown(schema, md);
      expect(marksIn(doc)).toEqual([]);
      expect(doc.childCount).toBe(1);
      expect(doc.child(0).type.name).toBe("paragraph");
      expect(doc.child(0).textContent).toBe(line);
      expect(serializeMarkdown(schema, doc)).toBe(md);
    },
  );

  it("setext 标题被识别为标题", () => {
    const doc = parseMarkdown(schema, "标题一\n===\n\n标题二\n---\n\n正文\n");
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(0).attrs.level).toBe(1);
    expect(doc.child(1).type.name).toBe("heading");
    expect(doc.child(1).attrs.level).toBe(2);
  });

  it("编辑其他块时，未改动的 setext 标题保持原文", () => {
    const src = "标题一\n===\n\n正文第一段。\n\n标题二\n---\n";
    const base = loadBaseline(schema, src);
    const para = base.doc.child(1);
    const pos = base.doc.child(0).nodeSize + 1 + para.content.size;
    const tr = new Transform(base.doc).insert(pos, schema.text("补充"));
    const res = serializeWithBaseline(schema, base, tr.doc);
    expect(res.text).toBe("标题一\n===\n\n正文第一段。补充\n\n标题二\n---\n");
  });
});
