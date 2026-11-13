# LiteMd 技术实现方案

| 项 | 内容 |
|---|---|
| 版本 | v0.1（草案） |
| 日期 | 2026-11-13 |
| 依据 | `docs/product-requirements.md` v0.2 |
| 调研基线 | mygo main `6eaa7fb`（v0.9.0，2026-11-13）；vmark main `01bf9f4`（0.9.120，2026-11-12） |

本文的“需求编号”（F1.2、NF5 等）指 PRD 中的条目，“决策编号”（D1–D6）指 PRD 第 10 节。

---

## 1. 总体架构

```
┌──────────────────────────── LiteMd 进程（Go，单实例） ────────────────────────────┐
│                                                                                   │
│  mygo.App ── RequestSingleInstanceLock / OnOpenFile / OnSecondInstance            │
│     │                                                                             │
│     ├─ mygo.NewDocuments[MdContent]   ← 一个文件一个窗口、自动保存、恢复副本、       │
│     │      Read / Write（编码、BOM、换行符）  外部修改检测、最近打开、文件菜单        │
│     │                                                                             │
│     ├─ Bind 服务：Doc（文档内容/状态）  Assets（图片落盘）  Links（打开链接）        │
│     │            Export（HTML/PDF/打印）  Settings（设置）  Shell（在访达中显示…）   │
│     │                                                                             │
│     ├─ Protocol "lmasset"  ← 按窗口作用域提供文档引用的本地图片                     │
│     ├─ 菜单（文件/编辑/段落/格式/视图/窗口/帮助）→ 事件发给对应窗口的页面            │
│     └─ 设置与按文件状态存储（PathUserData 下的 JSON）                               │
│                                                                                   │
│        │ 生成的 TS 客户端（类型化 IPC） + 事件                                      │
│        ▼                                                                          │
│  ┌──────────────── 每个文档窗口：系统 WebView（WKWebView / WebView2 / WebKitGTK） ─┐ │
│  │  React 外壳：模式切换、状态栏、提示条、大纲、查找替换                           │ │
│  │   ├─ 预览     Tiptap（只读，与所见即所得同一套 schema 和渲染）                  │ │
│  │   ├─ 所见即所得 Tiptap 3 / ProseMirror + vmark 扩展                            │ │
│  │   ├─ 源码     CodeMirror 6                                                     │ │
│  │   └─ 分屏     CodeMirror 6 + 只读 Tiptap 预览                                  │ │
│  │  Markdown 管线：remark/mdast ⇄ ProseMirror（迁自 vmark）+ 保真写回层（新写）    │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**核心原则：Markdown 文本是唯一的真实数据。**

- Go 侧的文档内容就是一段 Markdown 文本（外加编码元数据），读写盘、自动保存、恢复副本、外部修改检测都在 Go 侧，由 mygo `NewDocuments` 完成。
- 页面侧持有编辑状态（ProseMirror 文档或 CodeMirror 文本），在合适的时机把 Markdown 文本推给 Go。
- 页面只能通过显式绑定的少数几个服务影响磁盘，且所有服务都按“调用者窗口所属的文档”限定作用域。

### 1.1 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面框架 | **mygo**（Go，MIT），锁定具体版本 | 系统 WebView，纯 Go 不用 cgo，`NewDocuments` 提供文档窗口全套行为 |
| Go 版本 | Go 1.27.3+（mygo 要求） | |
| 前端构建 | Vite + TypeScript，**Bun** 作包管理和脚本 | 跟随 mygo 模板；vmark 的 pnpm patch 改用 Bun 的 `patchedDependencies` |
| UI 框架 | React 19 + zustand（只管单窗口内的状态） | vmark 组件都是 React |
| 所见即所得 | Tiptap 3（ProseMirror） | 迁自 vmark |
| 源码编辑 | CodeMirror 6 | 迁自 vmark |
| Markdown 管线 | unified / remark-parse / remark-stringify / remark-gfm / remark-math / remark-frontmatter | 迁自 vmark `src/utils/markdownPipeline` |
| 公式 | KaTeX | |
| 图表 | Mermaid（懒加载） | |
| 代码高亮 | lowlight（highlight.js 语法） | 只打包常用约 30 种语言 |
| HTML 过滤 | DOMPurify | |

## 2. 仓库结构

```
litemd/
├── mygo.config.ts            # 应用名、标识、文件关联、更新、打包配置
├── go.mod / main.go          # 入口：单实例、NewDocuments、菜单、协议、绑定
├── internal/
│   ├── doc/                  # MdContent、Read/Write、编码与换行符处理
│   ├── assets/               # lmasset 协议、图片落盘、路径校验
│   ├── links/                # 打开相对 .md 链接、外部链接
│   ├── export/               # HTML 写盘、PDF、打印
│   ├── settings/             # 设置读写与广播
│   ├── filestate/            # 按文件记住的模式、大纲开关、窗口状态（LRU）
│   └── menu/                 # 菜单定义与快捷键
├── locales/                  # Go 侧文案（mygo i18n）：zh-Hans.json、en.json
├── frontend/
│   ├── package.json / vite.config.ts / tsconfig.json
│   ├── patches/              # micromark、mdast-util-*、prosemirror-view 的补丁
│   └── src/
│       ├── main.tsx          # 页面入口
│       ├── mygo.ts           # mygo generate 生成的客户端（不手改）
│       ├── shell/            # 窗口外壳：模式切换、状态栏、提示条、大纲、查找
│       ├── modes/            # preview/ wysiwyg/ source/ split/
│       ├── sync/             # 页面 ⇄ Go 的内容同步协议（第 5 节）
│       ├── fidelity/         # 保真写回层（第 6 节）
│       ├── host/             # 平台适配层：替代 vmark 里的 @tauri-apps 调用
│       ├── vmark/            # 迁入的 vmark 代码，保持原目录结构（第 4 节）
│       ├── settings/ i18n/ styles/
│       └── test/
├── testdata/fidelity/        # 保真度回归语料（≥ 200 个 .md）
├── resources/                # 图标（D5：先用占位图标）
├── docs/
└── THIRD_PARTY.md
```

## 3. Go 侧设计

### 3.1 入口与生命周期

```go
func main() {
    if !mygo.App.RequestSingleInstanceLock() { return }     // F1.3
    settings.Load()
    assets.Register()                                        // 注册 lmasset 协议，须在建窗口前
    docs := mygo.NewDocuments(mygo.DocumentsOptions[doc.MdContent]{
        Types:         []mygo.DocumentType{{Name: "Markdown Document", Extensions: []string{"md", "markdown", "mdown", "mkd"}}},
        Read:          doc.Read,
        Write:         doc.Write,
        Equal:         doc.Equal,
        Window:        newDocWindow,
        Autosave:      autosaveFromSettings(),               // D2：默认 AutosaveInPlace
        AutosaveDelay: time.Second,                          // F2.2：约 1 秒
        NoUntitled:    true,                                 // F1.9/D7：不自动新建，改为显示启动窗口
    })
    start.Install(docs)                                      // F1.12：启动窗口
    mygo.BindAs("Doc", docs.Service())                       // 内容、状态、保存等
    mygo.Bind(&assets.Service{}, &links.Service{}, &export.Service{}, &settings.Service{}, &shellSvc{})
    menu.Install()
    mygo.App.WhenReady(start.ShowIfNoDocuments)              // 没有文档窗口时显示启动窗口
    if err := mygo.App.Run(); err != nil { log.Fatal(err) }
}
```

mygo `NewDocuments` 已提供以下能力，**不自己写**：

| PRD | mygo 提供的行为 |
|---|---|
| F1.2 | 同一文件再次打开时聚焦已有窗口 |
| F1.6 | 新建、打开、最近打开（含系统 Dock 菜单和跳转列表）、关闭 |
| F1.7 | 标题显示文件名；macOS 关闭按钮圆点，Windows/Linux 标题前加 `*`。PRD 写的是 `•`，以 mygo 的 `*` 为准 |
| F1.11 | macOS 标题栏代理图标 |
| F2.1 | 保存、另存为、副本、重命名、移动到、还原 |
| F2.2 | 自动保存：停止编辑后 `AutosaveDelay` 写盘，持续编辑时至少每 30 秒写一次，失焦和关闭时也写；未命名、只读、冲突、已删除的文档不自动保存，关闭时询问 |
| F2.3 | 恢复副本：写在 `PathUserData/Recovery/`，崩溃后下次启动自动恢复为“已编辑”状态 |
| F2.4 | 监听文件变化，窗口获得焦点时再检查一次：无本地改动则重新读入并发 `onDocumentReload`；有改动则进入冲突状态；跟踪重命名；文件被删除时保持窗口打开 |
| F2.7 | 原子写盘：临时文件 + `NSFileManager replaceItemAtURL` / `ReplaceFileW` / rename，保留权限、扩展属性、ACL |

### 3.2 文档内容模型 `MdContent`

```go
type MdContent struct {
    Text     string // 归一化后的正文：去掉 BOM，换行统一为 \n
    BOM      bool   // 原文件有 UTF-8 BOM
    EOL      string // "\n" 或 "\r\n"：原文件的主要换行符
    Encoding string // "utf-8"；其他值表示只读打开（F2.6）
    Lossy    bool   // 读入时做过编码转换或非法字节替换，禁止原地写回
}
```

- **Read**：读入字节，然后依次处理：
  1. 检测并去掉 UTF-8 BOM；
  2. 校验 UTF-8。不合法时尝试按 GB18030 解码用于显示，并设置 `Encoding = "gb18030"`、`Lossy = true`；还失败就做替换字符处理，`Encoding = "unknown"`；
  3. 统计 `\r\n` 和单独 `\n` 的数量，取多数作为 `EOL`，再把正文统一成 `\n`。
- **Write**：`Lossy` 为真时拒绝原地写回，返回错误，交给 mygo 走“另存为”。否则把 `\n` 还原成 `EOL`，按需补回 BOM，写出 UTF-8。
- **Equal**：比较 `Text`。撤销回原文时，文档会回到“未编辑”状态。
- **只读**：`Lossy` 的文档在页面侧强制进入预览模式，并显示提示条（F2.6）。权限只读的文件由 mygo 的 `State().ReadOnly` 给出（F2.8）。
- **混合换行符**：同一文件里 `\r\n` 和 `\n` 混用时，**只要不编辑就不会写盘**（F2.5①）；编辑后统一为占多数的那种。这是已知的保真例外，写进验收说明。

### 3.3 窗口

```go
func newDocWindow(d *mygo.Document[doc.MdContent]) *mygo.Window {
    w := mygo.NewWindow(mygo.WindowOptions{
        URL:             "/",
        Width: 880, Height: 1000, MinWidth: 420, MinHeight: 320,
        BackgroundColor: "light-dark(#ffffff, #1e1e1e)",    // 避免白屏闪烁
        StateKey:        filestate.WindowKey(d.State().Path), // F1.8；未命名文档不传
    })
    hardenPage(w)          // 第 7 节：导航拦截、新窗口处理
    flush.Attach(w, d)     // 第 5 节：关窗前先收齐页面的最新内容
    return w
}
```

- **按文件记住窗口状态（F1.8）**：mygo 的 `StateKey` 会让 `window-state.json` 随打开过的文件数无限增长。因此通过 `App.SetWindowStateStore` 接入自己的存储，用 LRU 只保留最近 500 个文件；查看模式、大纲开关等按文件的状态存在同一份存储里（`filestate`）。
### 3.3.1 启动窗口（F1.9、F1.10、F1.12、D7）

mygo 在 `NoUntitled: true` 时，启动和点 Dock 重新激活都不会自动新建未命名文档（见 mygo `document_flow.go` 中对 `noUntitled` 的两处判断），由 LiteMd 自己接管：

```go
// internal/start
func Install(docs *mygo.Documents[doc.MdContent]) {
    mygo.App.OnActivate(func(visible bool) {             // macOS 点 Dock
        if !visible { ShowIfNoDocuments() }
    })
    mygo.App.OnWindowCreated(func(w *mygo.Window) {      // 任何文档窗口出现就关掉启动窗口
        if docs.ForWindow(w) != nil { closeStart() }
    })
}

