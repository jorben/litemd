# LiteMd M0 技术验证报告

| 项 | 内容 |
|---|---|
| 状态 | 完成（V5 与 Windows 项待手工 / CI 验证） |
| 日期 | 2026-11-14 |
| 依据 | `docs/technical-design.md` v0.2 第 10 节（V1–V8） |
| 基线 | mygo `6eaa7fb`（Go 模块 `v0.9.1-0.20261112203958-6eaa7fb47e01`，npm 包 `mygo-runtime`/`mygo-cli` 0.9.0）；vmark `01bf9f4`（0.9.120） |
| 测试机 | Apple Silicon（arm64），macOS 27.2.1，Node.js 26.8.2，pnpm 11.5.3 |

## 0. 环境与工具链

| 项 | 结果 | 说明 |
|---|---|---|
| Go 版本 | 通过 | 本机 Go 1.26.1 是官方安装包（`/usr/local/go`，PATH 中排在 Homebrew 之前），用 Homebrew 另装一份会被遮住。改为在 `go.mod` 写 `go 1.27.4`，靠 Go 自带的工具链自动切换（`GOTOOLCHAIN=auto`）下载 1.27.4；在仓库内 `go version` 为 `go1.27.4`。不改系统环境，CI 用 `actions/setup-go` 读 `go.mod` 即可 |
| 参考源码 | 通过 | `.reference/mygo`、`.reference/vmark` 已切到基线，`.reference/` 在 `.gitignore` 中 |
| `go tool mygo` | 通过 | `go get -tool github.com/egoist/mygo/cmd/mygo@6eaa7fb4`，web 项目也能用 `go tool mygo` 运行 CLI（技术方案 1.2 节待确认项） |
| `mygo.config.ts` 由 Node 执行 | 通过 | 本机无 Bun，mygo 自动改用 Node.js（26.8，默认去除类型）。配置文件用 `import type` 从 `frontend/node_modules/mygo-cli` 取类型，运行时不依赖该包 |
| `mygo generate` 输出位置 | 通过 | 配置 `bindings: "frontend/src/mygo.ts"`；尚未绑定服务时 CLI 提示不生成，属预期 |
| `mygo doctor` | 通过 | go、macOS WKWebView、gh、codesign 检查通过；bun、makensis 为可选项 |
| `mygo build`（未签名骨架） | 通过 | 9.8 s 产出 `LiteMd.app` 7.1 MB、`litemd-0.1.0-arm64.dmg` 2.5 MB（NF4 目标 < 25 MB） |
| pnpm 供应链设置 | 有调整 | `minimumReleaseAge: 10080` 会挡住发布仅 3 天的 mygo 0.9.0 npm 包。在 `minimumReleaseAgeExclude` 中只放行 `mygo-runtime`、`mygo-cli`、`@egoist/mygo-cli-*`（基线锁定的框架本身，精确版本）。已核对 mygo `v0.9.0..6eaa7fb` 之间 `packages/runtime`、`packages/bridge`、`internal/bridge` 无改动，npm 0.9.0 与基线前端运行时一致 |
| 前端版本 | — | 与 vmark 对齐：TypeScript ~6.0.3、Vite ^8.3.5、Vitest ^4.1.12 |

## V3 vmark 管线在 Node 下运行、方言调整、往返基线 —— 通过

### 迁入方式

