// litemd: @tauri-apps/plugin-clipboard-manager 的替代。
import { host } from "..";
export function readText(): Promise<string> {
  return host.readClipboardText();
}