func ShowIfNoDocuments() {
    if len(docs.Documents()) > 0 { return }             // 带文件启动、或恢复了崩溃前的文档
    if startWin != nil { startWin.Focus(); return }      // 全局只有一个
    startWin = mygo.NewWindow(mygo.WindowOptions{
        URL: "/start", Width: 480, Height: 320, Resizable: false, Center: true,
    })
}
```

- 启动窗口是同一个前端包里的一个轻量路由 `/start`，只引入外壳样式，**不加载 Tiptap、CodeMirror**，保证秒开。
- 两个按钮调用绑定服务 `Start.newDocument()` → `docs.New()`、`Start.open()` → `docs.OpenDialog()`（以启动窗口为父窗口）。取消时什么都不做，启动窗口保留。
- 拖入文件：`win.OnFileDrop` → 筛出 Markdown 扩展名 → 逐个 `docs.Open(path)`。
- 启动窗口里的 ⌘N / ⌘O 由菜单加速键触发，走与按钮相同的路径。
- 关闭启动窗口：macOS 应用留在 Dock；Windows/Linux 上如果没有其他窗口，交给 `OnWindowAllClosed` 退出。
- 由启动窗口打开文档时要先建文档窗口、再关启动窗口（即上面 `OnWindowCreated` 的顺序），避免 Windows/Linux 上瞬间“没有窗口”触发退出。

### 3.4 绑定服务（页面能调用的全部 Go 接口）

所有方法都通过 `mygo.CallerWindow(ctx)` 找到调用者窗口对应的文档，**页面不能指定任意路径去读写**。

| 服务 | 方法 | 用途 / 约束 |
|---|---|---|
| `Doc`（mygo 自带） | `content` `setContent` `state` `save` `saveAs` `revert` … | 内容同步与文件操作 |
| `Start` | `newDocument()` `open()` | 只供启动窗口调用（第 3.3.1 节）；其他窗口调用时拒绝 |
| `Session` | `ready()` → `{docId, dir, name, readOnly, lossy, encoding, settings, fileState}` | 页面启动时拿到一次性的上下文 |
| `Session` | `flushed(seq)` | 回应第 5 节的收齐请求 |
| `Session` | `setFileState(state)` | 按文件保存查看模式、大纲开关、滚动位置 |
| `Assets` | `saveImage(bytes, mime, suggestedName)` → 相对路径 | F6.3：按设置的规则存到文档目录（默认 `./assets/`，D4），文件名冲突时加序号，大小上限 50 MB，只接受图片 MIME 类型。未命名文档返回 `ErrNeedSave` |
| `Assets` | `importDropped(paths)` → 相对路径列表 | F6.3/F6.5：拖入的图片复制到 assets 目录；非图片只计算相对路径，不复制 |
| `Assets` | `assetURL(ref)` → `lmasset://…` | 把 Markdown 里的图片引用转成可加载的 URL |
| `Links` | `open(href)` | 外部链接交给系统浏览器；相对路径的 `.md` 链接用 `Docs.Open` 开新窗口（F5.5）；其他本地文件用系统默认程序打开前先确认 |
| `Export` | `html(doc, opts)` | F8.1：页面生成 HTML，Go 弹保存对话框后写盘；选“内嵌图片”时由 Go 读取图片转成 base64 |
| `Export` | `pdf(opts)` / `print()` | F8.2/F8.3：Go 打开一个隐藏的打印用窗口，载入导出用 HTML，调用 `Page.PrintToPDF` / `Page.Print` |
| `Settings` | `get` `set` | 改动后 `Broadcast("settings-changed")` 通知所有窗口 |
| `Shell` | `revealInFolder` `copyPath` | F6.6 |

