// 文档窗口外壳（技术方案 8.1–8.3 节；视觉参照 docs/prototype.html）。
//   - 四种模式：预览 / 所见即所得（同一个 Tiptap 实例，只切 editable）、源码（CodeMirror）、
//     分屏（CodeMirror + 只读 Tiptap 预览，防抖整篇重绘）；
//   - 内容同步（第 5 节）：PageSync 只对用户编辑计数，失焦、切换模式、收齐时立即推送；
//   - 状态栏、提示条、查找替换、大纲、菜单命令、快捷键、外观设置、按文件状态。
import { onDocumentReload, onDocumentState, onFileDrop, type DocumentState } from "mygo-runtime";
import { FileState, Session, Settings, Assets, events, type ReadyInfo } from "../mygo";
import { WysiwygEditor } from "../editor/wysiwyg";
import { SourceEditor } from "../editor/source";
import { PageSync } from "../sync/pageSync";
import { host, onHostCommand, realHost, toBase64 } from "../host";
import { getSettings, setSettings, type PageSettings } from "../settings/store";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { MATH_BLOCK_LANGUAGE } from "@/utils/markdownPipeline/mdastBlockConverters";
import { applyAppearance, stepFont, watchSystemTheme } from "./theme";
import { bindFindToVmark, findState, onFind, replaceAllInWysiwyg, replaceCurrentInWysiwyg, setFind, stepFind } from "./find";
import { commandForKey, Deduper } from "./keys";
import { countWords, sourceHeadings } from "./text";
import { t } from "./i18n";

export type Mode = "preview" | "wysiwyg" | "source" | "split";
const MODES: Mode[] = ["preview", "wysiwyg", "source", "split"];
const LARGE = 5 * 1024 * 1024; // NF2：超过 5 MB 默认源码
const HUGE = 20 * 1024 * 1024; // 超过 20 MB 只读源码
const isMac = /Mac/i.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);

