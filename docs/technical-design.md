# LiteMd 技术实现方案

| 项 | 内容 |
|---|---|
| 版本 | v0.2（草案） |
| 日期 | 2026-11-13 |
| 依据 | `docs/product-requirements.md` v0.3 |
| 调研基线 | mygo main `6eaa7fb`（v0.9.0，2026-11-13）；vmark main `01bf9f4`（0.9.120，2026-11-12） |
| 修订 | v0.2：按方案评审结果修订，逐条对照 mygo、vmark 源码，修正启动窗口、内容同步、保真写回、编码、安全等处的缺陷，见附录 A。v0.2.1：前端包管理由 Bun 改为 pnpm（第 1.2 节） |

本文的“需求编号”（F1.2、NF5 等）指 PRD 中的条目，“决策编号”（D1–D15）指 PRD 第 10 节。文中引用的 mygo、vmark 源码位置都以上面的调研基线为准。

---

## 1. 总体架构

```
┌──────────────────────────── LiteMd 进程（Go，单实例） ────────────────────────────┐
│                                                                                   │
│  mygo.App ── RequestSingleInstanceLock / OnOpenFile / OnSecondInstance            │
│     │                                                                             │
│     ├─ mygo.NewDocuments[MdContent]   ← 一个文件一个窗口、自动保存、恢复副本、       │
│     │      Read / Write（编码、BOM、换行符）  外部修改检测、最近打开                 │
│     │                                                                             │
│     ├─ Bind 服务：Session（内容同步/文档操作）  Start（启动窗口）  Assets（图片）    │
│     │            Links（打开链接）  Export（HTML/PDF/打印）  Settings  Shell        │
│     │                                                                             │
│     ├─ Protocol "lmasset"  ← 按窗口作用域提供文档引用的本地图片                     │
│     ├─ 菜单（文件/编辑/段落/格式/视图/窗口/帮助）→ 事件发给对应窗口的页面            │
│     └─ 设置与按文件状态存储（PathUserData 下的 JSON）                               │
│                                                                                   │
│        │ 生成的 TS 客户端（类型化 IPC） + 事件                                      │
│        ▼                                                                          │
│  ┌──────────────── 每个文档窗口：系统 WebView（WKWebView / WebView2 / WebKitGTK） ─┐ │
│  │  React 外壳：模式切换、状态栏、提示条、大纲、查找替换                           │ │
│  │   ├─ 预览 / 所见即所得  同一个 Tiptap 3 实例，只切换 editable                   │ │
│  │   ├─ 源码     CodeMirror 6                                                     │ │
│  │   └─ 分屏     CodeMirror 6 + 只读 Tiptap 预览                                  │ │
│  │  Markdown 管线：remark/mdast ⇄ ProseMirror（迁自 vmark）+ 保真写回层（新写）    │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  导出/打印窗口：隐藏、Untrusted 页面，只载入自包含的导出 HTML，不能调用任何 Go 方法   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**核心原则：Markdown 文本是唯一的真实数据。**

- Go 侧的文档内容就是一段 Markdown 文本（外加编码元数据）。读写盘、自动保存、恢复副本、外部修改检测都在 Go 侧，由 mygo `NewDocuments` 完成。
- 页面侧持有编辑状态（ProseMirror 文档或 CodeMirror 文本），**只在用户确实编辑之后**把 Markdown 文本推给 Go（第 5 节）。
- 页面只能通过显式绑定的少数几个服务影响磁盘，所有服务都按“调用者窗口所属的文档”限定作用域。**不绑定 mygo 自带的 `DocumentService`**，页面需要的文档操作由 `Session` 服务包装（第 3.4 节），以便加入序号、收齐和 LiteMd 自己的确认流程。

### 1.1 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面框架 | **mygo**（Go，MIT），锁定具体版本 | 系统 WebView，纯 Go 不用 cgo，`NewDocuments` 提供文档窗口全套行为 |
| Go 版本 | Go 1.27.3+（mygo 的 go.mod 要求） | |
| 编码转换 | `golang.org/x/text`（GB18030、UTF-16） | F2.6、D14 |
| 前端构建 | Vite + TypeScript，**pnpm** 作包管理和脚本，Node.js 24 LTS（不低于 22.6） | 与 vmark 一致，vmark 的依赖补丁可原样迁入；不使用 Bun，见第 1.2 节 |
| mygo CLI | 通过 `go.mod` 的 `tool` 指令固定版本，用 `go tool mygo …` 运行 | CLI 与 mygo 库版本始终一致，不需要 npm 包 `mygo-cli` |
| UI 框架 | React 19 + zustand（只管单窗口内的状态） | vmark 组件都是 React |
| 所见即所得 | Tiptap 3（ProseMirror） | 迁自 vmark |
| 源码编辑 | CodeMirror 6 | 迁自 vmark |
| Markdown 管线 | unified / remark-parse / remark-stringify / remark-gfm / remark-math / remark-frontmatter | 迁自 vmark `src/utils/markdownPipeline` |
| 公式 | KaTeX | |
| 图表 | Mermaid（懒加载） | |
| 代码高亮 | lowlight（highlight.js 语法） | 只打包常用约 30 种语言 |
| HTML 过滤 | DOMPurify | |

### 1.2 包管理与工具链：pnpm

选 pnpm、不用 mygo 模板默认的 Bun。依据（mygo `6eaa7fb` 源码）：

- mygo 对 Bun 没有硬依赖：读取 `mygo.config.ts` 时优先用 Bun，没有则用 Node.js 22.6+（`cmd/mygo/config_ts.go`）；`mygo init` 找不到 Bun 只给出警告；`mygo doctor` 把 Bun 列为可选；`devCommand` / `buildCommand` 只是普通命令。
- vmark 用 pnpm，它的 6 个依赖补丁是 pnpm 的 `patchedDependencies` 格式，**可以原样迁入**；以后从 vmark 挑选改动时补丁也不用转换。
- 测试用 vitest，本来就跑在 Node.js 上。

约定：

| 项 | 做法 |
|---|---|
| pnpm 版本 | `frontend/package.json` 的 `packageManager` 字段写死具体版本，通过 Corepack 启用（`corepack enable`）；CI 用同一版本 |
| Node.js 版本 | 根目录 `.nvmrc` 写 24；`frontend/package.json` 的 `engines.node` 写 `>=22.6`，`frontend/.npmrc` 设 `engine-strict=true`（与 vmark 相同），版本不符时安装直接失败 |
| 锁文件 | 提交 `frontend/pnpm-lock.yaml`；CI 一律 `pnpm install --frozen-lockfile` |
| 依赖补丁 | 补丁文件放 `frontend/patches/`，在 `frontend/pnpm-workspace.yaml` 的 `patchedDependencies` 中登记。补丁按“包名@精确版本”匹配，被补丁的包在 `package.json` 中写**精确版本**（不带 `^`），升级时用 `pnpm patch` / `pnpm patch-commit` 重新生成。更换 pnpm 大版本时确认 `patchedDependencies` 的写法 |
| 供应链 | 参照 vmark，在 `pnpm-workspace.yaml` 设 `minimumReleaseAge`（如 7 天），新发布的版本过了观察期才会被解析进锁文件 |
| 依赖构建脚本 | 只允许确有需要的包执行安装脚本（pnpm 默认不执行依赖的 `postinstall`，需要的在 `onlyBuiltDependencies` 中列出） |
| mygo 配置 | `mygo.config.ts` 由 Node.js 执行，因此只能用“可去除类型”的 TS 语法（不能用 `enum` 等），见 mygo `docs/configuration.md` |
| 常用命令 | 根目录：`go tool mygo dev`、`go tool mygo build`、`go tool mygo generate`；`mygo.config.ts` 中 `devCommand: "pnpm -C frontend dev:web"`、`buildCommand: "pnpm -C frontend build:web"`。前端：`pnpm -C frontend test` / `typecheck` / `lint` |

M0 的 V1 顺带确认：web 模板的项目用 `go tool mygo` 运行 CLI（mygo 文档只在 native 模板中示范了这种用法），以及 `mygo generate` 把客户端写到 `frontend/src/mygo.ts`（`frontend/package.json` 依赖 `mygo-runtime` 时的默认位置）。

## 2. 仓库结构

```
litemd/
├── mygo.config.ts            # 应用名、标识、文件关联（只含 Markdown 扩展名）、更新、打包配置
├── go.mod / main.go          # 入口：单实例、NewDocuments、菜单、协议、绑定；go.mod 用 tool 指令固定 mygo CLI
├── .nvmrc                    # Node.js 版本
├── internal/
│   ├── doc/                  # MdContent、Read/Write、编码与换行符处理、另存为 UTF-8
│   ├── session/              # Session 服务：内容同步（序号、脏标记、收齐）、文档操作包装
│   ├── start/                # 启动窗口
│   ├── cli/                  # 命令行参数中 mygo 不投递的部分（不存在的文件、.txt）
│   ├── assets/               # lmasset 协议、图片落盘、拖入、网络图片单张加载、路径校验
│   ├── links/                # 打开相对 .md 链接、外部链接、本地文件（可执行文件拦截）
│   ├── export/               # HTML 写盘、PDF、打印（Untrusted 隐藏窗口）
│   ├── settings/             # 设置读写与广播
│   ├── filestate/            # 按文件记住的模式、大纲开关、窗口状态（LRU）
│   └── menu/                 # 菜单定义与快捷键（自建文件菜单）
├── locales/                  # Go 侧文案（mygo i18n）：zh-Hans.json、en.json
├── frontend/
│   ├── package.json / vite.config.ts / tsconfig.json
│   ├── pnpm-lock.yaml        # 提交
│   ├── pnpm-workspace.yaml   # patchedDependencies、minimumReleaseAge 等 pnpm 设置
│   ├── .npmrc                # engine-strict=true
│   ├── patches/              # micromark、mdast-util-*、prosemirror-view 的补丁（pnpm 格式，迁自 vmark）
│   └── src/
│       ├── main.tsx          # 页面入口（路由：/ 文档、/start 启动窗口、/settings 设置）
│       ├── mygo.ts           # mygo generate 生成的客户端（不手改）
│       ├── shell/            # 窗口外壳：模式切换、状态栏、提示条、大纲、查找
│       ├── modes/            # preview-wysiwyg/ source/ split/
│       ├── sync/             # 页面 ⇄ Go 的内容同步协议（第 5 节）
│       ├── fidelity/         # 保真写回层（第 6 节）
│       ├── host/             # 平台适配层：替代 vmark 里的 @tauri-apps 调用
│       ├── vmark/            # 迁入的 vmark 代码，保持原目录结构（第 4 节）
│       ├── settings/ i18n/ styles/
│       └── test/
├── testdata/fidelity/        # 保真度回归语料（≥ 200 个 .md，含 vmark 的 23 份）
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
    // 必须在 NewDocuments 之前注册：mygo 的文档退出监听是在 NewDocuments 里注册的，
    // 收齐要排在它前面（第 5.3 节）。
    session.InstallQuitFlush()
    start.TrackOpenFiles()                                   // 同理，先于 mygo 记下启动时要打开的文件（第 3.3.1 节）
    assets.Register()                                        // 注册 lmasset 协议，须在建窗口前
    docs := mygo.NewDocuments(mygo.DocumentsOptions[doc.MdContent]{
        Types: []mygo.DocumentType{
            {Name: "Markdown Document", Extensions: []string{"md", "markdown", "mdown", "mkd"}},
            {Name: "Plain Text", Extensions: []string{"txt"}}, // 只用于打开对话框；不在 fileAssociations 里
        },
        Read:          doc.Read,
        Write:         doc.Write,
        Equal:         doc.Equal,
        Window:        newDocWindow,
        Autosave:      settings.AutosaveMode(),              // D2 默认开启；D11 修改后重启生效
        AutosaveDelay: time.Second,                          // F2.2：约 1 秒
        NoUntitled:    true,                                 // F1.9/D7：不自动新建，改为显示启动窗口
    })
    cli.Install(docs)                                        // F1.5：不存在的文件、.txt
    start.Install(docs)                                      // F1.12：启动窗口
    mygo.Bind(session.New(docs), start.NewService(docs), &assets.Service{}, &links.Service{},
        &export.Service{}, &settings.Service{}, &shellSvc{})
    menu.Install(docs)                                       // 自建文件菜单（第 3.6 节）
    if err := mygo.App.Run(); err != nil { log.Fatal(err) }
}
```

mygo `NewDocuments` 提供以下能力，**不自己写**；与 PRD 有出入的地方已在 PRD D8–D12 中调整：

| PRD | mygo 提供的行为 | 与 PRD 的出入及处理 |
|---|---|---|
| F1.2 | 同一文件再次打开时聚焦已有窗口（按路径和 `os.SameFile` 判断） | — |
| F1.6 | 新建、打开、最近打开（含系统 Dock 菜单和跳转列表）、关闭 | 最近打开固定 10 个（`recent_docs.go` 的 `maxRecentDocuments`），D8 |
| F1.7 | 标题显示文件名；macOS 关闭按钮圆点，Windows/Linux 标题前加 `*` | — |
| F1.11 | macOS 标题栏代理图标 | — |
| F2.1 | 保存、另存为、副本、重命名、移动到、还原 | 文件菜单自建（第 3.6 节），快捷键按 D9 |
| F2.2 | 自动保存：停止编辑后 `AutosaveDelay` 写盘，持续编辑时至少每 30 秒写一次，失焦和关闭时也写；未命名、只读、冲突、已删除的文档不自动保存，关闭时询问 | 自动保存模式只能在 `NewDocuments` 时设定，D11 |
| F2.3 | 恢复副本：写在 `PathUserData/Recovery/`，崩溃后下次启动自动恢复为“已编辑”状态 | mygo 静默恢复；提示条由页面补上，D10、第 3.3 节 |
| F2.4 | 监听文件变化，窗口获得焦点时再检查一次：无本地改动则重新读入并发 `onDocumentReload`；有改动则进入冲突状态；跟踪重命名；文件被删除时保持窗口打开 | “本地改动”要包括页面里尚未推送的输入，靠脏标记解决（第 5.2 节）。冲突时主动保存、关窗由 mygo 弹系统对话框，D12 |
| F2.7 | 原子写盘：临时文件 + `NSFileManager replaceItemAtURL` / `ReplaceFileW` / rename，保留权限、扩展属性、ACL | — |

mygo 不提供、由 LiteMd 自己实现的部分：

| 需求 | 原因（mygo 源码） | LiteMd 的做法 |
|---|---|---|
| F1.5 命令行打开不存在的文件、打开 `.txt` | `fileArgs`（`deeplink.go`）只投递已存在、且扩展名在 `fileAssociations` 里的文件 | `cli` 包处理剩下的参数（第 3.8 节） |
| F1.8 新窗口层叠 | 没有层叠逻辑，`X`、`Y` 都为 0 时居中 | `newDocWindow` 自己计算位置（第 3.3 节） |
| F1.12 判断“无文件启动” | 没有“启动时的打开流程已结束”的回调；恢复和打开都在 goroutine 里异步进行 | 计数 + 短暂等待（第 3.3.1 节），并向上游提需求 |

### 3.2 文档内容模型 `MdContent`

```go
type MdContent struct {
    Text     string // 归一化后的正文：去掉 BOM，换行统一为 \n
    BOM      bool   // 原文件有 UTF-8 BOM
    EOL      string // "\n" 或 "\r\n"：原文件的主要换行符
    Encoding string // "utf-8"、"utf-16le"、"utf-16be"、"gb18030"
    Lossy    bool   // 不是 UTF-8：只读，禁止写回（F2.6、D14）
}
```

- **Read**：读入字节，然后依次处理：
  1. 有 UTF-8 BOM：去掉，`BOM = true`；
  2. 有 UTF-16 LE/BE BOM：按 UTF-16 解码，`Encoding = "utf-16le"/"utf-16be"`，`Lossy = true`；
  3. 校验 UTF-8，合法则 `Encoding = "utf-8"`；
  4. 不合法时一律按 GB18030 解码用于显示，`Encoding = "gb18030"`、`Lossy = true`。GB18030 几乎能解码任何字节序列，所以这一步不会失败；对 Shift-JIS、Latin-1 等文件会显示乱码，D14 接受这一点（v1 不做编码识别和手动选择）；
  5. 统计 `\r\n` 和单独 `\n` 的数量，取多数作为 `EOL`，再把正文统一成 `\n`。
- **Write**：`Lossy` 为真时返回错误（这种文档永远不会被编辑，见下文，所以正常流程走不到这里，只是兜底）。否则把 `\n` 还原成 `EOL`，按需补回 BOM，写出 UTF-8。mygo 的恢复副本也通过 `Write` 写、`Read` 读，两者对 UTF-8 文档互逆。
- **Equal**：比较全部字段。撤销回原文时，文档会回到“未编辑”状态。
- **非 UTF-8 文档（`Lossy`）**：
  - 页面侧强制只读预览，显示提示条（F2.6）；页面不推送内容，文档始终“未编辑”，因此不会自动保存，也不会写恢复副本；菜单里的保存类命令置灰。
  - 「另存为 UTF-8」调用 `Session.saveAsUTF8()`，**不走 mygo 的 `SaveAs`**（那样会经过拒绝写回的 `Write`，也会把当前文档改指向新路径）：Go 弹保存对话框（默认同目录、同名加 `.utf8` 后缀）→ 用 `internal/doc` 自己的原子写入写出 UTF-8 文本（换行符按 `EOL`）→ 关闭当前窗口 → `docs.Open(目标路径)` 打开新文件。用户选了原路径时，先关闭当前窗口再打开，避免 `Open` 只聚焦旧窗口。
- **只读**：权限只读的文件由 mygo 的 `State().ReadOnly` 给出（F2.8）。
- **混合换行符**：同一文件里 `\r\n` 和 `\n` 混用时，**只要不编辑就不会写盘**（F2.5①）；编辑后统一为占多数的那种。这是 PRD F2.5④ 中写明的已知例外。

### 3.3 文档窗口

```go
func newDocWindow(d *mygo.Document[doc.MdContent]) *mygo.Window {
    path := d.State().Path
    x, y := cascadeFrom(mygo.FocusedWindow())               // F1.8：有记录的窗口状态会覆盖它
    w := mygo.NewWindow(mygo.WindowOptions{
        URL:             "/",
        X: x, Y: y, Width: 880, Height: 1000, MinWidth: 420, MinHeight: 320,
        BackgroundColor: "light-dark(#ffffff, #1e1e1e)",    // 避免白屏闪烁
        StateKey:        filestate.WindowKey(path),          // 未命名文档为 ""
    })
    session.Attach(w, d)   // 第 5 节：OnClose 收齐。必须在 mygo attach 之前注册，这里正好满足
    hardenPage(w)          // 第 7 节：导航拦截、新窗口处理、拖入路径登记
    start.Close()          // 第 3.3.1 节：任何文档窗口出现，就关掉启动窗口
    return w
}
```

- **监听器顺序**：mygo 在 `Window` 回调返回之后才调用 `attach` 注册自己的 `OnClose`（`document.go` 的 `show`），所以在 `newDocWindow` 里注册的监听一定排在它前面。
- **层叠（F1.8）**：`cascadeFrom` 取当前聚焦的文档窗口位置向右下各偏移 24 pt，超出屏幕则回到左上角附近；没有聚焦窗口时返回 `0, 0`（mygo 居中）。有 `StateKey` 记录的窗口，记录会覆盖 `X`、`Y`。
- **按文件记住窗口状态（F1.8）**：mygo 的默认存储会让 `window-state.json` 随打开过的文件数无限增长，因此通过 `App.SetWindowStateStore` 接入 `filestate`，用 LRU 只保留最近 500 个文件。
- **恢复的文档（D10）**：mygo 从恢复副本重建的文档，在 `Window` 回调被调用时已经是“已编辑”状态，而正常打开的文档不是。LiteMd 自己发起的“副本”操作也会产生已编辑文档，菜单处理时先登记，回调里排除。由此得到 `recovered` 标记，经 `Session.ready()` 交给页面显示提示条：
  - 「保留」：只关闭提示条；
  - 「丢弃，载入磁盘版本」：有路径的文档调用 `Document.Revert()`；未命名文档调用 `SetEdited(false)` 后关闭窗口（未编辑的文档关闭时 mygo 会删除恢复副本）。

### 3.3.1 启动窗口（F1.9、F1.10、F1.12、D7）

mygo 在 `NoUntitled: true` 时，启动和点 Dock 重新激活都不会自动新建未命名文档（`document_flow.go` 中对 `noUntitled` 的两处判断），由 LiteMd 接管。难点是**判断“无文件启动”**：

- mygo 的启动顺序是 `WhenReady` 回调 → `launchArgs` 投递命令行文件 → `startDocuments` 在 goroutine 里恢复副本、打开文件（`app.go` 的 `handleReady`）。所以 `WhenReady` 时 `docs.Documents()` 必然为空，不能据此判断；
- mygo 没有“启动打开流程结束”的回调。

做法（向上游提需求 `Documents.WhenStarted` 之类的回调；合入前用以下办法）：

```go
// internal/start
var pending atomic.Int32 // 已知要打开、但窗口还没出现的文件数

