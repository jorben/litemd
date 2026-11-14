# LiteMd v1.0 验收清单

对照 PRD v0.3 第 4、5、7 节逐条列出状态与证据。测试机：Apple Silicon，macOS；Windows / Linux 只有 CI 配置（`.github/workflows/`），没有在本机运行。

状态：**完成**（实现并有自动化或实测证据）、**部分完成**、**待手工验证**（实现了，但需要人工操作或其他平台才能确认）、**延后**（v1 不做，写明去向）。

证据中的「e2e」指用 `mygo-automation` 驱动本机构建的应用实测（M1、M2 期间，见各提交）；「冒烟」指 `scripts/smoke-macos.sh` 的输出（第 3 节）。

## 1. 第 7 节发布条件

| # | 条件 | 状态 | 证据 |
|---|---|---|---|
| 1 | P0 全部完成，P1 ≥ 90%，未完成项有去向 | 完成（除凭据与 Windows 实机） | 第 2 节。P0 共 34 项：32 项完成；F11.1 的真实签名公证需要凭据（目标范围外，CI 已配置），F11.2 需 Windows 实机验证。P1 共 31 项（含 F10、F12）：全部实现，28 项完成 = 90.3%；另 3 项待手工验证（F1.4 拖到 Dock、F8.3 打印面板、F11.4 真实更新） |
| 2 | 保真度回归集 | 完成 | 第 4 节：264 份语料；不编辑 100%、撤销 100%、局部编辑 99.62%（管线）/ 99.6%（真实编辑器）、源码模式 100% |
| 3 | NF1–NF4 达标并有记录 | 部分完成（未达标两项经 Jorben 同意延到 v1.x） | 有完整测量记录（[perf-report.md](perf-report.md)）。达标：冷启动 646 ms、1 MB 输入 P95 11 ms（所见即所得）/ 2 ms（源码）、空闲 CPU 0、DMG 6.5 MB。未达标：100 KB 文档「已运行时打开」中位 403 ms（目标 400 ms；常见文档 180–220 ms）、100 KB 文档每窗口约 212 MB（目标 150 MB；小文档 55–90 MB）。原因分析与 v1.x 去向见报告。**2026-11-14 Jorben 确认：v1.0 按现状发布，NF1（100 KB 文档已运行时打开 403 ms）与 NF3（100 KB 文档每窗口约 212 MB）延到 v1.x 达标。** |
| 4 | macOS、Windows 冒烟清单 | macOS 完成（10/10）；Windows 待手工验证 | 第 3 节 |
| 5 | 中文输入法四种模式手工验证 | 待手工验证 | 自动化无法驱动输入法候选框。M0 V5 已确认编辑器在 `compositionstart/end` 期间不推送、不改写（见 [m0-report.md](m0-report.md) V5）。需人工在 macOS 拼音、Windows 微软拼音、搜狗下各走一遍四种模式 |
| 6 | D3 未改动块保持原文为阻断条件 | 完成 | 同第 2 条；每次 `pnpm test` 与 CI 都运行 |

## 2. 功能需求

### F1 文件与窗口

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F1.1 双击打开 | P0 | 完成（macOS）/ 待手工验证（Windows） | `mygo.config.ts` 的 `fileAssociations`；从 DMG 复制出的 .app 以 `open -a` 带文件启动显示文档（M1） |
| F1.2 每个文件一个窗口 | P0 | 完成 | 冒烟「同一文件再次打开只聚焦已有窗口」 |
| F1.3 单实例 | P0 | 完成 | 冒烟「第二个文件在同一进程的新窗口打开」；M0 V1 |
| F1.4 拖到 Dock / 窗口标题栏 | P1 | 部分完成 | Dock、任务栏由 mygo `OnOpenFile` 投递（与双击同一路径）；启动窗口支持拖入；正文区拖入为插入（F6）。拖到 Dock 待手工验证 |
| F1.5 命令行 | P1 | 完成 | `internal/cli`（含不存在时 `O_EXCL` 创建）测试；macOS「安装命令行工具…」`internal/clitool` |
| F1.6 新建 / 打开 / 最近 / 关闭 | P0 | 完成 | mygo 菜单角色 `new` `open` `openRecent` `close`（`internal/menu/spec.go`） |
| F1.7 标题与未保存标记 | P0 | 完成（macOS）/ 待手工验证（Windows `*`） | mygo `NewDocuments` 管理标题与编辑标记 |
| F1.8 层叠与按文件记住窗口 | P1 | 完成 | `main.go` 层叠；`internal/filestate`（LRU 500）测试 |
| F1.9 不带文件启动显示启动窗口 | P0 | 完成 | M0 V7 |
| F1.10 关闭最后一个窗口 | P1 | 完成（macOS）/ 待手工验证（Windows、Linux 退出） | `internal/start` |
| F1.11 代理图标 | P2 | 完成 | mygo `NewDocuments` 提供，未单独测试 |
| F1.12 启动窗口 | P0 | 完成 | M0 V7，`frontend/src/shell/start.ts` |

