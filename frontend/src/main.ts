// 页面入口（M0 验证页：V1/V2/V5/V7）。M1 替换为正式外壳（React + 四种模式）。
//   /          文档窗口：CodeMirror 源码编辑 + 同步协议；底部 Tiptap 区域用于输入法验证（V5）
//   #/start    启动窗口（F1.12）
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { onDocumentReload, onDocumentState, type DocumentState } from "mygo-runtime";
import { Session, Start, events } from "./mygo";
import { PageSync } from "./sync/pageSync";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;

declare global {
  interface Window {
    __litemd?: Record<string, unknown>;
  }
}

if (location.hash === "#/start") startPage();
else void docPage();

function startPage(): void {
  document.title = "LiteMd";
  app.className = "start";
  app.innerHTML = `
    <h1>LiteMd</h1>
    <div class="actions">
      <button id="new" class="primary">新建</button>
      <button id="open">打开…</button>
    </div>
    <p class="hint">也可以把 .md 文件拖到这里</p>`;
  app.querySelector("#new")!.addEventListener("click", () => void Start.newDocument());
  app.querySelector("#open")!.addEventListener("click", () => void Start.open());
  window.__litemd = { page: "start" };
}

async function docPage(): Promise<void> {
  const info = await Session.ready();
  const { text, seq } = await Session.content();
  const readOnly = info.readOnly || info.lossy;
  app.className = "doc";
  app.innerHTML = `
    <div class="banner" hidden></div>
    <div class="src"></div>
    <div class="ime"><div class="ime-label">输入法验证（Tiptap，V5）</div><div class="tiptap"></div></div>
    <footer><span class="state"></span><span class="meta">${info.encoding}${info.eol === "\r\n" ? " · CRLF" : ""}${readOnly ? " · 只读" : ""}</span></footer>`;
  const banner = app.querySelector<HTMLDivElement>(".banner")!;
  const stateEl = app.querySelector<HTMLSpanElement>(".state")!;

  let view: EditorView;
  let loading = false;
  const sync = new PageSync({
    client: Session,
    getText: () => view.state.doc.toString(),
  });
  sync.reset(seq);

  view = new EditorView({
    parent: app.querySelector<HTMLDivElement>(".src")!,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        // 5.1：只对用户操作产生的、改变了文档的事务计数
        EditorView.updateListener.of((u) => {
          if (loading || !u.docChanged) return;
          if (u.transactions.some((tr) => tr.annotation(Transaction.userEvent) !== undefined)) sync.edit();
        }),
      ],
    }),
  });

  const load = (t: string, s: number) => {
    loading = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
    loading = false;
    sync.reset(s);
  };

  let flushes = 0;
  events.flush.on(({ n }) => { flushes++; void sync.flush(n); });
  window.addEventListener("blur", () => void sync.push());
  document.addEventListener("visibilitychange", () => void sync.push());

  // 5.4：外部修改时 mygo 已重新读盘；页面若还有未推送的编辑，不载入，显示冲突提示条
  onDocumentReload(async () => {
    if (sync.hasUnpushed) {
      sync.paused = true;
      showBanner("磁盘上的文件已被修改", [
        ["载入磁盘版本", async () => { await Session.revert(); const c = await Session.content(); load(c.text, c.seq); }],
        ["保留我的版本", async () => { sync.paused = false; await sync.push(); await Session.saveAnyway(); }],
      ]);
      return;
    }
    const c = await Session.content();
    load(c.text, c.seq);
  });
  let last: DocumentState | null = null;
  onDocumentState((s) => {
    last = s;
    stateEl.textContent = s.conflict ? "冲突" : s.deleted ? "已删除" : s.edited ? "已编辑" : s.path ? "已保存" : "未保存";
    if (s.conflict && !sync.paused) {
      showBanner("磁盘上的文件已被其他应用修改", [
        ["载入磁盘版本", async () => { await Session.revert(); const c = await Session.content(); load(c.text, c.seq); }],
        ["保留我的版本", async () => { await sync.push(); await Session.saveAnyway(); }],
      ]);
    } else if (!s.conflict && !sync.paused) banner.hidden = true;
  });
  if (info.recovered) {
    showBanner("已恢复上次未保存的内容", [
      ["保留", async () => {}],
      ["丢弃，载入磁盘版本", async () => { await Session.revert(); const c = await Session.content(); load(c.text, c.seq); }],
    ]);
  }

  function showBanner(msg: string, acts: Array<[string, () => Promise<void>]>) {
    banner.hidden = false;
    banner.innerHTML = `<span>${msg}</span>`;
    for (const [label, fn] of acts) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = async () => { banner.hidden = true; await fn(); };
      banner.appendChild(b);
    }
  }

  const tiptap = new Editor({
    element: app.querySelector<HTMLDivElement>(".tiptap")!,
    extensions: [StarterKit],
    content: "<p>在这里用中文输入法输入，检查组字与候选框位置。</p>",
  });

  // 自动化测试钩子（V1/V2/V5/V7 用 mygo-automation eval 驱动）
  window.__litemd = {
    page: "doc",
    // 内容渲染完成的时刻（epoch ms），V6 用来测打开耗时
    readyAt: performance.timeOrigin + performance.now(),
    info,
    view,
    sync,
    tiptap,
    state: () => last,
    flushes: () => flushes,
    text: () => view.state.doc.toString(),
    /** 模拟用户输入：带 input.type 用户事件注解 */
    type: (s: string, at?: number) => {
      const pos = at ?? view.state.doc.length;
      view.dispatch({ changes: { from: pos, insert: s }, userEvent: "input.type", selection: { anchor: pos + s.length } });
    },
  };
}

