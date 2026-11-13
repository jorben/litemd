// litemd: @tauri-apps/api/webviewWindow 的替代。LiteMd 一个窗口一个文档。
export function getCurrentWebviewWindow(): { label: string } {
  return { label: "main" };
}
