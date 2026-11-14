// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("mygo-runtime", () => ({ call: vi.fn(), event: () => ({ on: vi.fn() }) }));

const { renderRecent } = await import("./start");

function page() {
  const app = document.createElement("div");
  app.innerHTML = `<button class="lm-start-clear" hidden></button><ul class="lm-start-recent-list"></ul><p class="lm-start-recent-empty" hidden></p>`;
  return { app, list: app.querySelector<HTMLUListElement>("ul")! };
}

// 启动窗口的最近打开列表（F1.12⑤）
describe("renderRecent", () => {
  it("按给定顺序列出，文件名不当作 HTML", () => {
    const { app, list } = page();
    renderRecent(app, list, [
      { path: "/Users/me/a.md", name: "a.md", dir: "~" },
      { path: "/tmp/<img src=x>.md", name: "<img src=x>.md", dir: "/tmp" },
    ]);
    const items = [...list.querySelectorAll<HTMLButtonElement>(".lm-start-recent-item")];
    expect(items.map((b) => b.dataset.path)).toEqual(["/Users/me/a.md", "/tmp/<img src=x>.md"]);
    expect(items[1]!.querySelector(".name")!.textContent).toBe("<img src=x>.md");
    expect(list.querySelector("img")).toBeNull();
    expect(items[0]!.dataset.act).toBe("recent");
    expect(items[0]!.title).toBe("/Users/me/a.md");
    expect(app.querySelector<HTMLElement>(".lm-start-clear")!.hidden).toBe(false);
    expect(app.querySelector<HTMLElement>(".lm-start-recent-empty")!.hidden).toBe(true);
  });

  it("没有记录时隐藏清除入口，显示空状态", () => {
    const { app, list } = page();
    renderRecent(app, list, [{ path: "/a.md", name: "a.md", dir: "/" }]);
    renderRecent(app, list, []);
    expect(list.children).toHaveLength(0);
    expect(list.hidden).toBe(true);
    expect(app.querySelector<HTMLElement>(".lm-start-clear")!.hidden).toBe(true);
    expect(app.querySelector<HTMLElement>(".lm-start-recent-empty")!.hidden).toBe(false);
  });
});
