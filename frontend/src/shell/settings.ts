// 设置窗口（PRD F10；视觉参照 docs/prototype.html 的设置窗口）。改动立即保存并广播给所有窗口；
// 自动保存开关重启后生效（D11），界面语言重启后生效。
import { Settings, Update, events, type View } from "../mygo";
import { getSettings, setSettings } from "../settings/store";
import { applyAppearance, FONT_STEPS, watchSystemTheme } from "./theme";
import { applyLanguage, t } from "./i18n";

type Tab = "general" | "edit" | "look" | "privacy" | "about";
const TABS: Array<[Tab, string]> = [["general", "通用"], ["edit", "编辑"], ["look", "外观"], ["privacy", "隐私"], ["about", "关于"]];
const isMac = /Mac/i.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function settingsPage(app: HTMLElement): Promise<void> {
  let view: View = await Settings.get();
  const version = await Settings.appVersion().catch(() => "");
  setSettings(view);
  applyLanguage();
  applyAppearance(getSettings());
  watchSystemTheme(getSettings);
  document.title = t("设置");
  app.className = "lm-settings";
  let tab: Tab = "general";
  let licOpen = false;

  async function save(patch: Partial<View>): Promise<void> {
    view = await Settings.set({ ...view, ...patch });
    setSettings(view);
    applyAppearance(getSettings());
    render();
  }
  events.settingsChanged.on((v) => {
    view = v;
    setSettings(v);
    applyAppearance(getSettings());
    render();
  });
  events.settingsTab.on((id) => {
    tab = (TABS.find(([k]) => k === id)?.[0] ?? "general") as Tab;
    render();
  });

  const sel = (k: keyof View, opts: Array<[string | number, string]>) =>
    `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(view[k]) === String(v) ? "selected" : ""}>${t(l)}</option>`).join("")}</select>`;
  const chk = (k: keyof View, label: string) => `<label class="chk"><input type="checkbox" data-k="${k}" ${view[k] ? "checked" : ""}> ${t(label)}</label>`;
  const radio = (k: keyof View, opts: Array<[string, string]>) =>
    opts.map(([v, l]) => `<label class="chk"><input type="radio" name="${k}" data-k="${k}" value="${v}" ${view[k] === v ? "checked" : ""}> ${t(l)}</label>`).join("");
  const row = (label: string, ctl: string, help = "", warn = false) =>
    `<div class="row"><span class="lbl">${t(label)}</span><div class="ctl">${ctl}${help ? `<span class="help${warn ? " warn" : ""}">${help}</span>` : ""}</div></div>`;
  const mod = isMac ? "⌘" : "Ctrl+";

  function body(): string {
    switch (tab) {
      case "general":
        return (
          row("打开文件时", sel("defaultMode", [["preview", "预览"], ["wysiwyg", "所见即所得"], ["source", "源码"], ["remember", "记住每个文件上次的模式"]]),
            t("出厂默认以预览打开，按 {mod}E 或双击进入编辑。", { mod })) +
          row("保存", chk("autosave", "自动保存已存在的文件"),
            view.autosave !== view.autosaveEffective ? t("重启 LiteMd 后生效。") : t("停止输入约 1 秒后写入磁盘；未命名文档关闭时询问。"),
            view.autosave !== view.autosaveEffective) +
          row("窗口", chk("restoreWindow", "按文件记住窗口大小和位置"), t("重启后生效。")) +
          `<div class="sep"></div>` +
          row("界面语言", sel("language", [["system", "跟随系统"], ["zh-Hans", "简体中文"], ["en", "English"]]), t("重启后生效。文档内容不会被翻译。"))
        );
      case "edit":
        return (
          row("粘贴的图片存到", radio("imageRule", [["assets", "./assets/"], ["named", "./<文件名>.assets/"], ["same", "与文件同一目录"], ["custom", "自定义相对路径"]]) +
            (view.imageRule === "custom" ? `<input type="text" data-k="imageCustom" value="${esc(view.imageCustom)}" aria-label="${t("自定义相对路径")}">` : ""),
            t("文件名为 image-年月日-时分秒.png，重名时自动加序号。")) +
          row("粘贴", chk("pasteRich", "把网页和富文本转换为 Markdown"), t("需要纯文本时用 {keys}。", { keys: isMac ? "⌥⇧⌘V" : "Ctrl+Alt+Shift+V" })) +
          row("拼写检查", chk("spellCheck", "检查拼写")) +
          row("代码块 Tab 宽度", sel("tabWidth", [[2, "2 个空格"], [4, "4 个空格"], [8, "8 个空格"]]))
        );
      case "look":
        return (
          row("主题", radio("theme", [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]])) +
          row("字号", `<div class="inline"><input type="range" min="0" max="${FONT_STEPS.length - 1}" step="1" data-k="fontScale" value="${Math.max(0, FONT_STEPS.indexOf(view.fontScale))}" aria-label="${t("字号")}"><span>${Math.round(16 * view.fontScale)} px</span></div>`,
            t("{mod}+ / {mod}- 调整，{mod}0 还原。", { mod })) +
          row("正文宽度", `<div class="lm-seg" role="radiogroup">${[["narrow", "窄"], ["medium", "中"], ["wide", "宽"], ["full", "铺满"]].map(([v, l]) => `<button role="radio" data-k="width" data-v="${v}" aria-checked="${view.width === v}">${t(l!)}</button>`).join("")}</div>`) +
          `<div class="sep"></div>` +
          row("正文字体", sel("bodyFont", [["system", "系统默认（苹方 / 微软雅黑）"], ["serif", "宋体"], ["kai", "楷体"]])) +
          row("代码字体", sel("codeFont", [["system", "系统等宽字体"], ["jb", "JetBrains Mono"], ["menlo", "Menlo"]]))
        );
      case "privacy":
        return (
          row("网络图片", chk("networkImages", "加载文档中的网络图片"), t("关闭后不加载网络图片。已打开的窗口需重新载入。")) +
          row("更新", chk("autoUpdate", "自动检查更新"), t("检查时不上传任何个人数据。")) +
          `<div class="sep"></div>` +
          row("数据", `<span class="help plain">${t("LiteMd 没有账号，不收集使用统计，也不会自动上报崩溃。")}</span>`)
        );
      case "about":
        return `<div class="about"><img src="/icon.png" alt="" class="about-icon"><h2>LiteMd</h2><p>${t("版本")} ${esc(version)}</p>
          <p>${t("一个文件，一个窗口，所见即所得，原文不走样。")}</p>
          <div class="inline center"><button class="lm-btn" data-act="update">${t("检查更新")}</button><button class="lm-btn" data-act="lic">${t("开源许可")}</button></div>
          <div class="lic" ${licOpen ? "" : "hidden"}>${t("LiteMd 以 Apache-2.0 许可发布。包含的第三方代码：vmark（ISC）、mygo（MIT）、Tiptap / ProseMirror / CodeMirror / KaTeX / Mermaid / unified（MIT）、DOMPurify（Apache-2.0 / MPL-2.0）、highlight.js、golang.org/x/text（BSD-3-Clause）、elkjs（EPL-2.0）。完整清单见 THIRD_PARTY.md。")}</div></div>`;
    }
  }

  function render(): void {
    app.innerHTML = `<nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${t(l)}</button>`).join("")}</nav>
      <div class="body" role="tabpanel">${body()}</div>`;
  }

  app.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const tb = el.closest<HTMLElement>("[data-tab]");
    if (tb) {
      tab = tb.dataset.tab as Tab;
      return render();
    }
    const b = el.closest<HTMLButtonElement>("button[data-k]");
    if (b) return void save({ [b.dataset.k!]: b.dataset.v } as Partial<View>);
    const act = el.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "lic") {
      licOpen = !licOpen;
      render();
    }
    if (act === "update") void Update.check();
  });
  app.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.k as keyof View | undefined;
    if (!k) return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") return void save({ [k]: el.checked } as Partial<View>);
    if (el instanceof HTMLInputElement && el.type === "range") return void save({ fontScale: FONT_STEPS[Number(el.value)] ?? 1 });
    if (k === "tabWidth") return void save({ tabWidth: Number(el.value) });
    void save({ [k]: el.value } as Partial<View>);
  });
  render();
  window.__litemd = { page: "settings", tab: () => tab };
}
