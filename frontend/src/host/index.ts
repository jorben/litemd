// 平台适配层（技术方案 4.5 节）：迁入的 vmark 插件与 LiteMd 外壳通过这里调用 Go 侧服务，
// 单元测试中替换为假实现（setHost）。
import { Assets, Links, Shell, type ReadyInfo } from "../mygo";

export interface Host {
  /** Session.ready 的结果（页面启动后设置） */
  info: ReadyInfo | null;
  /** 文档引用的本地图片 → lmasset URL；网络图片、data:、blob: 原样返回 */
  mediaURL(src: string): string;
  openLink(href: string): Promise<boolean>;
  saveImage(data: Uint8Array): Promise<string>;
  importDropped(paths: string[]): Promise<string[]>;
  fetchImage(url: string): Promise<Blob>;
  readClipboardText(): Promise<string>;
  revealInFolder(ref: string): Promise<void>;
  /** 发给外壳的命令（与菜单命令同一套 ID） */
  command(id: string): void;
}

function toBase64(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 本地引用 → 协议 URL（与 Go 侧 assets.Resolve 对应：相对路径按文档目录，由 Go 解析）。 */
export function mediaURL(assetBase: string | undefined, src: string): string {
  if (!src || /^(https?:|data:|blob:)/i.test(src) || !assetBase) return src;
  return assetBase + encodeURIComponent(src);
}

const commandListeners = new Set<(id: string) => void>();
export function onHostCommand(fn: (id: string) => void): () => void {
  commandListeners.add(fn);
  return () => commandListeners.delete(fn);
}

export const realHost: Host = {
  info: null,
  mediaURL(src) {
    return mediaURL(this.info?.assetBase, src);
  },
  async openLink(href) {
    try {
      await Links.open(href);
      return true;
    } catch {
      return false;
    }
  },
  saveImage: (data) => Assets.saveImage(toBase64(data)),
  importDropped: (paths) => Assets.importDropped(paths),
  async fetchImage(url) {
    const img = await Assets.fetchImage(url);
    return new Blob([fromBase64(img.data).buffer as ArrayBuffer], { type: img.mime });
  },
  readClipboardText: () => Shell.readClipboardText(),
  revealInFolder: (ref) => Shell.revealInFolder(ref),
  command(id) {
    commandListeners.forEach((fn) => fn(id));
  },
};

/** 当前宿主；测试中用 setHost 换成假实现。 */
export let host: Host = realHost;
export function setHost(h: Host): void {
  host = h;
}
export { toBase64, fromBase64 };
