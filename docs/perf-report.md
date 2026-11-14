# LiteMd v1 性能报告（NF1–NF4）

## 测量方法

- 脚本：`scripts/perf.py`。需要先构建带自动化插件的版本：
  `GOFLAGS=-tags=e2e go tool mygo build -debug -skip-dmg -o /tmp/litemd-perf`，再运行
  `python3 scripts/perf.py build/darwin-arm64/litemd-<版本>-arm64.dmg`。
  非 `-debug` 构建带 `mygo_noinspector` 标签，不含自动化插件，所以只能用 `-debug` 构建测量（多带开发者工具，数据偏保守）。
- 测试机：Apple Silicon，macOS。文档由 `testdata/fidelity/` 语料拼接成 100 KB 与 1 MB 的 Markdown。
- 计时终点：页面内容渲染完成时记录的 `performance.timeOrigin + performance.now()`（`window.__litemd.readyAt`），起点是脚本启动可执行文件之前的时间。
- 输入延迟：每次按键 = 一次 ProseMirror / CodeMirror 事务 + 强制布局（输入到可上屏的同步部分），每次之间等一帧；共 220 次，去掉前 20 次预热。
- 内存：应用进程 + LiteMd 启动后新出现的 WebKit 进程（WebContent、GPU、Networking；运行前已存在的其他应用的 WebKit 进程不计）。
  同时记录 `footprint`（活动监视器「内存」一栏的口径，不含可回收与共享页）和 RSS。每窗口 = 合计 ÷ 窗口数（应用进程与 GPU、Networking 进程由各窗口分摊）。
- 已运行时打开新文件：每次之前空闲 3 秒；连续打开（前一个窗口还在渲染）另记一组。

## 结果（2026-11-14，提交 `dd6da47` 之后，含表格宽度修复）

| 指标 | 要求 | 结果 | 结论 |
|---|---|---|---|
| NF1 冷启动到显示内容（100 KB，预览） | < 1 s | 625 / 644 / 646 / 649 / 1111 ms，中位 **646 ms** | 达标 |
| NF1 已运行时打开新文件（100 KB，预览） | < 400 ms | 395 / 403 / 420 ms，中位 **403 ms**；连续打开 425 / 442 ms | **未达标（差 3 ms）**，见下文 |
| 同上，常见大小的文档（`mygo-docs-en/i18n.md`，空闲时） | — | 179 / 209 / 212 / 216 ms | — |
| NF2 1 MB 文档所见即所得输入 | P95 < 16 ms | P50 9 ms、**P95 11 ms**、最大 11 ms | 达标 |
| NF2 1 MB 文档源码输入 | P95 < 16 ms | P50 1 ms、**P95 2 ms**、最大 3 ms | 达标 |
| 1 MB 文档一次推送（保真写回 / 源码） | — | 11 ms / 11 ms | — |
| 1 MB 文档打开（预览） | — | 1425 ms | — |
| NF3 单窗口空闲内存（6 个 100 KB 文档窗口） | < 150 MB | footprint **212 MB / 窗口**（应用 76 MB + WebKit 1197 MB）；RSS 231 MB / 窗口 | **未达标**，见下文 |
| NF3 单窗口内存，小文档 | < 150 MB | 3 行文档的 WebContent footprint 约 55 MB；8.7 KB 的 README 约 90 MB | 达标 |
| NF3 空闲 CPU | ≈ 0 | 0.0% | 达标 |
| NF3 7 个窗口（再加 1 MB 文档） | 可用 | footprint 合计 1827 MB，输入与切换无卡顿 | 达标 |
| NF4 macOS DMG | < 25 MB | **6.5 MB**（.app 20 MB） | 达标 |
| NF4 Windows 安装包 | < 20 MB | 本机不构建（CI 产出） | 待手工验证 |

### 测量中发现并修复的问题

