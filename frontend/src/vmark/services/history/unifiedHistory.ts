// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// vmark 的 HTML 块「编辑源码」按钮切到源码模式；LiteMd 发同名命令给外壳。
import { host } from "../../../host";

export function toggleSourceModeWithCheckpoint(_windowLabel: string): void {
  host.command("mode-source");
}
