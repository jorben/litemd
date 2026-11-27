// LiteMd 所见即所得模式的换行语义（Enter / Shift+Enter）。
//
// 原则：按 Markdown 语义而非传统富文本“延续一切格式”处理换行：
//   - 标题（heading）：行尾/行中换行后新行一律回到普通段落；空标题按 Enter 原地转为普通段落；
//     行首按 Enter 在上方插空段落并保留原标题；Shift+Enter 同 Enter（ATX 标题不支持多行）。
//   - 行内格式（bold / italic / strike / code / link）：Enter 与 Shift+Enter 均不延续到新行。
//   - 折叠块（detailsSummary / detailsBlock）：标题行 Enter 打开折叠块并进入正文；正文末尾空段
//     Enter 退出到折叠块后的普通段落（包括仅有一个空段时）。
//   - 脚注定义（footnote_definition）：单段容器，按 Enter 退出并在其后插入普通段落。
//   - 引用块 / 提示块（blockquote / alertBlock）：非空段 Enter 留在容器内（清空行内格式），
//     空段 Enter 由 liftEmptyBlock 退出并清空行内格式。
//   - 列表（listContinuation，priority 1000）、跨块选区（safeBlockSplit，priority 999）、
//     代码块（CodeBlock / newlineInCode）与块级图片（NodeSelection）保持各自原有处理。
import { Extension, type Editor } from "@tiptap/core";
import { liftEmptyBlock } from "@tiptap/pm/commands";
import { keymap } from "@tiptap/pm/keymap";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection, type Command } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import { guardProseMirrorCommand } from "@/utils/imeGuard";

/** 标题行内 Enter / Shift+Enter：除行首插空段外，新行一律回到普通段落且不延续行内格式。 */
const handleHeadingEnter: Command = (state, dispatch) => {
  const { selection, schema } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $from, $to } = selection;
  if (!$from.sameParent($to) || $from.parent.type.name !== "heading") return false;

  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) return false;

  // 空标题按 Enter：原地转为普通段落，不留下空 `# `
  if ($from.parent.content.size === 0) {
    if (dispatch) {
      const tr = state.tr
        .setBlockType($from.before(), $from.after(), paragraphType)
        .setStoredMarks([])
        .scrollIntoView();
      dispatch(tr);
    }
    return true;
  }

  // 非空标题行首按 Enter：在标题上方插入空段落，原标题和光标位置保持在标题首
  if (selection.empty && $from.parentOffset === 0) {
    if (dispatch) {
      const tr = state.tr.insert($from.before(), paragraphType.create()).setStoredMarks([]).scrollIntoView();
      dispatch(tr);
    }
    return true;
  }

  const tr = state.tr;
  if (!selection.empty) tr.deleteSelection();

  const splitPos = tr.mapping.map($from.pos);
  const $split = tr.doc.resolve(splitPos);

  // 选中整行标题内容后按 Enter：删除后变为空标题，直接转为普通段落
  if ($split.parent.content.size === 0) {
    if (dispatch) {
      tr.setBlockType($split.before(), $split.after(), paragraphType).setStoredMarks([]).scrollIntoView();
      dispatch(tr);
    }
    return true;
  }

  if (!canSplit(tr.doc, splitPos, 1, [{ type: paragraphType }])) return false;

  if (dispatch) {
    tr.split(splitPos, 1, [{ type: paragraphType }]).setStoredMarks([]).scrollIntoView();
    dispatch(tr);
  }
  return true;
};

/** 折叠块标题（detailsSummary）内 Enter / Shift+Enter：展开折叠块并将光标/后半段移入正文首段。 */
const handleDetailsSummaryEnter: Command = (state, dispatch) => {
  const { selection, schema } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $from, $to } = selection;
  if (!$from.sameParent($to) || $from.parent.type.name !== "detailsSummary") return false;

  const paragraphType = schema.nodes.paragraph;
  const detailsDepth = $from.depth - 1;
  if (!paragraphType || detailsDepth < 1 || $from.node(detailsDepth).type.name !== "detailsBlock") return false;

  if (dispatch) {
    const tr = state.tr;
    if (!selection.empty) tr.deleteSelection();

    const splitPos = tr.mapping.map($from.pos);
    const $split = tr.doc.resolve(splitPos);
    const summaryEnd = $split.end();
    const trailing = splitPos < summaryEnd ? tr.doc.slice(splitPos, summaryEnd).content : Fragment.empty;
    if (splitPos < summaryEnd) tr.delete(splitPos, summaryEnd);

    const $afterSummaryDel = tr.doc.resolve(tr.mapping.map($from.pos));
    const detailsPos = $afterSummaryDel.before(detailsDepth);
    const detailsNode = tr.doc.nodeAt(detailsPos);
    if (detailsNode && !detailsNode.attrs.open) {
      tr.setNodeMarkup(detailsPos, undefined, { ...detailsNode.attrs, open: true });
    }

    const bodyStart = tr.doc.resolve(tr.mapping.map($from.pos)).after($from.depth);
    const firstBody = tr.doc.nodeAt(bodyStart);
    if (trailing.size === 0 && firstBody?.type === paragraphType && firstBody.content.size === 0) {
      tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1));
    } else {
      tr.insert(bodyStart, paragraphType.create(null, trailing));
      tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1));
    }
    tr.setStoredMarks([]).scrollIntoView();
    dispatch(tr);
  }
  return true;
};

