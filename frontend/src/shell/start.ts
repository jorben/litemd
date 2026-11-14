// 启动窗口（PRD F1.12，D7；视觉参照 docs/prototype.html 的启动窗口）。
import { Settings, Start } from "../mygo";
import { setSettings, getSettings } from "../settings/store";
import { applyAppearance, watchSystemTheme } from "./theme";
import { applyLanguage, t } from "./i18n";

const isMac = /Mac/i.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);

export async function startPage(app: HTMLElement): Promise<void> {
  try {
    setSettings(await Settings.get());
    applyLanguage();
  } catch {
    /* 设置读取失败时用默认值 */
  }
  applyAppearance(getSettings());
  watchSystemTheme(getSettings);
  document.title = "LiteMd";
  app.className = "lm-start";
  const mod = isMac ? "⌘" : "Ctrl+";
  app.innerHTML = `
    <img class="lm-start-icon" src="/icon.png" alt="" aria-hidden="true">
    <h1>LiteMd</h1>
    <div class="lm-start-actions">
      <button class="lm-start-btn primary" data-act="new">${t("新建")}<kbd>${mod}N</kbd></button>
      <button class="lm-start-btn" data-act="open">${t("打开…")}<kbd>${mod}O</kbd></button>
    </div>
    <p class="lm-start-hint">${t("也可以把 .md 文件拖到这里")}</p>`;
  app.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "new") void Start.newDocument();
    if (act === "open") void Start.open();
  });
  window.__litemd = { page: "start" };
}
