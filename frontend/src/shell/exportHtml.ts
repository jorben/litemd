// 导出用的自包含 HTML（PRD F8；技术方案第 7 节）：取渲染后的文档 DOM，去掉编辑用的控件、
// 事件属性与脚本，内联样式（浅色版式）与图片、公式字体，并加一条不允许脚本的 CSP。
import { tokensToCssEntries } from "@/theme/applyTheme";
import { white } from "@/theme/themes/white";
import { computeCoreColorVars, computeModeColorVars } from "@/theme/legacyModeColors";
import { themeTokensToColors } from "@/theme/themeColorsAdapter";

export const EXPORT_CSP = "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:";
/**
 * 关闭「加载网络图片」时 PDF 与打印用的 CSP：不含 http(s)（技术方案 3.5、7 节的硬性保证）。
 * 与 internal/export 的 offlineCSP 保持一致。
 */
export const EXPORT_CSP_OFFLINE = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** 编辑界面才有的元素（代码块工具条、复制按钮、表格操作、拖拽手柄等）。 */
const UI_SELECTORS = [
  "button", "input:not([type=checkbox])", "select", "textarea", ".ProseMirror-widget", ".code-block-toolbar",
  ".code-lang-dropdown", "[data-export-skip]", ".table-scroll-indicator", ".mermaid-panzoom-controls", ".diagram-export-btn",
];

/** 清理文档 DOM 的副本（纯 DOM 操作，便于测试）。 */
export function cleanClone(root: HTMLElement): HTMLElement {
  const c = root.cloneNode(true) as HTMLElement;
  c.querySelectorAll(UI_SELECTORS.join(",")).forEach((el) => el.remove());
  c.querySelectorAll("script, iframe, object, embed, form, link, meta, base").forEach((el) => el.remove());
  c.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "contenteditable" || n === "draggable" || n === "spellcheck") el.removeAttribute(a.name);
      else if ((n === "href" || n === "src" || n === "xlink:href") && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el instanceof HTMLInputElement) el.disabled = true;
  });
  c.removeAttribute("contenteditable");
  return c;
}

/** 浅色版式的 CSS 变量（导出与 PDF 一律用浅色，F8.2）。 */
export function lightVars(): string {
  const colors = themeTokensToColors(white);
  const vars = [...tokensToCssEntries(white), ...Object.entries({ ...computeCoreColorVars(colors), ...computeModeColorVars(colors, false).vars })];
  return `:root{${vars.map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

async function toDataURL(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => res(null);
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

/** 当前页面的样式表文本；needFonts 时把 @font-face 的字体内联为 data:（KaTeX）。 */
async function collectCss(needFonts: boolean): Promise<string> {
  const out: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...rules]) {
      let text = rule.cssText;
      if (rule instanceof CSSFontFaceRule) {
        if (!needFonts) continue;
        const urls = [...text.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]!).filter((u) => !u.startsWith("data:"));
        for (const u of urls) {
          const d = await toDataURL(new URL(u, sheet.href ?? location.href).href);
          text = d ? text.replace(u, d) : text;
        }
      }
      out.push(text);
    }
  }
  return out.join("\n");
}

export interface ExportOptions {
  title: string;
  /** 本地图片内联为 data:（F8.1 默认）；false 时保留原始相对路径 */
  embedImages: boolean;
  /** 原始引用（img 的 data-src / alt 之外的 Markdown 地址），由调用方提供；本地图片返回非空 */
  originalSrc?: (img: HTMLImageElement) => string | null;
  /**
   * 不加载网络图片（关闭「加载网络图片」时的 PDF 与打印）：CSP 去掉 http(s)，网络图片换成占位（去掉地址，
   * 显示替代文字；没有替代文字时显示原地址）。用户单独点开过的图片是 blob:，照常内嵌。
   */
  blockRemoteImages?: boolean;
}

/** 生成自包含 HTML。 */
export async function buildExportHtml(root: HTMLElement, o: ExportOptions): Promise<string> {
  const c = cleanClone(root);
  for (const img of [...c.querySelectorAll("img")]) {
    const src = img.getAttribute("src") ?? "";
    if (o.blockRemoteImages && /^\s*https?:/i.test(src) && !o.originalSrc?.(img)) {
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      if (!img.getAttribute("alt")) img.setAttribute("alt", src.trim());
      continue;
    }
    if (!o.embedImages) {
      const orig = o.originalSrc?.(img);
      if (orig) img.setAttribute("src", orig);
      continue;
    }
    if (/^(data:|https?:)/i.test(src)) continue;
    const d = await toDataURL(src);
    if (d) img.setAttribute("src", d);
  }
  const css = await collectCss(!!c.querySelector(".katex"));
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return `<!doctype html>
<html lang="${document.documentElement.lang || "zh-CN"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${o.blockRemoteImages ? EXPORT_CSP_OFFLINE : EXPORT_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="LiteMd">
<title>${esc(o.title)}</title>
<style>${css}
${lightVars()}
html,body{background:#fff;color:#1a1a1a;height:auto;overflow:visible}
body{margin:0}
.lm-export{max-width:44em;margin:0 auto;padding:32px 24px 48px}
.lm-export .tiptap-editor{max-width:none}
@media print{.lm-export{max-width:none;padding:0}pre,table,figure,img,.mermaid-preview{break-inside:avoid}}
</style>
</head>
<body><div class="lm-export"><div class="tiptap-editor"><div class="ProseMirror">${c.innerHTML}</div></div></div></body>
</html>
`;
}
