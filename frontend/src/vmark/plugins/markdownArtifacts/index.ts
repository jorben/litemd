// Migrated from xiaolai/vmark@01bf9f4 src/plugins/markdownArtifacts/index.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Barrel for the markdown-artifacts plugins — re-exports the frontmatter,
 * inline and block HTML, link-definition and wiki-link extensions, and loads
 * their shared stylesheet.
 *
 * @module plugins/markdownArtifacts
 */

import "./markdown-artifacts.css";
export { frontmatterExtension } from "./frontmatter";
export { htmlInlineExtension } from "./htmlInline";
export { htmlBlockExtension } from "./htmlBlock";
export { linkDefinitionExtension } from "./linkDefinition";
export { wikiLinkExtension } from "./wikiLink";
