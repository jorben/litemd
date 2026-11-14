// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { WysiwygEditor } from "./wysiwyg";

function make(text: string, editable = true, onUserEdit?: () => void) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new WysiwygEditor({ element: el, text, editable, ...(onUserEdit ? { onUserEdit } : {}) });
}

/** 模拟点击第一个折叠块的标题（走 detailsBlock 插件的 handleClick）。 */
function clickSummary(ed: WysiwygEditor) {
  const view = ed.editor.view;
  const summary = view.dom.querySelector("summary")!;
  const pos = view.posAtDOM(summary, 0);
  return view.someProp("handleClick", (f) => f(view, pos, { target: summary } as unknown as MouseEvent));
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

  const DETAILS = "<details>\n<summary>标题</summary>\n\n隐藏内容\n\n</details>\n\n段落。\n";
  it("预览里展开折叠块：不算编辑，之后有别的编辑也不把 open 写回", () => {
    let edits = 0;
    const ed = make(DETAILS, false, () => edits++);
    expect(clickSummary(ed)).toBe(true);
    expect(ed.doc.firstChild!.attrs.open).toBe(true);
    expect(edits).toBe(0);
    expect(ed.dirty).toBe(false);
    expect(ed.peek()).toMatchObject({ text: DETAILS, mode: "unchanged" });
    ed.setEditable(true);
    ed.editor.chain().focus("end").insertContent("加").run();
    expect(edits).toBe(1);
    expect(ed.serialize()).toBe(DETAILS.replace("段落。", "段落。加"));
  });
  it("所见即所得里展开折叠块：算一次编辑，照常保存", () => {
    let edits = 0;
    const ed = make(DETAILS, true, () => edits++);
    expect(clickSummary(ed)).toBe(true);
    expect(edits).toBe(1);
    expect(ed.serialize()).toContain("<details open>");
  });
  it("编辑折叠块旁边的段落：折叠块保持原文，不会被写两遍", () => {
    for (const [src, at, want] of [
      [DETAILS, "end", DETAILS.replace("段落。", "段落。加")],
      ["开头。\n\n" + DETAILS, "start", "加开头。\n\n" + DETAILS],
    ] as const) {
      const ed = make(src);
      ed.editor.chain().focus(at).insertContent("加").run();
      expect(ed.serialize()).toBe(want);
    }
  });
});