### F2 保存与可靠性

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F2.1 保存、另存为、还原等 | P0 | 完成 | 菜单 `save` `save-as` `revert` `duplicate` `rename` `move-to`；快捷键见 [keybindings.md](keybindings.md) |
| F2.2 自动保存 | P0 | 完成 | 冒烟「编辑后约 1 秒写盘」；设置重启后生效（D11） |
| F2.3 崩溃恢复 | P0 | 完成 | 冒烟：`kill -9` 后重开，未命名文档恢复并显示提示条；已存在的文件由自动保存约 1 秒写盘（mygo 只为自动保存不写的文档保留恢复副本） |
| F2.4 外部修改 | P0 | 完成 | 冒烟「无未保存改动时自动载入」；M1 e2e 冲突提示条与「保留我的版本」 |
| F2.5 原文保真 | P0 | 完成 | 第 4 节 |
| F2.6 编码 | P1 | 完成 | `internal/doc` 测试（BOM、UTF-16、GB18030、混合换行）；M1 e2e GB 文件显示 `lossy` 提示条，另存为 UTF-8 |
| F2.7 原子写盘、失败提示 | P0 | 完成 | mygo 临时文件 + 原子替换并保留元数据；写盘失败由 mygo `showDocumentError` 弹窗并保持未保存 |
| F2.8 只读文件 | P1 | 完成 | 冒烟「只读文件以只读打开并有标记」 |

### F3 查看模式

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F3.1 预览 | P0 | 完成 | M1 e2e；预览中任务框不可勾选（`editable: false`） |
| F3.2 所见即所得 | P0 | 完成 | M1 e2e 编辑后自动保存只改一行 |
| F3.3 源码 | P0 | 完成 | M1 e2e 源码编辑逐字节保存；`test/fidelity/source.test.ts` |
| F3.4 分屏 | P1 | 完成 | M2 e2e（防抖刷新、同步滚动、交换左右） |
| F3.5 切换快捷键 | P0 | 完成 | [keybindings.md](keybindings.md)，菜单与页面同表（`keys.test.ts`） |
| F3.6 切换保留位置 | P0 | 完成 | 按最近的块对齐（`frontend/src/shell/doc.ts`）；M1 e2e |
| F3.7 默认预览、可改 | P1 | 完成 | 设置「打开文件时」 |
| F3.8 双击进入编辑 | P2 | 完成 | `doc.ts` dblclick |

### F4 语法支持

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F4.1 CommonMark | P0 | 完成 | vmark 管线测试 6220 通过；setext 识别（`dialect.test.ts`） |
| F4.2 GFM | P0 | 完成 | `~x~` 删除线（D13，`dialect.test.ts`）；M2 e2e 任务框 |
| F4.3 代码高亮 | P0 | 完成 | lowlight；M2 e2e 高亮元素 17 个 |
| F4.4 公式 | P0 | 完成 | KaTeX；M2 e2e 与导出 PDF 截图 |
| F4.5 Mermaid | P1 | 完成 | M2 e2e 渲染出 SVG、无错误块 |
| F4.6 frontmatter | P0 | 完成 | M2 e2e；打开不改字节 |
| F4.7 脚注 | P1 | 完成 | M2 e2e；悬停浮层（vmark footnotePopup） |
| F4.8 提示块 | P1 | 完成 | M2 e2e |
| F4.9 details | P1 | 完成 | M2 e2e |
| F4.10 原始 HTML | P1 | 完成 | DOMPurify extended 白名单；M2 e2e 无任何 `on*` 属性（`security.test.ts` 23 项） |
| F4.11 未识别语法原样保留 | P0 | 完成 | `dialect.test.ts`（`==高亮==`、`^上标^`、`++下划线++`、`[[wiki]]`、`[TOC]`） |