func TrackOpenFiles() {                                  // 在 NewDocuments 之前调用
    mygo.App.OnOpenFile(func(path string) { pending.Add(1); expire(path) })
}

func Install(docs *mygo.Documents[doc.MdContent]) {
    mygo.App.WhenReady(func() { time.AfterFunc(300*time.Millisecond, showIfIdle) })
    mygo.App.OnActivate(func(visible bool) {             // macOS 点 Dock
        if !visible { showIfIdle() }
    })
}

func showIfIdle() {
    if len(docs.Documents()) > 0 { return }             // 带文件启动，或恢复了崩溃前的文档
    if pending.Load() > 0 && waited < 3*time.Second {    // 还有文件在读：稍后再看
        time.AfterFunc(100*time.Millisecond, showIfIdle); return
    }
    show()                                               // 全局只有一个，已存在则聚焦
}
```

- `pending` 在对应文档窗口出现时（`newDocWindow`）或超时（打开失败时 mygo 只弹错误框，不通知应用）后减一；`cli` 包处理的参数同样计入。
- 300 ms 是给恢复副本留的时间（读本地小文件，通常远小于此）。即使极端情况下启动窗口先出现，文档窗口一出来它就会被关掉（规则②），只是闪一下。V7 实测这个时间。
- 启动窗口是同一个前端包里的路由 `/start`，只引入外壳样式，**不加载 Tiptap、CodeMirror**；窗口选项 `Width: 560, Height: 540, DisableResize: true`，`X`、`Y` 为 0 即居中。
- 两个按钮调用 `Start.newDocument()` → `docs.New()`、`Start.open()` → `docs.OpenDialog()`；这两个方法检查调用者必须是启动窗口。取消打开对话框时什么都不做，启动窗口保留。
- 拖入文件：`win.OnFileDrop` → 筛出 Markdown 扩展名和 `.txt` → 逐个 `docs.Open(path)`。
- 最近打开（F1.12⑤、D16）：`Start.recent()` 取 `mygo.App.RecentDocuments()` 的前 5 个（mygo 在打开、保存时把文件移到最前，已不存在的文件不返回；用户目录缩写为 `~`）；`Start.openRecent(path)` 只接受当前列出的路径，再 `docs.Open`；`Start.clearRecent()` 调 `mygo.App.ClearRecentDocuments()`，与菜单「清除菜单」相同。页面在加载和窗口获得焦点时刷新列表。
- 启动窗口里的 ⌘N / ⌘O 走菜单的 `RoleNew` / `RoleOpen`，与按钮效果相同。
- **关闭启动窗口**：`newDocWindow` 在文档窗口**创建之后**调用 `start.Close()`，因此 Windows/Linux 上不会出现瞬间“没有窗口”而触发退出。不能放在 `App.OnWindowCreated` 里做：那个事件在 mygo 把窗口登记到文档之前触发，`docs.ForWindow(w)` 还是 `nil`。`start.Close()` 先隐藏启动窗口，`CloseDelay`（1 秒）后再真正关闭：拖入文件时文档窗口是在页面 drop 事件中打开的，立刻销毁启动窗口的 WKWebView 会让 WebKit 的拖放回调访问已销毁的页面而崩溃（macOS 27 实测，应用 exit(2) 退出）。
- 用户关闭启动窗口：macOS 应用留在 Dock（mygo 已为文档应用把 `OnWindowAllClosed` 设为空操作）；Windows/Linux 上没有其他窗口时由 mygo 默认行为退出。

### 3.4 绑定服务（页面能调用的全部 Go 接口）

所有方法都通过 `mygo.CallerWindow(ctx)` 找到调用者窗口对应的文档，**页面不能指定任意路径去读写**。mygo 的 `DocumentService` 不绑定。

| 服务 | 方法 | 用途 / 约束 |
|---|---|---|
| `Session` | `ready()` → `{docToken, assetBase, dir, name, readOnly, lossy, encoding, recovered, settings, fileState}` | 页面启动时拿到一次性的上下文；`assetBase` 按平台给出（第 3.5 节） |
| `Session` | `content()` → `{text, seq}` | 读取正文（初次载入、外部修改重新载入后） |
| `Session` | `markDirty(seq)` | 第 5.2 节：页面出现未推送的编辑时立即调用，让 Go 侧进入“已编辑” |
| `Session` | `setContent(seq, text)` | 第 5.2 节：带序号推送正文，Go 侧丢弃过期的推送 |
| `Session` | `flushed(n)` | 回应第 5.3 节的收齐请求 |
| `Session` | `revert()` | 不再弹确认框，直接重新读盘：只供提示条（冲突、恢复）调用，提示条本身就是确认。先丢弃页面未推送的编辑（第 5.4 节） |
| `Session` | `holdConflict()` | 第 5.4 节竞态：页面暂停推送、显示冲突提示条时调用，Go 侧进入「暂停」 |
| `Session` | `saveAnyway()` | 冲突提示条「保留我的版本」；解除第 5.4 节的暂停 |
| `Session` | `discardRecovered()` | 恢复提示条「丢弃」（第 3.3 节）；同样先丢弃页面未推送的编辑 |
| `Session` | `saveAsUTF8()` | 非 UTF-8 文档另存为 UTF-8（第 3.2 节） |
| `Session` | `setFileState(state)` | 按文件保存查看模式、大纲开关、滚动位置 |
| `Session` | `setMenuState(state)` | 当前模式下哪些菜单命令可用，Go 据此置灰 |
| `Start` | `newDocument()` `open()` `recent()` `openRecent(path)` `clearRecent()` | 只供启动窗口调用（第 3.3.1 节）；其他窗口调用时拒绝 |
| `Assets` | `saveImage(bytes, mime, suggestedName)` → 相对路径 | F6.3：按设置的规则存到文档目录（默认 `./assets/`，D4），文件名冲突时加序号，大小上限 50 MB，只接受图片 MIME 类型。未命名文档返回 `ErrNeedSave`（F6.4：提示先保存） |
| `Assets` | `importDropped(paths)` → 相对路径列表 | F6.3/F6.5：**只接受本窗口最近一次 `OnFileDrop` 登记过的路径**（第 7 节）；图片复制到 assets 目录（位图按文件头定扩展名，SVG/ICO 核对内容后沿用原扩展名），非图片只计算相对路径，不复制；结果与 `paths` 一一对应，某张图片读不了、不是图片或太大时对应项为空字符串，页面跳过它，不影响其他文件 |
| `Assets` | `fetchImage(url)` → 图片字节 | F6.2：关闭“加载网络图片”后，用户点击单张图片时由 Go 下载（第 3.5 节） |
| `Links` | `open(href)` | 外部链接交给系统浏览器；相对路径的 `.md` 链接用 `docs.Open` 开新窗口（F5.5）；其他本地文件见第 7 节 |
| `Export` | `html(html, opts)` | F8.1：页面生成 HTML，Go 弹保存对话框后写盘；选“内嵌图片”时由 Go 读取图片转成 base64 |
| `Export` | `pdf(html, opts)` / `print(html)` | F8.2/F8.3：Go 生成自包含 HTML，在隐藏的 Untrusted 窗口中打印（第 7 节） |
| `Settings` | `get` `set` | 改动后 `Broadcast("settings-changed")` 通知所有窗口 |
| `Shell` | `revealInFolder` `copyPath` | F6.6 |

### 3.5 本地图片协议 `lmasset`

```
macOS / Linux：lmasset://localhost/<docToken>/<url-encoded-ref>
Windows：     http://lmasset.localhost/<docToken>/<url-encoded-ref>   （WebView2 对自定义协议的映射方式）
```

- 页面不自己拼协议名，用 `Session.ready()` 返回的 `assetBase` 拼 URL。
- `docToken` 是每个文档窗口随机生成的令牌（映射到文档所在目录），窗口关闭后失效。处理器还用 `mygo.CallerPage(r.Context())` 核对请求来自令牌所属的窗口。
- 处理器把 `ref` 按文档目录解析（相对路径、`file://`、绝对路径都支持），然后：
  - **只提供图片类文件**：按扩展名和文件头嗅探双重判断，限 png/jpg/gif/webp/avif/bmp/ico/svg；
  - **不限于文档目录及其子目录**（NF5）。Markdown 里常见 `../images/x.png` 这种写法，限死子目录会让大量文档显示不了图。代价是被攻破的页面能读到机器上任意位置的**图片**，但读不到其他类型的文件；
  - SVG 返回时附加 `Content-Security-Policy: script-src 'none'`；
  - Windows 上**文档所在共享之外的 UNC 路径**（`\\server\share\…`，来自 `//server/…`、`file://server/…` 等写法）不访问文件系统直接返回 404：打开它会连接远程主机，SMB 自动发送当前用户的 NTLM 凭据，关闭“加载网络图片”也拦不住。文档本身在网络共享上时，同一共享（卷 `\\server\share` 相同）里的图片照常显示；
  - 文件不存在返回 404，页面显示占位和原始路径（F6.7）。
