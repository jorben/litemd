// 迁入的 vmark 代码用 "@/..." 引用 vmark 的 src/（技术方案 4.1 节）；@tauri-apps/* 指向
// src/host/tauri/ 中的同名替代（技术方案 4.5 节），迁入代码不改。vite 与 vitest 共用。
import { resolve } from "node:path";

export const aliases: Record<string, string> = {
  "@": resolve(import.meta.dirname, "src/vmark"),
  "@tauri-apps/api/core": resolve(import.meta.dirname, "src/host/tauri/api-core.ts"),
  "@tauri-apps/api/path": resolve(import.meta.dirname, "src/host/tauri/api-path.ts"),
  "@tauri-apps/api/webviewWindow": resolve(import.meta.dirname, "src/host/tauri/api-webviewWindow.ts"),
  "@tauri-apps/plugin-dialog": resolve(import.meta.dirname, "src/host/tauri/plugin-dialog.ts"),
  "@tauri-apps/plugin-fs": resolve(import.meta.dirname, "src/host/tauri/plugin-fs.ts"),
  "@tauri-apps/plugin-clipboard-manager": resolve(import.meta.dirname, "src/host/tauri/plugin-clipboard-manager.ts"),
};
