// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// LiteMd 不迁 GitHub 工作流预览：任何 YAML 都不当作工作流。
export interface IsWorkflowOpts {
  path?: string | null;
}
export function looksLikeWorkflowPath(_path: string | undefined | null): boolean {
  return false;
}
export function isWorkflowYaml(_content: string, _opts: IsWorkflowOpts = {}): boolean {
  return false;
}
