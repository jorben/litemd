# 第三方代码

LiteMd 本身以 Apache-2.0 许可发布。下面列出仓库中迁入（复制）的第三方代码，以及作为依赖使用的主要组件。

## 迁入的代码

### vmark

| 项 | 内容 |
|---|---|
| 来源 | https://github.com/xiaolai/vmark ，commit `01bf9f4`（0.9.120） |
| 许可 | ISC，Copyright (c) 2026 Xiaolai Li |
| 位置 | `frontend/src/vmark/`，保持 vmark `src/` 的目录结构；每个文件开头注明原路径 |
| 内容 | M0：`utils/markdownPipeline/`（Markdown 管线，含测试与语料）及其依赖的 `utils/`、`lib/extensions/`、`test/` 模块。M1：编辑器扩展按依赖闭包迁入（`plugins/`、`components/`、`stores/`、`theme/`、`styles/`、`services/`、`locales/` 中的 editor / dialog / common 语言包），共约 520 个文件 |
| 补丁 | `frontend/patches/` 中 micromark、mdast-util-from-markdown、mdast-util-to-markdown、micromark-extension-gfm-autolink-literal、mdast-util-find-and-replace、prosemirror-view 的 6 个补丁，原样迁入 |
| 改动 | 改动处以 `// litemd:` 注释标出；主要是方言调整（D13）、日志出口改为宿主注入、顶层块来源记录。LiteMd 自有的替代模块（不含 vmark 代码）：`i18n.ts`、`services/navigation/linkOpen.ts`、`services/terminal/`、`utils/media/resolveMediaSrc.ts`、`utils/history/unifiedHistory.ts`、`utils/persistence/workspaceStorage.ts`、`lib/ghaWorkflow/`、graphviz / markmap 占位、`test/productionSchema.ts`、`test/litemdDivergence.ts`、`test/vitestShared.ts`；`@tauri-apps/*` 由 `frontend/src/host/tauri/` 替代 |

ISC 许可全文：

```
ISC License

Copyright (c) 2026 Xiaolai Li

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## 测试语料

`testdata/fidelity/` 中的文件来自 vmark（ISC）、mygo（MIT）以及 MIT/ISC/Apache-2.0/BSD 许可的 npm 包自带文档，仅用作保真度回归测试数据。逐个文件的来源与许可见 `testdata/fidelity/MANIFEST.md`。

## 依赖

打进应用的前端依赖（`pnpm licenses list --prod`，共约 275 个包）以 MIT 为主，另有 ISC（d3 系列）、BSD-2/3-Clause（highlight.js、d3 部分模块、domino）、Apache-2.0（chevrotain）、Unlicense（robust-predicates）。主要组件：

| 组件 | 版本 | 许可 |
|---|---|---|
| mygo（github.com/egoist/mygo、npm mygo-runtime / mygo-cli） | 6eaa7fb / 0.9.0 | MIT |
| Tiptap / ProseMirror | 3.32.1 | MIT |
| CodeMirror 6 | 6.x | MIT |
| unified / remark / micromark / mdast 生态 | 11.x | MIT |
| KaTeX（含字体） | 0.19.1 | MIT |
| Mermaid | 12.3.0 | MIT |
| highlight.js / lowlight | 11.12.0 / 3.3.0 | BSD-3-Clause / MIT |
| DOMPurify | 3.4.17 | MPL-2.0 或 Apache-2.0，LiteMd 按 Apache-2.0 使用 |
| turndown、@joplin/turndown-plugin-gfm | 7.2.5 / 1.0.68 | MIT |
| i18next、zustand、React | 26.7.2 / 5.1.0 / 19.3.1 | MIT |
| khroma（Mermaid 依赖，包内未声明 license 字段，LICENSE 文件为 MIT） | 2.1.0 | MIT |
| golang.org/x/text、golang.org/x/net（仅 Windows 版） | 0.43.0 / 0.59.0 | BSD-3-Clause |
| github.com/ebitengine/purego（mygo 依赖） | 0.11.1 | Apache-2.0 |

链接进应用的 Go 模块以 `go list -deps` 为准；golang.org/x/crypto、golang.org/x/sys 等只被 mygo 构建工具使用，不进应用。

### elkjs（EPL-2.0）

Mermaid 依赖 [elkjs](https://github.com/kieler/elkjs) 0.12.1 提供 ELK 布局，构建后是按需加载的单独文件（`assets/elk-*.js`），只在图表声明 `layout: elk` 时载入。elkjs 以 EPL-2.0 或 GPL-3.0-or-later 双许可发布，**LiteMd 按 EPL-2.0 使用**，未作修改；源码见 https://github.com/kieler/elkjs 与 https://github.com/eclipse/elk ，许可全文见 https://www.eclipse.org/legal/epl-2.0/ 。

完整的逐包许可全文见随应用打包的 `frontend/public/THIRD_PARTY_NOTICES.txt`（设置 → 关于 → 开源许可），依赖或本文件变化后用 `make notices` 重新生成。