- vmark `src/` 中管线的依赖闭包（共 273 个文件：`utils/markdownPipeline/` 全部代码、测试与语料，外加 26 个小模块）按原目录结构复制到 `frontend/src/vmark/`，`@/` 别名指向该目录，迁入文件的 import 一律不改。依赖闭包由脚本根据 import 关系算出。
- 6 个依赖补丁原样迁入 `frontend/patches/`，在 `pnpm-workspace.yaml` 的 `patchedDependencies` 中登记；锁文件中 6 个包都带 `patch_hash`。
- **版本漂移**：直接 `pnpm install` 会解析到比 vmark 锁文件更新的 `mdast-util-gfm-*`、`markdown-table`、Tiptap 3.33，导致 vmark 的差分测试失败。改为用 `overrides` 把管线相关包钉回 vmark@01bf9f4 锁文件中的版本，Tiptap 钉在 3.32.1。以后升级这些包须重跑全部管线测试。
- 不迁的部分：`productionSchema`（原版从 vmark 的整套编辑器装配生成，会拉进应用层）由 LiteMd 自己的版本替代，在管线的 `testSchema` 上补齐 `codeBlock.meta`、列表 `spread`、`listItem.tightBefore`、图片引用属性，去掉 D13 的四种 mark；`debug` 里懒加载 `@tauri-apps/plugin-log` 的部分改为 `setPersistentLogSink` 由宿主注入。
- 媒体：schema 中没有 `block_video`/`block_audio`/`video_embed` 时，转换器拒绝提升，`![](x.mp4)` 退回普通图片、`<iframe>` 退回原始 HTML，**不丢内容**（已实测）。

### 方言调整（技术方案 4.3 节、D13）

| 项 | 处理 | 验证 |
|---|---|---|
| `remarkGfm` 的 `singleTilde` | 文档解析、details 内部解析、序列化三处都改为 `true` | `~x~` 与 `~~x~~` 都解析为删除线 |
| `remarkCustomInline`（`==` `~` `^` `++`） | 所有模式 `never`；序列化器也不注册（否则普通文本里的 `==` 会被转义成 `\==`） | 原样保留为普通文本，规范序列化不转义 |
| `remarkWikiLinks` | 所有模式 `never`，序列化器不注册 | `[[内部链接]]` 原样保留 |
| `remarkTocBlock` | 所有模式 `never`（技术方案未列出，但 LiteMd 不迁目录扩展，`[TOC]` 属 F4.11 范围） | `[TOC]` 原样保留 |
| setext 标题 | 文档方言照常识别；保真写回层原样保留未改动的 setext 标题 | `test/fidelity/dialect.test.ts` |
| 脚注重新编号 | 属于编辑器插件（`footnotePopup/cleanupOnEdit`），M1 迁扩展时不装 | — |

方言用例：`frontend/test/fidelity/dialect.test.ts`，9 个用例全部通过。

已知现象（只影响**被编辑、走规范序列化的块**，渲染结果不变）：`[[x]]` 在某些上下文被写成 `\[\[x]]`；`H~2~O` 被写成 `H~~2~~O`；`\==` 这类 vmark 专用转义的反斜杠在重写时丢掉。M1 视需要在序列化器里加对应的不转义处理。

### 迁入测试的处理

迁入的 vmark 管线测试共 6313 个。处理后：**6220 通过、0 失败、104 跳过**。跳过的用例都标了 `// litemd:` 原因，原因定义集中在 `frontend/src/vmark/test/litemdDivergence.ts`：

- D13：测试 vmark 扩展语法本身的用例（customInline、wiki 链接等）；
- 未迁节点：toc、音视频、视频嵌入；
- ledger：vmark 方言下录制的 spec/fidelity 分歧清单（D13 后有条目过期、`~x~` 带来新的写法差异），M1 按 LiteMd 方言重录。

characterization golden 中 12/15/16/17 号随 D13 更新，逐条核对过差异（15 号的 iframe 现在与原文完全一致，比 vmark 原 golden 更忠实）。

`tsconfig` 沿用 vmark 的编译选项（`strict`、`exactOptionalPropertyTypes`，无 `noUncheckedIndexedAccess`）；与 vmark 一样，迁入的 vmark 测试文件不参与类型检查，LiteMd 自己的代码与测试参与。

### 保真语料与往返基线