### F5 编辑

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F5.1 格式快捷键 | P0 | 完成 | [keybindings.md](keybindings.md)（由菜单表生成并测试） |
| F5.2 输入规则 | P0 | 完成 | Tiptap / vmark 输入规则 |
| F5.3 浮动格式栏 | P1 | 完成 | M2 e2e：选中后出现，点「加粗」只改该处 |
| F5.4 表格编辑 | P0 | 完成 | vmark tableUI（Tab、增删行列、对齐）；菜单「表格」 |
| F5.5 链接 | P1 | 完成 | 预览单击、所见即所得 ⌘ 点击、悬停浮层均走 `Links.open`；相对 `.md` 新窗口打开（`internal/links` 测试） |
| F5.6 撤销与模式切换 | P0 | 完成 | D15；`editorLoad.test.ts` 撤销逐字节回到原文 |
| F5.7 源码模式编辑能力 | P1 | 完成 | CodeMirror 6 扩展（`frontend/src/editor/source.ts`） |
| F5.8 粘贴转换 | P1 | 完成 | turndown + GFM 插件；「粘贴为纯文本」⌥⇧⌘V |
| F5.9 中英间距视觉处理 | P2 | 延后 | v1.x |
| F5.10 字数统计 | P1 | 完成 | 状态栏；菜单「状态栏」可隐藏 |
| F5.11 拼写检查 | P2 | 完成 | 设置开关作用于两种编辑器（`39e0450`） |

### F6 图片

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F6.1 本地图片 | P0 | 完成 | `lmasset` 协议（token + 窗口校验，M1 实测 200/403/404） |
| F6.2 网络图片可关闭 | P1 | 完成 | 设置「加载网络图片」；关闭时单击由 Go 下载（含 SSRF 防护）后显示 |
| F6.3 粘贴 / 拖入图片 | P1 | 完成 | 冒烟「图片粘贴保存到 assets/ 并插入引用」；四种目录规则（`internal/assets` 测试） |
| F6.4 未命名文档粘贴 | P1 | 完成 | 提示条「请先保存文档，再粘贴图片」 |
| F6.5 拖入非图片文件 | P2 | 完成 | 插入相对路径链接（`internal/assets` 拖放登记） |
| F6.6 放大与右键菜单 | P2 | 延后 | Go 侧已有 `RevealInFolder`、`CopyPath`，右键菜单与放大查看放到 v1.x |
| F6.7 缺失图片占位 | P0 | 完成 | 冒烟「缺失图片显示占位与原始路径」，文件不被改动；块级图片在占位下方显示原路径，行内图片显示 alt 并在悬停提示中给出路径 |

### F7 导航与查找

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F7.1 大纲 | P1 | 完成 | M1 e2e 9 个条目；按文件记住开关 |
| F7.2 查找 | P0 | 完成 | M1 e2e 三种模式计数一致（1/18） |
| F7.3 替换 | P1 | 完成 | M1 e2e；预览中只能查找 |

### F8 导出

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F8.1 导出 HTML | P1 | 完成 | `exportHtml.test.ts`；e2e：图片内嵌、KaTeX 字体内嵌、无脚本、带 CSP |
| F8.2 导出 PDF | P1 | 完成 | e2e 经系统存储面板生成 A4 两页 PDF，浅色版式，公式与图片正确 |
| F8.3 打印 | P1 | 待手工验证 | 隐藏的 Untrusted 窗口载入导出 HTML 后调用系统打印面板；面板需人工确认 |
| F8.4 复制为 HTML / Markdown | P2 | 延后 | v1.x |

### F9 外观

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F9.1 浅色 / 深色 | P1 | 完成 | vmark white / night 主题，跟随系统 |
| F9.2 字号缩放 | P1 | 完成 | ⌘+ ⌘- ⌘0，全局保存 |
| F9.3 正文宽度 | P2 | 完成 | 菜单「正文宽度」、设置 |
| F9.4 字体 | P2 | 完成 | 设置「正文字体」「代码字体」（预设列表，未枚举系统字体） |
| F9.5 极简窗口 | P0 | 完成 | 无工具栏；状态栏可隐藏 |

