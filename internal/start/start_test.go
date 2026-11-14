package start

import (
	"path/filepath"
	"testing"
)

// 启动窗口接受拖入的 Markdown 与 .txt（PRD 3.2、F1.12）。
func TestIsOpenable(t *testing.T) {
	for p, want := range map[string]bool{"/a.md": true, "/a.MARKDOWN": true, "/a.mdown": true, "/a.mkd": true, "/a.txt": true,
		"/a.pdf": false, "/a": false, "/a.md.exe": false} {
		if IsOpenable(p) != want {
			t.Errorf("%s: want %v", p, want)
		}
	}
}

// 计数不会减成负数（打开失败的超时与窗口出现可能都触发减一）。
func TestPendingNeverNegative(t *testing.T) {
	pending.Store(1)
	decrement()
	decrement()
	if pending.Load() != 0 {
		t.Fatal(pending.Load())
	}
}

// 最近打开：最多 MaxRecent 个，保持 mygo 给的倒序；用户目录缩写为 ~（F1.12⑤）。
func TestRecentFiles(t *testing.T) {
	oldPaths, oldHome := recentPaths, homeDir
	t.Cleanup(func() { recentPaths, homeDir = oldPaths, oldHome })
	home := filepath.Join(string(filepath.Separator), "Users", "me")
	homeDir = func() (string, error) { return home, nil }
	recentPaths = func() []string {
		return []string{
			filepath.Join(home, "notes", "a.md"),
			filepath.Join(home, "b.md"),
			filepath.Join(string(filepath.Separator), "tmp", "c.md"),
			filepath.Join(home+"x", "d.md"), // 只是前缀相同，不是用户目录下
			filepath.Join(home, "e.md"),
			filepath.Join(home, "f.md"),
		}
	}
	got := recentFiles()
	if len(got) != MaxRecent {
		t.Fatalf("len = %d, want %d", len(got), MaxRecent)
	}
	want := []RecentFile{
		{Path: filepath.Join(home, "notes", "a.md"), Name: "a.md", Dir: filepath.Join("~", "notes")},
		{Path: filepath.Join(home, "b.md"), Name: "b.md", Dir: "~"},
		{Path: filepath.Join(string(filepath.Separator), "tmp", "c.md"), Name: "c.md", Dir: filepath.Join(string(filepath.Separator), "tmp")},
		{Path: filepath.Join(home+"x", "d.md"), Name: "d.md", Dir: home + "x"},
		{Path: filepath.Join(home, "e.md"), Name: "e.md", Dir: "~"},
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%d: got %+v, want %+v", i, got[i], want[i])
		}
	}
	if !isRecent(want[0].Path) || isRecent(filepath.Join(home, "f.md")) || isRecent("/etc/passwd") {
		t.Error("isRecent 只认列出的前 MaxRecent 个")
	}
}

// 没有记录时返回空切片（页面拿到 [] 而不是 null）。
func TestRecentFilesEmpty(t *testing.T) {
	old := recentPaths
	t.Cleanup(func() { recentPaths = old })
	recentPaths = func() []string { return nil }
	if got := recentFiles(); got == nil || len(got) != 0 {
		t.Fatalf("got %#v", got)
	}
}
