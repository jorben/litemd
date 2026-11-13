// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
import type { ExportInstance } from "../shared/diagramExport";
export function setupMarkmapExport(_container: HTMLElement, _source: string): ExportInstance {
  return { destroy() {} };
}