### F10 设置、F11 分发、F12 语言

| 编号 | 优先级 | 状态 | 证据 |
|---|---|---|---|
| F10 设置窗口 | P1 | 完成 | 五个分组与 PRD 一致（`frontend/src/shell/settings.ts`） |
| F11.1 macOS DMG + 签名公证 | P0 | 部分完成 | 本机产出 ad-hoc 签名 DMG 6.1 MB，挂载复制后可运行；`build.yml` 从 secrets 导入证书并公证（凭据未配置，按目标不在本机执行） |
| F11.2 Windows 安装包 | P0 | 待手工验证 | `ci.yml` 在 windows-latest 构建，`build.yml` 用 NSIS 打包；SmartScreen 说明见 README |
| F11.3 Linux | P2 | 完成（CI 配置） | `build.yml` 构建 linux/amd64、arm64 |
| F11.4 自动更新 | P1 | 待手工验证 | `internal/update`；公钥在配置中，私钥在本机 mygo 配置目录与 CI secret；需要发布第一个 Release 后实测 |
| F12 界面语言 | P1 | 完成 | 页面 `i18n.test.ts` 覆盖全部文案；菜单 `TestEnglishLabels`；e2e 英文界面；mygo 自身文案载入 zh-Hans |

## 3. 冒烟清单（第 7 节第 4 条）

macOS 自动部分：`scripts/smoke-macos.sh`（e2e 构建，`mygo-automation` 驱动），2026-11-14 结果：

```
PASS  打开文件显示内容、文件不被改动
PASS  单实例：第二个文件在同一进程的新窗口打开
PASS  同一文件再次打开只聚焦已有窗口
PASS  自动保存：编辑后约 1 秒写盘，内容正确
PASS  外部修改：无未保存改动时自动载入磁盘版本
PASS  只读文件以只读打开并有标记
PASS  缺失图片显示占位与原始路径
PASS  图片粘贴：保存为 assets/image-20261114-083116.png 并插入引用
PASS  强制结束前已自动保存的编辑在磁盘上
PASS  崩溃恢复：重开后恢复未命名文档并提示
通过 10，失败 0
```

清单中其余 macOS 项的证据：双击打开见 F1.1（从 DMG 复制出的 .app 带文件启动）；导出 PDF 见 F8.2（e2e 经系统存储面板生成 A4 PDF 并检查渲染）；外部修改的冲突分支见 F2.4（M1 e2e）。

Windows：待手工验证（双击打开、单实例、多窗口、自动保存、崩溃恢复、外部修改、图片粘贴、导出 PDF、自动更新）。自动更新在 macOS 上也需要第一个正式 Release 后验证。

## 4. 保真度（第 7 节第 2 条、D3）

语料：`testdata/fidelity/` 264 份（含 vmark 自带语料、mygo 中英文文档、LiteMd 自己的文档、npm 包 README、换行与 BOM 变体），来源见 `MANIFEST.md`。

| 指标 | 要求 | 结果 | 测试 |
|---|---|---|---|
| 打开 → 保存（无编辑） | 100% | 264/264（管线）；真实编辑器载入 264/264 | `writeback.test.ts`、`editorLoad.test.ts` |
| 编辑后撤销 | 100% | 1056/1056（管线）；真实编辑器 254/254 | 同上 |
| 随机小改 → diff 只在改动块 | ≥ 98% | 1052/1056 = 99.62%（管线，语义 1056/1056 正确，0 次整篇重写）；真实编辑器 253/254 = 99.6%；连续两次编辑推送 247/248 | `writeback.test.ts`、`editorLoad.test.ts`、`commit.test.ts` |
| 源码模式编辑 → 保存 | 100% | 页面 1056/1056；Go 写回 1060/1060（含混合换行与 BOM） | `source.test.ts`、`internal/doc/corpus_test.go` |

未达标的个例（都属技术方案 6.4 节预计的「合并单元」，语义正确）：

