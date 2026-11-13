// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { WysiwygEditor } from "./wysiwyg";

function make(text: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new WysiwygEditor({ element: el, text, editable: true });
}

describe("WysiwygEditor", () => {
  it("新建的空文档输入后，不多出 TrailingNode 的空行", () => {
    const ed = make("");
    ed.editor.chain().focus().insertContent("你好").run();
    expect(ed.serialize()).toBe("你好\n");
  });
  it("以表格结尾的文档载入后不编辑：原样输出", () => {
    const src = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    expect(make(src).peek().text).toBe(src);
  });
  it("编辑后 serialize 提交基线，再次 peek 不变", () => {
    const ed = make("# 标题\n\n段落。\n");
    ed.editor.chain().focus("end").insertContent("加").run();
    const out = ed.serialize();
    expect(out).toBe("# 标题\n\n段落。加\n");
    expect(ed.peek()).toMatchObject({ text: out, mode: "unchanged" });
  });
});
