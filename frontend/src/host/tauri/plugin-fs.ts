// litemd: @tauri-apps/plugin-fs 的替代：只能写入保存对话框里选择的路径（NF5）。
import { Export } from "../../mygo";
import { toBase64 } from "..";
export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  await Export.writeChosen(path, toBase64(data));
}
