// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildExportHtml, cleanClone, EXPORT_CSP, EXPORT_CSP_OFFLINE } from "./exportHtml";

describe("导出 HTML（F8，第 7 节）", () => {
  const root = () => {
    const d = document.createElement("div");
    d.setAttribute("contenteditable", "true");
    d.innerHTML = `<h1 onclick="x()">标题</h1><p>正文 <a href="javascript:alert(1)">坏</a> <a href="https://a.com">好</a></p>
      <div class="code-block-toolbar"><button>复制</button></div><pre><code>x</code></pre>
      <script>alert(1)</script><iframe src="https://e.com"></iframe><img src="data:image/png;base64,AA" alt="a">
      <ul><li><input type="checkbox" checked> 任务</li></ul>`;
    return d;
  };
  it("去掉编辑控件、脚本、事件属性与危险链接", () => {
    const c = cleanClone(root());
    const h = c.outerHTML.toLowerCase();
    expect(h).not.toMatch(/<script|<iframe|onclick|javascript:|contenteditable|<button|code-block-toolbar/);
    expect(h).toContain("https://a.com");
    expect((c.querySelector("input[type=checkbox]") as HTMLInputElement).disabled).toBe(true);
  });
  it("自包含：带 CSP、没有脚本标签", async () => {
    const html = await buildExportHtml(root(), { title: "<报告>", embedImages: true });
    expect(html).toContain(EXPORT_CSP);
    expect(html).toContain("<title>&lt;报告&gt;</title>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).toContain("data:image/png;base64,AA");
  });
  const withImages = () => {
    const d = document.createElement("div");
    d.innerHTML = `<p><img src="https://img.example/a.png" srcset="https://img.example/a2.png 2x" alt="图"><img src="http://img.example/b.png" alt="">
      <img src="lmasset://localhost/t/c.png" alt="c"><img src="data:image/png;base64,AA" alt="d"></p>`;
    return d;
  };
  const local = (img: HTMLImageElement) => (img.getAttribute("src")!.startsWith("lmasset:") ? "c.png" : null);
  it("不加载网络图片时（PDF / 打印）：CSP 不含 http(s)，网络图片换成占位，本地与 data: 图片不受影响", async () => {
    const html = await buildExportHtml(withImages(), { title: "t", embedImages: false, originalSrc: local, blockRemoteImages: true });
    expect(html).toContain(`content="${EXPORT_CSP_OFFLINE}"`);
    expect(EXPORT_CSP_OFFLINE).not.toMatch(/https?:/);
    expect(html).not.toMatch(/src="https?:|srcset=/);
    expect(html).toContain('<img alt="图">');
    expect(html).toContain('<img alt="http://img.example/b.png">');
    expect(html).toContain('src="c.png"');
    expect(html).toContain('src="data:image/png;base64,AA"');
  });
  it("导出的 HTML 文件保留网络图片地址（之后由用户的浏览器打开）", async () => {
    const html = await buildExportHtml(withImages(), { title: "t", embedImages: false, originalSrc: local });
    expect(html).toContain(`content="${EXPORT_CSP}"`);
    expect(html).toContain('src="https://img.example/a.png"');
    expect(html).toContain('src="http://img.example/b.png"');
  });
});
