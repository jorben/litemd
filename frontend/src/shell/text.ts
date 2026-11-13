// 外壳用到的纯文本工具：字数统计（F5.10）、源码中的标题（大纲 F7.1）。

/** 字数：中日韩字符每字算一个，其他按单词；字符数不含空白；阅读时长按每分钟 300 字。 */
export function countWords(text: string): { words: number; chars: number; minutes: number } {
  const plain = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~|\-[\]()$]/g, " ");
  const cjk = (plain.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) ?? []).length;
  const words = (plain.replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
  const chars = plain.replace(/\s/g, "").length;
  const total = cjk + words;
  return { words: total, chars, minutes: total === 0 ? 0 : Math.max(1, Math.round(total / 300)) };
}

export interface SourceHeading {
  level: number;
  text: string;
  line: number; // 0 起
}

/** 源码中的 ATX / setext 标题（跳过代码块与 frontmatter）。 */
export function sourceHeadings(text: string): SourceHeading[] {
  const lines = text.split("\n");
  const out: SourceHeading[] = [];
  let fence: string | null = null;
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    const f = l.match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) {
      if (fence === null) fence = f[1]![0]!.repeat(f[1]!.length);
      else if (l.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = l.match(/^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
    if (m) {
      out.push({ level: m[1]!.length, text: clean(m[2]!), line: i });
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined && l.trim() && /^ {0,3}(=+|-+)[ \t]*$/.test(next) && !/^\s*([-*+]|\d+[.)])\s/.test(l)) {
      out.push({ level: next.trim()[0] === "=" ? 1 : 2, text: clean(l.trim()), line: i });
      i++;
    }
  }
  return out;
}

function clean(s: string): string {
  return s.replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
}
