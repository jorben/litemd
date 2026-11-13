// 页面的内容安全策略（技术方案第 7 节）。只在生产构建中注入 index.html：开发时 Vite 的 HMR
// 需要 websocket 与内联模块，开发服务器不受此约束。即使 HTML 过滤有漏洞，注入的脚本也无法执行。
// unsafe-inline 样式是 KaTeX 与 Mermaid 需要的。Windows 上 WebView2 把自定义协议映射到 http://<scheme>.localhost。
export function cspFor(): string {
  const app = "'self' mygo: http://mygo.localhost";
  const assets = "lmasset: http://lmasset.localhost";
  return [
    `default-src ${app}`,
    `script-src 'self'`,
    `style-src ${app} 'unsafe-inline'`,
    `img-src ${app} ${assets} data: blob: https: http:`,
    `font-src ${app} data:`,
    `connect-src ${app} ${assets}`,
    `media-src ${app} ${assets} blob:`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join("; ");
}
