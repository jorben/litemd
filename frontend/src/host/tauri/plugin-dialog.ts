// litemd: @tauri-apps/plugin-dialog 的替代：Go 弹保存对话框并登记路径（internal/export）。
import { Export } from "../../mygo";
export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  title?: string;
}
export async function save(opts: SaveDialogOptions = {}): Promise<string | null> {
  const p = await Export.choosePath(opts.defaultPath ?? "", opts.filters ?? []);
  return p || null;
}