const ICON = {
  preview: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  wysiwyg: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  source: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  swap: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
};
const svg = (p: string) => `<svg class="lm-i" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface BannerAction {
  label: string;
  primary?: boolean;
  run: () => unknown;
}
interface Banner {
  key: string;
  kind: "info" | "warn" | "danger";
  title: string;
  detail?: string;
  actions: BannerAction[];
  closable?: boolean;
}

export async function docPage(app: HTMLElement): Promise<void> {
  const [info, content, view, fsState, initialState] = await Promise.all([
    Session.ready(),
    Session.content(),
    Settings.get(),
    FileState.get().catch(() => ({ mode: "", outline: false, scroll: 0 })),
    Session.state().catch(() => null),
  ]);
  realHost.info = info;
  setSettings(view);
  applyAppearance(getSettings());
  watchSystemTheme(getSettings);
  applyNetworkImagePolicy(getSettings());
  bindFindToVmark();

  const readOnly = info.readOnly || info.lossy;
  const huge = info.size > HUGE;
  let text = content.text; // Go 侧已知的最新 Markdown（推送后更新）
  let mode: Mode = initialMode(info, getSettings(), fsState.mode as Mode | "");
  let lastEdit: Mode = mode === "preview" ? (info.readOnly ? "source" : "wysiwyg") : mode;
  let outlineOn = !!fsState.outline;
  let swapped = false;
  let state: DocumentState | null = initialState as DocumentState | null;
  const banners: Banner[] = [];

  app.className = "lm-doc";
  app.innerHTML = `
    <div class="lm-find" role="search" hidden></div>
    <div class="lm-banners" role="region" aria-label="${t("提示")}"></div>
    <div class="lm-body">
      <div class="lm-main" data-mode="${mode}">
        <div class="editor-container lm-rich"><div class="editor-content"><div class="tiptap-editor"></div></div></div>
        <div class="lm-divider"></div>
        <div class="lm-source"></div>
      </div>
      <aside class="lm-outline" aria-label="${t("大纲")}" hidden><header>${t("大纲")}<button class="lm-icon" data-act="outline" aria-label="${t("收起大纲")}">${svg(ICON.x)}</button></header><nav></nav></aside>
    </div>
    <footer class="lm-status"></footer>`;
  const $ = <T extends HTMLElement>(s: string) => app.querySelector<T>(s)!;
  const main = $(".lm-main");
  const richScroll = $(".lm-rich .editor-content");
  const sourceHost = $(".lm-source");

  // ---- 编辑器 ----
  const sync = new PageSync({ client: Session, getText: () => currentText() });
  sync.reset(content.seq);

  const rich = new WysiwygEditor({
    element: $(".tiptap-editor"),
    text,
    editable: mode === "wysiwyg",
    onUserEdit: () => sync.edit(),
    onTransaction: () => scheduleOutline(),
  });
  let source: SourceEditor | null = null;
  let sourceEntry = "";
  let splitPreview: WysiwygEditor | null = null;

  function currentText(): string {
    if (source && (mode === "source" || mode === "split")) text = source.text;
    else if (mode === "wysiwyg" || rich.dirty) {
      text = rich.serialize();
      if (rich.lastMode === "full") showBanner(reformatBanner());
    }
    scheduleStatus();
    return text;
  }

  function createSource(t0: string): SourceEditor {
    sourceHost.innerHTML = "";
    const ed = new SourceEditor({
      parent: sourceHost,
      text: t0,
      readOnly: readOnly || huge,
      tabSize: getSettings().tabWidth,
      onUserEdit: () => sync.edit(),
      onChange: () => {
        scheduleStatus();
        scheduleOutline();
        if (mode === "split") scheduleSplit();
        if (findState().isOpen) runSourceFind();
      },
    });
    ed.scroller.addEventListener("scroll", () => {
      syncSplitScroll(ed.scroller);
      markOutline();
      saveFileState();
    });
    return ed;
  }

  // ---- 模式（技术方案 6.3「模式切换与基线」、8.2） ----
  function allowed(m: Mode): boolean {
    if (info.lossy) return m === "preview";
    if (huge) return m === "source";
    if (info.readOnly) return m === "preview" || m === "source";
    return true;
  }

  async function setMode(next: Mode, initial = false): Promise<void> {
    if (!allowed(next) || (next === mode && !initial)) return;
    const ratio = initial ? fsState.scroll || 0 : scrollRatio();
    if (!initial) await sync.push(); // 离开前推送未同步的编辑（5.2）
    const prev = mode;
    if (!initial && (prev === "source" || prev === "split") && source) {
      const t1 = source.text;
      if (t1 !== sourceEntry) rich.load(t1); // 文本变了才重新解析并重建基线
      if (!(next === "source" || next === "split")) {
        source.destroy();
        source = null;
      }
    }
    if (splitPreview && next !== "split") {
      splitPreview.destroy();
      splitPreview = null;
    }
    mode = next;
    if (next !== "preview") lastEdit = next;
    main.dataset.mode = next;
    main.classList.toggle("lm-swapped", swapped);
    if (next === "preview" || next === "wysiwyg") rich.setEditable(next === "wysiwyg");
    if (next === "source" || next === "split") {
      if (!source) {
        sourceEntry = text;
        source = createSource(text);
      } else sourceEntry = source.text;
    }
    if (next === "split") renderSplit();
    renderStatus();
    renderFind();
    renderOutline();
    reportMenuState();
    saveFileState();
    requestAnimationFrame(() => {
      setScrollRatio(ratio);
      if (!initial) {
        if (next === "wysiwyg") rich.editor.commands.focus();
        else if (source && (next === "source" || next === "split")) source.focus();
      }
    });
  }

  function activeScroller(): HTMLElement | null {
    if (mode === "source" || mode === "split") return source?.scroller ?? null;
    return richScroll;
  }
  function scrollRatio(): number {
    const s = activeScroller();
    return s ? s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight) : 0;
  }
  function setScrollRatio(r: number): void {
    const s = activeScroller();
    if (s) s.scrollTop = r * (s.scrollHeight - s.clientHeight);
  }

  // 分屏：右侧只读预览（F3.4），防抖整篇重绘，比例同步滚动
  let splitTimer = 0;
  function scheduleSplit(): void {
    clearTimeout(splitTimer);
    splitTimer = window.setTimeout(renderSplit, (source?.text.length ?? 0) > 200_000 ? 500 : 200);
  }
  function renderSplit(): void {
    if (mode !== "split" || !source) return;
    if (!splitPreview) {
      // 分屏的预览放在 rich 窗格里：隐藏主 Tiptap，放一个只读实例
      const el = document.createElement("div");
      el.className = "tiptap-editor lm-split-preview";
      richScroll.appendChild(el);
      splitPreview = new WysiwygEditor({ element: el, text: source.text, editable: false });
    } else splitPreview.load(source.text);
  }
  let scrollLock = false;
  function syncSplitScroll(from: HTMLElement): void {
    if (mode !== "split" || scrollLock) return;
    const to = from === richScroll ? source?.scroller : richScroll;
    if (!to) return;
    scrollLock = true;
    const r = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    to.scrollTop = r * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => (scrollLock = false));
  }
  richScroll.addEventListener("scroll", () => {
    syncSplitScroll(richScroll);
    markOutline();
    saveFileState();
  });

  // ---- 状态栏（F9.5、F5.10） ----
  const status = $(".lm-status");
  let statusTimer = 0;
  let saveFlash = "";
  function scheduleStatus(): void {
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(renderStatus, 300);
  }
  function saveLabel(): [string, string] {
    if (!state) return ["", ""];
    if (state.conflict) return [t("冲突"), "danger"];
    if (state.deleted) return [t("已删除"), "danger"];
    if (saveFlash) return [saveFlash, "saved"];
    if (state.edited || sync.hasUnpushed) return [view.autosaveEffective && state.path && !state.readOnly ? t("编辑中…") : t("未保存"), "dirty"];
    return state.path ? [t("已保存"), "saved"] : [t("未保存"), ""];
  }
  function renderStatus(): void {
    status.hidden = !getSettings().statusBar;
    const c = countWords(mode === "source" || mode === "split" ? (source?.text ?? text) : text);
    const [label, cls] = saveLabel();
    const seg = MODES.map((m) => {
      const name = { preview: t("预览"), wysiwyg: t("所见即所得"), source: t("源码"), split: t("分屏") }[m];
      const k = isMac ? `⌘${MODES.indexOf(m) + 1}` : `Ctrl+${MODES.indexOf(m) + 1}`;
      return `<button role="radio" aria-checked="${mode === m}" data-mode="${m}" ${allowed(m) ? "" : "disabled"} title="${name}（${k}）">${svg(ICON[m])}<span>${name}</span></button>`;
    }).join("");
    const enc = info.lossy ? `<span class="lm-tag warn">${info.encoding.toUpperCase()} · ${t("只读")}</span>` : readOnly || huge ? `<span class="lm-tag warn">${t("只读")}</span>` : `<span class="lm-sb">UTF-8${info.eol === "\r\n" ? " · CRLF" : ""}</span>`;
    status.innerHTML = `<div class="lm-seg" role="radiogroup" aria-label="${t("查看模式")}">${seg}</div>
      ${mode === "split" ? `<button class="lm-icon" data-act="swap" title="${t("交换左右")}" aria-label="${t("交换左右")}">${svg(ICON.swap)}</button>` : ""}
      <span class="lm-gap"></span>
      <span class="lm-sb lm-save ${cls}" role="status"><span class="dot"></span>${label}</span>
      <span class="lm-sb" title="${c.chars.toLocaleString()} ${t("个字符")} · ${t("约")} ${c.minutes} ${t("分钟读完")}">${c.words.toLocaleString()} ${t("字")}</span>
      ${enc}`;
  }

  // ---- 提示条（技术方案 8.3） ----
  const bannerBox = $(".lm-banners");
  function showBanner(b: Banner): void {
    const i = banners.findIndex((x) => x.key === b.key);
    if (i >= 0) banners[i] = b;
    else banners.push(b);
    renderBanners();
  }
  function hideBanner(key: string): void {
    const i = banners.findIndex((x) => x.key === key);
    if (i >= 0) banners.splice(i, 1);
    renderBanners();
  }
  function renderBanners(): void {
    bannerBox.innerHTML = "";
    for (const b of banners) {
      const el = document.createElement("div");
      el.className = `lm-banner ${b.kind}`;
      el.setAttribute("role", b.kind === "danger" ? "alert" : "status");
      el.innerHTML = `${svg(b.kind === "info" ? ICON.info : ICON.warn)}<div class="msg"><b>${esc(b.title)}</b>${b.detail ? `<small>${esc(b.detail)}</small>` : ""}</div><div class="acts"></div>`;
      for (const a of b.actions) {
        const btn = document.createElement("button");
        btn.className = "lm-btn" + (a.primary ? " primary" : "");
        btn.textContent = a.label;
        btn.onclick = async () => {
          hideBanner(b.key);
          await a.run();
        };
        el.querySelector(".acts")!.appendChild(btn);
      }
      if (b.closable) {
        const x = document.createElement("button");
        x.className = "lm-icon";
        x.setAttribute("aria-label", t("关闭提示"));
        x.innerHTML = svg(ICON.x);
        x.onclick = () => hideBanner(b.key);
        el.appendChild(x);
      }
      bannerBox.appendChild(el);
    }
  }
  function reformatBanner(): Banner {
    return {
      key: "reformat", kind: "info", title: t("本次修改调整了全文格式"),
      detail: t("这次编辑无法只改动局部，已按规范格式重写全文。可以撤销。"),
      actions: [{ label: t("撤销"), run: () => runCommand("undo") }], closable: true,
    };
  }

  /** 丢弃本地编辑、载入磁盘版本（冲突「载入磁盘版本」、恢复「丢弃」）。 */
  async function loadFromDisk(revert: () => Promise<void>): Promise<void> {
    sync.paused = true;
    sync.reset(sync.pushedSeq);
    await revert();
    await reloadContent();
  }
  async function reloadContent(): Promise<void> {
    const c = await Session.content();
    text = c.text;
    rich.load(c.text);
    if (source) {
      source.setText(c.text);
      sourceEntry = c.text;
    }
    if (splitPreview) splitPreview.load(c.text);
    sync.reset(c.seq);
    renderStatus();
    renderOutline();
  }

  function conflictBanner(title: string): Banner {
    return {
      key: "conflict", kind: "warn", title,
      detail: t("你在这里还有未保存的改动。选择保留哪个版本。"),
      actions: [
        { label: t("载入磁盘版本"), run: () => loadFromDisk(() => Session.revert()) },
        { label: t("保留我的版本"), primary: true, run: async () => { sync.paused = false; await sync.push(); await Session.saveAnyway(); } },
      ],
    };
  }

  // ---- Go 侧事件 ----
  events.flush.on(({ n }) => void sync.flush(n));
  events.command.on(({ id }) => runCommand(id, "menu"));
  events.settingsChanged.on((v) => {
    const prevNet = getSettings().networkImages;
    setSettings(v);
    applyAppearance(getSettings());
    source?.setTabSize(v.tabWidth);
    renderStatus();
    if (prevNet !== v.networkImages) {
      showBanner({ key: "netchanged", kind: "info", title: t("「加载网络图片」设置已更改"), detail: t("重新载入后对这个窗口生效。"),
        actions: [{ label: t("重新载入"), primary: true, run: async () => { await sync.push(); location.reload(); } }], closable: true });
    }
  });
  onHostCommand((id) => runCommand(id, "host"));
  window.addEventListener("blur", () => void sync.push());
  document.addEventListener("visibilitychange", () => void sync.push());

  // 5.4：mygo 已重新读盘（只在 Go 侧认为未编辑时）。页面自己还有未推送的编辑：不载入，显示冲突提示
  onDocumentReload(async () => {
    if (sync.hasUnpushed && !sync.paused) {
      sync.paused = true;
      showBanner(conflictBanner(t("磁盘上的文件已被修改")));
      return;
    }
    if (sync.paused) return;
    const r = scrollRatio();
    await reloadContent();
    requestAnimationFrame(() => setScrollRatio(r));
    hideBanner("deleted");
  });
  onDocumentState((s) => {
    state = s;
    document.title = s.name;
    if (s.conflict && !banners.some((b) => b.key === "conflict")) showBanner(conflictBanner(t("磁盘上的文件已被其他应用修改")));
    if (!s.conflict && !sync.paused) hideBanner("conflict");
    if (s.deleted) {
      showBanner({ key: "deleted", kind: "danger", title: t("文件已被删除或移走"), detail: t("窗口里的内容仍然保留，自动保存已暂停。"),
        actions: [{ label: t("另存为…"), primary: true, run: () => Session.saveAs() }] });
    } else hideBanner("deleted");
    if (!s.edited && state.path && !sync.hasUnpushed && banners.length === 0) flash(t("已保存"));
    renderStatus();
    reportMenuState();
  });
  function flash(msg: string): void {
    saveFlash = msg;
    renderStatus();
    setTimeout(() => {
      saveFlash = "";
      renderStatus();
    }, 1500);
  }

  // ---- 启动时的提示条 ----
  if (info.recovered) {
    showBanner({ key: "recovered", kind: "info", title: t("已恢复上次未保存的内容"), detail: t("LiteMd 上次没有正常退出，这些改动还没有写入磁盘。"),
      actions: [
        { label: t("保留"), primary: true, run: () => {} },
        { label: t("丢弃，载入磁盘版本"), run: () => loadFromDisk(() => Session.discardRecovered()) },
      ] });
  }
  if (info.lossy) {
    showBanner({ key: "lossy", kind: "warn", title: t(`此文件不是 UTF-8 编码（按 ${info.encoding.toUpperCase()} 显示），暂不支持编辑`),
      detail: t("另存为 UTF-8 后可以正常编辑，原文件不会改动。"), actions: [{ label: t("另存为 UTF-8…"), primary: true, run: () => Session.saveAsUTF8() }] });
  } else if (info.readOnly) {
    showBanner({ key: "readonly", kind: "info", title: t("此文件为只读"), detail: t("文件权限不允许写入，可以阅读、查找和复制，也可以存储一份副本后编辑。"),
      actions: [{ label: t("存储副本…"), run: () => Session.duplicate() }], closable: true });
  }
  if (info.size > LARGE) {
    showBanner({ key: "large", kind: "info", title: huge ? t("文件超过 20 MB，已用只读源码模式打开") : t("文件较大，已用源码模式打开"),
      detail: t("超过 5 MB 的文件默认用源码模式，保证输入流畅；超过 20 MB 时只读打开。"), actions: [], closable: true });
  }

  // ---- 查找替换（F7.2/F7.3） ----
  const findBar = $(".lm-find");
  let findBuilt = false;
  let findReplace = false;
  function openFind(replace: boolean): void {
    findReplace = replace || findReplace;
    setFind({ isOpen: true });
    renderFind();
    const inp = findBar.querySelector<HTMLInputElement>(".lm-find-in");
    inp?.focus();
    inp?.select();
  }
  function closeFind(): void {
    setFind({ isOpen: false });
    findBuilt = false;
    renderFind();
    if (mode === "wysiwyg") rich.editor.commands.focus();
    else source?.focus();
  }
  function canReplace(): boolean {
    return mode !== "preview" && !readOnly && !huge;
  }
  function renderFind(): void {
    const s = findState();
    findBar.hidden = !s.isOpen;
    if (!s.isOpen) return;
    if (!findBuilt) {
      findBuilt = true;
      findBar.innerHTML = `<div class="lm-find-rows">
        <div class="lm-find-row">
          <label class="lm-field"><input class="lm-find-in" placeholder="${t("查找")}" aria-label="${t("查找内容")}"><span class="lm-count" aria-live="polite"></span>
            <button class="lm-opt" data-opt="caseSensitive" title="${t("区分大小写")}">Aa</button><button class="lm-opt" data-opt="wholeWord" title="${t("全词匹配")}">W</button><button class="lm-opt" data-opt="useRegex" title="${t("正则表达式")}">.*</button></label>
          <button class="lm-icon" data-act="find-prev" aria-label="${t("上一个")}">${svg(ICON.up)}</button>
          <button class="lm-icon" data-act="find-next" aria-label="${t("下一个")}">${svg(ICON.down)}</button>
          <button class="lm-icon" data-act="find-toggle-replace" aria-label="${t("替换")}">⇄</button>
          <button class="lm-icon" data-act="find-close" aria-label="${t("关闭查找")}">${svg(ICON.x)}</button>
        </div>
        <div class="lm-find-row lm-replace-row"></div></div>`;
      const inp = findBar.querySelector<HTMLInputElement>(".lm-find-in")!;
      inp.value = s.query;
      inp.addEventListener("input", () => setFind({ query: inp.value, currentIndex: -1 }));
      inp.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          findStep(e.shiftKey ? -1 : 1);
        }
        if (e.key === "Escape") closeFind();
      });
    }
    findBar.querySelectorAll<HTMLButtonElement>(".lm-opt").forEach((b) => {
      b.setAttribute("aria-pressed", String(s[b.dataset.opt as "caseSensitive"]));
    });
    const row = findBar.querySelector<HTMLElement>(".lm-replace-row")!;
    row.hidden = !findReplace;
    if (findReplace) {
      if (!canReplace()) {
        row.innerHTML = `<span class="lm-note">${t("预览模式只能查找。")}</span>${readOnly ? "" : `<button class="lm-btn" data-act="mode-wysiwyg">${t("切换到所见即所得")}</button>`}`;
      } else if (!row.querySelector(".lm-rep-in")) {
        row.innerHTML = `<label class="lm-field"><input class="lm-rep-in" placeholder="${t("替换为")}" aria-label="${t("替换为")}"></label>
          <button class="lm-btn" data-act="replace-one">${t("替换")}</button><button class="lm-btn" data-act="replace-all">${t("全部替换")}</button>`;
        const rin = row.querySelector<HTMLInputElement>(".lm-rep-in")!;
        rin.value = s.replaceText;
        rin.addEventListener("input", () => setFind({ replaceText: rin.value }));
        rin.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.isComposing) replaceOne();
          if (e.key === "Escape") closeFind();
        });
      }
    }
    const count = findBar.querySelector<HTMLElement>(".lm-count")!;
    count.textContent = s.query ? (s.matchCount ? `${s.currentIndex + 1}/${s.matchCount}` : t("无结果")) : "";
  }
  let findGuard = false;
  function runSourceFind(): void {
    if (!source || findGuard) return;
    findGuard = true;
    const s = findState();
    const r = source.find(s, s.currentIndex);
    if (r.count !== s.matchCount || r.index !== s.currentIndex) setFind({ matchCount: r.count, currentIndex: r.index });
    findGuard = false;
  }
  onFind(() => {
    if (mode === "source" || mode === "split") runSourceFind();
    renderFind();
  });
  function findStep(dir: 1 | -1): void {
    stepFind(dir);
    if (source && (mode === "source" || mode === "split")) source.reveal(findState().currentIndex);
  }
  function replaceOne(): void {
    const s = findState();
    if (!canReplace() || s.matchCount === 0) return;
    if (mode === "wysiwyg") replaceCurrentInWysiwyg();
    else if (source) source.replaceCurrent(s.currentIndex, s.replaceText, s);
  }
  function replaceAll(): void {
    const s = findState();
    if (!canReplace() || s.matchCount === 0) return;
    if (mode === "wysiwyg") replaceAllInWysiwyg();
    else if (source) source.replaceAll(s.replaceText, s);
  }

  // ---- 大纲（F7.1） ----
  const outline = $(".lm-outline");
  let outlineTimer = 0;
  let heads: Array<{ level: number; text: string; pos?: number; line?: number }> = [];
  function scheduleOutline(): void {
    if (!outlineOn) return;
    clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(renderOutline, 250);
  }
  function renderOutline(): void {
    outline.hidden = !outlineOn;
    if (!outlineOn) return;
    if (mode === "source" || mode === "split") heads = sourceHeadings(source?.text ?? text).map((h) => ({ ...h }));
    else {
      heads = [];
      rich.doc.forEach((node, offset) => {
        if (node.type.name === "heading") heads.push({ level: node.attrs.level as number, text: node.textContent, pos: offset });
      });
    }
    const nav = outline.querySelector("nav")!;
    nav.innerHTML = heads.length
      ? heads.map((h, i) => `<a href="#" data-i="${i}" data-l="${h.level}">${esc(h.text)}</a>`).join("")
      : `<div class="lm-empty">${t("文档里还没有标题")}</div>`;
    markOutline();
  }
  function headTop(h: (typeof heads)[number]): number {
    if (h.pos !== undefined) {
      const dom = rich.editor.view.nodeDOM(h.pos) as HTMLElement | null;
      return dom ? dom.offsetTop : 0;
    }
    if (source && h.line !== undefined) {
      const line = source.view.state.doc.line(Math.min(h.line + 1, source.view.state.doc.lines));
      return source.view.lineBlockAt(line.from).top;
    }
    return 0;
  }
  function markOutline(): void {
    if (!outlineOn || !heads.length) return;
    const sc = activeScroller();
    if (!sc) return;
    let cur = 0;
    heads.forEach((h, i) => {
      if (headTop(h) - 48 <= sc.scrollTop) cur = i;
    });
    outline.querySelectorAll("a").forEach((a, i) => a.classList.toggle("cur", i === cur));
  }
  outline.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-i]");
    if (!a) return;
    e.preventDefault();
    const h = heads[Number(a.dataset.i)];
    if (!h) return;
    const sc = activeScroller();
    if (sc) sc.scrollTo({ top: Math.max(0, headTop(h) - 16), behavior: "smooth" });
  });

  // ---- 菜单状态与按文件状态 ----
  function reportMenuState(): void {
    void Session.setMenuState({ mode, editable: !readOnly && !huge, lossy: info.lossy, outline: outlineOn, statusbar: getSettings().statusBar }).catch(() => {});
  }
  let fsTimer = 0;
  function saveFileState(): void {
    clearTimeout(fsTimer);
    fsTimer = window.setTimeout(() => void FileState.set({ mode, outline: outlineOn, scroll: scrollRatio() }).catch(() => {}), 800);
  }

  // ---- 命令（菜单、快捷键、宿主共用一套 ID） ----
  const dedupe = new Deduper();
  function wys(fn: (c: ReturnType<typeof rich.editor.chain>) => unknown): void {
    if (mode !== "wysiwyg") return;
    fn(rich.editor.chain().focus());
  }
  const commands: Record<string, () => unknown> = {
    "mode-preview": () => setMode("preview"),
    "mode-wysiwyg": () => setMode("wysiwyg"),
    "mode-source": () => setMode("source"),
    "mode-split": () => setMode("split"),
    "toggle-edit": () => setMode(mode === "preview" ? (allowed(lastEdit) ? lastEdit : "source") : "preview"),
    find: () => openFind(false),
    replace: () => openFind(true),
    "find-next": () => findStep(1),
    "find-prev": () => findStep(-1),
    outline: () => {
      outlineOn = !outlineOn;
      renderOutline();
      reportMenuState();
      saveFileState();
    },
    statusbar: () => void Settings.set({ ...getSettings(), version: 1, statusBar: !getSettings().statusBar }),
    "zoom-in": () => setFontScale(1),
    "zoom-out": () => setFontScale(-1),
    "zoom-reset": () => setFontScale(0),
    "width-narrow": () => setWidth("narrow"),
    "width-medium": () => setWidth("medium"),
    "width-wide": () => setWidth("wide"),
    "width-full": () => setWidth("full"),
    undo: () => (mode === "wysiwyg" ? rich.editor.commands.undo() : source?.undo()),
    redo: () => (mode === "wysiwyg" ? rich.editor.commands.redo() : source?.redo()),
    "paste-plain": () => void pastePlain(),
    paragraph: () => wys((c) => c.setParagraph().run()),
    "bullet-list": () => wys((c) => c.toggleBulletList().run()),
    "ordered-list": () => wys((c) => c.toggleOrderedList().run()),
    "task-list": () => wys((c) => c.toggleBulletList().updateAttributes("listItem", { checked: false }).run()),
    blockquote: () => wys((c) => c.toggleBlockquote().run()),
    "code-block": () => wys((c) => c.toggleCodeBlock().run()),
    table: () => wys((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
    "math-block": () => wys((c) => c.setCodeBlock({ language: MATH_BLOCK_LANGUAGE }).run()),
    hr: () => wys((c) => c.setHorizontalRule().run()),
    bold: () => wys((c) => c.toggleBold().run()),
    italic: () => wys((c) => c.toggleItalic().run()),
    strike: () => wys((c) => c.toggleStrike().run()),
    "inline-code": () => wys((c) => c.toggleCode().run()),
    "clear-format": () => wys((c) => c.unsetAllMarks().run()),
    link: () => openLinkCreate(),
    "export-html": () => exportUnavailable(),
    "export-pdf": () => exportUnavailable(),
    print: () => exportUnavailable(),
  };
  for (const n of [1, 2, 3, 4, 5, 6] as const) commands[`heading-${n}`] = () => wys((c) => c.toggleHeading({ level: n }).run());

  function runCommand(id: string, _from: string = "key"): void {
    const fn = commands[id];
    if (!fn || !dedupe.shouldRun(id)) return;
    void fn();
  }
  function setFontScale(dir: 1 | -1 | 0): void {
    void Settings.set({ ...getSettings(), version: 1, fontScale: stepFont(getSettings().fontScale, dir) });
  }
  function setWidth(w: string): void {
    void Settings.set({ ...getSettings(), version: 1, width: w });
  }
  async function pastePlain(): Promise<void> {
    const t1 = await host.readClipboardText();
    if (mode === "wysiwyg") rich.editor.chain().focus().insertContent(t1.replace(/</g, "&lt;")).run();
    else source?.insert(t1);
  }
  function openLinkCreate(): void {
    if (mode !== "wysiwyg") return;
    const v = rich.editor.view;
    const { from, to } = v.state.selection;
    const a = v.coordsAtPos(from);
    const b = v.coordsAtPos(to);
    useLinkCreatePopupStore.getState().openPopup({
      text: v.state.doc.textBetween(from, to),
      rangeFrom: from,
      rangeTo: to,
      anchorRect: { top: a.top, left: a.left, bottom: b.bottom, right: b.right },
      showTextInput: from === to,
    });
  }
  function exportUnavailable(): void {
    showBanner({ key: "export", kind: "info", title: t("导出与打印将在下一个版本提供"), actions: [], closable: true });
  }

  // 快捷键（捕获阶段先于编辑器键位；组字中不触发，NF9）
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape" && findState().isOpen) {
        e.preventDefault();
        closeFind();
        return;
      }
      const id = commandForKey(e, isMac);
      if (!id || !commands[id]) return;
      e.preventDefault();
      e.stopPropagation();
      runCommand(id);
    },
    true,
  );

  // ---- 点击 ----
  app.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const m = el.closest<HTMLElement>("[data-mode]");
    if (m && status.contains(m)) return void setMode(m.dataset.mode as Mode);
    const act = el.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act) {
      e.preventDefault();
      if (act === "swap") {
        swapped = !swapped;
        main.classList.toggle("lm-swapped", swapped);
      } else if (act === "find-close") closeFind();
      else if (act === "find-next") findStep(1);
      else if (act === "find-prev") findStep(-1);
      else if (act === "find-toggle-replace") {
        findReplace = !findReplace;
        renderFind();
      } else if (act === "replace-one") replaceOne();
      else if (act === "replace-all") replaceAll();
      else if (act === "outline") runCommand("outline");
      else if (act === "mode-wysiwyg") void setMode("wysiwyg");
      return;
    }
    const opt = el.closest<HTMLElement>(".lm-opt")?.dataset.opt as "caseSensitive" | "wholeWord" | "useRegex" | undefined;
    if (opt) setFind({ [opt]: !findState()[opt], currentIndex: -1 });
    // 预览中点击链接：直接打开（所见即所得中由 vmark 的 ⌘ 点击处理，F5.5）
    const a = el.closest<HTMLAnchorElement>(".lm-rich a[href]");
    if (a && (mode === "preview" || mode === "split") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const href = a.getAttribute("href")!;
      if (href.startsWith("#")) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
      else void host.openLink(href);
    }
  });
  // F3.8：预览中双击正文进入所见即所得，光标落在双击处
  richScroll.addEventListener("dblclick", (e) => {
    if (mode !== "preview" || !allowed("wysiwyg")) return;
    const pos = rich.editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    void setMode("wysiwyg").then(() => {
      if (pos) rich.editor.chain().focus().setTextSelection(pos.pos).run();
    });
  });

  // ---- 图片粘贴与拖入（F6.3–F6.5） ----
  async function insertImage(rel: string): Promise<void> {
    const md = `![](${rel.replace(/ /g, "%20")})`;
    if (mode === "wysiwyg") rich.editor.chain().focus().insertContent({ type: "image", attrs: { src: rel, alt: "" } }).run();
    else if (source) source.insert(md);
  }
  function needSave(): void {
    showBanner({ key: "needsave", kind: "info", title: t("请先保存文档，再粘贴图片"), detail: t("图片会存到文档旁边的 assets 文件夹，未命名文档还没有位置。"),
      actions: [{ label: t("存储…"), primary: true, run: () => Session.saveAs() }], closable: true });
  }
  app.addEventListener(
    "paste",
    async (e) => {
      if (mode === "preview" || readOnly) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      if (!state?.path) return needSave();
      try {
        const rel = await Assets.saveImage(toBase64(new Uint8Array(await file.arrayBuffer())));
        await insertImage(rel);
      } catch (err) {
        showBanner({ key: "imgfail", kind: "danger", title: t("图片没有保存"), detail: String(err), actions: [], closable: true });
      }
    },
    true,
  );
  onFileDrop(async ({ paths }) => {
    if (mode === "preview" || readOnly || !paths.length) return;
    try {
      const rels = await Assets.importDropped(paths);
      for (const [i, rel] of rels.entries()) {
        if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(paths[i]!)) await insertImage(rel);
        else {
          const name = paths[i]!.split(/[\\/]/).pop()!;
          if (mode === "wysiwyg") rich.editor.chain().focus().insertContent({ type: "text", text: name, marks: [{ type: "link", attrs: { href: rel } }] }).run();
          else source?.insert(`[${name}](${rel.replace(/ /g, "%20")})`);
        }
      }
    } catch (err) {
      if (String(err).includes("先保存")) needSave();
    }
  });

  // ---- 启动 ----
  await setMode(mode, true);
  renderBanners();
  renderStatus();
  if (mode === "wysiwyg" && info.untitled) rich.editor.commands.focus();

  window.__litemd = {
    page: "doc", info, sync, rich, readyAt: performance.timeOrigin + performance.now(),
    mode: () => mode, setMode, text: () => currentText(), source: () => source, state: () => state,
    run: (id: string) => runCommand(id), banners: () => banners.map((b) => b.key),
  };
}

function initialMode(info: ReadyInfo, s: PageSettings, remembered: Mode | ""): Mode {
  if (info.lossy) return "preview";
  if (info.size > LARGE) return "source";
  if (info.untitled) return "wysiwyg"; // 新建的空文档直接可写
  let m: Mode = s.defaultMode === "remember" ? remembered || "preview" : (s.defaultMode as Mode);
  if (!MODES.includes(m)) m = "preview";
  if (info.readOnly && (m === "wysiwyg" || m === "split")) m = "preview";
  return m;
}

/** F6.2：关闭「加载网络图片」时追加一条不含 http(s) 的 img-src CSP（多条 CSP 取交集，第 7 节）。 */
function applyNetworkImagePolicy(s: PageSettings): void {
  if (s.networkImages) return;
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = "img-src 'self' mygo: lmasset: http://lmasset.localhost http://mygo.localhost data: blob:";
  document.head.appendChild(meta);
}

declare global {
  interface Window {
    __litemd?: Record<string, unknown>;
  }
}
