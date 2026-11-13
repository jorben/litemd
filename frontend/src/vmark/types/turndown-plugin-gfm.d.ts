// Migrated from xiaolai/vmark@01bf9f4 src/types/turndown-plugin-gfm.d.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
declare module "@joplin/turndown-plugin-gfm" {
  import TurndownService from "turndown";
  type TurndownPlugin = (service: TurndownService) => void;
  export const gfm: TurndownPlugin;
  export const tables: TurndownPlugin;
  export const strikethrough: TurndownPlugin;
  export const taskListItems: TurndownPlugin;
  export const highlightedCodeBlock: TurndownPlugin;
}
