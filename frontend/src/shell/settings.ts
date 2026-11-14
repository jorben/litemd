// 设置窗口（PRD F10；视觉参照 docs/prototype.html 的设置窗口，布局为分组卡片：左侧名称与说明，右侧控件）。
// 改动立即保存并广播给所有窗口；自动保存开关重启后生效（D11），界面语言、按文件记住窗口重启后生效。
import { Settings, Update, events, type Status, type View } from "../mygo";
import { getSettings, setSettings } from "../settings/store";
import { applyAppearance, FONT_STEPS, watchSystemTheme } from "./theme";
import { applyLanguage, t } from "./i18n";

type Tab = "general" | "edit" | "look" | "privacy" | "about";
const TABS: Array<[Tab, string]> = [["general", "通用"], ["edit", "编辑"], ["look", "外观"], ["privacy", "隐私"], ["about", "关于"]];
const isMac = /Mac/i.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// 图标：24×24 线框（与 doc.ts 的 .lm-i 同一画法）
const ICON: Record<string, string> = {
  general: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z"/>',
  look: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.12a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/><circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/>',
  privacy: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  about: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  check: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
};
const svg = (name: string, cls = "lm-i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

export async function settingsPage(app: HTMLElement): Promise<void> {
  let view: View = await Settings.get();
  const version = await Settings.appVersion().catch(() => "");
  setSettings(view);
  applyLanguage();
  applyAppearance(getSettings());
  watchSystemTheme(getSettings);
  document.title = t("设置");
  app.className = "lm-settings";
  document.documentElement.classList.add("lm-settings-root");
  // 打开窗口时的值：改动这些项后在说明处提示重启（autosave 由 Go 给出本次运行实际生效的值）
  const boot = { language: view.language, restoreWindow: view.restoreWindow };
  let tab: Tab = "general";
  let licOpen = false;
  // 第三方许可全文（make notices 生成，随前端打包）。展开时用同源 fetch 读取并内嵌显示：
  // 窗口只能导航到前端自身且不开新窗口（links.Harden），直接打开文件会离开设置页
  let notices: { state: "idle" | "loading" | "failed" } | { state: "ready"; text: string } = { state: "idle" };
  let update: Status = { state: "idle", version: "", message: "" };

  async function save(patch: Partial<View>): Promise<void> {
    try {
      view = await Settings.set({ ...view, ...patch });
      setSettings(view);
      applyAppearance(getSettings());
    } catch {
      // 保存失败：界面回到已保存的值
    }
    render();
  }
  events.settingsChanged.on((v) => {
    view = v;
    setSettings(v);
    applyAppearance(getSettings());
    render();
  });
  events.settingsTab.on((id) => go((TABS.find(([k]) => k === id)?.[0] ?? "general") as Tab));
  const onUpdate = (s: Status | null) => {
    if (!s) return;
    update = s;
    if (tab === "about") render();
  };
  events.updateStatus.on(onUpdate);
  void Update.status().then(onUpdate).catch(() => {});

  const mod = isMac ? "⌘" : "Ctrl+";

  // ---- 控件 ----
  const id = (k: string) => `s-${k}`;
  const sel = (k: keyof View, opts: Array<[string | number, string]>) =>
    `<span class="sel"><select id="${id(k)}" data-k="${k}" aria-describedby="h-${k}">${opts.map(([v, l]) => `<option value="${v}"${String(view[k]) === String(v) ? " selected" : ""}>${esc(t(l))}</option>`).join("")}</select>${svg("chevron")}</span>`;
  const sw = (k: keyof View) =>
    `<input type="checkbox" role="switch" class="sw" id="${id(k)}" data-k="${k}" aria-describedby="h-${k}"${view[k] ? " checked" : ""}>`;
  const radios = (k: keyof View, cls: string, opts: Array<[string, string]>, inner: (v: string, l: string) => string) =>
    `<div class="${cls}" role="radiogroup" aria-labelledby="l-${k}">${opts.map(([v, l]) => {
      const on = String(view[k]) === v;
      return `<button type="button" role="radio" data-k="${k}" data-v="${v}" aria-checked="${on}" tabindex="${on ? 0 : -1}">${inner(v, t(l))}</button>`;
    }).join("")}</div>`;

  /** 一行：左侧名称（label 指向控件）与说明，右侧控件。warn 时说明以提示色显示。 */
  const row = (k: string, label: string, ctl: string, help = "", warn = false, labelled = true) =>
    `<div class="row">
      <div class="txt">${labelled ? `<label class="lbl" id="l-${k}" for="${id(k)}">${t(label)}</label>` : `<span class="lbl" id="l-${k}">${t(label)}</span>`}
        ${help ? `<p class="help${warn ? " warn" : ""}" id="h-${k}">${warn ? svg("alert") : ""}${help}</p>` : ""}</div>
      <div class="ctl">${ctl}</div>
    </div>`;
  const group = (rows: string) => `<section class="group">${rows}</section>`;
  const restart = t("重启后生效。");

  function body(): string {
    switch (tab) {
      case "general": {
        const autoWarn = view.autosave !== view.autosaveEffective;
        return (
          group(row("language", "界面语言", sel("language", [["system", "跟随系统"], ["zh-Hans", "简体中文"], ["en", "English"]]),
            t("重启后生效。文档内容不会被翻译。"), view.language !== boot.language)) +
          group(row("defaultMode", "打开文件时", sel("defaultMode", [["preview", "预览"], ["wysiwyg", "所见即所得"], ["source", "源码"], ["remember", "记住每个文件上次的模式"]]),
            t("出厂默认以预览打开，按 {mod}E 或双击进入编辑。", { mod }))) +
          group(
            row("autosave", "自动保存已存在的文件", sw("autosave"),
              autoWarn ? t("重启 LiteMd 后生效。") : t("停止输入约 1 秒后写入磁盘；未命名文档关闭时询问。"), autoWarn) +
            row("restoreWindow", "按文件记住窗口大小和位置", sw("restoreWindow"), restart, view.restoreWindow !== boot.restoreWindow),
          )
        );
      }
      case "edit":
        return (
          group(
            row("imageRule", "粘贴的图片存到", sel("imageRule", [["assets", "./assets/"], ["named", "./<文件名>.assets/"], ["same", "与文件同一目录"], ["custom", "自定义相对路径"]]),
              t("文件名为 image-年月日-时分秒.png，重名时自动加序号。")) +
            (view.imageRule === "custom"
              ? row("imageCustom", "自定义相对路径", `<input type="text" class="txt-in" id="${id("imageCustom")}" data-k="imageCustom" value="${esc(view.imageCustom)}" spellcheck="false" autocomplete="off">`)
              : ""),
          ) +
          group(
            row("tabWidth", "代码块 Tab 宽度", sel("tabWidth", [[2, "2 个空格"], [4, "4 个空格"], [8, "8 个空格"]])) +
            row("pasteRich", "把网页和富文本转换为 Markdown", sw("pasteRich"), t("需要纯文本时用 {keys}。", { keys: isMac ? "⌥⇧⌘V" : "Ctrl+Alt+Shift+V" })) +
            row("spellCheck", "检查拼写", sw("spellCheck")),
          )
        );
      case "look": {
        const fi = Math.max(0, FONT_STEPS.indexOf(view.fontScale));
        return (
          group(row("theme", "主题", radios("theme", "themes", [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]],
            (v, l) => `<span class="thumb ${v}" aria-hidden="true">${v === "system" ? `<span class="half light"><i></i></span><span class="half dark"><i></i></span>` : `<i></i>`}</span><span class="cap">${l}</span>`), "", false, false)) +
          group(
            row("bodyFont", "正文字体", sel("bodyFont", [["system", "系统默认"], ["serif", "宋体"], ["kai", "楷体"]])) +
            row("codeFont", "代码字体", sel("codeFont", [["system", "系统等宽字体"], ["jb", "JetBrains Mono"], ["menlo", "Menlo"]])),
          ) +
          group(
            row("fontScale", "字号",
              `<div class="slider"><span class="a sm" aria-hidden="true">A</span><input type="range" id="${id("fontScale")}" min="0" max="${FONT_STEPS.length - 1}" step="1" data-k="fontScale" value="${fi}" aria-describedby="h-fontScale" aria-valuetext="${Math.round(16 * view.fontScale)} px"><span class="a lg" aria-hidden="true">A</span><output for="${id("fontScale")}">${Math.round(16 * view.fontScale)} px</output></div>`,
              t("{mod}+ / {mod}- 调整，{mod}0 还原。", { mod })) +
            row("width", "正文宽度", radios("width", "lm-seg", [["narrow", "窄"], ["medium", "中"], ["wide", "宽"], ["full", "铺满"]], (_v, l) => l), "", false, false),
          )
        );
      }
      case "privacy":
        return (
          group(
            row("networkImages", "加载文档中的网络图片", sw("networkImages"), t("关闭后不加载网络图片。已打开的窗口需重新载入。")) +
            row("autoUpdate", "自动检查更新", sw("autoUpdate"), t("检查时不上传任何个人数据。")),
          ) +
          `<div class="note">${svg("check")}<p>${t("LiteMd 没有账号，不收集使用统计，也不会自动上报崩溃。")}</p></div>`
        );
      case "about": {
        const busy = update.state === "checking" || update.state === "downloading";
        const ready = update.state === "ready";
        const btn = ready
          ? `<button class="lm-btn primary" data-act="restart">${t("立即重启")}</button>`
          : `<button class="lm-btn" data-act="update"${busy ? " disabled" : ""}>${busy ? `<span class="spin" aria-hidden="true"></span>` : ""}${t(update.state === "checking" ? "正在检查…" : update.state === "downloading" ? "正在下载…" : "检查更新")}</button>`;
        return `<div class="about">
          <img src="/icon.png" alt="" class="about-icon">
          <h2>LiteMd</h2>
          <p class="ver">${t("版本")} ${esc(version)}</p>
          <p class="tagline">${t("一个文件，一个窗口，所见即所得，原文不走样。")}</p>
          <p class="upd" role="status">${ready ? esc(t("LiteMd {v} 已下载", { v: update.version })) : ""}</p>
          <div class="acts">${btn}<button class="lm-btn" data-act="lic" aria-expanded="${licOpen}" aria-controls="lm-lic">${t("开源许可")}</button></div>
          <div class="lic" id="lm-lic"${licOpen ? "" : " hidden"}><p>${t("LiteMd 以 Apache-2.0 许可发布。包含的第三方代码：vmark（ISC）、mygo（MIT）、Tiptap / ProseMirror / CodeMirror / KaTeX / Mermaid / unified（MIT）、DOMPurify（Apache-2.0 / MPL-2.0）、highlight.js、golang.org/x/text、golang.org/x/net（BSD-3-Clause）、purego（Apache-2.0）、elkjs（EPL-2.0）。各组件的许可全文如下。")}</p>${
            !licOpen ? ""
            : notices.state === "ready" ? `<pre class="notices" tabindex="0" aria-label="THIRD_PARTY_NOTICES.txt">${esc(notices.text)}</pre>`
            : notices.state === "failed" ? `<p class="notices-err">${t("许可全文载入失败。")}</p>`
            : ""}</div>
        </div>`;
      }
    }
  }

  async function loadNotices(): Promise<void> {
    notices = { state: "loading" };
    try {
      const r = await fetch("/THIRD_PARTY_NOTICES.txt");
      notices = r.ok ? { state: "ready", text: await r.text() } : { state: "failed" };
    } catch {
      notices = { state: "failed" };
    }
    render();
  }

  // 只更新变化的部分（不整块替换 innerHTML），保留键盘焦点、滚动位置和开关的过渡动画
  const tpl = document.createElement("template");
  function render(): void {
    tpl.innerHTML = `<nav class="tabs" role="tablist" aria-label="${t("设置分组")}">${TABS.map(([k, l]) =>
      `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-selected="${tab === k}" aria-controls="lm-panel" tabindex="${tab === k ? 0 : -1}">${svg(k, "ti")}<span>${t(l)}</span></button>`).join("")}</nav>
      <div class="body" id="lm-panel" role="tabpanel" aria-labelledby="tab-${tab}" data-tab-panel="${tab}">${body()}</div>`;
    const [nav, panel] = [...tpl.content.children] as [HTMLElement, HTMLElement];
    const [curNav, curPanel] = [...app.children] as HTMLElement[];
    if (!curNav || !curPanel) return app.replaceChildren(nav, panel);
    patchElement(curNav, nav);
    // 换了分组时整块替换内容区：不让焦点留在新分组同一位置的另一个控件上，滚动位置也回到顶部
    if (curPanel.dataset.tabPanel !== tab) curPanel.replaceWith(panel);
    else patchElement(curPanel, panel);
  }
  function go(next: Tab, focus = false): void {
    if (next !== tab) {
      tab = next;
      render();
    }
    if (focus) app.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  app.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const tb = el.closest<HTMLElement>("[data-tab]");
    if (tb) return go(tb.dataset.tab as Tab);
    const b = el.closest<HTMLButtonElement>("button[data-k]");
    if (b) return void save({ [b.dataset.k!]: b.dataset.v } as Partial<View>);
    const act = el.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "lic") {
      licOpen = !licOpen;
      if (licOpen && (notices.state === "idle" || notices.state === "failed")) void loadNotices();
      render();
    }
    if (act === "update") {
      update = { ...update, state: "checking" };
      render();
      void Update.check().catch(() => onUpdate({ state: "idle", version: "", message: "" }));
    }
    if (act === "restart") void Update.restart();
  });
  app.addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement;
    const role = el.getAttribute("role");
    if (role !== "tab" && role !== "radio") return;
    const items = [...(el.parentElement?.children ?? [])] as HTMLElement[];
    const i = items.indexOf(el);
    const n = items.length;
    const j = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: n - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const next = items[(j + n) % n]!;
    if (role === "tab") return go(next.dataset.tab as Tab, true);
    next.focus();
    void save({ [next.dataset.k!]: next.dataset.v } as Partial<View>);
  });
  // 拖动字号滑块时即时显示数值，松开后保存
  app.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== "range") return;
    const px = `${Math.round(16 * (FONT_STEPS[Number(el.value)] ?? 1))} px`;
    el.setAttribute("aria-valuetext", px);
    const out = el.parentElement?.querySelector("output");
    if (out) out.textContent = px;
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

/** 把 next 的子节点同步到 cur：同类节点就地更新属性与表单状态，其余替换。 */
function patchChildren(cur: ParentNode, next: ParentNode): void {
  const a = [...cur.childNodes];
  const b = [...next.childNodes];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (!x) cur.appendChild(y!);
    else if (!y) x.remove();
    else if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) x.replaceWith(y);
    else if (x instanceof Element) patchElement(x, y as Element);
    else if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
  }
}

function patchElement(x: Element, y: Element): void {
  for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
  for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
  patchChildren(x, y);
  if (x instanceof HTMLInputElement) {
    if (x.type === "checkbox" || x.type === "radio") x.checked = y.hasAttribute("checked");
    else if (x !== document.activeElement || x.type === "range") x.value = y.getAttribute("value") ?? "";
  } else if (x instanceof HTMLSelectElement) {
    x.value = (y as HTMLSelectElement).querySelector("option[selected]")?.getAttribute("value") ?? x.value;
  }
}