`testdata/fidelity/` 共 **264** 份（≥ 200）：vmark 角色化语料 23、vmark 官网指南（英 36 / 中 36 / 日 12）、mygo 文档（英 39 / 中 40）、mygo 示例 4、npm 包自带文档 60、LiteMd 文档 2、换行符与 BOM 变体 12（CRLF、UTF-8 BOM、混合换行各 4）。来源与许可见 `MANIFEST.md`。非 UTF-8 编码样例在 Go 侧测试（V8），不进前端语料。

**规范管线直接往返（不经保真写回层）**：`frontend/test/fidelity/baseline.test.ts`

| 指标 | 结果 |
|---|---|
| 逐字节相同 | **61 / 264（23.1%）** |
| 解析报错 | 0 |
| 首处差异分类 | 表格 118（列宽对齐被重排）、强调 45、列表 15、其他 16、HTML 11、转义 10、引用式链接 4、空白 4 |

结论：vmark 管线自身的往返会改写 3/4 以上的真实文档，**必须有保真写回层**（D3）。

## V4 保真写回原型 —— 通过

实现：`frontend/src/fidelity/writeback.ts`，按技术方案第 6 节：

- 载入时在 `mdastToProseMirror` 顶层循环记录每个 mdast 节点产出的 PM 顶层节点（vmark 代码中加了可选的 `record` 回调，以 `// litemd:` 标出），用 mdast **行号**（预处理会改变字符偏移，但不改变行数）把顶层块映射为原文区间「单元」。拿不到位置或互相重叠的节点并入相邻单元；预处理改变了行数时退回整篇一个单元（语料中 2 份：两份 details 样例）。
- 保存时比较公共前后缀顶层节点（`Node.eq`，未改动的节点是同一对象，先比引用），只把改动范围内的单元交给规范序列化，其余原样输出原文切片。
- 局部校验：取改动单元加前后各一个单元重新解析，与当前节点比较结构；不一致时以规范序列化结果为对照；再不行扩大一个单元；最后才整篇规范序列化。

测试：`frontend/test/fidelity/writeback.test.ts`，每份文件分别做 4 种随机编辑（插入字符、加粗/取消加粗、删除几个字、新增段落），随机种子固定：

| 指标 | 目标 | 结果 |
|---|---|---|
| ① 载入后不编辑 → 逐字节相同（同一对象、以及重新解析的新对象两种） | 100% | **264 / 264** |
| ② 编辑后撤销 → 逐字节回到原文 | 100% | **1056 / 1056** |
| ③ 随机编辑 → diff 只落在被改的顶层块内 | ≥ 98% | **1052 / 1056（99.62%）** |
| ③ 的输出重新解析后与编辑后的文档结构一致 | 100% | **1056 / 1056** |
| 退回整篇规范序列化 | — | 0 次 |

③ 未达标的 4 例：`_csstools__css-color-parser-readme.md`（标题含行内 `<img>`，局部校验扩大了一个单元）、`vmark-corpus/18-nested-details.md` 3 例（嵌套 details，整篇被并成粗粒度单元）。都属于技术方案 6.4 节预计的“合并单元”情形，语义均正确。

判定过程中的一个发现：vmark 管线对 5 份语料的规范往返**本身就会改变语义**（行内 HTML 段落被读成 HTML 块、长段落合并行）。保真写回因保留原文反而更正确；测试的语义判定因此以编辑后的文档本身为准。

退路：不需要（③ ≥ 98%）。M1 待办：基线提交（`commitBaseline`）目前按新文本重新解析建立单元，再换回当前文档节点，需要改为直接平移单元区间，以免节点身份丢失；`docFingerprint` 目前从 vmark 的测试目录引用，迁到非测试位置。

## V1/V2/V5–V8 的实测方法

在 macOS 上用 `GOFLAGS=-tags=e2e go tool mygo build -debug` 构建带 mygo 自动化插件的 .app（`automation_e2e.go`，发布构建不含），用 `mygo-automation` 驱动：列窗口、在页面里 `eval` 模拟用户输入（带 CodeMirror `input.type` 用户事件注解）、选菜单、截图；外部修改、崩溃（`kill -9`）、第二实例、点 Dock（`open LiteMd.app`）由 shell 产生。设置 `LITEMD_DEBUG=1` 时 Go 侧把收齐过程写入日志。M0 验证页（`frontend/src/main.ts`）是 CodeMirror 源码编辑 + 同步协议 + 一个 Tiptap 输入法区域，M1 替换为正式外壳。

