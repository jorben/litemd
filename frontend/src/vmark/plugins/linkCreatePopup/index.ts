// Migrated from xiaolai/vmark@01bf9f4 src/plugins/linkCreatePopup/index.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Barrel for the link-create popup plugin — re-exports its Tiptap extension
 * and loads the popup's stylesheet.
 *
 * @module plugins/linkCreatePopup
 */

export { linkCreatePopupExtension } from "./tiptap";
import "./link-create-popup.css";