- **网络图片（F6.2）**：
  - 开启时由页面直接加载。
  - 关闭时，页面启动阶段在 CSP 中去掉 `http:`、`https:`（第 7 节），这是硬性保证：原始 HTML、行内样式里的 `url()` 也加载不了。页面同时把 `http(s)` 图片换成占位。用户点击单张图片时调用 `Assets.fetchImage(url)`：只接受 `http(s)`；解析后的地址是回环、内网、链路本地地址时拒绝；响应必须是图片 MIME 类型，上限 20 MB；页面拿到字节后用 `blob:` URL 显示。
  - 关闭时的导出：PDF 和打印同样不加载网络图片。页面生成导出 HTML 时去掉网络图片的地址，改为显示替代文字（没有替代文字时显示原地址），并换用不含 `http:`、`https:` 的离线 CSP；Go 在隐藏窗口载入前也在最前面加上同一条 CSP（多条 CSP 取交集，页面送来的 HTML 无法放宽，见第 7 节）。用户单独点开过的图片是 `blob:`，照常内嵌。导出的 HTML 文件保留网络图片的原地址：它之后由用户的浏览器打开，不是本应用的网络请求。
  - 设置改动后对新打开的窗口生效；已打开的窗口在提示条中提供「重新载入」（先收齐，再重新载入页面）。

### 3.6 菜单与快捷键

- **文件菜单自建**，不用 `RoleFileMenu`。原因：`RoleFileMenu` 是整体打包的，无法单独替换其中的保存项来插入“先收齐”；而且它在 macOS 上没有“另存为”。
  - macOS：新建 ⌘N（`RoleNew`）、打开… ⌘O（`RoleOpen`）、打开最近（`RoleOpenRecent`）｜关闭 ⌘W（`RoleClose`）、保存 ⌘S、副本 ⇧⌘S、另存为… ⌥⇧⌘S、重命名…、移动到…、还原到上次保存的版本｜导出 HTML…、导出 PDF…、打印… ⌘P。
  - Windows/Linux：新建 Ctrl+N、打开… Ctrl+O、打开最近｜保存 Ctrl+S、另存为… Ctrl+Shift+S、还原｜导出、打印 Ctrl+P｜关闭、退出。
  - 保存、副本、另存为、还原、导出、打印都是自定义菜单项，`Click` 中先收齐（第 5.3 节），再调用 `Document.Save()` / `Duplicate()` / `SaveAs("")` / `Rename("")` / `MoveTo("")`。“还原”在 Go 侧先用 LiteMd 自己的文案弹确认框，再调用 `Document.Revert()`（这个公开方法本身不询问）。
  - 自定义项的可用状态在窗口焦点变化、文档状态变化（`OnStateChange`）、页面 `setMenuState` 时刷新：启动窗口和非 UTF-8 文档中保存类命令置灰。
