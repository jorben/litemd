package filestate

import (
	"fmt"
	"sync"
	"testing"

	"github.com/egoist/mygo"
)

func TestLRU(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	s.Set("/keep/me.md", FileState{Mode: "source"})
	for i := 0; i < Limit+20; i++ {
		s.Set(fmt.Sprintf("/f/%d.md", i), FileState{Mode: "preview"})
		if i == Limit/2 {
			s.Set("/keep/me.md", FileState{Mode: "source", Outline: true}) // 中途用过：仍较新
		}
	}
	if s.Len() != Limit {
		t.Fatalf("len=%d", s.Len())
	}
	if _, ok := s.Get("/f/0.md"); ok {
		t.Fatal("最旧的应被淘汰")
	}
	if fs, ok := s.Get("/keep/me.md"); !ok || !fs.Outline {
		t.Fatalf("最近用过的应保留: %+v %v", fs, ok)
	}
	// 持久化后重新打开
	s2 := Open(dir)
	if fs, ok := s2.Get(fmt.Sprintf("/f/%d.md", Limit+19)); !ok || fs.Mode != "preview" {
		t.Fatal("重新打开后应读到状态")
	}
	s2.Set("/new.md", FileState{})
	if _, ok := s2.Get("/f/0.md"); ok {
		t.Fatal("LRU 序号应在重启后延续")
	}
}

func TestWindowStates(t *testing.T) {
	s := Open(t.TempDir())
	ws := mygo.WindowState{X: 10, Y: 20, Width: 800, Height: 600}
	if err := s.SaveWindowStates(map[string]mygo.WindowState{WindowKey("/a/B.md"): ws, "other": ws}); err != nil {
		t.Fatal(err)
	}
	got, _ := s.LoadWindowStates()
	if len(got) != 1 || got[WindowKey("/a/B.md")] != ws {
		t.Fatalf("%+v", got)
	}
	if WindowKey("") != "" {
		t.Fatal("未命名文档不记住窗口状态")
	}
	s.SaveWindowStates(map[string]mygo.WindowState{})
	if got, _ := s.LoadWindowStates(); len(got) != 0 {
		t.Fatal("ClearWindowStates 应清空")
	}
}

// 并发保存时，最后落盘的必须是最新的快照：重新打开后每个文件的状态都在。
func TestConcurrentSetKeepsNewestOnDisk(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.Set(fmt.Sprintf("/f/%d.md", i), FileState{Mode: "source"}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := Open(dir).Len(); n != 64 {
		t.Fatalf("磁盘上只有 %d 个文件的状态，较早的快照覆盖了较新的", n)
	}
}