- `npm-docs/_csstools__css-color-parser-readme.md`、`_csstools__css-calc-readme.md`：标题含行内 `<img>`，局部校验扩大一个单元（`expanded`）。
- `vmark-corpus/18-nested-details.md`（3 例）：嵌套 `<details>` 使整篇成为粗粒度单元。

## 5. 非功能需求

| 编号 | 状态 | 证据 |
|---|---|---|
| NF1 启动与打开速度 | 部分完成 | 冷启动中位 646 ms（达标）；已运行时打开 100 KB 文档中位 403 ms（目标 400 ms，未达标 3 ms），常见文档 180–220 ms。[perf-report.md](perf-report.md) |
| NF2 编辑流畅度 | 完成 | 1 MB 文档输入 P95：所见即所得 11 ms、源码 2 ms。v1 实测发现所见即所得每次按键约 1 s（防抖计时序列化全文、推送后重新解析基线），已修复（`dd6da47`）；> 5 MB 源码模式、> 20 MB 只读 |
| NF3 资源占用 | 部分完成 | 空闲 CPU 0；20 个窗口量级可用（7 窗口含 1 MB 文档无卡顿）。单窗口：小文档 55–90 MB 达标，100 KB 文档约 212 MB 未达标；宽表格合成层问题已修复（92 → 41 MB 图形内存）。去向见报告 |
| NF4 安装包大小 | 完成（macOS）/ 待手工验证（Windows） | DMG 6.5 MB；Windows 安装包由 CI 产出 |
| NF5 安全 | 完成 | `security.test.ts`（XSS 两档白名单、CSP）；生产 CSP `script-src 'self'`；`lmasset` 只给图片且按窗口限定；导出 / 打印窗口 `Untrusted`；可执行文件链接拒绝打开（`internal/links` 测试） |
| NF6 隐私 | 完成 | 无账号、无遥测；默认网络请求只有检查更新与网络图片，两者可在设置关闭 |
| NF7 可靠性 | 完成 | 原子写盘、恢复副本、写盘失败保持未保存；保真回归在 CI 每次运行 |
| NF8 兼容性 | 部分完成 | macOS 最低 13.0（`mygo.config.ts`）；Windows / Linux 待手工验证 |
| NF9 输入法 | 待手工验证 | 见第 1 节第 5 条 |
| NF10 无障碍 | 部分完成 | 菜单、设置、对话框可键盘操作，控件带 `aria-label`；读屏待手工验证 |

## 6. 与技术方案的偏离

发布条件的例外：**2026-11-14 Jorben 确认：v1.0 按现状发布，NF1（100 KB 文档已运行时打开 403 ms）与 NF3（100 KB 文档每窗口约 212 MB）延到 v1.x 达标。** 已试过「屏幕外顶层块 `content-visibility: auto`」，打开耗时降到 353–379 ms，但大纲跳转、光标滚动会落到错误位置（估算高度与实际排版不符），已撤回；记入技术方案附录 B。

见 [technical-design.md](technical-design.md) 附录 B。v1 阶段新增四条：混合换行文件按行保留换行符；推送后平移基线单元（回到技术方案 6.3 节第 6 步的原设计，M1 实现曾用重新解析代替）；表格最宽到正文宽度、单元格内换行（参照原型，减少合成层内存）；缺失图片显示原路径（改动 vmark 的 `mediaNodeViewHelpers.ts`，以 `// litemd:` 标出）。

## 7. 延后与去向

| 项 | 去向 |
|---|---|
| F5.9 中英间距视觉处理、F6.6 图片放大与右键菜单、F8.4 复制为 HTML / Markdown | v1.x |
| NF1 打开 100 KB 文档 403 ms、NF3 100 KB 文档每窗口 212 MB | 经 Jorben 同意（2026-11-14）延到 v1.x：首屏优先渲染、推迟代码高亮与公式、减少载入时的中间结构（[perf-report.md](perf-report.md)） |
| 正式签名、公证、发布 | 配置 secrets 后打 `vX.Y.Z` tag（漏写 v 或写成大写 V 时 CI 自动纠正）由 `build.yml` 构建并发布为 prerelease，验证后手动转正（凭据见 workflow 注释） |
| Windows / Linux 实机、输入法、读屏、打印面板、自动更新的手工验证 | 发布前人工按本清单走一遍 |
