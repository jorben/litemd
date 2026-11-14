// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { acceleratorTable, commandForKey, Deduper, FIELD_COMMANDS, isTextField, parseAccel } from "./keys";

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
  it("编辑器之外的文本输入处：撤销、格式等文档命令不作用于文档，窗口级命令照常", () => {
    document.body.innerHTML = `<div class="ProseMirror" contenteditable="true"><p>x</p></div>
      <div class="lm-find"><input class="lm-find-in"><input type="radio"><textarea></textarea></div>
      <div class="popup" contenteditable><span>y</span></div><div contenteditable="false"><b>z</b></div>`;
    const editor = document.querySelector(".ProseMirror")!;
    const editors = [editor, null, undefined];
    const q = (s: string) => document.querySelector(s);
    expect(isTextField(q(".lm-find-in"), editors)).toBe(true);
    expect(isTextField(q("textarea"), editors)).toBe(true);
    expect(isTextField(q(".popup span"), editors)).toBe(true);
    expect(isTextField(q("input[type=radio]"), editors)).toBe(false);
    expect(isTextField(q("b"), editors)).toBe(false);
    expect(isTextField(editor, editors)).toBe(false);
    expect(isTextField(q(".ProseMirror p"), editors)).toBe(false);
    expect(isTextField(null, editors)).toBe(false);
    for (const k of [key("KeyZ", { meta: true }), key("KeyZ", { meta: true, shift: true }), key("KeyB", { meta: true }), key("KeyK", { meta: true }), key("Digit2", { meta: true, alt: true })]) {
      expect(FIELD_COMMANDS.has(commandForKey(k, true)!)).toBe(true);
    }
    for (const k of [key("KeyG", { meta: true }), key("KeyF", { meta: true }), key("Digit1", { meta: true }), key("KeyE", { meta: true }), key("Equal", { meta: true })]) {
      expect(FIELD_COMMANDS.has(commandForKey(k, true)!)).toBe(false);
    }
  });
});