### 3.5 本地图片协议 `lmasset`

```
lmasset://localhost/<docToken>/<url-encoded-ref>
```

- `docToken` 是每个文档窗口随机生成的令牌（映射到文档所在目录），窗口关闭后失效。令牌保证其他页面拿不到别的文档的作用域。
- 处理器把 `ref` 按文档目录解析（相对路径、`file://`、绝对路径都支持），然后：
  - **只提供图片类文件**：按扩展名和文件头嗅探双重判断，限 png/jpg/gif/webp/avif/bmp/ico/svg；
  - **不限于文档目录及其子目录**。Markdown 里常见 `../images/x.png` 这种写法，限死子目录会让大量文档显示不了图。代价是一个被攻破的页面能读到机器上任意位置的**图片**，但读不到其他类型的文件。PRD NF5 已按此修订；
  - SVG 返回时附加 `Content-Security-Policy: script-src 'none'`；
  - 文件不存在返回 404，页面显示占位和原始路径（F6.7）。
- 网络图片（F6.2）由页面直接加载。关闭“加载网络图片”后，页面把 `http(s)` 图片换成占位，点击才加载。

### 3.6 菜单与快捷键

- 文件菜单使用 mygo 的 `RoleFileMenu`。保存相关项按第 5 节包装：先收齐页面内容，再调用文档的保存。
- 编辑菜单（撤销、重做、剪切、复制、粘贴、粘贴为纯文本、全选、查找、替换）、段落菜单（标题 1–6、列表、引用、代码块、表格、公式块）、格式菜单（加粗、斜体、删除线、行内代码、链接）、视图菜单（四种模式、大纲、状态栏、字号缩放）：一律由 Go 通过 `Emit(window, "command", {id})` 发给对应窗口，页面里的命令注册表负责执行。命令在当前模式不可用时，页面通过 `Session.setMenuState` 告诉 Go 置灰。
- 快捷键以菜单加速键为准（F3.5、F5.1）。完整键位表在 M1 开始前定稿，放进 `docs/keybindings.md`。
- **输入法保护（NF9）**：页面在 `compositionstart` 到 `compositionend` 期间不执行菜单命令（vmark 的 `compositionGuard` 插件已处理编辑器内部这部分）。

