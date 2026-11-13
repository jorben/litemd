// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// 技术方案 4.4 节不迁 graphviz：dot / graphviz 代码块按普通代码块显示。
export function isGraphvizLanguage(_language: string): boolean {
  return false;
}
export async function renderGraphviz(_content: string): Promise<string | null> {
  return null;
}
export async function renderGraphvizForExport(_content: string, ..._rest: unknown[]): Promise<string | null> {
  return null;
}
