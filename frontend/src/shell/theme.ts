// 外观（PRD F9）：浅色 / 深色（默认跟随系统）、字号缩放、正文宽度、正文与代码字体。
// 主题令牌来自 vmark 的 white / night 两套（技术方案 4.2 节：迁入白色、夜间两套）。
import { applyTheme } from "@/theme/applyTheme";
import { night } from "@/theme/themes/night";
import { white } from "@/theme/themes/white";
import { computeCoreColorVars, computeModeColorVars } from "@/theme/legacyModeColors";
import { themeTokensToColors } from "@/theme/themeColorsAdapter";
import type { PageSettings } from "../settings/store";

const WIDTH: Record<string, string> = { narrow: "36em", medium: "44em", wide: "56em", full: "100%" };
const BODY_FONT: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  serif: '"Songti SC", "STSong", "SimSun", Georgia, serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", serif',
};
const CODE_FONT: Record<string, string> = {
  system: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  jb: '"JetBrains Mono", ui-monospace, monospace',
  menlo: "Menlo, ui-monospace, monospace",
};

const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function isDark(s: Pick<PageSettings, "theme">): boolean {
  return s.theme === "dark" || (s.theme === "system" && !!darkQuery?.matches);
}

export function applyAppearance(s: PageSettings): void {
  const root = document.documentElement;
  const dark = isDark(s);
  const tokens = dark ? night : white;
  applyTheme(tokens, root);
  // vmark 插件与 editor.css 读的是 --bg-color、--text-color 等旧名字，由这两步写出
  const colors = themeTokensToColors(tokens);
  for (const [k, v] of Object.entries({ ...computeCoreColorVars(colors), ...computeModeColorVars(colors, dark).vars })) root.style.setProperty(k, v);
  root.classList.toggle("dark-theme", dark);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  const base = 16 * s.fontScale;
  root.style.setProperty("--editor-font-size", `${base}px`);
  root.style.setProperty("--editor-font-size-mono", `${(base * 0.85).toFixed(1)}px`);
  root.style.setProperty("--editor-width", WIDTH[s.width] ?? WIDTH.medium!);
  root.style.setProperty("--font-sans", BODY_FONT[s.bodyFont] ?? BODY_FONT.system!);
  root.style.setProperty("--font-mono", CODE_FONT[s.codeFont] ?? CODE_FONT.system!);
  root.dataset.width = s.width;
}

/** 系统外观变化时（主题为「跟随系统」）重新应用。 */
export function watchSystemTheme(get: () => PageSettings): void {
  darkQuery?.addEventListener("change", () => applyAppearance(get()));
}

export const FONT_STEPS = [0.8, 0.875, 0.9375, 1, 1.0625, 1.125, 1.25, 1.375, 1.5];

export function stepFont(cur: number, dir: 1 | -1 | 0): number {
  if (dir === 0) return 1;
  let i = FONT_STEPS.indexOf(cur);
  if (i < 0) i = FONT_STEPS.indexOf(1);
  return FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, i + dir))]!;
}