- 编辑菜单（撤销、重做、剪切、复制、粘贴、粘贴为纯文本、全选、查找、替换）、段落菜单（标题 1–6、列表、引用、代码块、表格、公式块）、格式菜单（加粗、斜体、删除线、行内代码、链接）、视图菜单（四种模式、大纲、状态栏、字号缩放）：一律由 Go 通过 `Emit(window, "command", {id})` 发给对应窗口，页面里的命令注册表负责执行。撤销、重做也走这条路（ProseMirror 和 CodeMirror 有自己的历史，不能用 WebView 原生的撤销）。M0 要确认菜单加速键和编辑器自身的键位不会重复触发。
- 快捷键以菜单加速键为准（F3.5、F5.1、D9）。完整键位表在 M1 开始前定稿，放进 `docs/keybindings.md`。
- **输入法保护（NF9）**：页面在 `compositionstart` 到 `compositionend` 期间不执行菜单命令（vmark 的 `compositionGuard` 插件已处理编辑器内部这部分）。

### 3.7 设置与按文件状态

- 设置存在 `PathUserData/settings.json`，带 `version` 字段，新增字段一律有默认值。内容见 PRD F10。
- **自动保存开关（D11）**：`Autosave` 只能在 `NewDocuments` 时传入。设置窗口中改动后显示“重启 LiteMd 后生效”。向上游提需求支持运行中切换。
- 按文件状态存在 `PathUserData/file-state.json`：以文件绝对路径为键（Windows 上不区分大小写），LRU 保留 500 条；记录查看模式、大纲开关、滚动锚点和窗口位置大小。

### 3.8 命令行（F1.5）

mygo 只把已存在、且扩展名在 `fileAssociations` 里的文件交给 `OnOpenFile`。`cli` 包处理剩下的参数：

- 来源：首次启动时的 `os.Args`（在 `WhenReady` 之后处理）；已在运行时，第二个实例转来的参数（`App.OnSecondInstance(args, workingDir)`）。
- 按工作目录解析成绝对路径后：
  - 扩展名是 Markdown 系列或 `.txt`、文件不存在：以 `O_EXCL` 创建空文件，再 `docs.Open`；
  - `.txt` 且已存在：`docs.Open`；
  - 没有扩展名且不存在：补上 `.md` 后按上一条处理；
  - 其余情况交给 mygo，或忽略。
- 和 mygo 重复处理同一个文件没有副作用：`docs.Open` 遇到已打开的文件只会聚焦。
- macOS 上的 `litemd` 命令由设置中的「安装命令行工具」生成：在 `/usr/local/bin` 放一个调用 .app 内可执行文件的脚本。

### 3.9 自动更新与分发

| 平台 | 方案 |
|---|---|
| macOS | `mygo build` 生成 `.app` + DMG。`signingIdentity` 使用 Developer ID，`notarize` 使用 keychain profile（Apple Developer 账号已具备，2026-11-13 确认；CI 中通过 secrets 导入证书和 notarytool 凭据）。最低系统版本设为 13.0 |
| Windows | NSIS 安装包，按用户安装。**不配置 `certificate`（D6）**；下载页说明 SmartScreen 的处理方式 |
| Linux | AppImage + deb，尽力支持 |
| 文件关联 | `fileAssociations` 只列 `md` `markdown` `mdown` `mkd`，`mimeType: "text/markdown"`；不含 `txt`（PRD 3.2） |
| 更新 | `updates: { publicKey, github: "jorben/litemd" }`。用 `mygo keygen` 生成密钥对，私钥只放在 CI secrets 和密码管理器里。安装包是否可信靠这把密钥的签名校验，**和 Windows 代码签名无关**。开启增量更新 |
| CI | GitHub Actions：PR 上在三个平台构建并测试；打 `v*` tag 时构建、签名公证、发布 Release |

## 4. 从 vmark 迁入的内容

### 4.1 迁移原则

1. **只迁模块，不迁应用。** 不搬 vmark 的 `App`、工作区、标签页、store、MCP、AI、终端等；`TiptapEditor.tsx` 本身和这些深度耦合（标签页、多窗格、MCP 修订追踪），所以**外层编辑器组件自己写**，只复用它内部的扩展和工具函数。
2. **保持原目录结构，放在 `frontend/src/vmark/` 下**，文件头保留 vmark 的 ISC 版权声明，在 `THIRD_PARTY.md` 记录来源 commit。改动处加 `// litemd:` 注释，方便以后对比上游。
3. **vmark 的插件按“端口（port）注入”设计**（vmark 的 ADR-015：插件声明需要的端口和默认值，由宿主注入实现）。LiteMd 写自己的宿主装配代码（参照 vmark 的 `services/assembly/tiptapExtensions.ts` 和 `hostAdapters.ts`，大约 600 行），只装配需要的扩展。
4. 插件里直接调用 `@tauri-apps/*` 的地方统一改成调用 `frontend/src/host/` 平台适配层，适配层再转到 mygo 生成的客户端。按本次清单抽查，`linkPopup`、`imageHandler`、`editorContextMenu` 涉及 Tauri 调用，其余迁入的插件不依赖 store 和 Tauri。

### 4.2 迁移清单

| vmark 模块 | 规模 | 处理 | 对应需求 |
|---|---|---|---|
| `src/utils/markdownPipeline/` | 非测试代码约 1.1 万行（含测试约 3.6 万行） | **整体迁入，连同测试**。不依赖 store，也不调用 Tauri，但依赖少量 `@/utils/*`（`debug`、`perfLog`、`markdownUrl`、`headingSlug`、`linebreaks`、`referenceIdentity`、`mediaPathDetection`、`videoProviderRegistry`）和 `@/lib/extensions/*`（`claim`、`pmConverterRegistry`），一并迁入 | F4、F2.5 |
| `markdownPipeline/__tests__/fidelity/`、`characterization/` | — | 迁入，作为保真回归的起点（第 6.5 节） | 第 7 节验收 |
| `patches/`：micromark、mdast-util-from-markdown、mdast-util-to-markdown、micromark-extension-gfm-autolink-literal、mdast-util-find-and-replace、prosemirror-view | 6 个补丁 | **原样迁入**（vmark 同为 pnpm 格式），登记到 `pnpm-workspace.yaml`；被补丁的包锁定为补丁对应的精确版本（xterm 的补丁不迁） | 性能、病态输入 |
| `src/services/assembly/` 中的扩展装配 | 约 4000 行 | 参照它重写成 LiteMd 自己的装配（只取需要的扩展） | — |
| `src/components/Editor/alignedTableNodes.ts`、`tiptapContentLoad.ts`、`tiptapInitialLoad.ts` 等工具 | 少量 | 迁入并去掉 store 依赖 | F4.2 |
| `src/components/Editor/SourceEditor.tsx` + `sourceEditorExtensions.ts` | 约 450 行 | 参照重写 | F3.3、F5.7 |
| `src/components/Editor/MarkdownSplitView.tsx`、`DocumentSplit/` | 少量 | 迁入 | F3.4 |
| `src/utils/cursorSync/` | — | 迁入：模式切换时对齐光标和滚动位置 | F3.6 |
| `src/export/` 中的 HTML 导出部分（`createExportExtensions`、`htmlExport`、`htmlSanitizer`、`htmlTemplates`、`katexFontEmbed`、`pdfHtmlTemplate`、`exportStyles.css`） | 约 3000 行（全部约 7100 行） | 只迁 HTML/PDF 相关，去掉 Pandoc、导出锁、发布等 | F8 |
| 主题和编辑器 CSS | — | 迁入白色、夜间两套，去掉其余四套 | F9.1 |

### 4.3 管线方言调整（D13、F4.1、F4.11）

vmark 的方言集中在 `markdownPipeline/dialectDescriptors.ts`，LiteMd 在这里调整，并用迁入的 `dialect.test.ts` 和保真测试兜底：

| 项 | vmark 现状 | LiteMd |
|---|---|---|
| `remarkGfm` 的 `singleTilde` | `false`，`~x~` 留给下标 | **改为默认值 `true`**，`~x~` 与 GitHub 一样是删除线 |
| `remarkCustomInline`（`==高亮==` `~下标~` `^上标^` `++下划线++`） | 所有模式都加载 | **关闭**；这些写法作为普通文本原样保留。如果关闭影响 vmark 的其他模式，改为让它不识别任何标记 |
| `remarkWikiLinks` | 文档含 `[[` 时加载 | **关闭**；`[[...]]` 是普通文本 |
| `remarkDisableSetextHeadings` | 只在 `hasAmbiguousListUnderline` 时启用（为了避免空列表项 `  -` 被误读成 setext 下划线），vmark 保真文档仍把 setext 标题列为现存缺陷 | M0 用语料确认现状；按 vmark README 给出的方向修：读入时保留 setext，只对 `  -` 的误读做特殊处理。未改动的 setext 标题由保真写回层原样保留 |
| 脚注删除后的自动重新编号（`footnotePopup/cleanupOnEdit.ts` 的 `appendTransaction`） | 删除一个引用时，会把所有引用重新编号，并在文末重建全部定义 | **不装这个 `appendTransaction`**，只保留悬停弹窗。删除引用后留下的孤立定义不影响渲染，也不会改动其他块 |

### 4.4 要迁入的 Tiptap 扩展

按 PRD 范围从 vmark 的 `buildExtensionList` 里挑：

| 类别 | 扩展 |
|---|---|
| 基础 | StarterKit（vmark 的配置）、`AlignedTableCell/Header`、`TableWithScrollWrapper`、`tableUI`、`taskListItem`（`taskToggle`）、`vmarkLinkExtension`、`imageView`、`blockImage` |
| 语法 | `mathInline` + 块级公式（`codePreview`、`blockMathKeymap`、`latex`）、`alertBlock`、`detailsBlock/Summary`、`footnoteReference/Definition`、`footnotePopup`（不含重新编号，见第 4.3 节） |
| 编辑行为 | `listContinuation`、`listBackspace`、`listClickFix`、`safeBlockSplit`、`blockEscape`、`tabIndent`、`autoPair`、`inlineCodeBoundary`、`smartSelectAll`、`CJKBold/CJKItalic`（输入规则）、`markInputRules`、`textDragDrop`、`editorKeymap` |
| 保真与安全 | `compositionGuard`（输入法）、`blankLinesGuard`、`undoIntegrity`、`inactiveSelection` |
| 粘贴复制 | `smartPaste`、`markdownPaste`、`htmlPaste`、`codePaste`、`markdownCopy` |
| 浮层 | `linkPopup`、`linkCreatePopup`、`mathPopup`、`editorContextMenu`、`formatToolbar`（浮动格式栏，F5.3） |
| 查找 | `search`（F7.2/F7.3） |
| 图片 | `imageHandler`（粘贴/拖入，宿主端口接到 `Assets.saveImage` / `importDropped`） |

**不迁入**：`highlight`、`subscript/superscript`、`underline`（D13；`<u>`、`<sup>` 等原始 HTML 由 vmark 的行内 HTML 节点原样保留）、`aiSuggestion`、`wikiLink*`、`multiCursor`（所见即所得模式下的多光标）、`focusMode`、`typewriterMode`、`lint`、`agentJournal/wysiwygProvenance`、`sourcePeekInline`、`markmap`、`graphviz`、`blockAudio/Video`、`videoEmbed`、`mediaPopup`、`cjkLetterSpacing`（PRD F5.9 为 P2）、`showInvisibles`、`tableOfContents`、`workflow*` 等。