### 3.7 设置与按文件状态

- 设置存在 `PathUserData/settings.json`，带 `version` 字段，新增字段一律有默认值。内容见 PRD F10。
- 按文件状态存在 `PathUserData/file-state.json`：以文件绝对路径为键（Windows 上不区分大小写），LRU 保留 500 条；记录查看模式、大纲开关、滚动锚点和窗口位置大小。

### 3.8 自动更新与分发

| 平台 | 方案 |
|---|---|
| macOS | `mygo build` 生成 `.app` + DMG。`signingIdentity` 使用 Developer ID，`notarize` 使用 keychain profile（Apple Developer 账号已具备，2026-11-13 确认；CI 中通过 secrets 导入证书和 notarytool 凭据）。最低系统版本设为 13.0 |
| Windows | NSIS 安装包，按用户安装。**不配置 `certificate`（D6）**；下载页说明 SmartScreen 的处理方式 |
| Linux | AppImage + deb，尽力支持 |
| 更新 | `updates: { publicKey, github: "jorben/litemd" }`。用 `mygo keygen` 生成密钥对，私钥只放在 CI secrets 和密码管理器里。安装包是否可信靠这把密钥的签名校验，**和 Windows 代码签名无关**。开启增量更新 |
| CI | GitHub Actions：PR 上在三个平台构建并测试；打 `v*` tag 时构建、签名公证、发布 Release |

## 4. 从 vmark 迁入的内容

### 4.1 迁移原则

1. **只迁模块，不迁应用。** 不搬 vmark 的 `App`、工作区、标签页、store、MCP、AI、终端等；`TiptapEditor.tsx` 本身和这些深度耦合（标签页、多窗格、MCP 修订追踪），所以**外层编辑器组件自己写**，只复用它内部的扩展和工具函数。
2. **保持原目录结构，放在 `frontend/src/vmark/` 下**，文件头保留 vmark 的 ISC 版权声明，在 `THIRD_PARTY.md` 记录来源 commit。改动处加 `// litemd:` 注释，方便以后对比上游。
3. **vmark 的插件按“端口（port）注入”设计**（vmark 的 ADR-015：插件声明需要的端口和默认值，由宿主注入实现）。LiteMd 写自己的宿主装配代码（参照 vmark 的 `services/assembly/tiptapExtensions.ts` 和 `hostAdapters.ts`，大约 600 行），只装配需要的扩展。
4. 插件里直接调用 `@tauri-apps/*` 的地方（约 16 个插件目录），统一改成调用 `frontend/src/host/` 平台适配层，适配层再转到 mygo 生成的客户端。

### 4.2 迁移清单

