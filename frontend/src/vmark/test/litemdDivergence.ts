// LiteMd 自有文件：迁入的 vmark 管线测试中，因 LiteMd 的范围决定而不再适用的部分。
// 每一项都有原因；被跳过的用例在 vitest 报告中显示为 skipped，不会静默消失。
// 汇总见 docs/m0-report.md「迁入测试的处理」。

/** D13：vmark 扩展语法（==高亮== ~下标~ ^上标^ ++下划线++ [[wiki]]）在 LiteMd 中不启用。 */
export const D13 = "litemd: D13 — vmark 扩展语法不启用，按普通文本原样保留";
/** 技术方案 4.4 节：不迁 toc、blockVideo、blockAudio、videoEmbed 扩展。 */
export const NOT_MIGRATED = "litemd: 技术方案 4.4 节 — 不迁 toc / 音视频 / 视频嵌入节点";
/**
 * vmark 的 spec / fidelity ledger 是在 vmark 方言下录制的「已知分歧」清单。D13 之后有的条目
 * 不再发生（被判为过期），也有条目因 `~x~` 改为删除线而出现新的写法差异。
 * LiteMd 的保真度以 test/fidelity/ 的回归为准；这些 ledger 在 M1 按 LiteMd 方言重录。
 */
export const LEDGER = "litemd: vmark 方言下录制的 ledger，M1 按 LiteMd 方言重录";

/** schema 中不存在的节点类型（与 test/productionSchema.ts 一致）。 */
export const ABSENT_NODES: ReadonlySet<string> = new Set(["toc", "block_video", "block_audio", "video_embed"]);

/** 角色化语料中含 D13 语法、或依赖未迁节点的文件。 */
export const AFFECTED_CORPUS: ReadonlySet<string> = new Set([
  "12-edge-cases.md",
  "13-toc.md",
  "15-video-embeds.md",
  "16-inline-marks.md",
  "17-escaped-markers.md",
]);

/** spec 语料中因 `~x~` 改为删除线（D13）而出现新写法差异的例子。 */
export const AFFECTED_SPEC_EXAMPLES: ReadonlySet<string> = new Set(["gfmreg-8", "gfmext-26", "mdx-33"]);

/** spec 语料中 vmark 方言专用的语料文件（wiki 链接）。 */
export const AFFECTED_SPEC_CORPORA: ReadonlySet<string> = new Set(["pulldown-wikilinks.json"]);