扩展裁掉之后，schema 里没有对应的节点和标记；第 4.3 节已在解析阶段关掉这些语法，保证不会生成 schema 不认识的节点。迁入的 `schemaCoverage.test.ts` 要改成按 LiteMd 的扩展清单检查。

Mermaid：vmark 用 `codePreview` 渲染 Mermaid 代码块，保留这条路径，但 Mermaid 库**懒加载**（第一次遇到 mermaid 代码块时才 `import()`）。

### 4.5 平台适配层 `host/`

```ts
export interface Host {
  saveImage(data: Uint8Array, mime: string, name?: string): Promise<string>; // 相对路径
  importDropped(paths: string[]): Promise<string[]>;
  assetURL(ref: string): string;          // 同步：用 Session.ready 拿到的 assetBase + docToken 拼 URL
  fetchImage(url: string): Promise<Blob>; // 关闭网络图片时的单张加载
  openLink(href: string): Promise<void>;
  readClipboardImage(): Promise<Blob | null>;
  revealInFolder(ref: string): Promise<void>;
  settings: SettingsPort;                  // 读设置、订阅变化
}
```

迁入插件里的 Tauri 调用一律改为调用 `host`，单元测试里换成假实现。

## 5. 内容同步协议（页面 ⇄ Go）

问题：mygo 的文档内容在 Go 侧，编辑发生在页面侧。保存、自动保存、关窗、退出、外部修改检测时，Go 必须知道页面是否有未推送的改动，并拿到**最新**的文本；但每次按键都序列化整篇 Markdown 成本太高。另外，mygo 的每次绑定调用都在独立的 goroutine 上执行，可能并发（mygo `docs/bindings.md`），**推送到达 Go 的顺序不一定是发出的顺序**。

### 5.1 原则

1. **只有用户编辑才推送。** 页面只对用户操作产生的、改变了文档的事务计数：ProseMirror 中 `docChanged` 且不带 `preventUpdate` 等程序载入标记；CodeMirror 中 `userEvent` 不为空。打开、切换模式、重新载入都不推送，Go 侧文档保持“未编辑”，也就不会写盘（F2.5①）。
2. **每次编辑都有序号。** 页面维护 `editSeq`（每次用户编辑加一）和 `pushedSeq`（最后一次推送的序号）。
3. **Go 侧知道“有未推送的编辑”。** 靠轻量的脏标记，而不是靠频繁推送全文。

### 5.2 正常编辑

```
用户编辑 → editSeq++
   ├─ 立即（仅当 pushedSeq == 上次的 editSeq，即刚从“已同步”变成“有未推送编辑”）：
   │     Session.markDirty(editSeq)    → Go：记 pendingSeq，Document.SetEdited(true)
   └─ 防抖：文档 < 200 KB 时 150 ms，否则 400 ms
        → 序列化（第 6 节保真写回）→ Session.setContent(editSeq, text) → pushedSeq = editSeq
        → Go：seq ≤ lastSeq 则丢弃；否则 lastSeq = seq，Document.Set(...) → 自动保存计时（1 s）
```

- **Go 侧的顺序保证**：`setContent` 和 `markDirty` 在每个文档自己的互斥锁内比较序号并调用 `Set` / `SetEdited`，序号旧的直接丢弃，旧内容不会覆盖新内容。
- **脏标记的作用**：`SetEdited(true)` 让 mygo 立即认为文档“已编辑”，于是：
  - 外部修改时进入**冲突**状态，而不是静默重新载入、冲掉页面里还没推送的输入（F2.4）；
  - 失焦时 mygo 的 `OnBlur` 会触发一次自动保存，此时 Go 侧可能还是上一版内容。页面在 `blur` 时也立即推送，最多多写一次盘，不丢内容；
  - Go 侧可以准确判断哪些窗口需要收齐（`pendingSeq > lastSeq`）。
- 推送后内容与磁盘一致时（例如输入后又撤销），`Set` 经 `Equal` 判断回到“未编辑”。
- 源码模式下直接取 CodeMirror 的文本，不经过序列化。
- 页面失焦、`visibilitychange`、切换模式时，有未推送的编辑就立即推送（不等防抖）。

### 5.3 收齐（flush）

保存、关窗、退出、导出、打印之前，Go 先确认页面已推送最新内容：

```
Go：该窗口 pendingSeq ≤ lastSeq → 无需收齐，直接继续
否则：Emit(window, "flush", {n}) → 页面：有未推送的编辑就立即序列化 + setContent → Session.flushed(n)
Go：等到 flushed(n)，超时 800 ms → 继续原操作（超时记日志；内容以最后一次 setContent 为准）
```

页面暂停推送时（第 5.4 节的竞态），普通收齐只应答、不推送，不会静默覆盖磁盘上的外部修改。只有用户在关窗或退出对话框里选了「保留我的版本」时，Go 发出 `{n, force: true}`：不看序号、总是发出，页面即使暂停也推送。

| 场景 | 接入点 |
|---|---|
| 菜单保存、副本、另存为、导出、打印 | 自建文件菜单的 `Click`（第 3.6 节）：先收齐，再执行 |
| 关窗 | `newDocWindow` 里注册的 `OnClose`，排在 mygo 的关闭监听之前（第 3.3 节）。窗口需要收齐时 `PreventDefault`（mygo 看到已阻止就不处理），收齐后再次调用 `Close()`；第二次无需收齐，放行给 mygo 的保存/询问流程。处于第 5.4 节「暂停」的窗口不收齐，而是 `PreventDefault` 后在该窗口上弹模态对话框（见第 5.4 节），选定后再关一次。**应用正在退出时一律放行**：退出时 mygo 会对每个窗口调用 `close`，此时阻止会取消整个退出（`app.go` 的 `prepareQuit`） |
| 退出 | `session.InstallQuitFlush` 在 `NewDocuments` **之前**注册 `OnBeforeQuit`，排在 mygo 的 `documentsBeforeQuit` 前面。有窗口需要收齐时：`PreventDefault`，并行收齐，然后再次 `App.Quit()`；没有需要收齐的窗口时不做任何事，交给 mygo。因为“是否需要收齐”由序号判断，第二次进入时必然放行，不会和 mygo 自己的“阻止 → 处理 → 再次退出”流程互相打断。监听在放行时记下“正在退出”，在 `OnQuitCanceled` 中清除。有「暂停」的窗口时先处理它们：`PreventDefault`，逐个弹第 5.4 节的对话框（在 mygo 的关窗过程之前，因为退出中的关窗不能阻止）；任一窗口选「取消」就取消退出，全部选定后再次 `App.Quit()`，第二次进入时不再有暂停的窗口 |
| 关机、注销（`e.SessionEnding`） | 不能阻止也不能等待，只能依赖最近一次推送。由于有脏标记，mygo 会把这类文档当作已编辑处理（写盘或留恢复副本），最多丢失最后 150–400 ms 的输入。「暂停」中的窗口没法询问，其未推送的编辑不在 Go 侧 |

### 5.4 外部修改、冲突与恢复

- **`onDocumentReload`**：mygo 已经重新读入了磁盘内容（只在 Go 侧认为“未编辑”时发生）。页面先保存当前模式的滚动锚点，调用 `Session.content()` 重新载入文本、重建保真基线，再恢复位置。
- **竞态**：极少数情况下，`markDirty` 还在路上时 mygo 已经重新读盘。页面收到 `onDocumentReload` 时如果自己还有未推送的编辑，就**不载入**磁盘内容，改为显示冲突提示条「磁盘上的文件已被修改」，并暂停推送，直到用户选择：「载入磁盘版本」→ 丢弃本地编辑并重新载入（`Session.revert()`）；「保留我的版本」→ 推送本地内容后 `Session.saveAnyway()`。
  - **Go 侧的「暂停」**：mygo 没有把文档置为冲突的公开接口。页面暂停时调用 `Session.holdConflict()`，Go 在该窗口的同步状态上记下「暂停」。暂停期间，文档变回「未编辑」时不再重新标记已编辑、不发起收齐（否则页面不推送、自动保存每秒重写一次文件）；普通收齐仍不推送。提示条的「保留我的版本」（`saveAnyway`）和「载入磁盘版本」（`revert`）都解除暂停。
  - **关窗、退出时的对话框**：暂停中的窗口关闭时（退出时在 `OnBeforeQuit` 里逐个处理，见第 5.3 节），在该窗口上弹模态对话框「「文件名」在磁盘上已被修改」，三个按钮：「保留我的版本」→ 强制收齐（`force`）拿到页面内容后 `SaveAnyway`，解除暂停并关窗（收齐超时或写盘失败则不关，仍保持暂停）；「载入磁盘版本」→ 丢弃待收齐的序号、解除暂停、标为未编辑后不保存直接关闭；「取消」→ 不关窗（退出时取消整个退出）。
  - **通知页面（`conflictResolved` 事件）**：Go 侧结束暂停时——关窗或退出对话框选了「保留我的版本」或「载入磁盘版本」，或菜单「还原到上次保存的版本」——向该窗口的页面发 `conflictResolved {choice: "keep" | "disk"}`。关窗、退出之后仍可能被取消（另一个窗口选了「取消」、mygo 第二轮的保存询问、关窗失败），页面不能一直停在暂停里，否则之后的编辑只有 `markDirty` 没有推送。页面收到 `keep`：恢复推送、收起冲突提示条，并推送强制收齐之后的编辑；收到 `disk`：丢弃本地编辑，用 `Session.content()` 按 Go 的序号重新载入正文，恢复推送并收起提示条。菜单「还原」时页面处于暂停，会忽略随之而来的 `onDocumentReload`，靠这个事件载入。只有 Go 侧确实处于暂停时才发；提示条按钮由页面自己处理、不触发事件，两条路径都经过同一个「暂停未结束」标记（`PageSync.release()`），只有先到的一个生效。
  - **页面重新载入**：`Session.ready()` 解除 Go 侧的暂停并丢弃待推送的序号（`Sync.Discard`），刚载入的页面没有未推送的编辑。
- **丢弃页面的编辑**：`Session.revert()`、`Session.discardRecovered()` 和菜单「还原到上次保存的版本」在重新读盘前把 Go 侧的 `pendingSeq` 降到 `lastSeq`（`Sync.Discard`）。否则页面丢掉的编辑仍让 Go 认为「需要收齐」，状态钩子反复重新标记已编辑，自动保存每秒重写一次文件。
- **冲突状态**（`onDocumentState` 中 `conflict = true`）：页面顶部显示提示条：「载入磁盘版本」调用 `Session.revert()`（不再弹确认框）；「保留我的版本」调用 `Session.saveAnyway()`。提示条显示期间，用户主动保存或关窗时由 mygo 弹系统对话框（`resolveConflict` / `askToSave`），符合 D12。
- **文件被删除**：提示条提供「另存为」。
- **恢复的文档**：提示条「已恢复上次未保存的内容」，见第 3.3 节。

