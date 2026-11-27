// Migrated from xiaolai/vmark@01bf9f4 src/plugins/shared/headingIdAttr.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Heading ID attribute definition.
 *
 * Provides stable, unique IDs for headings to enable:
 * - Bookmark/anchor links (#heading-id)
 * - Fragment navigation
 * - Table of contents generation
 *
 * IDs are generated during MDAST → ProseMirror conversion and
 * rendered to DOM for fragment link support.
 *
 * @module plugins/shared/headingIdAttr
 */

/**
 * Heading ID attribute configuration for Tiptap.
 */
export const headingIdAttr = {
  id: {
    default: null as string | null,
    // litemd: 拆分标题时不复制 DOM id，避免文档中出现重复锚点
    keepOnSplit: false,
    parseHTML: (element: HTMLElement) => element.getAttribute("id"),
    renderHTML: (attributes: { id?: string | null }) =>
      attributes.id ? { id: attributes.id } : {},
  },
} as const;

/**
 * Interface for extensions that can be extended with additional attributes.
 */
interface ExtendableExtension {
  extend: (config: { addAttributes: () => Record<string, unknown> }) => ExtendableExtension;
}

/**
 * Extend a Tiptap node with heading ID attribute.
 *
 * @example
 * const HeadingWithId = withHeadingId(Heading);
 *
 * @param extension - The Tiptap extension to extend
 * @returns Extended extension with id attribute
 */
export function withHeadingId<T extends ExtendableExtension>(extension: T): T {
  return extension.extend({
    addAttributes() {
      return {
        ...(this as unknown as { parent?: () => Record<string, unknown> }).parent?.(),
        ...headingIdAttr,
      };
    },
  }) as T;
}
