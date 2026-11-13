// @vitest-environment jsdom
// PRD 第 7 节第 2 条「源码模式编辑 → 保存：100% 与编辑内容一致」的页面一侧：真实的 SourceEditor
// （CodeMirror，LiteMd 的全部源码模式扩展）载入每份语料，做随机输入、删除、替换、撤销后，
// 推送的正文必须等于「原文 + 同样的编辑」。Go 一侧写回字节（换行符、BOM）见 internal/doc/corpus_test.go。
import { undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { SourceEditor } from "../../src/editor/source";
import { loadCorpus } from "./corpus";

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe("源码模式编辑", () => {
  it("推送的正文与编辑内容一致；撤销回到原文", () => {
    const corpus = loadCorpus();
    expect(corpus.length).toBeGreaterThanOrEqual(200);
    const r = rng(11);
    const bad: string[] = [];
    let edits = 0;
    for (const f of corpus) {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const ed = new SourceEditor({ parent, text: f.text, readOnly: false, tabSize: 4 });
      const v = ed.view;
      let expected = f.text;
      for (let k = 0; k < 4; k++) {
        const len = expected.length;
        const from = Math.floor(r() * (len + 1));
        const to = Math.min(len, from + (k % 2 ? Math.floor(r() * 12) : 0));
        const insert = ["字", "x\n", "", "**粗**"][k]!;
        v.dispatch({ changes: { from, to, insert }, userEvent: k === 2 ? "delete" : "input.type" });
        expected = expected.slice(0, from) + insert + expected.slice(to);
        edits++;
      }
      if (ed.text !== expected) bad.push(`${f.name}：编辑后正文不一致`);
      for (let k = 0; k < 8 && undo(v); k++);
      if (ed.text !== f.text) bad.push(`${f.name}：撤销后与原文不同`);
      ed.destroy();
      parent.remove();
    }
    console.log(`源码模式：${corpus.length} 份语料、${edits} 次编辑，不一致 ${bad.length}`);
    expect(bad).toEqual([]);
  });
});