## 6. 保真写回层（D3：发布阻断条件）

### 6.1 目标

| 场景 | 要求 |
|---|---|
| 打开后不编辑 | 不写盘（不推送，第 5.1 节） |
| 切换模式但不编辑 | 不推送；源码模式拿到的就是原文 |
| 编辑后又撤销回原样 | 输出与原文逐字节相同，`Equal` 判断为未编辑 |
| 所见即所得编辑后保存 | **只有改动过的顶层块变化**，其余块（含块之间的空行）保持原文 |
| 源码模式编辑 | 与编辑内容逐字节一致 |

### 6.2 基线

保真层为当前 Tiptap 文档维护一个**基线**：

```ts
interface Baseline {
  source: string;   // 上一次写给 Go 的文本（初始为读入的原文）
  doc: PMNode;      // 与 source 对应的 ProseMirror 文档
  ranges: Array<{ from: number; to: number }>; // doc 第 i 个顶层块在 source 中的区间
}
```

- **载入时**：解析原文得到 `doc`，并为每个顶层块确定原文区间：
  - 起点取 mdast 顶层节点的 `position.start.offset`（vmark 管线在块上记录了 `sourceLine`，可直接利用）；
  - 终点取下一个块起点之前最后一个非空白字符所在行的行尾；
  - mdast 与 ProseMirror 的顶层节点不一定一一对应（vmark 的 `inlineHtmlMerge`、`listInterruptJoin` 会合并节点，`details` 等节点没有位置，见 `positionTrust.ts`）。位置与前一个块重叠的块与前一个块合并成一个单元，共享一个区间；完全拿不到位置的块（如 `<details>`）单独成一个单元，区间取前后两个单元之间的非空白文本——曾经把它们并进相邻单元却不扩大区间，原文落在分隔空白里，编辑相邻段落时折叠块被写两遍。
- **基线的 `doc` 必须就是编辑器里的那个文档对象**。载入完成、各插件首轮 `appendTransaction` 跑完之后，如果 `editor.state.doc` 已经不是解析结果（有插件在载入时改了节点），对改动的块记日志；M0 的目标是这种块为 0（第 6.4 节）。

### 6.3 序列化

1. **找出改动范围**：用 ProseMirror 的 `Fragment.findDiffStart` / `findDiffEnd` 比较 `baseline.doc` 与当前文档。它对未改动的节点先比较对象是否相同，再用 `eq` 做结构比较，耗时与改动量成正比。
   - 没有差异（包括“改了又撤销”的情况：撤销生成的是新对象，但结构相等）→ 直接返回 `baseline.source`；
   - 否则得到当前文档中从第 `a` 个到第 `b` 个顶层块的改动区间，以及基线中对应的区间。区间之外的块都没变。
2. **区间之外**：原样输出原文切片 `source.slice(from, to)`，块之间沿用原文中的空白。
3. **区间之内**：逐块判断，仍是基线中某个块的同一个对象、且相对顺序不变的块，照样输出原文；其余块组成一个临时文档，交给 vmark 的规范序列化。vmark 的 `serializerSpans.ts` 能同时给出每个块在输出中的区间（并自带一致性校验），直接用于第 5 步。
4. **分隔**：两个原样输出的块在原文中相邻时，沿用原文中的空白；否则用规范分隔（一个空行，或按 vmark 的 `blankLinesBefore` 属性还原的空行数）。
5. **局部校验**：只取改动区间加前后各一个块，把拼出的这段文本重新解析，与“这几块全部规范序列化”的解析结果做结构比较（复用 vmark 保真测试里的 `docFingerprint`）。用来发现保留下来的缩进或空行改变了相邻块含义的情况（例如列表合并、懒惰续行）。不一致时依次退回：区间内全部规范序列化 → 前后各扩大一个块 → 整篇规范序列化。**退回到整篇时**，页面显示提示条“本次修改调整了全文格式”（PRD F2.5⑤），并记日志。
6. **更新基线**：推送成功后，`baseline = { source: 输出, doc: 当前文档, ranges: 第 2–3 步拼接时记录的各块区间 }`。**不重新解析**，下一轮比较直接以当前文档的节点为准。

模式切换与基线：

- 预览 ⇄ 所见即所得：同一个 Tiptap 实例，基线不变。
- 进入源码：自基线以来没有编辑，就把 `baseline.source` 原样交给 CodeMirror；否则先按上面的步骤序列化。
- 离开源码：CodeMirror 文本没变，就保留原来的 Tiptap 文档和基线，不重新解析；变了才重新解析，并按第 6.2 节重建基线。

性能：第 1 步与改动量成正比，第 3 步只序列化改动的块，第 5 步只解析改动附近的几块，1 MB 文档的单次推送耗时取决于改动大小而不是文档大小（NF2）。整篇解析只在载入和离开源码模式时发生。

### 6.4 风险与 M0 要验证的点

- **载入时的规范化**：vmark 的插件可能在载入后用 `appendTransaction` 修改节点属性（`tableUI`、`inlineCodeBoundary`、`blankLinesGuard` 等都有 `appendTransaction`），导致没碰过的块也被判为改动。M0 统计“载入后不编辑，`findDiffStart` 是否为空”，目标 100%。
- **跨块修改的插件**：脚注重新编号已在第 4.3 节去掉。M0 逐个检查迁入扩展的 `appendTransaction`，确认只修改当前编辑所在的块。
- **嵌套改动**：改了列表里的一项，整个列表块会按规范格式重写（列表符号、缩进可能变化）。v1 接受这个粒度，验收指标（≥ 98%）按“diff 只出现在改动的**顶层**块内”计算。如果实测问题集中在列表，再把粒度细化到列表项。
- **frontmatter**：作为独立块原文保留，只有在元数据区编辑后才重写。
- **vmark 管线自身的往返差异**：vmark 的保真文档记录了它的 23 份语料中有 13 份往返后文本不同（表格对齐、空行合并、转义、有序列表编号、setext 等）。这些差异只影响**被编辑的块**，但会让 diff 比用户的实际改动大，是 ≥ 98% 指标的主要风险，M0 先用这套语料建立基线数据。

### 6.5 回归测试

- 语料：`testdata/fidelity/`，≥ 200 个文件（vmark 的 23 份、主流开源项目文档、中文文档、AI 生成的报告、边界语法样例、CRLF/BOM/混合换行样例、GB18030/UTF-16 样例）。
- 在 Node（vitest + jsdom）里运行，每次提交都跑：
  1. 解析 → 不编辑 → 序列化：逐字节相等，100%；
  2. 随机挑一个顶层块做一次编辑（插入字符、切换加粗、删除一行、在表格中加一行）→ 序列化：diff 只能落在被编辑块的原文区间内，≥ 98%；
  3. 编辑 → 撤销 → 序列化：逐字节等于原文，100%；
  4. 连续多轮编辑（每轮后更新基线）：每轮的 diff 只落在当轮被编辑的块内；
  5. 规范序列化 → 重新解析：文档结构不变（管线自身的往返正确性，沿用 vmark 的 `roundtripFidelity`、`referenceConformance`）；
  6. 方言用例：`~x~` 是删除线；`==x==` `^x^` `++x++` `[[x]]` 原样保留；setext 标题被识别为标题；删除脚注引用不改动其他块。
- 每个失败用例输出原因分类，作为改进依据。

## 7. 安全设计（NF5）

LiteMd 的文档页面是 mygo 意义上的“受信任页面”（可以调用绑定的 Go 方法），而它要渲染来自文件的、不可信的 HTML。主要防线：

| 层 | 措施 |
|---|---|
| 内容过滤 | Markdown 中的原始 HTML 经过 DOMPurify 白名单过滤（迁自 vmark 的 `htmlSanitizer`）：去掉 `script`、`iframe`、`object`、`embed`、`form`、全部 `on*` 属性、`javascript:`/`vbscript:`/`data:text/html` 链接 |
| CSP | 前端 `index.html` 设置 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' lmasset: http://lmasset.localhost data: blob: https: http:; font-src 'self' data:; connect-src 'self' lmasset: http://lmasset.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`。即使过滤有漏洞，注入的脚本也不能执行。`unsafe-inline` 样式是 KaTeX 和 Mermaid 需要的。**关闭“加载网络图片”时**，页面在渲染任何文档内容之前追加一条不含 `http:` `https:` 的 `img-src` CSP（多条 CSP 同时生效，取最严格的交集） |
| Mermaid | `securityLevel: "strict"`，渲染结果再过一遍 DOMPurify |
| 导航 | `OnWillNavigate`：只允许前端自身的地址，其余一律取消；`http(s)` 交给 `Links.open` 用系统浏览器打开 |
| 新窗口 | `SetWindowOpenHandler`：一律不在应用内开窗口；只有用户点击触发的 `http(s)` 才交给系统浏览器 |
| 权限 | `SetPermissionHandler` 一律拒绝（摄像头、麦克风、定位、通知）：受信任页面在 mygo 中默认不经询问就能获得这些权限 |
| 后端接口 | 绑定的方法很少，并且都按调用者窗口限定作用域：不提供“按任意路径读写”的接口；图片协议只提供图片类文件；写盘只发生在文档本身、文档目录下的 assets 目录、用户在保存对话框里选的路径 |
| 拖入路径 | 页面传给 `Assets.importDropped` 的路径必须在本窗口最近一次 `OnFileDrop` 登记的集合里（Go 侧在 `OnFileDrop` 中记录，几秒后过期），被攻破的页面不能借此复制任意文件 |
| 本地链接 | `Links.open` 打开非 Markdown 的本地文件前，确认框显示**完整路径**；可执行文件一律拒绝打开：`.app` `.exe` `.bat` `.cmd` `.com` `.msi` `.ps1` `.vbs` `.lnk` `.url` `.scr` `.sh` `.command` `.tool` `.scpt` `.jar` `.desktop` `.appimage`，以及 Unix 上带可执行权限的文件和目录。Windows 上文档所在共享之外的 UNC 路径（第 3.5 节）只按扩展名判断，确认前不访问文件系统（Markdown 链接也先确认），用户确认后才检查是否存在、是否是目录；`Shell.revealInFolder` 同样先确认 |
| 网络图片单张加载 | `Assets.fetchImage` 只接受 `http(s)`，拒绝回环、内网、链路本地地址（防止借应用访问本机服务），只返回图片类型，上限 20 MB |
| 导出与打印 | 导出 HTML 经过同样的过滤，不含任何脚本，文件内设 `default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:`。PDF 和打印：Go 把导出 HTML 处理成自包含的（本地图片转 base64、KaTeX 字体内嵌、Mermaid 已渲染成 SVG），在一个隐藏窗口中以 `PageOptions{Untrusted: true}` 载入后调用 `PrintToPDF` / `Print`。**必须设 `Untrusted`**：mygo 把不带 base URL 的 `LoadHTML`（`about:blank`）视为应用自己的受信任页面，可以调用全部绑定方法。关闭“加载网络图片”时，PDF 和打印改用离线 CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:`（不含 `http:`、`https:`，Go 载入前也在最前面加上同一条），网络图片换成替代文字或原地址；导出的 HTML 文件仍保留网络图片的原地址（第 3.5 节） |
| 网络 | 除检查更新和网络图片（都可关闭）外，没有任何网络请求；不加载远程字体和脚本，所有资源都打包在本地 |

## 8. 前端设计

### 8.1 页面启动流程

```
main.tsx
  → Session.ready()（拿到 docToken、assetBase、设置、按文件状态、只读/编码/恢复信息）
  → 关闭网络图片时追加 CSP（第 7 节）
  → Session.content()（拿到正文）
  → 决定初始模式（D1：默认预览；或按文件记住的模式；Lossy 时强制预览；> 5 MB 默认源码，> 20 MB 只读源码）
  → 渲染外壳和对应模式的编辑器，建立保真基线（第 6.2 节）
  → 显示需要的提示条（恢复、只读、编码）
  → 订阅事件：command / flush / settings-changed / onDocumentState / onDocumentReload / onFileDrop