| vmark 模块 | 规模 | 处理 | 对应需求 |
|---|---|---|---|
| `src/utils/markdownPipeline/` | 约 1.1 万行 | **整体迁入**。不依赖 store，也不调用 Tauri | F4、F2.5 |
| `patches/`：micromark、mdast-util-from-markdown、mdast-util-to-markdown、micromark-extension-gfm-autolink-literal、mdast-util-find-and-replace、prosemirror-view | 6 个补丁 | 迁入，改成 Bun 的补丁格式，**锁定依赖版本** | 性能、病态输入 |
| `src/services/assembly/` 中的扩展装配 | 约 4000 行 | 参照它重写成 LiteMd 自己的装配（只取需要的扩展） | — |
| `src/components/Editor/alignedTableNodes.ts`、`tiptapContentLoad.ts`、`tiptapInitialLoad.ts` 等工具 | 少量 | 迁入并去掉 store 依赖 | F4.2 |
| `src/components/Editor/SourceEditor.tsx` + `sourceEditorExtensions.ts` | 约 450 行 | 参照重写 | F3.3、F5.7 |
| `src/components/Editor/MarkdownSplitView.tsx`、`DocumentSplit/` | 少量 | 迁入 | F3.4 |
| `src/utils/cursorSync/` | — | 迁入：模式切换时对齐光标和滚动位置 | F3.6 |
| `src/export/` 中的 HTML 导出部分（`createExportExtensions`、`htmlExport`、`htmlSanitizer`、`htmlTemplates`、`katexFontEmbed`、`pdfHtmlTemplate`、`exportStyles.css`） | 约 3000 行（全部约 7100 行） | 只迁 HTML/PDF 相关，去掉 Pandoc、导出锁、发布等 | F8 |
| 主题和编辑器 CSS | — | 迁入白色、夜间两套，去掉其余四套 | F9.1 |

**要迁入的 Tiptap 扩展**（按 PRD 范围从 vmark 的 `buildExtensionList` 里挑）：

| 类别 | 扩展 |
|---|---|
| 基础 | StarterKit（vmark 的配置）、`AlignedTableCell/Header`、`TableWithScrollWrapper`、`tableUI`、`taskListItem`、`vmarkLinkExtension`、`imageView`、`blockImage` |
| 语法 | `mathInline` + 块级公式（`codePreview`、`blockMathKeymap`、`latex`）、`alertBlock`、`detailsBlock/Summary`、`footnoteReference/Definition`、`footnotePopup`、`highlight`、`subscript/superscript`、`underline`（只为保留已有 HTML，不提供菜单） |
| 编辑行为 | `listContinuation`、`listBackspace`、`listClickFix`、`safeBlockSplit`、`blockEscape`、`tabIndent`、`autoPair`、`inlineCodeBoundary`、`smartSelectAll`、`CJKBold/CJKItalic`（输入规则）、`markInputRules`、`textDragDrop`、`editorKeymap` |
| 保真与安全 | `compositionGuard`（输入法）、`blankLinesGuard`、`undoIntegrity`、`inactiveSelection` |
| 粘贴复制 | `smartPaste`、`markdownPaste`、`htmlPaste`、`codePaste`、`markdownCopy` |
| 浮层 | `linkPopup`、`linkCreatePopup`、`mathPopup`、`editorContextMenu`、`formatToolbar`（浮动格式栏，F5.3） |
| 查找 | `search`（F7.2/F7.3） |
| 图片 | `imageHandler`（粘贴/拖入，宿主端口接到 `Assets.saveImage`） |

**不迁入**：`aiSuggestion`、`wikiLink*`、`multiCursor`（所见即所得模式下的多光标）、`focusMode`、`typewriterMode`、`lint`、`agentJournal/wysiwygProvenance`、`sourcePeekInline`、`markmap`、`graphviz`、`blockAudio/Video`、`videoEmbed`、`mediaPopup`、`cjkLetterSpacing`（PRD F5.9 为 P2，以后再说）、`showInvisibles`、`tableOfContents`、`workflow*` 等。

Mermaid：vmark 用 `codePreview` 渲染 Mermaid 代码块，保留这条路径，但 Mermaid 库**懒加载**（第一次遇到 mermaid 代码块时才 `import()`）。

### 4.3 平台适配层 `host/`

```ts
export interface Host {
  saveImage(data: Uint8Array, mime: string, name?: string): Promise<string>; // 相对路径
  importDropped(paths: string[]): Promise<string[]>;
  assetURL(ref: string): string;          // 同步：用 Session.ready 拿到的 docToken 拼 URL
  openLink(href: string): Promise<void>;
  readClipboardImage(): Promise<Blob | null>;
  revealInFolder(ref: string): Promise<void>;
  settings: SettingsPort;                  // 读设置、订阅变化
}
```

迁入插件里的 Tauri 调用一律改为调用 `host`，单元测试里换成假实现。

## 5. 内容同步协议（页面 ⇄ Go）

问题：mygo 的文档内容在 Go 侧，编辑发生在页面侧。保存、自动保存、关窗、退出时，Go 必须拿到**最新**的文本，但每次按键都序列化整篇 Markdown 成本太高。

### 5.1 正常编辑

```
用户输入 → 编辑器事务
   ├─ 立即：页面记 dirty=true，seq++
   └─ 防抖：文档 < 200 KB 时 150 ms，否则 400 ms
        → 序列化（第 6 节保真写回）→ Doc.setContent({...meta, Text}) 
        → Go：Document.Set → 自动保存计时（AutosaveDelay = 1 s）
```

- 源码模式下直接取 CodeMirror 的文本，不经过序列化。
- 页面失焦、`visibilitychange`、切换模式时立即推送（不等防抖）。
- `setContent` 带上读入时的 `BOM`/`EOL`/`Encoding`，Go 侧原样保留。

### 5.2 两阶段收齐（flush）

保存、关窗、退出、导出之前，Go 先确认页面已推送最新内容：

