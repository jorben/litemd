// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// LiteMd 没有内置终端：代码块不显示「在终端运行」。
export interface RunInTerminalResult {
  ok: boolean;
  reason?: string;
}
export function isShellLanguage(_language: string | null | undefined): boolean {
  return false;
}
export function runInTerminal(_source: string, _language: string): Promise<RunInTerminalResult> {
  return Promise.resolve({ ok: false, reason: "unsupported" });
}
