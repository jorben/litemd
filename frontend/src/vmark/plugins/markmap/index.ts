// LiteMd 自有文件：替代 vmark 的同名模块（技术方案 4.1 节第 4 条），只实现被迁入插件用到的导出。
// 技术方案 4.4 节不迁 markmap。
export async function renderMarkmapToElement(..._args: unknown[]): Promise<{ fit: () => void } | null> {
  return null;
}
export async function renderMarkmapToSvgString(..._args: unknown[]): Promise<string | null> {
  return null;
}
export async function updateMarkmapTheme(): Promise<boolean> {
  return false;
}
