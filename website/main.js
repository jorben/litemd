const translations = {
  en: {
    title: "LiteMd — One file, one window.",
    description: "A lightweight desktop Markdown editor for macOS, Windows and Linux. One file, one window. Save only what you changed.",
    skip: "Skip to content", navLabel: "Main navigation", navFeatures: "Features", navDownload: "Download",
    intro: "A lightweight desktop Markdown editor",
    headline1: "One file,", headline2: "one window.",
    heroDescription: "Open Markdown like you open a picture.<br>Read a little, edit a little, get on with your day.",
    getApp: "Download for free", explore: 'Meet LiteMd <span aria-hidden="true">↘</span>',
    screenshotAlt: "An actual LiteMd window displaying a Markdown document with syntax-highlighted code and four view modes in the status bar.",
    screenshotCaption: "Your document takes center stage.", factsLabel: "Product highlights",
    factLight: "About 7 MB on macOS", factPrivate: "No account. No telemetry.", factOpen: "Free and open source. Apache-2.0.",
    fidelityKicker: "A little respect for your source",
    fidelityTitle: "Only change<br>what you edited.",
    fidelityBody: "Blank lines, list markers, table alignment, line endings. They're part of your document, too. Edit one block and save just that block. Everything else stays as it was.",
    fidelityNote: "Just looking? Not a single byte changes.",
    fidelityLink: 'Fidelity-tested on 260+ real documents <span aria-hidden="true">↗</span>',
    diffLabel: "Save example: only Friday changes to Saturday. List markers, blank lines and other content stay unchanged.",
    saved: "Saved", diffCaption: "Only the edited block is written back. The rest stays intact.",
    viewsKicker: "From reading to writing", viewsTitle: "Your Markdown.<br>Four ways to see it.",
    viewsBody: "Read a document, fix a sentence, or work on the source.<br>Switch views without losing your place.",
    viewsLabel: "Explore the four view modes", preview: "Preview", wysiwyg: "WYSIWYG", source: "Source", split: "Split",
    exampleLabel: "Illustrative example", localFile: "Local Markdown file",
    viewPreview: "Open straight into reading. Press {key}E or double-click the text in LiteMd to start editing.",
    viewWysiwyg: "Edit the rendered document directly in LiteMd. See headings, lists and formatting as you write.",
    viewSource: "Work directly with Markdown in LiteMd's CodeMirror source editor. Every character is yours to control.",
    viewSplit: "Source and rendered content, side by side in LiteMd. Keep both in sight as you write.",
    detailsTitle: "Travel light.<br>Bring the essentials.",
    detailsBody: "More room for your document.<br>Thoughtful details for the everyday things.",
    detailWindowTitle: "A window for every file", detailWindowBody: "Double-click a file or drop it in. No file tree, notes library or tabs. Just the document in front of you.",
    detailSaveTitle: "A little less save anxiety", detailSaveBody: "Existing files autosave. Unsaved work recovers after a crash. If another app edits the file, you choose which version to keep.",
    detailMarkdownTitle: "The Markdown you use", detailMarkdownBody: "Tables, task lists, syntax highlighting, math, Mermaid diagrams, footnotes and GitHub alerts.",
    detailExportTitle: "Easy to pass along", detailExportBody: "Export HTML or PDF, or print. Find and replace, a document outline, and light and dark themes are here, too.",
    downloadTitle: "Give your next Markdown<br>a little room.", downloadBody: "Free, open source. Your files stay yours.",
    latestStable: "Latest stable release", macRequirement: "macOS 13 Ventura or later", macNote: "Developer-signed and Apple-notarized",
    windowsRequirement: "Windows 10 or later, x64", windowsInstaller: "Download installer",
    windowsNote: 'No admin rights needed. If SmartScreen appears on first install, choose “More info → Run anyway”.',
    linuxRequirement: "x64 / arm64, best-effort support", linuxPackages: "Choose a package",
    linuxNote: "Available as .deb, .rpm and .tar.gz.<br>Choose your distribution and architecture.",
    earlyNote: "LiteMd is still young. Back up important documents or keep them under version control.",
    installGuide: "Installation & usage", reportIssue: "Report an issue", allReleases: "All releases", footerTagline: "Light, handy, and gone when you're done.",
  },
};

// Keep the complete, useful Chinese page available before JavaScript runs.
const textNodes = [...document.querySelectorAll("[data-i18n]")];
const altNodes = [...document.querySelectorAll("[data-i18n-alt]")];
const ariaNodes = [...document.querySelectorAll("[data-i18n-aria]")];
translations.zh = Object.fromEntries(textNodes.map((node) => [node.dataset.i18n, node.innerHTML]));
for (const node of altNodes) translations.zh[node.dataset.i18nAlt] = node.alt;
for (const node of ariaNodes) translations.zh[node.dataset.i18nAria] = node.getAttribute("aria-label");
Object.assign(translations.zh, {
  title: document.title,
  description: document.querySelector('meta[name="description"]').content,
  viewPreview: "默认以预览打开，专注阅读。按 {key}E 或双击正文，随时开始编辑。",
  viewWysiwyg: "在 LiteMd 中直接编辑排版后的正文，标题、列表和格式随写随见。",
  viewSource: "在 LiteMd 的 CodeMirror 源码编辑器里，直接掌握 Markdown 的每一个字符。",
  viewSplit: "在 LiteMd 中将源码与排版后的内容并排查看，边写边对照。",
});

