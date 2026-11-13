// LiteMd 自有文件（替代 vmark src/test/productionSchema.ts）。
//
// litemd: vmark 的原版通过 createTiptapExtensions() 从整套编辑器装配生成 schema，
// 会把 vmark 应用层（services/assembly、store、Tauri 插件等）一起拉进来，
// 技术方案 4.1 节明确不迁这一层。
//
// M0 阶段：在管线自带的 testSchema 上按 LiteMd 的范围调整：
//   - 补上生产扩展声明、而 testSchema 没有的属性：代码块 meta、列表 spread（松散列表）、
//     列表项 tightBefore、图片的引用式写法，否则这些在往返中丢失；
//   - 去掉 D13 不启用的 mark：highlight / subscript / superscript / underline；
//   - 不含 toc、block_video、block_audio、video_embed（技术方案 4.4 节不迁这些扩展）：
//     媒体转换在 schema 缺少对应节点时退回普通图片 / HTML，不会丢内容。
// M1 阶段：改为 getSchema(LiteMd 的扩展清单)，并保持与这里一致（schemaCoverage.test.ts 把关）。
import { Schema, type NodeSpec } from "@tiptap/pm/model";
import { testSchema } from "@/utils/markdownPipeline/testSchema";

const EXTRA_ATTRS: Record<string, Record<string, { default: unknown }>> = {
  codeBlock: { meta: { default: null } },
  bulletList: { spread: { default: false } },
  orderedList: { spread: { default: false } },
  // 与 vmark plugins/shared/sourceLineAttr.ts 的 tightBeforeAttr 一致：松散列表中紧贴上一项写的项
  listItem: { tightBefore: { default: false } },
  // 与 vmark utils/referenceIdentity.ts 一致：引用式图片 ![alt][id] 的写法
  image: { referenceId: { default: null }, referenceType: { default: null } },
  block_image: { referenceId: { default: null }, referenceType: { default: null } },
};
const DROPPED_MARKS = ["highlight", "subscript", "superscript", "underline"];

let cached: Schema | null = null;

export function getProductionSchema(): Schema {
  if (cached) return cached;
  let nodes = testSchema.spec.nodes;
  for (const [name, attrs] of Object.entries(EXTRA_ATTRS)) {
    const spec = nodes.get(name) as NodeSpec;
    nodes = nodes.update(name, { ...spec, attrs: { ...spec.attrs, ...attrs } });
  }
  let marks = testSchema.spec.marks;
  for (const m of DROPPED_MARKS) marks = marks.remove(m);
  cached = new Schema({ nodes, marks });
  return cached;
}
