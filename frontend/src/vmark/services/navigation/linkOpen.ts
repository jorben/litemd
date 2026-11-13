// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// 链接的打开一律交给 Go 侧 Links.open（外部链接 → 系统浏览器；相对 .md → 新窗口；可执行文件拒绝）。
import { host } from "../../../host";

export type LinkKind = "fragment" | "external" | "filepath";

export function classifyHref(href: string): LinkKind {
  const h = href.trim();
  if (h.startsWith("#")) return "fragment";
  if (/^(https?|mailto):/i.test(h)) return "external";
  return "filepath";
}

export async function openExternalLink(href: string): Promise<boolean> {
  return host.openLink(href);
}

export async function openFilepathLink(href: string, _sourcePath: string | null): Promise<boolean> {
  return host.openLink(href);
}

export async function openLinkTarget(
  href: string,
  _sourcePath: string | null,
  navigateToFragment: ((targetId: string) => boolean) | null,
): Promise<void> {
  if (classifyHref(href) === "fragment") {
    navigateToFragment?.(decodeURIComponent(href.slice(1)));
    return;
  }
  await host.openLink(href);
}
