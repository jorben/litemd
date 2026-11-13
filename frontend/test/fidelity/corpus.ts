// 保真度回归语料的读取（testdata/fidelity/，见其中 MANIFEST.md）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const CORPUS_DIR = resolve(__dirname, "../../../testdata/fidelity");

export interface CorpusFile {
  /** 相对 testdata/fidelity 的路径 */
  name: string;
  /** 按 MdContent 规则归一化后的正文：去掉 BOM，换行统一为 \n（技术方案 3.2 节） */
  text: string;
}

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".md") && e !== "MANIFEST.md") out.push(p);
  }
  return out;
}

export function normalize(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export function loadCorpus(): CorpusFile[] {
  return walk(CORPUS_DIR, [])
    .sort()
    .map((p) => ({ name: relative(CORPUS_DIR, p), text: normalize(readFileSync(p, "utf8")) }));
}
