import { describe, expect, it } from "vitest";
import { acceleratorTable, commandForKey, Deduper, parseAccel } from "./keys";

const key = (code: string, m: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  code,
  metaKey: !!m.meta,
  ctrlKey: !!m.ctrl,
  altKey: !!m.alt,
  shiftKey: !!m.shift,
});

describe("快捷键表", () => {
  it("每个页面命令的加速键都能解析", () => {
    for (const mac of [true, false]) for (const [id, a] of Object.entries(acceleratorTable(mac))) expect(parseAccel(a, mac), id).not.toBeNull();
  });
  it("macOS 键位（PRD F3.5、keybindings 初稿）", () => {
    expect(commandForKey(key("Digit1", { meta: true }), true)).toBe("mode-preview");
    expect(commandForKey(key("Digit4", { meta: true }), true)).toBe("mode-split");
    expect(commandForKey(key("KeyE", { meta: true }), true)).toBe("toggle-edit");
    expect(commandForKey(key("Digit2", { meta: true, alt: true }), true)).toBe("heading-2");
    expect(commandForKey(key("Digit0", { meta: true, alt: true }), true)).toBe("paragraph");
    expect(commandForKey(key("Digit8", { meta: true, shift: true }), true)).toBe("bullet-list");
    expect(commandForKey(key("Backquote", { ctrl: true }), true)).toBe("inline-code");
    expect(commandForKey(key("KeyF", { meta: true, alt: true }), true)).toBe("replace");
    expect(commandForKey(key("Equal", { meta: true }), true)).toBe("zoom-in");
    expect(commandForKey(key("Equal", { meta: true, shift: true }), true)).toBe("zoom-in");
    expect(commandForKey(key("KeyB", { ctrl: true }), true)).toBeNull(); // macOS 上 Ctrl+B 不是加粗
  });
  it("Windows / Linux 用 Ctrl", () => {
    expect(commandForKey(key("KeyB", { ctrl: true }), false)).toBe("bold");
    expect(commandForKey(key("KeyY", { ctrl: true }), false)).toBe("redo");
    expect(commandForKey(key("KeyB", { meta: true }), false)).toBeNull();
  });
  it("菜单与键盘重复触发只执行一次", () => {
    let t = 0;
    const d = new Deduper(() => t);
    expect(d.shouldRun("bold")).toBe(true);
    t = 40;
    expect(d.shouldRun("bold")).toBe(false);
    t = 400;
    expect(d.shouldRun("bold")).toBe(true);
    expect(d.shouldRun("italic")).toBe(true);
  });
});
