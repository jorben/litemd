// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildExportHtml, cleanClone, EXPORT_CSP } from "./exportHtml";

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
});
