// 页面侧的设置副本：启动时从 Go 读取，settings-changed 事件时更新（技术方案 3.7 节）。
// 迁入插件通过 editor/extensions.ts 里的 getter 读取，不依赖 vmark 的 settingsStore。

export interface PageSettings {
  defaultMode: string;
  autosave: boolean;
  autosaveEffective: boolean;
  restoreWindow: boolean;
  language: string;
  imageRule: string;
  imageCustom: string;
  pasteRich: boolean;
  spellCheck: boolean;
  tabWidth: number;
  theme: string;
  fontScale: number;
  width: string;
  bodyFont: string;
  codeFont: string;
  networkImages: boolean;
  autoUpdate: boolean;
  statusBar: boolean;
}

export const DEFAULT_SETTINGS: PageSettings = {
  defaultMode: "preview",
  autosave: true,
  autosaveEffective: true,
  restoreWindow: true,
  language: "system",
  imageRule: "assets",
  imageCustom: "images",
  pasteRich: true,
  spellCheck: false,
  tabWidth: 4,
  theme: "system",
  fontScale: 1,
  width: "medium",
  bodyFont: "system",
  codeFont: "system",
  networkImages: true,
  autoUpdate: true,
  statusBar: true,
};

let current: PageSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<(s: PageSettings) => void>();

export function getSettings(): PageSettings {
  return current;
}

export function setSettings(next: Partial<PageSettings>): void {
  current = { ...current, ...next };
  listeners.forEach((fn) => fn(current));
}

export function onSettings(fn: (s: PageSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
