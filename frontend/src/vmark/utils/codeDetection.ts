// Migrated from xiaolai/vmark@01bf9f4 src/utils/codeDetection.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Code Detection Utilities
 *
 * Re-exports from the codeDetection module for backward compatibility.
 * The implementation is now split into smaller files under ./codeDetection/
 *
 * @module utils/codeDetection
 */

/* v8 ignore start -- @preserve reason: barrel re-export file with no executable logic */
export { shouldPasteAsCodeBlock } from "./codeDetection/index";
/* v8 ignore stop */
