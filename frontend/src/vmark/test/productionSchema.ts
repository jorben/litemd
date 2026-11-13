// LiteMd 自有文件（替代 vmark src/test/productionSchema.ts）。
//
// litemd: 与 vmark 原版同样「从生产扩展清单生成 schema」，只是清单换成 LiteMd 自己的
// frontend/src/editor/extensions.ts（技术方案 4.4 节）。保真基线、管线测试与编辑器因此用同一个 schema。
// 与 vmark 的差异：没有 highlight / subscript / superscript / underline / wikiLink（D13），
// 没有 toc、block_video、block_audio、video_embed（不迁）；媒体转换在缺少这些节点时退回图片 / HTML。
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { buildExtensions } from "../../editor/extensions";

let cached: Schema | null = null;

export function getProductionSchema(): Schema {
  if (cached === null) cached = getSchema(buildExtensions());
  return cached;
}
