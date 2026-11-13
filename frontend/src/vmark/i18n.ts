// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// vmark 原版按设置异步加载 10 种语言、依赖 settingsStore 与 react-i18next。LiteMd 只有简体中文与英文
// （PRD F12），在这里同步载入迁入插件用到的 editor / dialog / common 三个命名空间。
import i18n from "i18next";
import enCommon from "./locales/en/common.json";
import enDialog from "./locales/en/dialog.json";
import enEditor from "./locales/en/editor.json";
import zhCommon from "./locales/zh-CN/common.json";
import zhDialog from "./locales/zh-CN/dialog.json";
import zhEditor from "./locales/zh-CN/editor.json";

/** 界面语言：zh-Hans 映射到 vmark 的 zh-CN 语言包。 */
export function toVmarkLocale(lang: string): string {
  return /^zh/i.test(lang) ? "zh-CN" : "en";
}

void i18n.init({
  initAsync: false,
  lng: toVmarkLocale(typeof navigator === "undefined" ? "en" : navigator.language),
  fallbackLng: "en",
  ns: ["common", "editor", "dialog"],
  defaultNS: "common",
  resources: {
    en: { common: enCommon, dialog: enDialog, editor: enEditor },
    "zh-CN": { common: zhCommon, dialog: zhDialog, editor: zhEditor },
  },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