```
Go: Emit(window, "flush", {seq: n}) → 页面：有未推送的改动就立即序列化 + setContent → Session.flushed(n)
Go: 等到 flushed(n)，超时 800 ms → 继续原操作（超时记日志；内容以最后一次 setContent 为准）
```

| 场景 | 接入点 |
|---|---|
| 菜单保存、另存为 | 不直接用 `RoleSave`，改用自定义菜单项：先收齐，再调用 `Document.Save()` / `SaveAs("")` |
| 关窗 | 在文档挂上自己的关闭监听之前，先给窗口注册 `OnClose`：第一次关窗时 `PreventDefault`，收齐后再次调用 `Close()`，第二次放行给 mygo 的保存询问流程。**M0 要确认监听器的先后顺序** |
| 退出 | `OnBeforeQuit`：取消本次退出，对所有窗口并行收齐，然后再次 `App.Quit()`。`SessionEnding`（关机、注销）时不能等待，只能依赖最近一次推送（最多丢失 150–400 ms 的输入） |
| 导出、打印 | 先收齐，再取 Go 侧的文本 |

### 5.3 外部修改与冲突

- `onDocumentReload`：mygo 已经重新读入了磁盘内容。页面先保存当前模式的滚动锚点，重新载入文本，再恢复位置。
- 冲突状态（有本地改动、磁盘也变了）：`onDocumentState` 中 `conflict = true` 时，页面顶部显示提示条：「载入磁盘版本」调用 `Doc.revert()`，「保留我的版本」调用 `Doc.saveAnyway()`（需要在自己的 Session 服务里包一层，mygo 的 `DocumentService` 没有暴露这个方法）。
- 文件被删除：提示条提供「另存为」。

## 6. 保真写回层（D3：发布阻断条件）

### 6.1 目标

| 场景 | 要求 |
|---|---|
| 打开后不编辑 | 不写盘（mygo `Equal` + 页面不推送） |
| 切换模式但不编辑 | 文本逐字节不变 |
| 所见即所得编辑后保存 | **只有改动过的顶层块变化**，其余块（含块之间的空行）保持原文 |
| 源码模式编辑 | 与编辑内容逐字节一致 |

### 6.2 机制：利用 ProseMirror 的结构共享

ProseMirror 文档不可变：一次事务只会替换被改动路径上的节点，**未改动的顶层节点在新文档里仍是同一个对象**。因此：

1. **解析时**：管线从 mdast 构建 ProseMirror 文档的同时，为每个顶层块记录它在原文中的区间（mdast 节点的 `position.start.offset` / `end.offset`），存进一个 `WeakMap<Node, {from, to}>`，再记下“原文快照”。
2. **序列化时**：逐个处理新文档的顶层子节点：
   - 节点仍是 WeakMap 里的同一个对象 → 原样输出原文区间 `source.slice(from, to)`；
   - 否则 → 用 vmark 管线的规范序列化输出这个块；
   - 块之间的分隔：前后两个块都是原样输出、且在原文里也相邻时，沿用原文中它们之间的空白；否则用规范分隔（一个空行，或按 vmark `blankLinesBefore` 属性还原的空行数）。
3. **校验**：拼出结果后，把它重新解析成 ProseMirror 文档，和“全部用规范序列化”的结果解析出来的文档做结构比较。如果不一致（例如保留下来的缩进或空行改变了相邻块的含义，像列表合并、懒惰续行），就退回到更保守的策略：只保留块本身，分隔用规范写法；再不行就整篇规范序列化。这一层“写出前校验”的思路参考 quiet-md 的 `markdown.rs` 中 `preserve()` / `reads_as()`。
4. **基线滚动**：每次成功推送后，把这次的输出作为新的“原文快照”。WeakMap 按新的输出重建（重新解析一次，在空闲时执行），保证下一轮比较的基准是磁盘上的最新内容。

### 6.3 风险与 M0 要验证的点

- **初始规范化**：vmark 某些插件可能在载入后用 `appendTransaction` 修改节点属性，导致没碰过的节点也变成了新对象。M0 要统计“载入后不编辑，有多少顶层节点不再是同一个对象”，目标是 0。
- **嵌套改动**：改了列表里的一项，整个列表块会按规范格式重写（列表符号、缩进可能变化）。v1 接受这个粒度，验收指标（≥ 98%）按“diff 只出现在改动的**顶层**块内”计算。如果实测问题集中在列表，再把粒度细化到列表项。
- **frontmatter**：作为独立块原文保留，只有在元数据区编辑后才重写。
- 大文档：序列化只处理改动的块，未改动块直接切片，耗时和改动量成正比。

### 6.4 回归测试

- 语料：`testdata/fidelity/`，≥ 200 个文件（主流开源项目文档、中文文档、AI 生成的报告、边界语法样例、CRLF/BOM/混合换行样例）。
- 在 Node（vitest + jsdom）里运行，每次提交都跑：
  1. 解析 → 不编辑 → 序列化：逐字节相等，100%；
  2. 随机挑一个顶层块做一次编辑（插入字符、切换加粗、删除一行）→ 序列化：比较前后文本，diff 只能落在被编辑块的原文区间内，≥ 98%；
  3. 规范序列化 → 重新解析：文档结构不变（管线自身的往返正确性）。
- 每个失败用例输出原因分类，作为改进依据。

## 7. 安全设计（NF5）

LiteMd 的页面是 mygo 意义上的“受信任页面”（可以调用绑定的 Go 方法），而它要渲染来自文件的、不可信的 HTML。主要防线：

