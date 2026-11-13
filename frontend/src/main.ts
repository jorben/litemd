// 页面入口（技术方案 8.1 节）：/ 文档窗口，#/start 启动窗口。
import "@/styles/index.css";
import "@/components/Editor/editor.css";
import "@/styles/popup-shared.css";
import "@/styles/button-shared.css";
import "@/styles/input-shared.css";
import "@/styles/icon-button-shared.css";
import "@/styles/katexFixes.css";
import "katex/dist/katex.min.css";
import "./shell/shell.css";
import "@/i18n";
import { docPage } from "./shell/doc";
import { startPage } from "./shell/start";
import { settingsPage } from "./shell/settings";

const app = document.querySelector<HTMLDivElement>("#app")!;
if (location.hash === "#/start") void startPage(app);
else if (location.hash === "#/settings") void settingsPage(app);
else void docPage(app);
