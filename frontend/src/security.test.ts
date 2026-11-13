// @vitest-environment jsdom
// NF5 / 技术方案第 7 节：文档中的原始 HTML 经 DOMPurify 白名单过滤；脚本、事件属性、javascript: 链接不执行。
import { describe, expect, it } from "vitest";
import { sanitizeHtmlPreview } from "@/utils/sanitize";
import { cspFor } from "../csp";

describe("原始 HTML 过滤", () => {
  const cases = [
    `<script>alert(1)</script><p>x</p>`,
    `<img src=x onerror="alert(1)">`,
    `<a href="javascript:alert(1)">x</a>`,
    `<a href="vbscript:msgbox(1)">x</a>`,
    `<iframe src="https://evil.example"></iframe>`,
    `<object data="x"></object><embed src="x">`,
    `<form action="https://evil.example"><input></form>`,
    `<div onclick="alert(1)" onmouseover="alert(2)">x</div>`,
    `<svg><script>alert(1)</script></svg>`,
    `<a href="data:text/html,<script>alert(1)</script>">x</a>`,
  ];
  it.each(cases.flatMap((c) => [[c, "strict"], [c, "extended"]] as const))("%s (%s)", (html, level) => {
    const out = sanitizeHtmlPreview(html, { allowlistLevel: level }).toLowerCase();
    expect(out).not.toMatch(/<script|<iframe|<object|<embed|<form|\son\w+=|javascript:|vbscript:|data:text\/html/);
  });
  it("保留正常内容", () => {
    expect(sanitizeHtmlPreview(`<p align="center"><sub>研究组</sub> <kbd>⌘</kbd></p>`, { allowlistLevel: "extended" })).toContain("<kbd>");
  });
});

describe("CSP", () => {
  const csp = cspFor();
  it("禁止脚本内联、插件、表单、框架", () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    for (const d of ["object-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) expect(csp).toContain(d);
  });
  it("图片允许本地协议与网络（关闭网络图片时页面另加一条更严的 img-src）", () => {
    expect(csp).toMatch(/img-src[^;]*lmasset:/);
    expect(csp).toMatch(/img-src[^;]*http:\/\/lmasset\.localhost/);
  });
});
