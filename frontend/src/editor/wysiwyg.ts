// 预览 / 所见即所得共用的 Tiptap 实例（技术方案 8.2 节），接保真写回层（第 6 节）。
//   - 载入：解析原文得到基线（loadBaseline），编辑器内容即基线文档；
//   - 只有用户编辑才通知（5.1）：docChanged 且不在程序载入中；
//   - 序列化：serializeWithBaseline，推送成功后 commit 更新基线（6.3 第 6 步）。
import { Editor, type Extensions } from "@tiptap/core";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { VIEW_STATE_META } from "@/plugins/detailsBlock/tiptap";
import {
  commitBaseline,
  loadBaseline,
  serializeWithBaseline,
  type Baseline,
  type WriteResult,
} from "../fidelity/writeback";
import { buildExtensions } from "./extensions";

export interface WysiwygOptions {
  element: HTMLElement;
  text: string;
  editable: boolean;
  /** 用户做了一次改变文档的编辑 */
  onUserEdit?: () => void;
  /** 每个事务之后（选区、文档变化），外壳据此刷新大纲、浮层等 */
  onTransaction?: () => void;
  extensions?: Extensions;
}

export class WysiwygEditor {
  readonly editor: Editor;
  private baseline: Baseline;
  private loading = false;
  /** 最近一次序列化的方式；"full" 时外壳显示「本次修改调整了全文格式」（F2.5⑤） */
  lastMode: WriteResult["mode"] = "unchanged";
  /** 载入时被插件规范化的顶层块下标（[-1] 表示块数都变了，无法对齐）；技术方案 6.4 节统计用 */
  normalizedOnLoad: number[] = [];

  constructor(private readonly o: WysiwygOptions) {
    this.loading = true;
    this.editor = new Editor({
      element: o.element,
      extensions: o.extensions ?? buildExtensions(),
      editable: o.editable,
      onTransaction: ({ transaction }) => {
        if (transaction.getMeta(VIEW_STATE_META)) this.adoptViewState(transaction.before, transaction.doc);
        else if (!this.loading && transaction.docChanged && !transaction.getMeta("preventUpdate")) o.onUserEdit?.();
        o.onTransaction?.();
      },
    });
    this.loading = false;
    performance.mark("lm:tiptap");
    // 基线用编辑器自己的 schema 解析，并把解析出的节点原样放进编辑器（6.2：基线 doc 就是编辑器里的文档）
    this.baseline = loadBaseline(this.schema, "");
    this.load(o.text);
  }

  get schema(): Schema {
    return this.editor.schema;
  }

  get doc(): PMNode {
    return this.editor.state.doc;
  }

  /**
   * 要序列化的文档：去掉 Tiptap TrailingNode 在末尾补的空段落（文档以表格、代码块等结尾时，
   * 为了让光标能落到最后而加）。空段落不产生 Markdown；基线末尾本来就有空段落时不去掉。
   */
  private contentDoc(): PMNode {
    let doc = this.doc;
    const trailingEmpty = (d: PMNode) => {
      let n = 0;
      for (let i = d.childCount - 1; i >= 0 && d.child(i).type.name === "paragraph" && d.child(i).content.size === 0; i--) n++;
      return n;
    };
    // 基线末尾原有的空段落要保留；空白文档解析出的那个空段落不算（它不对应任何原文）
    const keep = this.baseline.source.trim() === "" ? 0 : trailingEmpty(this.baseline.doc);
    while (doc.childCount > 1 && trailingEmpty(doc) > keep) {
      doc = doc.copy(doc.content.cut(0, doc.content.size - doc.lastChild!.nodeSize));
    }
    return doc;
  }

  /**
   * 预览里展开/折叠折叠块（VIEW_STATE_META）：不通知编辑，并把变化同步进基线文档，这样之后
   * 不论是否有别的编辑，这些块都按原文输出，不会把 open 写进文件。只接收基线里原本未改动的
   * 顶层块；已经有未推送编辑的块保持原样，随那次编辑一起保存。
   */
  private adoptViewState(before: PMNode, after: PMNode): void {
    const base = this.baseline.doc;
    if (before.childCount !== after.childCount) return;
    const children: PMNode[] = [];
    let changed = false;
    base.forEach((node, _, i) => {
      if (i < before.childCount && before.child(i).eq(node) && !after.child(i).eq(node)) {
        children.push(after.child(i));
        changed = true;
      } else children.push(node);
    });
    if (changed) this.baseline = { ...this.baseline, doc: base.copy(Fragment.fromArray(children)) };
  }

  /** 预览 ⇄ 所见即所得：只切 editable，不重新解析，撤销历史保留（8.2）。 */
  setEditable(editable: boolean): void {
    this.editor.setEditable(editable, false);
  }

  /** 当前文档的 Markdown（不改基线）。 */
  peek(): WriteResult {
    return serializeWithBaseline(this.schema, this.baseline, this.contentDoc());
  }

  /** 序列化并把结果作为新基线（推送时调用）。 */
  serialize(): string {
    const schema = this.schema;
    const doc = this.contentDoc();
    const res = serializeWithBaseline(schema, this.baseline, doc);
    this.lastMode = res.mode;
    this.baseline = commitBaseline(schema, this.baseline, doc, res);
    return res.text;
  }

  /** 基线原文（进入源码模式时，若无编辑直接用它）。 */
  get source(): string {
    return this.baseline.source;
  }

  /** 是否自基线以来有编辑。 */
  get dirty(): boolean {
    return !this.contentDoc().eq(this.baseline.doc);
  }

  /** 重新载入（外部修改、离开源码模式且文本变了）：重建基线，不进撤销历史。 */
  load(text: string): void {
    const base = loadBaseline(this.schema, text);
    performance.mark("lm:parse");
    this.loading = true;
    try {
      const { state } = this.editor;
      const tr = state.tr.replaceWith(0, state.doc.content.size, base.doc.content);
      tr.setMeta("addToHistory", false).setMeta("preventUpdate", true);
      this.editor.view.dispatch(tr);
    } finally {
      this.loading = false;
    }
    // 各插件首轮 appendTransaction 之后的文档就是基线文档（6.2）。插件在载入时规范化了某些块
    // （如 prosemirror-tables 给缺单元格的行补空单元格）而顶层块数不变时，仍以载入后的文档为基线：
    // 载入不算编辑，这些块在用户改动它们之前照样输出原文。
    this.baseline = base;
    const loaded = this.contentDoc();
    this.normalizedOnLoad = [];
    if (loaded.childCount === base.doc.childCount) {
      for (let i = 0; i < loaded.childCount; i++) if (!loaded.child(i).eq(base.doc.child(i))) this.normalizedOnLoad.push(i);
      this.baseline = { ...base, doc: loaded };
    } else this.normalizedOnLoad = [-1];
  }

  destroy(): void {
    this.editor.destroy();
  }
}