## V1 mygo 文档窗口与工具链 —— 通过（macOS）；Windows 待 CI

| 检查 | 结果 |
|---|---|
| 工具链 | 见第 0 节：`go tool mygo`、Node 执行 `mygo.config.ts`、`mygo generate` 输出到 `frontend/src/mygo.ts` 均通过。两个服务类型同名 `Service` 时 `mygo.Bind` 会 panic，改用 `BindAs("Session")` / `BindAs("Start")` |
| 一个文件一个窗口、单实例 | 应用运行时再执行 `LiteMd a.md`：第二实例退出码 0，文件在现有进程开新窗口 |
| 只打开不写盘 | 打开 CRLF 文件后 `cmp` 与原文件相同 |
| 自动保存 | 输入后约 1 s 写盘，CRLF 保留（`od -c` 核对），状态回到未编辑 |
| 恢复副本 | 未命名文档输入后 `kill -9`，重启时自动恢复，`recovered=true`，内容一致 |
| 新窗口层叠（F1.8） | 连续打开 6 个文件，窗口位置依次偏移 24 pt（System Events 读取：1064,173 → 1184,293） |
| Finder 双击打开 | 文件关联已在 `mygo.config.ts` 配置；双击走与命令行相同的 `OnOpenFile`，未单独自动化，冒烟清单手工确认 |
| Windows | 待 CI（GitHub Actions windows runner 构建与 `go test`），交互项待手工验证 |

## V2 同步协议 —— 通过（发现并修复 1 个问题）

| 场景 | 结果 |
|---|---|
| 输入后、防抖到期前关窗（推送延迟改为 60 s 制造未推送状态） | `OnClose` 拦截 → `flush` 事件 → 页面推送 → `flushed` → 关窗，内容写盘 |
| 输入后立即退出 | `OnBeforeQuit` 拦截收齐后再次 `Quit`，进程退出，内容写盘，无重复询问 |
| 本地无改动时外部修改 | 静默重新载入（F2.4） |
| 本地有未推送输入时外部修改 | 进入冲突，显示提示条，输入未被冲掉；选「保留我的版本」后磁盘为本地内容 |
| 乱序推送、并发、收齐超时 | Go 单元测试（`internal/session`，含 `-race`）与页面单元测试（`frontend/src/sync`）覆盖 |

**发现的问题**：`markDirty` 调用 `SetEdited(true)` 会启动 mygo 的自动保存计时；若页面的推送晚于计时（实测把推送延迟设大即可复现），自动保存写的是上一版内容并把文档标回「未编辑」，此后关窗不再收齐，最后的输入会丢。**修复**：`session.Attach` 监听 `OnStateChange`，文档变为未编辑而页面仍有未推送编辑时，重新 `SetEdited(true)` 并立即收齐。修复后上述场景通过。正常防抖（150/400 ms）远短于自动保存延迟（1 s），这是边界情况，但必须兜住。

## V5 输入法与快捷键 —— 待手工验证

自动化插件不能驱动输入法组字（页面窗口只能 `eval`），macOS 拼音、Windows 微软拼音、搜狗在 Tiptap 与 CodeMirror 中的组字、候选框位置、组字中不触发快捷键，需要在冒烟阶段手工验证（PRD 第 7 节第 5 条）。代码侧已有的保护：CodeMirror 与 vmark `compositionGuard` 在组字期间不处理按键；原型的全局快捷键处理在 `isComposing` / `keyCode 229` 时跳过。菜单加速键与编辑器键位的重复触发，在 M1 自建菜单后一并验证。

## V6 性能 —— 接近或达到 NF1–NF4（M0 验证页）

