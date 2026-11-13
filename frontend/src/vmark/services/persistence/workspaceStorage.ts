// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// LiteMd 一个窗口一个文档，没有工作区：窗口标签固定。
export function getCurrentWindowLabel(): string {
  return "main";
}
