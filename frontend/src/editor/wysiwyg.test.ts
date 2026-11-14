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

  it("peek 取到未推送的编辑但不提交基线（暂停推送时进入源码模式用，5.4）", () => {
    const ed = make("# 标题\n\n段落。\n");
    ed.editor.chain().focus("end").insertContent("加").run();
    expect(ed.dirty).toBe(true);
    expect(ed.peek().text).toBe("# 标题\n\n段落。加\n");
    expect(ed.dirty).toBe(true);
    expect(ed.serialize()).toBe("# 标题\n\n段落。加\n");
  });

  it("insertPlainText：按字面插入，不解释 HTML / Markdown，换行变成段落，空字符串不编辑", () => {
    let edits = 0;
    const ed = make("段落。\n", true, () => edits++);
    ed.editor.commands.focus("end");
    ed.insertPlainText("");
    expect(edits).toBe(0);
    ed.insertPlainText("a < b &amp; <b>x</b>\n# h\r\n\n*y*");
    expect(ed.doc.childCount).toBe(3);
    expect(ed.doc.child(0).textContent).toBe("段落。a < b &amp; <b>x</b>");
    expect(ed.doc.child(1)).toMatchObject({ type: { name: "paragraph" }, textContent: "# h" });
    expect(ed.doc.child(2)).toMatchObject({ type: { name: "paragraph" }, textContent: "*y*" });
    expect(ed.doc.child(0).firstChild!.marks).toEqual([]);
    // 重新解析保存结果：文字不变（特殊字符已转义）
    const again = make(ed.serialize());
    expect([0, 1, 2].map((i) => again.doc.child(i).textContent)).toEqual(["段落。a < b &amp; <b>x</b>", "# h", "*y*"]);
  });
  it("insertPlainText：代码块里原样插入，保留换行", () => {
    const ed = make("```\ncode\n```\n");
    ed.editor.commands.focus("end");
    ed.editor.commands.setTextSelection(5);
    ed.insertPlainText("a < b\r\n\nc");
    expect(ed.doc.firstChild!.type.name).toBe("codeBlock");
    expect(ed.doc.firstChild!.textContent).toBe("codea < b\n\nc");
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
  // 单行的 \[x\] 经预处理改变了行结构：粗粒度基线，任何编辑都整篇规范序列化。
  // 折叠块按规范格式书写，整篇改写后原样不变，只看 open
  const DETAILS_BLOCK = "<details>\n<summary>标题</summary>\n\n隐藏内容\n</details>";
  const COARSE = "\\[x\\]\n\n开头。\n\n" + DETAILS_BLOCK + "\n\n段落。\n";
  it("粗粒度基线：预览里展开折叠块，之后编辑别处，折叠块原文不变（不写 open）", () => {
    const ed = make(COARSE, false);
    expect(clickSummary(ed)).toBe(true);
    expect(ed.doc.child(2).attrs.open).toBe(true);
    expect(ed.peek().text).toBe(COARSE);
    ed.setEditable(true);
    // 在折叠块之前插入：位置后移也要认得它
    ed.editor.chain().focus().setTextSelection(ed.doc.child(0).nodeSize + 1).insertContent("加").run();
    ed.editor.chain().focus("end").insertContent("加").run();
    const out = ed.serialize();
    expect(ed.lastMode).toBe("local");
    expect(out).toBe("$$\nx\n$$\n\n加开头。\n\n" + DETAILS_BLOCK + "\n\n段落。加\n");
    // 提交基线后再编辑一次：仍不写 open，编辑器里仍是展开的
    ed.editor.chain().focus("end").insertContent("再").run();
    expect(ed.serialize()).toContain("\n\n" + DETAILS_BLOCK + "\n\n");
    expect(ed.doc.child(2).attrs.open).toBe(true);
  });
  // 预览里展开又折叠（第二次切换不能把预览给的 open 当成原值），再在所见即所得里编辑别处：折叠块原文不变
  for (const [name, src, block] of [
    ["粗粒度基线", COARSE, DETAILS_BLOCK],
    ["细粒度基线", DETAILS, "<details>\n<summary>标题</summary>\n\n隐藏内容\n\n</details>"],
  ] as const) {
    it(`${name}：预览里展开再折叠折叠块，之后编辑别处，折叠块原文不变`, () => {
      const ed = make(src, false);
      expect(clickSummary(ed)).toBe(true);
      expect(clickSummary(ed)).toBe(true);
      const details = () => ed.doc.content.content.find((n) => n.type.name === "detailsBlock")!;
      expect(details().attrs.open).toBe(false);
      expect(ed.peek().text).toBe(src);
      ed.setEditable(true);
      ed.editor.chain().focus("end").insertContent("加").run();
      const out = ed.serialize();
      expect(out).toContain(block);
      expect(out).not.toContain("<details open>");
      expect(out.endsWith("段落。加\n")).toBe(true);
    });
  }
  it("粗粒度基线：所见即所得里展开折叠块照常写回", () => {
    const ed = make(COARSE, true);
    expect(clickSummary(ed)).toBe(true);
    expect(ed.serialize()).toContain("<details open>");
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