1. **1 MB 文档所见即所得每次按键约 1 s**（NF2）。原因：页面同步的防抖计时每次按键都取一次全文（所见即所得模式下即序列化全文），推送后又把整篇重新解析建基线。修复：防抖只取文档大小；推送后平移基线单元（技术方案 6.3 节第 6 步）。P50 从 963 ms 降到 9 ms（`dd6da47`）。
2. **宽表格的合成层**（NF3）。vmark 的表格样式是 `width: max-content`，100 KB 文档的 32 个表格中 30 个比正文宽、成为横向滚动区，WebKit 为每个滚动区分配整块合成缓冲。改为按原型的「最宽到正文宽度、单元格内换行」后，这个窗口的图形内存从 92 MB 降到 41 MB，每窗口 footprint 从约 267 MB（RSS 口径）降到 212 MB。
3. 早先的测量把本机其他应用的 WebKit 进程也计入了内存，且连续打开文件时测到的是排队时间，已修正口径（见「测量方法」）。

### 未达标项的分析与去向

**2026-11-14 Jorben 确认：v1.0 按现状发布，NF1（100 KB 文档已运行时打开 403 ms）与 NF3（100 KB 文档每窗口约 212 MB）延到 v1.x 达标。**

**打开新文件 403 ms**。页面内分段（`performance.mark`，100 KB 文档，新窗口）：

| 阶段 | 耗时 |
|---|---|
| 进程转发 + 建窗口 + WebView 导航到页面开始执行 | 约 95 ms（第二个实例 35 ms 内退出） |
| 页面脚本求值、取文档数据 | 约 50 ms |
| Markdown 解析建基线（`loadBaseline`） | 约 120 ms |
| 编辑器首次渲染（ProseMirror 视图、代码高亮、公式） | 约 120 ms |

同样的解析与渲染在已预热的页面里合计只要约 105 ms：每个窗口是一个新的 WebContent 进程，1.9 MB 主包的 JIT 都从冷开始，这是剩余耗时的主体。常见大小（10–30 KB）的文档在 180–220 ms 内打开。去向（v1.x）：先渲染首屏所在的顶层块、其余在空闲时补齐；代码高亮与公式渲染推迟到可见时；评估 mygo 是否支持多个窗口共享 WebContent 进程。已试过的 `content-visibility: auto`（屏幕外顶层块跳过排版）把打开耗时降到 353–379 ms、图形内存 41 → 34 MB，但 ProseMirror 按估算高度计算滚动目标，大纲跳转与光标滚动会停在错误位置，已撤回；首屏优先渲染需要在编辑器层面实现。

**100 KB 文档每窗口约 212 MB**。分解（单个窗口）：WebKit Malloc（JS 堆与 DOM）约 110 MB，图形缓冲约 41 MB，其余为进程基础开销。载入时峰值约 640 MB，说明解析与渲染过程中的临时对象很多，bmalloc 回收后不归还给系统。小文档在目标内。去向（v1.x）：减少载入时的中间结构（mdast → ProseMirror 两份全量树）、对屏幕外的顶层块使用 `content-visibility: auto`。

### 原始输出

```json
{
 "cold_start_ms": {"runs": [625, 644, 646, 649, 1111], "median": 646},
 "open_running_ms": {"runs": [395, 403, 420], "median": 403},
 "open_running_back_to_back_ms": [425, 442],
 "mem_6_windows_mb": {"rss_app": 157, "rss_webkit": 1229, "footprint_app": 76, "footprint_webkit": 1197, "footprint_per_window": 212, "rss_per_window": 231},
 "idle_cpu_percent": 0.0,
 "open_1mb_ms": 1425,
 "type_1mb_wysiwyg_ms": {"p50": 9, "p95": 11, "max": 11},
 "push_1mb_wysiwyg_ms": 11.0,
 "type_1mb_source_ms": {"p50": 1, "p95": 2, "max": 3},
 "push_1mb_source_ms": 11.0,
 "mem_7_windows_incl_1mb_mb": {"rss_app": 210, "rss_webkit": 2078, "footprint_app": 107, "footprint_webkit": 1720, "footprint_per_window": 261, "rss_per_window": 327},
 "app_bundle": "20M",
 "dmg_mb": 6.5
}
```

与 M0（源码模式、骨架页面）相比：冷启动 375 → 646 ms、打开新文件 107–141 → 180–400 ms，增加的部分是完整前端（Tiptap、vmark 扩展、KaTeX、Mermaid）的脚本求值与预览模式的富文本渲染。
