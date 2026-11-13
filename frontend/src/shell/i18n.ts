// 页面文案（PRD F12：简体中文与英文）。源文案即简体中文；英文表在 M2 补全，缺的条目回落到中文。
import { getSettings } from "../settings/store";

const EN: Record<string, string> = {};

export function setEnglish(table: Record<string, string>): void {
  Object.assign(EN, table);
}

function isEnglish(): boolean {
  const lang = getSettings().language;
  if (lang === "en") return true;
  if (lang === "zh-Hans") return false;
  return !/^zh/i.test(typeof navigator === "undefined" ? "zh" : navigator.language);
}

export function t(s: string): string {
  return isEnglish() ? (EN[s] ?? s) : s;
}
