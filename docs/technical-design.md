# LiteMd 技术实现方案

| 项 | 内容 |
|---|---|
| 版本 | v0.2（草案） |
| 日期 | 2026-11-13 |
| 依据 | `docs/product-requirements.md` v0.3 |
| 调研基线 | mygo main `6eaa7fb`（v0.9.0，2026-11-13）；vmark main `01bf9f4`（0.9.120，2026-11-12） |
| 修订 | v0.2：按方案评审结果修订，逐条对照 mygo、vmark 源码，修正启动窗口、内容同步、保真写回、编码、安全等处的缺陷，见附录 A |

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
├── mygo.config.ts            # 应用名、标识、文件关联（只含 Markdown 扩展名）、更新、打包配置
├── go.mod / main.go          # 入口：单实例、NewDocuments、菜单、协议、绑定
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
│   ├── patches/              # micromark、mdast-util-*、prosemirror-view 的补丁
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
- 启动窗口是同一个前端包里的路由 `/start`，只引入外壳样式，**不加载 Tiptap、CodeMirror**；窗口选项 `Width: 480, Height: 320, DisableResize: true`，`X`、`Y` 为 0 即居中。
- 两个按钮调用 `Start.newDocument()` → `docs.New()`、`Start.open()` → `docs.OpenDialog()`；这两个方法检查调用者必须是启动窗口。取消打开对话框时什么都不做，启动窗口保留。
- 拖入文件：`win.OnFileDrop` → 筛出 Markdown 扩展名和 `.txt` → 逐个 `docs.Open(path)`。
- 启动窗口里的 ⌘N / ⌘O 走菜单的 `RoleNew` / `RoleOpen`，与按钮效果相同。
- **关闭启动窗口**：`newDocWindow` 在文档窗口**创建之后**调用 `start.Close()`，因此 Windows/Linux 上不会出现瞬间“没有窗口”而触发退出。不能放在 `App.OnWindowCreated` 里做：那个事件在 mygo 把窗口登记到文档之前触发，`docs.ForWindow(w)` 还是 `nil`。
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
| `Session` | `revert()` | 不再弹确认框，直接重新读盘：只供提示条（冲突、恢复）调用，提示条本身就是确认 |
| `Session` | `saveAnyway()` | 冲突提示条「保留我的版本」 |
| `Session` | `discardRecovered()` | 恢复提示条「丢弃」（第 3.3 节） |
| `Session` | `saveAsUTF8()` | 非 UTF-8 文档另存为 UTF-8（第 3.2 节） |
| `Session` | `setFileState(state)` | 按文件保存查看模式、大纲开关、滚动位置 |
| `Session` | `setMenuState(state)` | 当前模式下哪些菜单命令可用，Go 据此置灰 |
| `Start` | `newDocument()` `open()` | 只供启动窗口调用（第 3.3.1 节）；其他窗口调用时拒绝 |
| `Assets` | `saveImage(bytes, mime, suggestedName)` → 相对路径 | F6.3：按设置的规则存到文档目录（默认 `./assets/`，D4），文件名冲突时加序号，大小上限 50 MB，只接受图片 MIME 类型。未命名文档返回 `ErrNeedSave`（F6.4：提示先保存） |
| `Assets` | `importDropped(paths)` → 相对路径列表 | F6.3/F6.5：**只接受本窗口最近一次 `OnFileDrop` 登记过的路径**（第 7 节）；图片复制到 assets 目录，非图片只计算相对路径，不复制 |
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
  - 文件不存在返回 404，页面显示占位和原始路径（F6.7）。
- **网络图片（F6.2）**：
  - 开启时由页面直接加载。
  - 关闭时，页面启动阶段在 CSP 中去掉 `http:`、`https:`（第 7 节），这是硬性保证：原始 HTML、行内样式里的 `url()` 也加载不了。页面同时把 `http(s)` 图片换成占位。用户点击单张图片时调用 `Assets.fetchImage(url)`：只接受 `http(s)`；解析后的地址是回环、内网、链路本地地址时拒绝；响应必须是图片 MIME 类型，上限 20 MB；页面拿到字节后用 `blob:` URL 显示。
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
| `patches/`：micromark、mdast-util-from-markdown、mdast-util-to-markdown、micromark-extension-gfm-autolink-literal、mdast-util-find-and-replace、prosemirror-view | 6 个补丁 | 迁入，改成 Bun 的补丁格式，**锁定依赖版本**（xterm 的补丁不迁） | 性能、病态输入 |
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

| 场景 | 接入点 |
|---|---|
| 菜单保存、副本、另存为、导出、打印 | 自建文件菜单的 `Click`（第 3.6 节）：先收齐，再执行 |
| 关窗 | `newDocWindow` 里注册的 `OnClose`，排在 mygo 的关闭监听之前（第 3.3 节）。窗口需要收齐时 `PreventDefault`（mygo 看到已阻止就不处理），收齐后再次调用 `Close()`；第二次无需收齐，放行给 mygo 的保存/询问流程。**应用正在退出时一律放行**：退出时 mygo 会对每个窗口调用 `close`，此时阻止会取消整个退出（`app.go` 的 `prepareQuit`） |
| 退出 | `session.InstallQuitFlush` 在 `NewDocuments` **之前**注册 `OnBeforeQuit`，排在 mygo 的 `documentsBeforeQuit` 前面。有窗口需要收齐时：`PreventDefault`，并行收齐，然后再次 `App.Quit()`；没有需要收齐的窗口时不做任何事，交给 mygo。因为“是否需要收齐”由序号判断，第二次进入时必然放行，不会和 mygo 自己的“阻止 → 处理 → 再次退出”流程互相打断。监听在放行时记下“正在退出”，在 `OnQuitCanceled` 中清除 |
| 关机、注销（`e.SessionEnding`） | 不能阻止也不能等待，只能依赖最近一次推送。由于有脏标记，mygo 会把这类文档当作已编辑处理（写盘或留恢复副本），最多丢失最后 150–400 ms 的输入 |

### 5.4 外部修改、冲突与恢复

- **`onDocumentReload`**：mygo 已经重新读入了磁盘内容（只在 Go 侧认为“未编辑”时发生）。页面先保存当前模式的滚动锚点，调用 `Session.content()` 重新载入文本、重建保真基线，再恢复位置。
- **竞态**：极少数情况下，`markDirty` 还在路上时 mygo 已经重新读盘。页面收到 `onDocumentReload` 时如果自己还有未推送的编辑，就**不载入**磁盘内容，改为显示冲突提示条「磁盘上的文件已被修改」，并暂停推送，直到用户选择：「载入磁盘版本」→ 丢弃本地编辑并重新载入；「保留我的版本」→ 推送本地内容后 `Session.saveAnyway()`。
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
  - mdast 与 ProseMirror 的顶层节点不一定一一对应（vmark 的 `inlineHtmlMerge`、`listInterruptJoin` 会合并节点，`details` 等节点没有位置，见 `positionTrust.ts`）。拿不到可靠起点的块与前一个块合并成一个单元，共享一个区间。
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


[Showing lines 1-546 of 713 (50.0KB limit). Use offset=547 to continue.]