// Migrated from xiaolai/vmark@01bf9f4 src/plugins/inlineCodeBoundary/tiptap.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Inline Code Boundary Extension for Tiptap
 *
 * Wraps the ProseMirror plugin that fixes cursor behavior at the
 * left boundary of inline code marks.
 *
 * @module plugins/inlineCodeBoundary/tiptap
 */

import { Extension } from "@tiptap/core";
import { createInlineCodeBoundaryPlugin } from "./plugin";

/** Tiptap extension that improves cursor behavior at inline code mark boundaries. */
export const inlineCodeBoundaryExtension = Extension.create({
  name: "inlineCodeBoundary",

  addProseMirrorPlugins() {
    return [createInlineCodeBoundaryPlugin()];
  },
});
