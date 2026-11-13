// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// 本地媒体由 Go 侧 lmasset 协议按窗口令牌提供（技术方案 3.5 节）。
import { host } from "../../../host";

export function resolveMediaSrc(src: string, _logPrefix = "[Media]", _ownerTabId?: string): Promise<string> {
  return Promise.resolve(host.mediaURL(src));
}
export function withMediaReloadKey(assetUrl: string, key: number): string {
  return assetUrl + (assetUrl.includes("?") ? "&" : "?") + "v=" + key;
}
export function getActiveTabIdForCurrentWindow(): string | null {
  return null;
}