测量脚本：`scripts/perf.py`（需先用 e2e 标签构建到 /tmp/litemd-e2e）。测试机 Apple Silicon，e2e 调试构建，文档为语料拼接的 100 KB / 1 MB Markdown，计时终点为页面内容渲染完成（`performance.timeOrigin + now()`）。

| 指标 | 目标 | 结果 |
|---|---|---|
| 冷启动到显示内容（100 KB） | < 1 s | 370 / 375 / 721 ms（中位 375 ms） |
| 已运行时打开新文件（含第二实例进程启动与转发） | < 400 ms | 107–141 ms |
| 6 个窗口的内存（应用进程 + WebKit 进程合计） | 单窗口 < 150 MB | 677 MB，约 113 MB / 窗口 |
| 1 MB 文档打开 | — | 116 ms |
| 1 MB 文档输入（CodeMirror 事务） | P95 < 16 ms | P50 1 ms、P95 2 ms、最大 5 ms |
| 1 MB 文档一次推送 | — | 7 ms |
| 安装包 | DMG < 25 MB | .app 11 MB（调试构建），DMG 2.5 MB（骨架）；M1 加入完整前端后复测 |

注意：这是**源码模式**的数据。预览 / 所见即所得（Tiptap + 保真写回）在 M1 完成后用同一脚本复测，写入 `docs/perf-report.md`；1 MB 文档窗口的 WebKit 内存约增加 300 MB，大文档默认源码模式（NF2）的阈值届时一并复核。

## V7 启动窗口 —— 通过（macOS）

| 场景 | 结果 |
|---|---|
| 不带文件启动 | 只出现启动窗口（`#/start`） |
| 带文件启动 | 第一个窗口就是文档窗口（窗口 ID 1），启动窗口未出现 |
| 恢复副本启动 | 第一个窗口就是恢复的文档，启动窗口未出现（300 ms 等待足够） |
| 启动窗口点「新建」 | 出现未命名文档窗口，启动窗口自动关闭 |
| 关闭最后一个文档窗口（macOS） | 应用留在 Dock，不弹窗 |
| 无窗口时点 Dock | 显示启动窗口；再点一次仍只有一个 |
| 关闭启动窗口（macOS） | 应用留在 Dock |
| 打开对话框里取消、拖入文件到启动窗口 | 系统面板与原生拖放无法自动化，待手工验证 |
| Windows / Linux 关闭最后一个窗口时退出 | 待 CI / 手工验证 |

## V8 编码与命令行 —— 通过

| 场景 | 结果 |
|---|---|
| `litemd new-cli.md`（不存在） | 创建空文件并打开 |
| `litemd todo`（无扩展名、不存在） | 补 `.md`，创建并打开 |
| `litemd note.txt` | 打开（mygo 不投递 .txt，由 `internal/cli` 处理） |
| GB18030 文件 | 按 GB18030 显示，只读，原文件字节未变 |
| UTF-16 LE（带 BOM） | 正确显示，只读 |
| 「另存为 UTF-8」 | Go 侧 `UTF8Copy` / `WriteFileAtomic` 单元测试通过；菜单与提示条接线在 M1 |
| 命令行参数解析 | `internal/cli` 单元测试覆盖（选项、目录、其他扩展名、已存在/不存在） |

## M0 结论

- V1、V2、V3、V4、V6、V7、V8 在 macOS 上通过；V5 待手工验证；Windows 相关项待 CI 与手工验证。
- 不需要启用技术方案第 10 节的任何退路。保真写回原型达到 99.62%（≥ 98%）。
- 带入 M1 的待办：V2 的状态兜底已并入 `internal/session`；`commitBaseline` 改为平移单元；`docFingerprint` 移出测试目录；vmark ledger 按 LiteMd 方言重录；未命名文档名「Untitled」随界面语言（mygo i18n，M2）；自建文件菜单后验证保存前收齐与快捷键冲突。
