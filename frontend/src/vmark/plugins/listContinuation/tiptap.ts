// Migrated from xiaolai/vmark@01bf9f4 src/plugins/listContinuation/tiptap.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * List continuation — a Tiptap keymap extension that splits the list item on
 * Enter (unchecking a new task item) and lifts an empty item out of the list.
 *
 * @module plugins/listContinuation/tiptap
 */

import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import { liftListItem, splitListItem } from "@tiptap/pm/schema-list";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { NodeType } from "@tiptap/pm/model";
import { guardProseMirrorCommand } from "@/utils/imeGuard";
import { findListItemType, isPositionInsideListItem } from "@/plugins/shared/listHelpers";

function isListItemEmpty(state: EditorState, listItemType: NodeType): boolean {
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listItemType) {
      // litemd: 结构判空，避免仅含图片/行内公式等原子节点的列表项被误判为空项而抬出列表
      if (node.childCount !== 1) return false;
      const first = node.child(0);
      if (!first.isTextblock) return false;
      if (first.childCount === 0) return true;
      return first.childCount === 1 && first.firstChild!.isText && first.textContent.trim() === "";
    }
  }
  /* v8 ignore next -- @preserve cursor always inside a list item when this fn is called */
  return false;
}

/**
 * Check if the current list item is a task (has checked attribute).
 */
function isInTaskItem(state: EditorState, listItemType: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listItemType) {
      const checked = node.attrs.checked;
      return checked === true || checked === false;
    }
  }
  /* v8 ignore next -- @preserve cursor always inside a list item when this fn is called */
  return false;
}

/**
 * Custom splitListItem that resets checked to false for new task items.
 * When pressing Enter on a checked task, the new item should be unchecked.
 */
function splitTaskListItem(
  listItemType: NodeType,
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  // Create a wrapper dispatch that modifies the transaction
  const wrappedDispatch = dispatch
    ? (tr: Transaction) => {
        // After split, the cursor is in the new list item
        // Find and reset its checked attribute to false
        const { $from } = tr.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type === listItemType) {
            const checked = node.attrs.checked;
            /* v8 ignore next -- @preserve splitTaskListItem only called for task items, so checked is always bool */
            if (checked === true || checked === false) {
              const pos = $from.before(d);
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
            }
            break;
          }
        }
        dispatch(tr);
      }
    : undefined;

  return splitListItem(listItemType)(state, wrappedDispatch);
}

function handleListEnter(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  _view?: EditorView
): boolean {
  const listItemType = findListItemType(state.schema);
  if (!listItemType) return false;

  const { $from, $to } = state.selection;
  if (!isPositionInsideListItem($from, listItemType)) return false;

  // litemd: 列表项内部嵌套代码块、标题或引用/折叠块/表格等容器时，以及跨块选区时，交回对应处理
  if (!$from.sameParent($to)) return false;
  if ($from.depth < 2 || $from.node(-1).type !== listItemType) return false;
  if ($from.parent.type.spec.code || $from.parent.type.name === "heading") return false;

  if (state.selection.empty && isListItemEmpty(state, listItemType)) {
    return liftListItem(listItemType)(state, dispatch);
  }

  // Use custom split for task items to reset checked state
  if (isInTaskItem(state, listItemType)) {
    return splitTaskListItem(listItemType, state, dispatch);
  }

  return splitListItem(listItemType)(state, dispatch);
}

/** Tiptap extension that continues list items on Enter and removes empty ones. */
export const listContinuationExtension = Extension.create({
  name: "listContinuation",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      keymap({
        Enter: guardProseMirrorCommand(handleListEnter),
      }),
    ];
  },
});
