// 启动窗口（PRD F1.12，D7；视觉参照 docs/prototype.html 的启动窗口）。
import { events, Settings, Start, type RecentFile } from "../mygo";
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
  // 在设置窗口里改了主题、字体等，启动窗口要马上跟着变
  events.settingsChanged.on((v) => {
    setSettings(v);
    applyAppearance(getSettings());
  });
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
    <p class="lm-start-hint">${t("也可以把 .md 文件拖到这里")}</p>
    <section class="lm-start-recent" aria-labelledby="lm-recent-h">
      <div class="lm-start-recent-head">
        <h2 id="lm-recent-h">${t("最近打开")}</h2>
        <button class="lm-start-clear" data-act="clear" hidden>${t("清除记录")}</button>
      </div>
      <ul class="lm-start-recent-list"></ul>
      <p class="lm-start-recent-empty" hidden>${t("还没有最近打开的文件")}</p>
    </section>`;
  const list = app.querySelector<HTMLUListElement>(".lm-start-recent-list")!;
  const refresh = () => void loadRecent(app, list);
  app.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    const act = el?.dataset.act;
    if (act === "new") void Start.newDocument();
    if (act === "open") void Start.open();
    if (act === "recent" && el?.dataset.path) void Start.openRecent(el.dataset.path).catch(refresh); // 文件刚被删掉等：刷新列表
    if (act === "clear") void Start.clearRecent().then(refresh, refresh);
  });
  // 在菜单「打开最近 › 清除菜单」或其他窗口里改变了记录，回到启动窗口时刷新
  window.addEventListener("focus", refresh);
  refresh();
  window.__litemd = { page: "start" };
}

/** 取最近打开列表（Go 侧已按最近访问时间倒序、最多 5 个）并渲染；文件名用 textContent，不拼 HTML。 */
async function loadRecent(app: HTMLElement, list: HTMLUListElement): Promise<void> {
  let files: RecentFile[] = [];
  try {
    files = await Start.recent();
  } catch {
    /* 读取失败按没有记录处理 */
  }
  renderRecent(app, list, files);
}

export function renderRecent(app: HTMLElement, list: HTMLUListElement, files: RecentFile[]): void {
  list.replaceChildren(
    ...files.map((f) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "lm-start-recent-item";
      btn.dataset.act = "recent";
      btn.dataset.path = f.path;
      btn.title = f.path;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = f.name;
      const dir = document.createElement("span");
      dir.className = "dir";
      dir.textContent = f.dir;
      btn.append(name, dir);
      li.append(btn);
      return li;
    }),
  );
  app.querySelector<HTMLElement>(".lm-start-clear")!.hidden = files.length === 0;
  app.querySelector<HTMLElement>(".lm-start-recent-empty")!.hidden = files.length > 0;
  list.hidden = files.length === 0;
}