| 层 | 措施 |
|---|---|
| 内容过滤 | Markdown 中的原始 HTML 经过 DOMPurify 白名单过滤（迁自 vmark 的 `htmlSanitizer`）：去掉 `script`、`iframe`、`object`、`embed`、`form`、全部 `on*` 属性、`javascript:`/`vbscript:`/`data:text/html` 链接 |
| CSP | 前端 `index.html` 设置 `Content-Security-Policy`：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' lmasset: data: blob: https: http:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'`。即使过滤有漏洞，注入的脚本也不能执行。`unsafe-inline` 样式是 KaTeX 和 Mermaid 需要的 |
| Mermaid | `securityLevel: "strict"`，渲染结果再过一遍 DOMPurify |
| 导航 | `OnWillNavigate`：只允许前端自身的地址，其余一律取消；`http(s)` 交给 `Links.open` 用系统浏览器打开 |
| 新窗口 | `SetWindowOpenHandler`：一律不在应用内开窗口；只有用户点击触发的 `http(s)` 才交给系统浏览器 |
| 后端接口 | 绑定的方法很少，并且都按调用者窗口限定作用域：不提供“按任意路径读写”的接口；图片协议只提供图片类文件；写盘只发生在文档本身、文档目录下的 assets 目录、用户在保存对话框里选的路径 |
| 导出 HTML | 导出内容同样经过过滤；导出文件里不包含任何脚本 |
| 网络 | 除检查更新和网络图片（都可关闭）外，没有任何网络请求；不加载远程字体和脚本，所有资源都打包在本地 |

## 8. 前端设计

### 8.1 页面启动流程

```
main.tsx
  → Session.ready()（拿到 docToken、设置、按文件状态、只读/编码信息）
  → Doc.content()（拿到正文）
  → 决定初始模式（D1：默认预览；或按文件记住的模式；Lossy 时强制预览；> 5 MB 默认源码，> 20 MB 只读源码）
  → 渲染外壳和对应模式的编辑器
  → 订阅事件：command / flush / settings-changed / onDocumentState / onDocumentReload / onFileDrop
