// 源码模式编辑器：CodeMirror 6 + Markdown（PRD F3.3、F5.7；技术方案 8.2 节）。
// 只有用户操作（带 userEvent 的事务）才算编辑（5.1）；查找替换由外壳的查找状态驱动。
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, Transaction, Compartment } from "@codemirror/state";
import { Decoration, EditorView, keymap, drawSelection, highlightActiveLine, type DecorationSet } from "@codemirror/view";
import type { FindState } from "../shell/find";

export interface SourceOptions {
  parent: HTMLElement;
  text: string;
  readOnly: boolean;
  tabSize: number;
  onUserEdit?: () => void;
  onChange?: () => void;
}

export interface Match {
  from: number;
  to: number;
}

/** 按查找选项构造正则；无效正则返回 null。 */
export function findRegex(q: Pick<FindState, "query" | "caseSensitive" | "wholeWord" | "useRegex">): RegExp | null {
  if (!q.query) return null;
  let src = q.useRegex ? q.query : q.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (q.wholeWord) src = `\\b(?:${src})\\b`;
  try {
    return new RegExp(src, q.caseSensitive ? "gu" : "giu");
  } catch {
    return null;
  }
}

export function findAll(text: string, re: RegExp | null, limit = 10000): Match[] {
  if (!re) return [];
  const out: Match[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ from: m.index, to: m.index + m[0].length });
  }
  return out;
}

const setMatches = StateEffect.define<{ matches: Match[]; current: number }>();
const matchMark = Decoration.mark({ class: "cm-litemd-match" });
const currentMark = Decoration.mark({ class: "cm-litemd-match cm-litemd-match-current" });
const matchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setMatches)) {
        const b = new RangeSetBuilder<Decoration>();
        e.value.matches.forEach((m, i) => b.add(m.from, m.to, i === e.value.current ? currentMark : matchMark));
        return b.finish();
      }
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export class SourceEditor {
  readonly view: EditorView;
  private loading = false;
  private matches: Match[] = [];
  private readonly readOnlyComp = new Compartment();
  private readonly tabComp = new Compartment();

  constructor(private readonly o: SourceOptions) {
    this.view = new EditorView({
      parent: o.parent,
      state: EditorState.create({
        doc: o.text,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorState.allowMultipleSelections.of(true), // F5.7 多光标
          closeBrackets(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          this.tabComp.of([EditorState.tabSize.of(o.tabSize), indentUnit.of(" ".repeat(o.tabSize))]),
          this.readOnlyComp.of([EditorState.readOnly.of(o.readOnly), EditorView.editable.of(!o.readOnly)]),
          keymap.of([...closeBracketsKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          matchField,
          // spellcheck 由外壳按设置写到 contentDOM（F5.11）
          EditorView.contentAttributes.of({ "aria-label": "Markdown 源码" }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (!this.loading && u.transactions.some((tr) => tr.annotation(Transaction.userEvent) !== undefined)) o.onUserEdit?.();
            o.onChange?.();
          }),
        ],
      }),
    });
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  /** 程序设置文本（载入、外部修改）：不算用户编辑，清空撤销历史（D15）。 */
  setText(text: string): void {
    this.loading = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: text },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      this.loading = false;
    }
  }

  setReadOnly(ro: boolean): void {
    this.view.dispatch({ effects: this.readOnlyComp.reconfigure([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]) });
  }

  setTabSize(n: number): void {
    this.view.dispatch({ effects: this.tabComp.reconfigure([EditorState.tabSize.of(n), indentUnit.of(" ".repeat(n))]) });
  }

  focus(): void {
    this.view.focus();
  }

  undo(): boolean {
    return undo(this.view);
  }
  redo(): boolean {
    return redo(this.view);
  }

  /** 插入文本到选区（菜单命令、粘贴图片后的路径）。 */
  insert(text: string): void {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input" });
  }

  /** 更新查找高亮，返回匹配数和当前位置（当前位置为光标之后的第一处，或保持 index）。 */
  find(q: FindState, index?: number): { count: number; index: number } {
    if (!q.isOpen) {
      this.matches = [];
      this.view.dispatch({ effects: setMatches.of({ matches: [], current: -1 }) });
      return { count: 0, index: -1 };
    }
    this.matches = findAll(this.text, findRegex(q));
    let cur = index ?? -1;
    if (cur < 0 || cur >= this.matches.length) {
      const head = this.view.state.selection.main.from;
      cur = this.matches.findIndex((m) => m.from >= head);
      if (cur < 0) cur = this.matches.length ? 0 : -1;
    }
    this.view.dispatch({ effects: setMatches.of({ matches: this.matches, current: cur }) });
    return { count: this.matches.length, index: cur };
  }

  /** 选中并滚动到第 i 处匹配。 */
  reveal(i: number): void {
    const m = this.matches[i];
    if (!m) return;
    this.view.dispatch({
      selection: EditorSelection.single(m.from, m.to),
      effects: [setMatches.of({ matches: this.matches, current: i }), EditorView.scrollIntoView(m.from, { y: "center" })],
    });
  }

  replaceCurrent(i: number, replacement: string, q: FindState): void {
    const m = this.matches[i];
    if (!m) return;
    const re = findRegex(q);
    const text = q.useRegex && re ? this.text.slice(m.from, m.to).replace(new RegExp(re.source, re.flags.replace("g", "")), replacement) : replacement;
    this.view.dispatch({ changes: { from: m.from, to: m.to, insert: text }, userEvent: "input.replace" });
  }

  replaceAll(replacement: string, q: FindState): number {
    const re = findRegex(q);
    if (!re) return 0;
    const n = findAll(this.text, re).length;
    if (!n) return 0;
    const next = q.useRegex ? this.text.replace(re, replacement) : this.text.replace(re, () => replacement);
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: next }, userEvent: "input.replace" });
    return n;
  }

  /** 滚动比例（模式切换时对齐阅读位置，F3.6 的近似实现）。 */
  get scroller(): HTMLElement {
    return this.view.scrollDOM;
  }

  destroy(): void {
    this.view.destroy();
  }
}