/** 折叠块正文末尾空段按 Enter：退出到折叠块之后的普通段落（解决 detailsSummary block+ 无法 lift 的问题）。 */
const handleDetailsBlockExit: Command = (state, dispatch) => {
  const { selection, schema } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType || $from.parent.type !== paragraphType || $from.parent.content.size !== 0) return false;
  if ($from.depth < 2 || $from.node(-1).type.name !== "detailsBlock") return false;

  const detailsNode = $from.node(-1);
  // 只在折叠块最后一个子块时退出；中间的空段仍交给常规拆分
  if ($from.index(-1) !== detailsNode.childCount - 1) return false;

  if (dispatch) {
    const tr = state.tr;
    if (detailsNode.childCount > 2) {
      // 有多个正文块：移除末尾空段，并在折叠块外补一个普通段落
      tr.delete($from.before(), $from.after());
    }
    const insertPos = tr.mapping.map($from.after(-1));
    const nextNode = tr.doc.nodeAt(insertPos);
    // 若折叠块紧邻后方已是空段落（如 TrailingNode 补的末尾空段），直接落入其中，避免叠出多余空段
    if (nextNode?.type === paragraphType && nextNode.content.size === 0) {
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    } else {
      tr.insert(insertPos, paragraphType.create());
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    }
    tr.setStoredMarks([]).scrollIntoView();
    dispatch(tr);
  }
  return true;
};

/** 脚注定义（content: "paragraph"）内按 Enter：退出并在其后插入普通段落，不再卡死。 */
const handleFootnoteEnter: Command = (state, dispatch) => {
  const { selection, schema } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $from, $to } = selection;
  if (!$from.sameParent($to)) return false;

  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) return false;

  let fnDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "footnote_definition") {
      fnDepth = d;
      break;
    }
  }
  if (fnDepth === -1) return false;

  if (dispatch) {
    const tr = state.tr;
    if (!selection.empty) tr.deleteSelection();

    const splitPos = tr.mapping.map($from.pos);
    const $split = tr.doc.resolve(splitPos);
    const paraEnd = $split.end();
    const trailing = splitPos < paraEnd ? tr.doc.slice(splitPos, paraEnd).content : Fragment.empty;
    if (splitPos < paraEnd) tr.delete(splitPos, paraEnd);

    const insertPos = tr.doc.resolve(tr.mapping.map($from.pos)).after(fnDepth);
    const nextNode = tr.doc.nodeAt(insertPos);
    if (trailing.size === 0 && nextNode?.type === paragraphType && nextNode.content.size === 0) {
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    } else {
      tr.insert(insertPos, paragraphType.create(null, trailing));
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    }
    tr.setStoredMarks([]).scrollIntoView();
    dispatch(tr);
  }
  return true;
};

/** 提升空块（退出 blockquote / alertBlock 等容器）并清空可能残留的 storedMarks。 */
const liftEmptyBlockClearingMarks: Command = (state, dispatch) => {
  const wrapped = dispatch
    ? (tr: typeof state.tr) => {
        dispatch(tr.setStoredMarks([]));
      }
    : undefined;
  return liftEmptyBlock(state, wrapped);
};

/** Shift+Enter 软换行：标题 / 折叠标题转为出块换行，其余插入不带行内格式的 hardBreak。 */
const handleShiftEnter: Command = (state, dispatch, view) => {
  const { selection, schema } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $from } = selection;
  if ($from.parent.type.spec.code) return false;

  if ($from.parent.type.name === "heading") return handleHeadingEnter(state, dispatch, view);
  if ($from.parent.type.name === "detailsSummary") return handleDetailsSummaryEnter(state, dispatch, view);

  if ($from.parent.type.spec.isolating) return false;
  const hardBreakType = schema.nodes.hardBreak;
  if (!hardBreakType) return false;

  if (dispatch) {
    // inheritMarks = false：避免 hardBreak 节点本身继承粗体/代码等 mark，导致紧随其后的输入继续带格式
    const tr = state.tr
      .replaceSelectionWith(hardBreakType.create(), false)
      .setStoredMarks([])
      .scrollIntoView();
    dispatch(tr);
  }
  return true;
};

/** 统一 Enter 处理入口。 */
function createEnterCommand(editor: Editor): Command {
  return (state, dispatch, view) => {
    const { selection } = state;
    // NodeSelection / CellSelection 等交回各自扩展（如 blockImage、createParagraphNear）
    if (!(selection instanceof TextSelection)) return false;

    const { $from } = selection;
    // 代码块 / 公式块交回 CodeBlock（三连 Enter 退出）与 newlineInCode
    if ($from.parent.type.spec.code) return false;

    if (handleHeadingEnter(state, dispatch, view)) return true;
    if (handleDetailsSummaryEnter(state, dispatch, view)) return true;
    if (handleDetailsBlockExit(state, dispatch, view)) return true;
    if (handleFootnoteEnter(state, dispatch, view)) return true;

    // 其余文本块（普通段落、blockquote、alertBlock、表格单元格等）：
    // 先尝试空块提升退出容器，再做不延续行内格式的 splitBlock
    if (liftEmptyBlockClearingMarks(state, dispatch, view)) return true;
    if (!dispatch) return editor.can().splitBlock({ keepMarks: false });
    return editor.commands.splitBlock({ keepMarks: false });
  };
}

/** LiteMd 所见即所得换行语义扩展（优先级 950：低于列表续行与跨块选区保护，高于核心 Keymap）。 */
export const newlineBehaviorExtension = Extension.create({
  name: "newlineBehavior",
  priority: 950,

  addProseMirrorPlugins() {
    return [
      keymap({
        Enter: guardProseMirrorCommand(createEnterCommand(this.editor)),
        "Shift-Enter": guardProseMirrorCommand(handleShiftEnter),
      }),
    ];
  },
});
