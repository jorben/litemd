// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { WysiwygEditor } from "./wysiwyg";

function make(text: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new WysiwygEditor({ element: el, text, editable: true });
  ed.editor.commands.focus();
  return ed;
}

/** 模拟真实键盘按下 Enter / Shift+Enter（走 ProseMirror handleKeyDown → keymap 链）。 */
function pressKey(ed: WysiwygEditor, key: string, opts: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) {
  const view = ed.editor.view;
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: !!opts.shiftKey,
    metaKey: !!opts.metaKey,
    ctrlKey: !!opts.ctrlKey,
    bubbles: true,
    cancelable: true,
  });
  return view.someProp("handleKeyDown", (f) => f(view, event));
}

/** 在当前光标处像用户一样键入纯文本（继承当前 active/stored marks）。 */
function typeText(ed: WysiwygEditor, text: string) {
  const { state, dispatch } = ed.editor.view;
  dispatch(state.tr.insertText(text));
}

/** 找到第一个匹配文本的位置（返回起始/结束文档偏移）。 */
function findText(ed: WysiwygEditor, needle: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  ed.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const idx = node.text.indexOf(needle);
    if (idx >= 0) found = { from: pos + idx, to: pos + idx + needle.length };
  });
  if (!found) throw new Error(`text not found: ${needle}`);
  return found;
}

