package doc

import (
	"bytes"
	"io/fs"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// PRD 第 7 节第 2 条「源码模式编辑 → 保存：100% 与编辑内容一致」的 Go 一侧：页面推送的是
// 归一化正文（\n 换行、无 BOM），这里检查写回时只在编辑处与原文件不同（换行符、BOM 原样）。
// 页面一侧（CodeMirror 编辑后推送的正文等于编辑内容）见 frontend/test/fidelity/source.test.ts。
func TestCorpusSourceEdit(t *testing.T) {
	root := filepath.Join("..", "..", "testdata", "fidelity")
	var files []string
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".md") {
			files = append(files, p)
		}
		return nil
	})
	if len(files) < 200 {
		t.Fatalf("语料只有 %d 份", len(files))
	}
	r := rand.New(rand.NewSource(7))
	edits, bad := 0, 0
	for _, p := range files {
		orig, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		c := Decode(orig)
		if c.Lossy {
			continue
		}
		if !bytes.Equal(c.Encode(), orig) {
			t.Errorf("%s：不编辑直接写回与原文不同", p)
			bad++
			continue
		}
		for k := 0; k < 4; k++ {
			lines := strings.Count(c.Text, "\n") + 1
			line := r.Intn(lines)
			// 正文第 line 行行首插入一段文字
			ti := 0
			for i := 0; i < line; i++ {
				ti += strings.IndexByte(c.Text[ti:], '\n') + 1
			}
			ins := "字 x"
			edited := c
			edited.Text = c.Text[:ti] + ins + c.Text[ti:]
			// 原文件中同一行的行首
			bi := 0
			if c.BOM {
				bi = 3
			}
			for i := 0; i < line; i++ {
				bi += bytes.IndexByte(orig[bi:], '\n') + 1
			}
			want := append(append(append([]byte{}, orig[:bi]...), ins...), orig[bi:]...)
			edits++
			if !bytes.Equal(edited.Encode(), want) {
				bad++
				t.Errorf("%s 第 %d 行：写回的字节与「原文 + 编辑」不同", p, line+1)
				break
			}
		}
	}
	t.Logf("源码编辑写回：%d 次编辑，%d 次不一致", edits, bad)
}
