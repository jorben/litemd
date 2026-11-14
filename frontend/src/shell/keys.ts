// 页面侧的快捷键表（技术方案 3.6 节、docs/keybindings.md）。
// 加速键由 Go 菜单表导出（internal/menu/testdata/accelerators.json），页面与原生菜单同一份数据。
// 原生菜单与编辑器可能都收到同一个按键（V5「菜单加速键与编辑器键位不重复触发」）：
// 页面在捕获阶段先按这张表执行命令并阻止编辑器自身的键位；原生菜单随后发来的同一命令在
// DEDUPE_MS 内被忽略。
import table from "../../../internal/menu/testdata/accelerators.json";

export const DEDUPE_MS = 150;

export interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const KEY_CODE: Record<string, string> = {
  ".": "Period", ",": "Comma", "-": "Minus", Plus: "Equal", "=": "Equal", "\\": "Backslash", "`": "Backquote", "/": "Slash",
};

interface Parsed {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean | null; // null：不检查（Plus 有无 Shift 都行）
  code: string;
}

export function parseAccel(accel: string, mac: boolean): Parsed | null {
  const parts = accel.split("+").filter(Boolean);
  if (accel.endsWith("+Plus") || accel === "Plus") parts.splice(parts.length - 1, 1, "Plus");
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  let code: string;
  if (/^[a-z]$/i.test(key)) code = "Key" + key.toUpperCase();
  else if (/^[0-9]$/.test(key)) code = "Digit" + key;
  else if (KEY_CODE[key]) code = KEY_CODE[key]!;
  else return null;
  const cmdOrCtrl = mods.has("cmdorctrl") || mods.has("commandorcontrol");
  return {
    meta: mac ? cmdOrCtrl || mods.has("cmd") : mods.has("cmd"),
    ctrl: mac ? mods.has("ctrl") : cmdOrCtrl || mods.has("ctrl"),
    alt: mods.has("alt"),
    shift: key === "Plus" ? null : mods.has("shift"),
    code,
  };
}

export function matches(p: Parsed, e: KeyLike): boolean {
  const code = e.code === "NumpadAdd" ? "Equal" : e.code === "NumpadSubtract" ? "Minus" : e.code;
  return (
    code === p.code &&
    e.metaKey === p.meta &&
    e.ctrlKey === p.ctrl &&
    e.altKey === p.alt &&
    (p.shift === null || e.shiftKey === p.shift)
  );
}

export function acceleratorTable(mac: boolean): Record<string, string> {
  return (mac ? table.mac : table.other) as Record<string, string>;
}

/** 按键对应的页面命令 ID（没有时返回 null）。 */
export function commandForKey(e: KeyLike, mac: boolean): string | null {
  for (const [id, accel] of Object.entries(acceleratorTable(mac))) {
    const p = parseAccel(accel, mac);
    if (p && matches(p, e)) return id;
  }
  return null;
}

/**
 * 焦点在编辑器之外的文本输入处（查找栏等）时不作用于文档的命令：撤销 / 重做走输入框自己的撤销栈，
 * 粘贴为纯文本和文字格式命令不执行。全选是原生菜单角色，本来就作用于焦点所在处。
 */
export const FIELD_COMMANDS: ReadonlySet<string> = new Set([
  "undo", "redo", "paste-plain",
  "paragraph", "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6",
  "bullet-list", "ordered-list", "task-list", "blockquote", "code-block", "table", "math-block", "hr",
  "bold", "italic", "strike", "inline-code", "clear-format", "link",
]);

const NON_TEXT_INPUT = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** el 是不是编辑器（editors）之外的文本输入处：文本类 input、textarea、编辑器外的 contenteditable。 */
export function isTextField(el: EventTarget | null, editors: ReadonlyArray<Element | null | undefined>): boolean {
  if (!(el instanceof Element) || editors.some((r) => r?.contains(el))) return false;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT.has(el.type);
  if (el instanceof HTMLTextAreaElement) return true;
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** 同一命令在短时间内的重复触发（键盘 + 原生菜单）只执行一次。 */
export class Deduper {
  private last = new Map<string, number>();
  constructor(private readonly now: () => number = () => performance.now()) {}
  shouldRun(id: string): boolean {
    const t = this.now();
    const prev = this.last.get(id);
    this.last.set(id, t);
    return prev === undefined || t - prev > DEDUPE_MS;
  }
}
