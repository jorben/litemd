import { describe, expect, it } from "vitest";
import { countWords, sourceHeadings } from "./text";

describe("字数统计（F5.10）", () => {
  it("中文按字、英文按词，不计 Markdown 标记与代码块", () => {
    const c = countWords("# 标题\n\n你好世界，hello world。\n\n```js\nconst x = 1\n```\n");
    expect(c.words).toBe(2 + 4 + 2);
    expect(c.minutes).toBe(1);
  });
  it("空文档", () => expect(countWords("")).toEqual({ words: 0, chars: 0, minutes: 0 }));
});

describe("源码大纲（F7.1）", () => {
  it("ATX 与 setext 标题，跳过代码块与 frontmatter", () => {
    const md = "---\ntitle: x\n---\n# 一\n\n```\n# 不是标题\n```\n\n二\n---\n\n### **三**\n- 列表\n---\n";
    expect(sourceHeadings(md)).toEqual([
      { level: 1, text: "一", line: 3 },
      { level: 2, text: "二", line: 9 },
      { level: 3, text: "三", line: 12 },
    ]);
  });
});