describe("所见即所得换行语义（newlineBehavior）", () => {
  describe("标题（heading）", () => {
    it("标题行尾按 Enter：回到普通段落，且新段不继承 sourceLine 与 id", () => {
      const ed = make("# 标题内容\n");
      const pos = findText(ed, "标题内容");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "正文");

      expect(ed.doc.child(0).type.name).toBe("heading");
      expect(ed.doc.child(0).textContent).toBe("标题内容");
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("正文");
      expect(ed.doc.child(1).attrs.sourceLine).toBeNull();
      expect(ed.serialize()).toBe("# 标题内容\n\n正文\n");
    });

    it("标题行中按 Enter：前半段保留标题，后半段降级为普通段落", () => {
      const ed = make("## 你好世界\n");
      const pos = findText(ed, "世界");
      ed.editor.commands.setTextSelection(pos.from);

      expect(pressKey(ed, "Enter")).toBe(true);

      expect(ed.doc.child(0).type.name).toBe("heading");
      expect(ed.doc.child(0).attrs.level).toBe(2);
      expect(ed.doc.child(0).textContent).toBe("你好");
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("世界");
      expect(ed.serialize()).toBe("## 你好\n\n世界\n");
    });

    it("空标题按 Enter：原地转为普通段落，不残留空标题", () => {
      const ed = make("");
      ed.editor.commands.setHeading({ level: 2 });
      expect(ed.doc.child(0).type.name).toBe("heading");

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "普通文本");

      expect(ed.doc.child(0).type.name).toBe("paragraph");
      expect(ed.doc.child(0).textContent).toBe("普通文本");
      expect(ed.serialize()).toBe("普通文本\n");
    });

    it("标题行首按 Enter：在上方插入空段落，原标题保持不变", () => {
      const ed = make("# 标题\n");
      const pos = findText(ed, "标题");
      ed.editor.commands.setTextSelection(pos.from);

      expect(pressKey(ed, "Enter")).toBe(true);

      expect(ed.doc.child(0).type.name).toBe("paragraph");
      expect(ed.doc.child(0).textContent).toBe("");
      expect(ed.doc.child(1).type.name).toBe("heading");
      expect(ed.doc.child(1).textContent).toBe("标题");
    });

    it("标题内按 Shift+Enter：不插入 br，直接退回普通段落", () => {
      const ed = make("# 标题\n");
      const pos = findText(ed, "标题");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter", { shiftKey: true })).toBe(true);
      typeText(ed, "下一行");

      expect(ed.doc.child(0).type.name).toBe("heading");
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("下一行");
    });

    it("带粗体的标题行尾按 Enter：新段落无粗体标记", () => {
      const ed = make("# **粗体标题**\n");
      const pos = findText(ed, "粗体标题");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "纯文本");

      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).firstChild!.marks).toEqual([]);
      expect(ed.serialize()).toBe("# **粗体标题**\n\n纯文本\n");
    });
  });

  describe("行内格式（Marks）不跨行延续", () => {
    for (const [label, md, word] of [
      ["粗体", "**加粗文本**\n", "加粗文本"],
      ["斜体", "*斜体文本*\n", "斜体文本"],
      ["删除线", "~~删除文本~~\n", "删除文本"],
      ["行内代码", "`inlineCode`\n", "inlineCode"],
      ["链接", "[示例](https://example.com)\n", "示例"],
    ] as const) {
      it(`${label}行尾按 Enter：新段落回到无格式纯文本`, () => {
        const ed = make(md);
        const pos = findText(ed, word);
        ed.editor.commands.setTextSelection(pos.to);

        expect(pressKey(ed, "Enter")).toBe(true);
        typeText(ed, "普通");

        expect(ed.doc.child(1).type.name).toBe("paragraph");
        expect(ed.doc.child(1).textContent).toBe("普通");
        expect(ed.doc.child(1).firstChild!.marks).toEqual([]);
      });

      it(`${label}行尾按 Shift+Enter：软换行后回到无格式纯文本`, () => {
        const ed = make(md);
        const pos = findText(ed, word);
        ed.editor.commands.setTextSelection(pos.to);

        expect(pressKey(ed, "Enter", { shiftKey: true })).toBe(true);
        typeText(ed, "普通");

        const p = ed.doc.child(0);
        const last = p.lastChild!;
        expect(last.isText).toBe(true);
        expect(last.text).toBe("普通");
        expect(last.marks).toEqual([]);
      });
    }
  });

  describe("列表（listItem）延续与边界修复", () => {
    it("无序列表非空项按 Enter 继续列表，空项按 Enter 退出列表", () => {
      const ed = make("- 第一项\n");
      const pos = findText(ed, "第一项");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "第二项");
      expect(ed.doc.child(0).type.name).toBe("bulletList");
      expect(ed.doc.child(0).childCount).toBe(2);

      // 再按两次 Enter：新建空项 → 退出列表为普通段落
      expect(pressKey(ed, "Enter")).toBe(true);
      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "正文");
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("正文");
    });

    it("任务列表已勾选项按 Enter：继续任务列表且新项默认未勾选", () => {
      const ed = make("- [x] 已完成\n");
      const pos = findText(ed, "已完成");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "待办");

      const list = ed.doc.child(0);
      expect(list.childCount).toBe(2);
      expect(list.child(0).attrs.checked).toBe(true);
      expect(list.child(1).attrs.checked).toBe(false);
    });

    it("列表项内带粗体按 Enter：继续列表但新项不延续粗体", () => {
      const ed = make("- **重点**\n");
      const pos = findText(ed, "重点");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "普通项");

      const secondItem = ed.doc.child(0).child(1);
      expect(secondItem.firstChild!.firstChild!.marks).toEqual([]);
    });

    it("列表项内嵌代码块按 Enter：在代码块内插换行，而不是把代码块拆成两个列表项", () => {
      const ed = make("- item\n\n  ```js\n  const a = 1;\n  ```\n");
      const pos = findText(ed, "const a = 1;");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "const b = 2;");

      const list = ed.doc.child(0);
      expect(list.childCount).toBe(1);
      const code = list.child(0).child(1);
      expect(code.type.name).toBe("codeBlock");
      expect(code.textContent).toBe("const a = 1;\nconst b = 2;");
    });

    it("仅含行内原子节点（如行内公式）的列表项按 Enter：不误判为空项，正常续行", () => {
      const ed = make("- $x$\n");
      // 找到列表项内段落的末尾位置（math_inline 原子节点之后）
      let paraEnd = -1;
      ed.doc.descendants((node, pos) => {
        if (paraEnd === -1 && node.type.name === "paragraph") {
          paraEnd = pos + 1 + node.content.size;
        }
      });
      expect(paraEnd).toBeGreaterThan(0);
      ed.editor.commands.setTextSelection(paraEnd);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "下一项");

      expect(ed.doc.child(0).type.name).toBe("bulletList");
      expect(ed.doc.child(0).childCount).toBe(2);
      expect(ed.doc.child(0).child(1).textContent).toBe("下一项");
    });
  });

  describe("容器块（blockquote / alertBlock / detailsBlock / footnote_definition）", () => {
    it("引用块非空段 Enter 留在引用内（清 Mark），空段二次 Enter 退出到正文", () => {
      const ed = make("> **引用第一段**\n");
      const pos = findText(ed, "引用第一段");
      ed.editor.commands.setTextSelection(pos.to);

      // 第一次 Enter：仍在 blockquote 内，但粗体不延续
      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "引用第二段");
      expect(ed.doc.child(0).type.name).toBe("blockquote");
      expect(ed.doc.child(0).childCount).toBe(2);
      expect(ed.doc.child(0).child(1).firstChild!.marks).toEqual([]);

      // 连续两次 Enter：新空段 → 退出引用块到正文
      expect(pressKey(ed, "Enter")).toBe(true);
      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "回到正文");
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("回到正文");
    });

    it("提示块（alertBlock）非空段 Enter 留在块内，空段二次 Enter 退出到正文", () => {
      const ed = make("> [!NOTE]\n> 提示内容\n");
      const pos = findText(ed, "提示内容");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      expect(ed.doc.child(0).type.name).toBe("alertBlock");
      expect(ed.doc.child(0).childCount).toBe(2);

      // 空行再按 Enter：退出 alertBlock
      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "块外正文");
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("块外正文");
    });

    it("折叠块标题（detailsSummary）按 Enter：展开折叠块并进入正文", () => {
      const ed = make("<details>\n<summary>折叠标题</summary>\n\n隐藏内容\n</details>\n");
      const pos = findText(ed, "折叠标题");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "首段新增");

      const details = ed.doc.child(0);
      expect(details.type.name).toBe("detailsBlock");
      expect(details.attrs.open).toBe(true);
      expect(details.child(0).type.name).toBe("detailsSummary");
      expect(details.child(1).type.name).toBe("paragraph");
      expect(details.child(1).textContent).toBe("首段新增");
    });

    it("折叠块正文仅有一个空段时按 Enter：能正常退出到折叠块后的普通段落", () => {
      const ed = make("<details open>\n<summary>标题</summary>\n\n正文\n</details>\n");
      const pos = findText(ed, "正文");
      ed.editor.commands.setTextSelection({ from: pos.from, to: pos.to });
      ed.editor.commands.deleteSelection();

      // 此时折叠块正文仅剩 1 个空段落，按 Enter 应跳出到折叠块之后
      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "外部段落");

      expect(ed.doc.child(0).type.name).toBe("detailsBlock");
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("外部段落");
    });

    it("折叠块正文多段时，在末尾空段按 Enter：删除末尾空段并退出到外部段落", () => {
      const ed = make("<details open>\n<summary>标题</summary>\n\n第一段\n</details>\n");
      const pos = findText(ed, "第一段");
      ed.editor.commands.setTextSelection(pos.to);

      // 第 1 次 Enter 留在折叠块内新建空段，第 2 次 Enter 退出到外部
      expect(pressKey(ed, "Enter")).toBe(true);
      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "外部段落");

      expect(ed.doc.child(0).type.name).toBe("detailsBlock");
      expect(ed.doc.child(0).childCount).toBe(2); // summary + 第一段（末尾空段已清理）
      expect(ed.doc.child(1).type.name).toBe("paragraph");
      expect(ed.doc.child(1).textContent).toBe("外部段落");
    });

    it("脚注定义（footnote_definition）内按 Enter：不再卡死，退出到下方普通段落", () => {
      const ed = make("正文[^1]\n\n[^1]: 脚注说明\n");
      const pos = findText(ed, "脚注说明");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "后续正文");

      expect(ed.doc.lastChild!.type.name).toBe("paragraph");
      expect(ed.doc.lastChild!.textContent).toBe("后续正文");
    });
  });

  describe("代码块（codeBlock）与属性保护", () => {
    it("代码块内按 Enter 仍插入换行符，不拆块", () => {
      const ed = make("```ts\nconst x = 1;\n```\n");
      const pos = findText(ed, "const x = 1;");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      typeText(ed, "const y = 2;");

      expect(ed.doc.child(0).type.name).toBe("codeBlock");
      expect(ed.doc.child(0).textContent).toBe("const x = 1;\nconst y = 2;");
    });

    it("普通段落拆行后新段落不继承上一行的 sourceLine", () => {
      const ed = make("第一行\n");
      const pos = findText(ed, "第一行");
      ed.editor.commands.setTextSelection(pos.to);

      expect(pressKey(ed, "Enter")).toBe(true);
      expect(ed.doc.child(1).attrs.sourceLine).toBeNull();
    });
  });
});
