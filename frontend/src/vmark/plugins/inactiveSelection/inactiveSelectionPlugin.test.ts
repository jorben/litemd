// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import { WysiwygEditor } from "../../../editor/wysiwyg";
import { INACTIVE_SELECTION_CLASS } from "./constants";

function make(editable: boolean) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new WysiwygEditor({ element: el, text: "第一段正文 hello world\n", editable });
  const { view } = ed.editor;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 5)));
  return ed;
}
const marked = (ed: WysiwygEditor) => ed.editor.view.dom.querySelectorAll(`.${INACTIVE_SELECTION_CLASS}`).length;

describe("inactiveSelection", () => {
  it("可编辑、失焦时：选区显示为暗色覆盖", () => {
    expect(marked(make(true))).toBe(1);
  });

  // litemd：预览不可聚焦、总算失焦；给双击选中的词套 span 会换掉被点中的文字节点，WebKit 随后不再派发 dblclick（F3.8）
  it("只读视图（预览）不加覆盖，切换 editable 时随之增删", () => {
    const ed = make(false);
    expect(marked(ed)).toBe(0);
    ed.setEditable(true);
    expect(marked(ed)).toBe(1);
    ed.setEditable(false);
    expect(marked(ed)).toBe(0);
  });
});
