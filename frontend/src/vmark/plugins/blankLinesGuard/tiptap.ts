// Migrated from xiaolai/vmark@01bf9f4 src/plugins/blankLinesGuard/tiptap.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Blank-lines guard Tiptap extension — registers the ProseMirror plugin that
 * clears blankLinesBefore on edit-created blocks (see blankLinesGuard.ts).
 * Always active and harmless: it only nulls a metadata attribute that is
 * default-null and only emitted when preserveBlankLines is on.
 *
 * @module plugins/blankLinesGuard/tiptap
 */
import { Extension } from "@tiptap/core";
import { blankLinesGuard } from "./blankLinesGuard";

export const blankLinesGuardExtension = Extension.create({
  name: "blankLinesGuard",
  addProseMirrorPlugins() {
    return [blankLinesGuard()];
  },
});
