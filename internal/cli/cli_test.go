package cli

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPlan(t *testing.T) {
	files := map[string]bool{"/w/a.md": false, "/w/b.txt": false, "/w/dir": true, "/w/c.pdf": false, "/w/notes.md": false}
	exists := func(p string) (bool, bool) {
		d, ok := files[p]
		return d, ok
	}
	got := Plan([]string{"-v", "a.md", "new.md", "b.txt", "new.txt", "dir", "c.pdf", "x.pdf", "notes", "todo", "/abs/z.markdown", "file:///w/a.md", ""}, "/w", exists)
	want := []Action{
		{Path: "/w/new.md", Create: true},  // 不存在的 .md：创建
		{Path: "/w/b.txt"},                 // 已存在的 .txt：mygo 不投递，这里打开
		{Path: "/w/new.txt", Create: true}, // 不存在的 .txt：创建
		{Path: "/w/notes.md"},              // 无扩展名，补 .md 后已存在
		{Path: "/w/todo.md", Create: true}, // 无扩展名，补 .md 后创建
		{Path: "/abs/z.markdown", Create: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("\n got %+v\nwant %+v", got, want)
	}
}

func TestCreateEmpty(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.md")
	if err := CreateEmpty(p); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := CreateEmpty(p); err != nil { // 已存在：不报错，也不清空
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "keep" {
		t.Fatalf("已存在的文件被改动: %q", b)
	}
}
