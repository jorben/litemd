// Migrated from xiaolai/vmark@01bf9f4 src/plugins/inactiveSelection/tiptap.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Purpose: Tiptap wrapper around the inactive-selection ProseMirror plugin.
 *   Imports the shared CSS so consumers don't need to remember to.
 *
 * @coordinates-with services/assembly/tiptapExtensions.ts — registers this extension
 * @module plugins/inactiveSelection/tiptap
 */
import { Extension } from "@tiptap/core";
import { inactiveSelectionPlugin } from "./inactiveSelectionPlugin";
import "./inactive-selection.css";

export const inactiveSelectionExtension = Extension.create({
  name: "inactiveSelection",

  addProseMirrorPlugins() {
    return [inactiveSelectionPlugin()];
  },
});
