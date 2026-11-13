// @vitest-environment jsdom
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import { buildExtensions } from "./extensions";

describe("LiteMd 扩展清单生成的 schema", () => {
  it("覆盖管线需要的全部节点、标记与属性", () => {
    const real = getSchema(buildExtensions());
    const want = testSchema; // 管线自带的节点清单
    const missing: string[] = [];
    const notUsed = new Set(["wikiLink", "highlight", "subscript", "superscript", "underline"]); // D13
    for (const [name, type] of Object.entries(want.nodes)) {
      if (notUsed.has(name)) continue;
      const got = real.nodes[name];
      if (!got) {
        missing.push(`node ${name}`);
        continue;
      }
      for (const a of Object.keys(type.spec.attrs ?? {})) if (!(a in (got.spec.attrs ?? {}))) missing.push(`${name}.${a}`);
    }
    for (const name of Object.keys(want.marks)) if (!notUsed.has(name) && !real.marks[name]) missing.push(`mark ${name}`);
    for (const name of notUsed) if (real.nodes[name] || real.marks[name]) missing.push(`D13 不应有 ${name}`);
    expect(missing).toEqual([]);
  });

  it("行内代码可以与加粗、链接共存（Markdown 允许 **`x`**），撤销不丢标记", () => {
    const schema = getSchema(buildExtensions());
    expect(schema.marks.code!.excludes(schema.marks.bold!)).toBe(false);
    expect(schema.marks.code!.excludes(schema.marks.link!)).toBe(false);
  });
});