```

**首屏速度（NF1）**：

- 代码按模式拆包：预览和所见即所得共用 Tiptap 这一包；CodeMirror 单独一包；Mermaid、KaTeX 字体、highlight.js 语言包、导出模块全部懒加载。
- 预览模式不加载 CodeMirror。
- 首屏目标：已运行时打开新文件 < 400 ms，M0 实测。WebView 本身的创建开销（尤其 WebView2）是主要的不确定因素。

### 8.2 四种模式

| 模式 | 实现 | 切换 |
|---|---|---|
| 预览 | 与所见即所得**同一个 Tiptap 实例**，装全部扩展，`editable: false`。Tiptap 不能给运行中的实例追加扩展，所以预览不另装一套精简扩展；编辑类界面（浮动格式栏、链接编辑浮层、右键菜单中的编辑项、任务框勾选）在 `editable` 为假时不响应（F3.1、D15）。为此要检查迁入的 `taskToggle`、`formatToolbar`、`linkPopup`、`editorContextMenu` 等是否判断了 `view.editable`，没有的补上 | — |
| 所见即所得 | 同上，`editable: true`。折叠块的展开/折叠：所见即所得里是一次编辑，`open` 照常写回；预览里只是查看，事务带 `lm:viewState` 标记，不通知编辑，并把变化同步进基线文档，之后有别的编辑时这些块仍输出原文（局部校验比较结构时忽略 `open`） | 与预览之间只切 `editable`，**不重新解析**，撤销历史保留 |
| 源码 | CodeMirror 6 + `@codemirror/lang-markdown`、查找、多光标、自动配对、列表续写 | 进出规则见第 6.3 节。与所见即所得之间切换后，撤销历史从切换时开始（D15）：两种编辑器的历史无法互通 |
| 分屏 | 左 CodeMirror、右只读 Tiptap。预览按防抖（200 ms，大文档 500 ms）整篇重新解析；按顶层块 key 复用节点，减少 DOM 变动 | 双向同步滚动：用块级“源码行号 ⇄ 预览块”映射（vmark 的 `sourceLineAttr`）。分屏时以 CodeMirror 文本为准，推送不经过保真层 |

模式切换时的光标和滚动对齐（F3.6）复用 vmark 的 `cursorSync`。

### 8.3 外壳组件

- **状态栏**：模式切换、字数（F5.10，在 Web Worker 里统计，避免阻塞输入）、编码/只读标记；可隐藏。
- **提示条**：外部修改冲突、文件被删除、只读、非 UTF-8（含「另存为 UTF-8」）、已恢复未保存的内容、“本次修改调整了全文格式”、“未命名文档请先保存再粘贴图片”、网络图片设置变更后的「重新载入」。
- **大纲**（F7.1）：从 ProseMirror 文档（或源码模式下的 mdast）提取标题，点击跳转，滚动时高亮当前章节。
- **查找替换**（F7.2/F7.3）：所见即所得用 vmark 的 `search` 扩展；源码用 CodeMirror 的 search；预览用同一个 `search` 扩展，替换按钮在 `editable` 为假时隐藏。
- **设置窗口**：单独的 mygo 窗口（`URL: "/settings"`），同一个前端包内的另一个路由。
- **启动窗口**：路由 `/start`，见第 3.3.1 节。

### 8.4 国际化

- Go 侧（菜单、对话框、LiteMd 自己的文案）：mygo i18n，`locales/zh-Hans.json`、`locales/en.json`。mygo 自身的文案（保存询问、冲突对话框、“未命名”）由 mygo 的 `zh-Hans` 翻译包提供，`mygo generate` 会按应用的语言自动引入。
- 页面：i18next，扁平键名（沿用 vmark 的规范），只保留迁入组件实际用到的键。

## 9. 测试策略

| 层 | 工具 | 内容 |
|---|---|---|
| Go 单元测试 | `go test` | `MdContent` 读写（BOM、CRLF、UTF-16、GB18030）、另存为 UTF-8、资源协议的路径和类型校验、拖入路径登记、`fetchImage` 的地址过滤、图片落盘命名、命令行参数处理、设置迁移、LRU |
| 同步协议（Go） | `go test` + mygo 的假后端 | 乱序到达的 `setContent`/`markDirty`、收齐超时、关窗与退出时监听器的顺序、退出流程不会反复询问 |
| 管线与保真 | vitest（Node） | 第 6.5 节回归语料；vmark 迁入的管线测试一并迁入 |
| 编辑器行为 | vitest + jsdom；关键用例用 Playwright WebKit | 输入规则、列表、表格、粘贴、模式切换前后文本不变、预览中任务框不可勾选 |
| 同步协议（页面） | vitest + 假的 Go 客户端 | 只有用户编辑才推送、防抖、序号、收齐、重新载入时有未推送编辑的处理 |
| 启动窗口 | mygo e2e + 手工 | 无文件启动、带文件启动不闪现、恢复副本启动、点 Dock、取消打开对话框 |
| 端到端 | mygo e2e（macOS 桌面会话）+ 手工冒烟清单 | PRD 第 7 节第 4 条的冒烟项 |
| 输入法 | 手工 | PRD 第 7 节第 5 条 |
| 性能 | 脚本 + 基准文档（100 KB / 1 MB / 5 MB） | NF1–NF3：打开耗时、输入延迟（含保真序列化）、内存 |

CI：PR 上跑 Go 测试、前端类型检查、lint、单元测试和保真回归，并在 macOS/Windows/Linux 上构建；`main` 分支保护要求这些全部通过。前端依赖统一用 `pnpm install --frozen-lockfile` 安装（Node.js 版本取 `.nvmrc`，pnpm 版本取 `packageManager`），并缓存 pnpm store。

## 10. 里程碑与任务拆分

### M0 技术验证（约 1 周）：每一项都给出“通过/不通过”的结论

| # | 验证项 | 通过标准 | 不通过时的退路 |
|---|---|---|---|
| V1 | mygo `NewDocuments` + WebView 页面：一个文件一个窗口、单实例、Finder 双击打开、自动保存、恢复副本；工具链：`go tool mygo` 运行 CLI、Node.js 执行 `mygo.config.ts`、`mygo generate` 输出到 `frontend/src/mygo.ts` | macOS 和 Windows 上都正常 | 向 mygo 提 issue；必要时自己实现缺的部分 |
| V2 | 第 5 节同步协议：序号、脏标记、关窗与退出收齐、退出流程与 mygo 的配合 | 快速输入后立即关窗、退出、切走焦点，内容都不丢；退出不出现重复询问；外部修改不冲掉未推送的输入 | 缩短防抖；必要时每次按键推送全文（只对小文档） |
| V3 | 抽出 `markdownPipeline` 在 Node 下单独跑通（含 `@/utils` 等依赖和 pnpm 补丁）；第 4.3 节的方言调整；用 200 份语料测“解析 → 序列化”的往返情况 | 得到基线数据；方言用例通过 | — |
| V4 | 第 6 节保真写回的原型：载入后不编辑没有差异；编辑后撤销逐字节回到原文；随机编辑的 diff 只落在改动块内 | 前两项 100%，第三项 ≥ 98% | 细化到列表项粒度，或改为以源码为主的编辑方式 |
| V5 | Tiptap 和 CodeMirror 在 WKWebView、WebView2 下的中文输入法；菜单加速键与编辑器键位不重复触发 | 组字、候选框、快捷键都正常 | 针对性修补（vmark 的 compositionGuard 已覆盖一部分） |
| V6 | 性能：冷启动、已运行时打开新文件、1 MB 文档输入延迟（含保真序列化）、单窗口内存 | 接近 NF1–NF3 | 调整预览实现（例如预览改为纯 HTML 渲染）或调整阈值 |
| V7 | 启动窗口（第 3.3.1 节）：无文件启动、带文件启动、恢复副本启动、点 Dock、从启动窗口新建/打开/拖入、取消打开对话框、关闭启动窗口时的退出行为 | macOS、Windows 上都符合 F1.12；带文件启动时启动窗口不出现 | 调整等待时间；推动上游提供启动完成的回调 |
| V8 | 编码与命令行：UTF-16/GB18030 只读打开并另存为 UTF-8；`litemd 不存在的文件.md`、`litemd a.txt` | 符合 F1.5、F2.6 | — |

### mygo 能力缺口与上游需求

| 缺口 | 影响 | v1 的做法 | 向上游提的需求 |
|---|---|---|---|
| 没有“启动打开流程结束”的回调 | F1.9 判断无文件启动 | 计数 + 短暂等待（第 3.3.1 节） | `Documents` 增加启动完成回调 |
| 自动保存模式不能在运行中切换 | F2.2 | 重启生效（D11） | 运行中切换自动保存模式 |
| 最近打开固定 10 个 | F1.6 | 接受（D8） | 可配置上限 |
| 恢复副本静默恢复，应用无法直接得知 | F2.3 | 按“窗口创建时已编辑”推断（第 3.3 节） | 文档状态中加“从恢复副本恢复”标记 |
| 命令行只投递已存在、已关联扩展名的文件 | F1.5 | `cli` 包自己处理（第 3.8 节） | — |
| 没有新窗口层叠 | F1.8 | 自己计算位置 | — |

### M1 MVP / alpha（约 3 周）

1. 工程骨架：mygo 项目（`go tool mygo`）、Vite/React、pnpm（锁文件、补丁、engine-strict）、CI；启动窗口、命令行处理。
2. Go：`MdContent` 读写与编码、窗口、Session/Assets/Links 服务、`lmasset` 协议、自建文件菜单和命令转发、同步协议与收齐。
3. 前端：迁入管线（含方言调整）和第 4.4 节的 P0 扩展、宿主装配、`host` 适配层。
4. 预览、所见即所得、源码三种模式及切换；保真写回层。
5. 查找（F7.2）、状态栏、提示条（冲突、恢复、只读、编码）。
6. 安全：DOMPurify、CSP、导航和新窗口拦截、权限拒绝、拖入路径校验、本地链接拦截。
7. macOS 签名公证打包、Windows 安装包。

### M2 beta（约 2 周）

分屏与同步滚动、Mermaid（懒加载）、脚注、提示块、details、图片粘贴和拖入、网络图片开关与单张加载、大纲、替换、浮动格式栏、导出 HTML/PDF/打印（Untrusted 打印窗口）、深浅色和字号、设置窗口、自动更新、中英文界面、macOS 命令行工具安装。

### v1.0（约 1 周）

补齐保真语料并达标、性能测量与优化、冒烟与输入法验收、文档（README、下载页的 SmartScreen 说明）、正式图标（D5）、发布。

## 11. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| mygo 很年轻（v0.9），API 可能变化，平台上的边角问题未经大规模验证 | 中–高 | 锁定版本；M0 覆盖所有用到的能力；能力缺口见第 10 节的表，向上游提需求；必要时 fork 打补丁（MIT） |
| LiteMd 依赖 mygo 的内部顺序（监听器注册顺序、`Window` 回调与 `attach` 的先后、启动流程） | 中 | 第 9 节的 Go 测试用 mygo 假后端把这些顺序固定下来；升级 mygo 时必跑 |
| 保真写回达不到 98% | 高（D3 阻断发布） | M0 的 V4 先验证；vmark 管线自身的往返差异是主要来源；退路见第 10 节 |
| vmark 上游迭代快、不收 PR | 中 | 迁入后单向挑选上游改动，不追求同步；迁入代码保留原目录结构，方便对比 |
| vmark 依赖的补丁在依赖升级时失效 | 中 | 被补丁的包锁定精确版本；补丁有对应测试；升级依赖时用 `pnpm patch` 重新生成并专门处理 |
| WebView 差异（WebView2、WebKitGTK）导致输入法、选区问题 | 中 | M0 的 V5；Linux 只做尽力支持 |
| Windows 不签名带来的 SmartScreen 警告影响安装转化（D6） | 低–中 | 下载页说明；以后视用户量再申请证书 |
| 每个窗口一个 WebView，开很多窗口时内存高 | 中 | NF3 测量；空闲窗口释放懒加载模块；大文档默认源码模式 |
| 非 UTF-8 文件按 GB18030 显示，其他编码会乱码（D14） | 低 | 只读、不改原文件；以后视反馈加编码选择 |

## 12. 许可

- 本仓库：Apache-2.0。
- 迁入的第三方代码：vmark（ISC）、mygo（MIT，作为依赖）、Tiptap/ProseMirror/CodeMirror/KaTeX/Mermaid/unified 生态/DOMPurify（MIT 或 Apache-2.0 等宽松许可）、`golang.org/x/text`（BSD-3-Clause）。都与 Apache-2.0 兼容。
- `THIRD_PARTY.md` 列出所有迁入和打包的第三方代码、版本、许可和来源 commit；从 vmark 迁入的文件保留原版权声明。

## 附录 A：v0.2 评审修订记录

| 问题 | 修订位置 |
|---|---|
| `App.OnWindowCreated` 触发时文档尚未登记，启动窗口关不掉 | 第 3.3、3.3.1 节：在 `newDocWindow` 中关闭 |
| `WhenReady` 早于命令行文件投递和恢复，带文件启动会闪出启动窗口 | 第 3.3.1 节：计数 + 等待；第 10 节上游需求 |
| 绑定调用并发执行，`setContent` 可能乱序 | 第 5.2 节：序号 |
| 退出监听排在 mygo 之后、退出时 `OnClose` 阻止会取消退出 | 第 5.3 节：先于 `NewDocuments` 注册；按序号判断是否需要收齐；退出时关窗放行 |
| 外部修改会冲掉页面里未推送的输入 | 第 5.2、5.4 节：脏标记与重新载入时的竞态处理 |
| 保真基线“重新解析重建”会让所有块失去身份 | 第 6.3 节第 6 步：基线直接用当前文档 |
| 撤销后块不再是同一对象，被规范化重写 | 第 6.3 节第 1 步：`findDiffStart`/`findDiffEnd` 结构比较 |
| 脚注重新编号会跨块修改 | 第 4.3 节：不装该 `appendTransaction` |
| mdast 与 ProseMirror 顶层节点不一一对应 | 第 6.2 节：合并成单元 |
| 每次推送整篇解析两遍，压垮 NF2 | 第 6.3 节第 5 步：局部校验 |
| 退回整篇规范序列化时没有任何提示 | 第 6.3 节第 5 步、PRD F2.5⑤ |
| 切换模式也推送，未编辑也可能写盘 | 第 5.1 节：只有用户编辑才推送 |
| `Lossy` 时 `Write` 拒绝写入，另存为 UTF-8 走不通；GB18030 回退分支走不到 | 第 3.2 节：独立的 `saveAsUTF8`；按 D14 简化 |
| PRD 与 mygo 不符：最近打开数量、另存为快捷键、`RoleFileMenu` 无法包装、自动保存开关、恢复提示、冲突对话框、命令行、`.txt`、层叠 | PRD D8–D12；第 3.1、3.6、3.7、3.8 节 |
| vmark 方言与 F4.11、GFM 不符（`==`、`~`、`[[`、setext） | PRD D13；第 4.3 节 |
| 打印窗口 `about:blank` 是受信任页面 | 第 7 节：`Untrusted` |
| `lmasset` 在 Windows 上的 URL 形式 | 第 3.5 节、第 7 节 CSP |
| 关闭网络图片只替换 `<img>`，拦不全 | 第 3.5 节、第 7 节：追加 CSP；`fetchImage` |
| 打开本地文件、拖入路径由页面决定 | 第 7 节 |
| 预览与所见即所得“共用实例”与“不装编辑扩展”矛盾；跨模式撤销 | 第 8.2 节、PRD D15 |
| API 名称（`Resizable`、`Center`）、遗漏的 `setMenuState`、D7、过时的 `•` 注释 | 第 3.3.1、3.4 节；文首 |
| 前端包管理用 Bun，与 vmark 的 pnpm 补丁格式不一致 | 第 1.1、1.2 节（v0.2.1）：改用 pnpm |

## 附录 B：实现中的偏离（M0–M1，2026-11-14）

| 设计 | 实际做法 | 原因 |
|---|---|---|
| 1.1 节：外壳用 React 19 | 外壳（状态栏、提示条、查找条、大纲、启动窗口）用原生 TypeScript + DOM（`frontend/src/shell/`）；React 只作为 vmark 弹层 store（zustand）的依赖存在 | 外壳界面元素少，迁入的 vmark 插件都是 ProseMirror 插件与原生 DOM 弹层，不依赖 React 组件；省去一层渲染框架，首屏更轻（NF1） |
| 4.2 节：迁入 vmark 模块 | 编辑器扩展按依赖闭包迁入（`frontend/src/vmark/`），在 7 处断点放 LiteMd 替代模块（i18n、链接打开、媒体地址、终端、工作流检测、graphviz、markmap），`@tauri-apps/*` 用构建别名指向 `frontend/src/host/tauri/` | vmark 的 NodeView 会把工作区、终端、store 一起带进来（未截断时 365 个文件），违背 4.1 节第 1 条 |
| 4.4 节：StarterKit 的 code 标记 | `Code.extend({ excludes: "" })`，行内代码可与加粗、链接共存 | Tiptap 默认 `excludes: "_"`，撤销「取消加粗」时加不回 bold，破坏「撤销逐字节回到原文」（D3，M1 回归发现） |
| 6.2 节：基线 doc 即编辑器文档 | 基线用编辑器自己的 schema 解析；载入后插件规范化了块（prosemirror-tables 补齐缺单元格的行）而顶层块数不变时，以载入后的文档为基线；Tiptap TrailingNode 补的末尾空段落在序列化前去掉 | 不同 schema 实例的节点不相等；载入不算编辑（264 份语料载入后序列化逐字节相同） |
| 7 节：CSP 写在 index.html | 由 Vite 插件只在生产构建时注入（`frontend/csp.ts`）；开发服务器不注入 | HMR 需要 websocket 与内联模块 |
| 7 节：DOMPurify 白名单 | 原始 HTML 用 vmark `sanitizeHtmlPreview` 的 extended 白名单（含 kbd、mark 等），不允许内联样式 | README 常见 `<kbd>`；extended 同样剔除脚本、事件属性、危险协议（`src/security.test.ts`） |
| 3.6 节：菜单可用状态 | 没有聚焦窗口时不刷新菜单 | 从命令行启动、应用未激活时 `FocusedWindow()` 为 nil，会把文档类菜单项全部置灰（M1 实测发现） |
| 5.2 节：脏标记 | `markDirty` 之后若 mygo 自动保存把文档标回未编辑而页面仍有未推送编辑，重新标记并立即收齐 | M0 V2 发现的竞态 |
| 3.4 节：Session 服务 | 增加 `state`、`saveAs`、`duplicate`；新增 `Export.choosePath/writeChosen`（只能写对话框选择的路径）、`Shell.readClipboardText` | 页面启动取文档状态；vmark 图表导出、粘贴为 Markdown 需要 |
| 3.2 节：MdContent 只记主要换行符 | 混合换行（CRLF 与 LF 并存）的文件另记每行原换行符；写回时按行对比原文（前后缀 + LCS），未改动的行与被改写的行沿用原换行符，新增行用主要换行符 | v1 回归发现：混合换行文件改一处会把全文换行统一，违反 D3（`internal/doc/corpus_test.go`） |
| 6.3 节第 6 步：推送后不重新解析 | M1 曾按新文本重新解析建基线；v1 改回原设计：改写的单元并成一个、其后单元平移偏移与下标，与新文本逐字节核对，对不上时才重新解析。页面防抖计时只取文档大小，不再每次按键序列化全文 | 1 MB 文档所见即所得每次按键约 1 s（NF2，v1 性能测量发现），修复后 P95 约 13 ms；平移后的输出不会像重新解析那样重排未改动的表格（`test/fidelity/commit.test.ts`） |
| 原型 `.md table`：表格最宽到正文宽度 | vmark 表格样式为 `width: max-content`，LiteMd 外壳覆盖为 `width: auto; max-width: 100%`、单元格 `overflow-wrap: anywhere`（`frontend/src/shell/shell.css`，导出 HTML 同） | 与原型一致；多数表格不再成为横向滚动区，100 KB 文档窗口的图形内存 92 → 41 MB（NF3，v1 性能测量发现） |
| PRD F6.7：缺失图片显示原始路径 | vmark 只在悬停提示里给出路径；`showMediaError` 在容器上记 `data-lm-missing`，外壳用 `::after` 显示在占位下方（块级图片；行内图片仍只有悬停提示） | 满足 F6.7（`scripts/smoke-macos.sh`） |
| PRD 第 7 节第 3 条：NF1–NF4 达标为发布条件 | v1.0 发布时 NF1（100 KB 文档已运行时打开中位 403 ms，目标 400 ms）与 NF3（100 KB 文档每窗口约 212 MB，目标 150 MB）未达标，经 Jorben 2026-11-14 同意延到 v1.x；`content-visibility: auto` 方案因破坏滚动定位撤回 | 剩余耗时与内存来自每个窗口独立 WebContent 进程的冷 JIT 与载入时的全量中间结构，需改编辑器载入方式（docs/perf-report.md） |