```

**首屏速度（NF1）**：

- 代码按模式拆包：预览和所见即所得共用 Tiptap 这一包；CodeMirror 单独一包；Mermaid、KaTeX 字体、highlight.js 语言包、导出模块全部懒加载。
- 预览模式不加载 CodeMirror。
- 首屏目标：已运行时打开新文件 < 400 ms，M0 实测。WebView 本身的创建开销（尤其 WebView2）是主要的不确定因素。

### 8.2 四种模式

| 模式 | 实现 | 切换 |
|---|---|---|
| 预览 | Tiptap，`editable: false`，同一套扩展（浮层、输入规则等编辑类扩展不装） | — |
| 所见即所得 | Tiptap，全部扩展 | 从预览切换：沿用同一个 Tiptap 实例，只切 `editable`，**不重新解析** |
| 源码 | CodeMirror 6 + `@codemirror/lang-markdown`、查找、多光标、自动配对、列表续写 | 进入：先用保真写回层序列化（不编辑时文本不变），再载入 CodeMirror。离开：重新解析文本，建新的 Tiptap 文档，并重建保真基线 |
| 分屏 | 左 CodeMirror、右只读 Tiptap。预览按防抖（200 ms，大文档 500 ms）整篇重新解析；按顶层块 key 复用节点，减少 DOM 变动 | 双向同步滚动：用块级“源码行号 ⇄ 预览块”映射（vmark 的 `sourceLineAttr`） |

模式切换时的光标和滚动对齐（F3.6）复用 vmark 的 `cursorSync`。

### 8.3 外壳组件

- **状态栏**：模式切换、字数（F5.10，在 Web Worker 里统计，避免阻塞输入）、编码/只读标记；可隐藏。
- **提示条**：外部修改冲突、文件被删除、只读、非 UTF-8、“未命名文档请先保存再粘贴图片”。
- **大纲**（F7.1）：从 ProseMirror 文档（或源码模式下的 mdast）提取标题，点击跳转，滚动时高亮当前章节。
- **查找替换**（F7.2/F7.3）：所见即所得用 vmark 的 `search` 扩展；源码用 CodeMirror 的 search；预览用同一个 `search` 扩展的只读模式。
- **设置窗口**：单独的 mygo 窗口（`URL: "/settings"`），同一个前端包内的另一个路由。
- **启动窗口**：路由 `/start`，见第 3.3.1 节。

### 8.4 国际化

- Go 侧（菜单、对话框、mygo 自身文案）：mygo i18n，`locales/zh-Hans.json`、`locales/en.json`。
- 页面：i18next，扁平键名（沿用 vmark 的规范），只保留迁入组件实际用到的键。

## 9. 测试策略

| 层 | 工具 | 内容 |
|---|---|---|
| Go 单元测试 | `go test` | `MdContent` 读写（BOM、CRLF、GB18030、非法字节）、资源协议的路径和类型校验、图片落盘命名、设置迁移、LRU |
| 管线与保真 | vitest（Node） | 第 6.4 节回归语料；vmark 迁入的管线测试一并迁入 |
| 编辑器行为 | vitest + jsdom；关键用例用 Playwright WebKit | 输入规则、列表、表格、粘贴、模式切换前后文本不变 |
| 同步协议 | vitest + 假的 Go 客户端 | 防抖、flush 序号、超时、冲突提示 |
| 端到端 | mygo e2e（macOS 桌面会话）+ 手工冒烟清单 | PRD 第 7 节第 4 条的冒烟项 |
| 输入法 | 手工 | PRD 第 7 节第 5 条 |
| 性能 | 脚本 + 基准文档（100 KB / 1 MB / 5 MB） | NF1–NF3：打开耗时、输入延迟、内存 |

CI：PR 上跑 Go 测试、前端类型检查、lint、单元测试和保真回归，并在 macOS/Windows/Linux 上构建；`main` 分支保护要求这些全部通过。

## 10. 里程碑与任务拆分

### M0 技术验证（约 1 周）：每一项都给出“通过/不通过”的结论

| # | 验证项 | 通过标准 | 不通过时的退路 |
|---|---|---|---|
| V1 | mygo `NewDocuments` + WebView 页面：一个文件一个窗口、单实例、Finder 双击打开、自动保存、恢复副本 | macOS 和 Windows 上都正常 | 向 mygo 提 issue；必要时自己实现缺的部分 |
| V2 | 关窗/退出两阶段收齐（第 5.2 节），以及 `OnClose` 监听器的先后顺序 | 快速输入后立刻关窗或退出不丢内容 | 改为每次按键都推送轻量“脏标记”+ 更短的防抖 |
| V3 | 抽出 `markdownPipeline` 在 Node 下单独跑通；用 200 份语料测“解析 → 序列化”的往返情况 | 得到基线数据 | — |
| V4 | 第 6 节保真写回的原型：未编辑时节点对象保持不变；随机编辑的 diff 只落在改动块内 | ≥ 98% | 细化到列表项粒度，或改为以源码为主的编辑方式 |
| V5 | Tiptap 和 CodeMirror 在 WKWebView、WebView2 下的中文输入法 | 组字、候选框、快捷键都正常 | 针对性修补（vmark 的 compositionGuard 已覆盖一部分） |
| V6 | 性能：冷启动、已运行时打开新文件、1 MB 文档输入延迟、单窗口内存 | 接近 NF1–NF3 | 调整预览实现（例如预览改为纯 HTML 渲染）或调整阈值 |
| V7 | 启动窗口（第 3.3.1 节）：无文件启动、点 Dock、从启动窗口新建/打开/拖入、取消打开对话框、关闭启动窗口时的退出行为 | macOS、Windows 上都符合 F1.12 | 调整开关窗顺序；必要时在 Windows 上自己接管 `OnWindowAllClosed` |

### M1 MVP / alpha（约 3 周）

1. 工程骨架：mygo 项目、Vite/React、Bun 补丁、CI；启动窗口。
2. Go：`MdContent` 读写、窗口、Session/Assets/Links 服务、`lmasset` 协议、菜单和命令转发、两阶段收齐。
3. 前端：迁入管线和第 4.2 节的 P0 扩展、宿主装配、`host` 适配层。
4. 预览、所见即所得、源码三种模式及切换；保真写回层。
5. 查找（F7.2）、状态栏、提示条（冲突、只读、编码）。
6. 安全：DOMPurify、CSP、导航和新窗口拦截。
7. macOS 签名公证打包、Windows 安装包。

### M2 beta（约 2 周）

分屏与同步滚动、Mermaid（懒加载）、脚注、提示块、details、图片粘贴和拖入、大纲、替换、浮动格式栏、导出 HTML/PDF/打印、深浅色和字号、设置窗口、自动更新、中英文界面。

### v1.0（约 1 周）

补齐保真语料并达标、性能测量与优化、冒烟与输入法验收、文档（README、下载页的 SmartScreen 说明）、正式图标（D5）、发布。

## 11. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| mygo 很年轻（v0.9），API 可能变化，平台上的边角问题未经大规模验证 | 中–高 | 锁定版本；M0 覆盖所有用到的能力；能力边界内的问题向上游提 issue；必要时 fork 打补丁（MIT） |
| 保真写回达不到 98% | 高（D3 阻断发布） | M0 的 V4 先验证；退路见第 10 节 |
| vmark 上游迭代快、不收 PR | 中 | 迁入后单向挑选上游改动，不追求同步；迁入代码保留原目录结构，方便对比 |
| vmark 依赖的补丁在依赖升级时失效 | 中 | 锁定版本；补丁有对应测试；升级依赖时专门处理 |
| WebView 差异（WebView2、WebKitGTK）导致输入法、选区问题 | 中 | M0 的 V5；Linux 只做尽力支持 |
| Windows 不签名带来的 SmartScreen 警告影响安装转化（D6） | 低–中 | 下载页说明；以后视用户量再申请证书 |
| 每个窗口一个 WebView，开很多窗口时内存高 | 中 | NF3 测量；空闲窗口释放懒加载模块；大文档默认源码模式 |

## 12. 许可

- 本仓库：Apache-2.0。
- 迁入的第三方代码：vmark（ISC）、mygo（MIT，作为依赖）、Tiptap/ProseMirror/CodeMirror/KaTeX/Mermaid/unified 生态/DOMPurify（MIT 或 Apache-2.0 等宽松许可）。都与 Apache-2.0 兼容。
- `THIRD_PARTY.md` 列出所有迁入和打包的第三方代码、版本、许可和来源 commit；从 vmark 迁入的文件保留原版权声明。
