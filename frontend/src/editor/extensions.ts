// LiteMd 的所见即所得扩展装配（技术方案 4.1 节第 3 条、4.4 节）。
// 参照 vmark services/assembly/tiptapExtensions.ts 的 buildExtensionList，只装配 LiteMd 需要的扩展：
//   不装 highlight / subscript / superscript / underline / wikiLink（D13）、toc、音视频、videoEmbed、
//   aiSuggestion、focusMode、typewriterMode、lint、multiCursor、sourcePeekInline、cjkLetterSpacing、
//   showInvisibles、mediaHandler、editorContextMenu（M2 由 LiteMd 自己的右键菜单替代）。
// 脚注重新编号属于 footnotePopup/cleanupOnEdit，不在这里注册（技术方案 4.3 节）。
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Code from "@tiptap/extension-code";
import { vmarkLinkExtension } from "@/services/assembly/linkExtension";
import {
  HeadingWithSourceLine,
  ParagraphWithSourceLine,
  CodeBlockWithSourceLine,
  BlockquoteWithSourceLine,
  BulletListWithSourceLine,
  OrderedListWithSourceLine,
  HorizontalRuleWithSourceLine,
  TableRowWithSourceLine,
} from "@/plugins/shared/sourceLineNodes";
import { TableWithScrollWrapper } from "@/plugins/tableScroll";
import { tableScrollFreezeExtension } from "@/plugins/tableScroll/scrollFreeze";
import { AlignedTableCell, AlignedTableHeader } from "@/components/Editor/alignedTableNodes";
import { tableUIExtension } from "@/plugins/tableUI/tiptap";
import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { mathInlineExtension } from "@/plugins/latex/tiptapInlineMath";
import { createInlineMathEditingRegistry } from "@/plugins/latex/inlineMathEditingRegistry";
import { mathPopupExtension } from "@/plugins/mathPopup";
import { codePreviewExtension } from "@/plugins/codePreview/tiptap";
import { blockMathKeymapExtension } from "@/plugins/codePreview/blockMathKeymap";
import { alertBlockExtension } from "@/plugins/alertBlock/tiptap";
import { detailsBlockExtension, detailsSummaryExtension } from "@/plugins/detailsBlock/tiptap";
import { footnoteDefinitionExtension, footnoteReferenceExtension } from "@/plugins/footnotePopup/tiptapNodes";
import { footnotePopupExtension } from "@/plugins/footnotePopup/tiptap";
import {
  frontmatterExtension,
  htmlBlockExtension,
  htmlInlineExtension,
  linkDefinitionExtension,
} from "@/plugins/markdownArtifacts";
import { imageViewExtension } from "@/plugins/imageView/tiptap";
import { blockImageExtension } from "@/plugins/blockImage/tiptap";
import { listContinuationExtension } from "@/plugins/listContinuation/tiptap";
import { listBackspaceExtension } from "@/plugins/listBackspace/tiptap";
import { listClickFixExtension } from "@/plugins/listClickFix/tiptap";
import { safeBlockSplitExtension } from "@/plugins/safeBlockSplit/tiptap";
import { blockEscapeExtension } from "@/plugins/blockEscape";
import { tabIndentExtension } from "@/plugins/tabIndent/tiptap";
import { autoPairExtension } from "@/plugins/autoPair/tiptap";
import { inlineCodeBoundaryExtension } from "@/plugins/inlineCodeBoundary/tiptap";
import { smartSelectAllExtension } from "@/plugins/smartSelectAll/tiptap";
import { CJKBold, CJKItalic } from "@/plugins/markInputRules/tiptap";
import { textDragDropExtension } from "@/plugins/textDragDrop/tiptap";
import { compositionGuardExtension } from "@/plugins/compositionGuard/tiptap";
import { blankLinesGuardExtension } from "@/plugins/blankLinesGuard/tiptap";
import { undoIntegrityExtension } from "@/plugins/undoIntegrity/tiptap";
import { inactiveSelectionExtension } from "@/plugins/inactiveSelection/tiptap";
import { smartPasteExtension } from "@/plugins/smartPaste/tiptap";
import { markdownPasteExtension } from "@/plugins/markdownPaste/tiptap";
import { htmlPasteExtension } from "@/plugins/htmlPaste/tiptap";
import { codePasteExtension } from "@/plugins/codePaste/tiptap";
import { markdownCopyExtension } from "@/plugins/markdownCopy/tiptap";
import { linkPopupExtension } from "@/plugins/linkPopup/tiptap";
import { linkCreatePopupExtension } from "@/plugins/linkCreatePopup";
import { searchExtension } from "@/plugins/search/tiptap";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { useMathPopupStore } from "@/stores/mathPopupStore";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import type { PasteSettings } from "@/plugins/shared/pasteSettings";
import { getSettings } from "../settings/store";

