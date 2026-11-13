// litemd: @tauri-apps/api/core 的替代（vite/tsconfig 别名），迁入代码不改。
import { host } from "..";
export function convertFileSrc(filePath: string, _protocol = "asset"): string {
  return host.mediaURL(filePath);
}
export async function invoke<T>(cmd: string): Promise<T> {
  throw new Error(`litemd: Tauri invoke(${cmd}) is not available`);
}
