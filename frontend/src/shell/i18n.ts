// 页面文案（PRD F12：简体中文与英文）。源文案即简体中文，英文见 en.ts；缺的条目回落到中文。
// 语言在页面取到设置后由 applyLanguage 锁定（设置里「界面语言」重启后生效，与 Go 侧 internal/l10n 同一规则）。
import vmarkI18n, { toVmarkLocale } from "@/i18n";
import { getSettings } from "../settings/store";
import { EN } from "./en";

let locked: boolean | null = null;

export function isEnglish(): boolean {
  if (locked !== null) return locked;
  const lang = getSettings().language;
  if (lang === "en") return true;
  if (lang === "zh-Hans") return false;
  return !/^zh/i.test(typeof navigator === "undefined" ? "zh" : navigator.language);
}

/** 页面取到设置后调用一次：锁定语言，同步 html lang 与迁入的 vmark 弹层文案。 */
export function applyLanguage(): void {
  locked = null;
  locked = isEnglish();
  document.documentElement.lang = locked ? "en" : "zh-CN";
  void vmarkI18n.changeLanguage(toVmarkLocale(locked ? "en" : "zh-Hans"));
}

/** 翻译文案；vars 填入 {name} 占位符。 */
export function t(s: string, vars?: Record<string, string | number>): string {
  const out = isEnglish() ? (EN[s] ?? s) : s;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}
