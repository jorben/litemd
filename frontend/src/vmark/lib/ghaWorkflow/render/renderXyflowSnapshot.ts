// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// 不迁工作流图渲染（isWorkflowYaml 恒为 false，这里不会被调用）。
export const SNAPSHOT_CACHE_MAX = 0;
export async function renderXyflowSnapshot(_yaml: string): Promise<string | null> {
  return null;
}
export function __resetSnapshotForTests(): void {}
