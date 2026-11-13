# LiteMd M0 技术验证报告

| 项 | 内容 |
|---|---|
| 状态 | 进行中 |
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