let language = "zh";
let selectedView = "preview";
let releaseVersion = "";
const shortcutKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
const languageButton = document.querySelector(".language-switch");
const viewDescription = document.querySelector("#view-description");
const viewButtons = [...document.querySelectorAll("[data-view]")];
const viewCopy = { preview: "viewPreview", wysiwyg: "viewWysiwyg", source: "viewSource", split: "viewSplit" };

function showView(view) {
  selectedView = view;
  document.querySelector(".view-example").dataset.mode = view;
  document.querySelector(".example-source").hidden = view !== "source" && view !== "split";
  document.querySelector(".example-render").hidden = view === "source";
  document.querySelector(".demo-caret").hidden = view !== "wysiwyg";
  for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.view === view));
  viewDescription.textContent = translations[language][viewCopy[view]].replace("{key}", shortcutKey);
}

function setLanguage(nextLanguage) {
  language = nextLanguage;
  const copy = translations[language];
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = copy.title;
  document.querySelector('meta[name="description"]').content = copy.description;
  document.querySelector('meta[property="og:title"]').content = copy.title;
  document.querySelector('meta[property="og:description"]').content = copy.description;
  // Only bundled translation strings are rendered as HTML; release data uses textContent.
  for (const node of textNodes) node.innerHTML = copy[node.dataset.i18n];
  for (const node of altNodes) node.alt = copy[node.dataset.i18nAlt];
  for (const node of ariaNodes) node.setAttribute("aria-label", copy[node.dataset.i18nAria]);
  languageButton.textContent = language === "zh" ? "EN" : "中文";
  languageButton.setAttribute("aria-label", language === "zh" ? "Switch to English" : "切换为简体中文");
  document.querySelector('[data-i18n="installGuide"]').href = language === "zh"
    ? "https://github.com/jorben/litemd/blob/master/README.zh-CN.md#快速开始"
    : "https://github.com/jorben/litemd#getting-started";
  if (releaseVersion) document.querySelector("#release-version").textContent = `${releaseVersion} · ${copy.latestStable}`;
  showView(selectedView);
}

languageButton.hidden = false;
languageButton.addEventListener("click", () => {
  const nextLanguage = language === "zh" ? "en" : "zh";
  const url = new URL(location.href);
  url.searchParams.set("lang", nextLanguage);
  history.replaceState(null, "", url);
  setLanguage(nextLanguage);
  try { localStorage.setItem("litemd-language", nextLanguage); } catch { /* The page also works with storage disabled. */ }
});
for (const [index, button] of viewButtons.entries()) {
  button.disabled = false;
  button.querySelector("kbd").textContent = `${shortcutKey}${index + 1}`;
  button.addEventListener("click", () => showView(button.dataset.view));
}
const urlLanguage = new URLSearchParams(location.search).get("lang");
let storedLanguage;
try { storedLanguage = localStorage.getItem("litemd-language"); } catch { /* Optional preference. */ }
const preferredLanguage = [urlLanguage, storedLanguage].find((value) => value === "zh" || value === "en");
setLanguage(preferredLanguage || (navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en"));

// Enhance release-page links only when GitHub returns real matching assets.
// An unavailable API, missing installer, or rate limit leaves the release links intact.
async function loadLatestRelease() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://api.github.com/repos/jorben/litemd/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }, signal: controller.signal,
    });
    if (!response.ok) return;
    const release = await response.json();
    if (release.draft || release.prerelease || !Array.isArray(release.assets)) return;
    const patterns = {
      "mac-arm": /^litemd-[\d][\w.+-]*-arm64\.dmg$/,
      "mac-intel": /^litemd-[\d][\w.+-]*-amd64\.dmg$/,
      windows: /^litemd-setup-[\d][\w.+-]*-amd64\.exe$/,
    };
    for (const link of document.querySelectorAll("[data-asset]")) {
      const asset = release.assets.find((item) => patterns[link.dataset.asset].test(item.name));
      if (!asset) continue;
      const url = new URL(asset.browser_download_url);
      if (url.origin === "https://github.com" && url.pathname.startsWith("/jorben/litemd/releases/download/")) link.href = url.href;
    }
    if (typeof release.tag_name === "string") {
      releaseVersion = release.tag_name;
      document.querySelector("#release-version").textContent = `${releaseVersion} · ${translations[language].latestStable}`;
    }
  } catch { /* Static release-page links remain available. */ }
  finally { clearTimeout(timeout); }
}
void loadLatestRelease();
