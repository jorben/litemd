package start

import "testing"

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