/** F5.8：粘贴时转换富文本可在设置中关闭（关闭后粘贴为纯文本）。 */
export function currentPasteSettings(): PasteSettings {
  return { pasteMode: getSettings().pasteRich ? "smart" : "plain", preserveLineBreaks: false };
}

const inlineMathEditing = createInlineMathEditingRegistry();

/** 预览与所见即所得共用的扩展清单（技术方案 8.2 节：同一个 Tiptap 实例，只切 editable）。 */
export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
      listItem: false,
      underline: false,
      bold: false,
      italic: false,
      heading: false,
      paragraph: false,
      codeBlock: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      horizontalRule: false,
      link: false,
      code: false, // 换成下面不排斥其他标记的版本
      undoRedo: { depth: 200, newGroupDelay: 500 },
    }),
    undoIntegrityExtension,
    // litemd: Tiptap 的 code 标记 excludes "_"（不与任何标记共存），但 Markdown 允许 **`x`**、
    // [`x`](url)。管线会构造出 code+bold 的文本，而撤销「取消加粗」时 AddMarkStep 遵守 excludes、
    // 加不回 bold，撤销无法回到原文（D3）。这里允许 code 与其他标记共存。
    Code.extend({ excludes: "" }),
    vmarkLinkExtension,
    CJKBold,
    CJKItalic,
    HeadingWithSourceLine,
    ParagraphWithSourceLine,
    CodeBlockWithSourceLine,
    BlockquoteWithSourceLine,
    BulletListWithSourceLine,
    OrderedListWithSourceLine,
    HorizontalRuleWithSourceLine,
    taskListItemExtension,
    mathInlineExtension.configure({ editingRegistry: inlineMathEditing }),
    mathPopupExtension.configure({ store: useMathPopupStore }),
    alertBlockExtension,
    detailsSummaryExtension,
    detailsBlockExtension,
    linkDefinitionExtension,
    frontmatterExtension,
    htmlInlineExtension,
    htmlBlockExtension,
    footnoteReferenceExtension,
    footnoteDefinitionExtension,
    TableWithScrollWrapper.configure({ resizable: false }),
    TableRowWithSourceLine,
    AlignedTableHeader,
    AlignedTableCell,
    tableUIExtension,
    tableScrollFreezeExtension,
    blockEscapeExtension,
    compositionGuardExtension,
    blockImageExtension,
    imageViewExtension,
    footnotePopupExtension.configure({ store: useFootnotePopupStore }),
    smartPasteExtension,
    markdownPasteExtension.configure({ getMode: () => "auto", getPreserveLineBreaks: () => false }),
    htmlPasteExtension.configure({ getPasteSettings: currentPasteSettings }),
    codePasteExtension.configure({ getPasteSettings: currentPasteSettings }),
    markdownCopyExtension.configure({ getCopyFormat: () => "default", getCopyOnSelect: () => false }),
    linkPopupExtension.configure({ store: useLinkPopupStore, createStore: useLinkCreatePopupStore }),
    linkCreatePopupExtension.configure({ store: useLinkCreatePopupStore }),
    searchExtension,
    autoPairExtension,
    blankLinesGuardExtension,
    codePreviewExtension,
    blockMathKeymapExtension,
    listContinuationExtension,
    safeBlockSplitExtension,
    listBackspaceExtension,
    listClickFixExtension,
    tabIndentExtension.configure({ getTabSize: () => getSettings().tabWidth }),
    smartSelectAllExtension,
    inlineCodeBoundaryExtension,
    textDragDropExtension,
    inactiveSelectionExtension,
  ];
}
