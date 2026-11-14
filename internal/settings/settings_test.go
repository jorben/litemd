package settings

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestDefaults(t *testing.T) {
	d := Defaults()
	// PRD 决策：D1 默认预览、D2 自动保存开启、D4 ./assets/、F5.11 拼写检查默认关闭
	if d.DefaultMode != "preview" || !d.Autosave || d.ImageRule != "assets" || d.SpellCheck || !d.NetworkImages {
		t.Fatalf("%+v", d)
	}
}

func TestDecodeFillsMissingAndFixesInvalid(t *testing.T) {
	s, err := Decode([]byte(`{"version":1,"theme":"dark","defaultMode":"bogus","tabWidth":3,"fontScale":9}`))
	if err != nil {
		t.Fatal(err)
	}
	if s.Theme != "dark" || s.DefaultMode != "preview" || s.TabWidth != 4 || s.FontScale != 1 || !s.Autosave || s.ImageRule != "assets" {
		t.Fatalf("%+v", s)
	}
	if _, err := Decode([]byte("{broken")); err == nil {
		t.Fatal("损坏的文件应报错")
	}
}

func TestStoreRoundTripAndAutosaveAtLaunch(t *testing.T) {
	dir := t.TempDir()
	st := Open(dir)
	if !st.AutosaveAtLaunch {
		t.Fatal("默认开启")
	}
	s := st.Get()
	s.Autosave = false
	s.Width = "wide"
	if _, err := st.Set(s); err != nil {
		t.Fatal(err)
	}
	if !st.AutosaveAtLaunch {
		t.Fatal("D11：本次运行中自动保存模式不变")
	}
	st2 := Open(dir)
	if st2.Get().Width != "wide" || st2.AutosaveAtLaunch {
		t.Fatalf("重启后生效: %+v %v", st2.Get(), st2.AutosaveAtLaunch)
	}
	if _, err := os.Stat(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
}

func TestCorruptFileFallsBack(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte("not json"), 0o644)
	if Open(dir).Get() != Defaults() {
		t.Fatal("损坏的设置文件应回到默认值")
	}
}

// 并发保存时，磁盘上必须是最后一次改动的设置，不能被较早的快照覆盖。
func TestConcurrentSetKeepsNewestOnDisk(t *testing.T) {
	dir := t.TempDir()
	st := Open(dir)
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s := st.Get()
			s.TabWidth = 1 + i%8
			s.FontScale = 1 + float64(i%5)/10
			if _, err := st.Set(s); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if got := Open(dir).Get(); got != st.Get() {
		t.Fatalf("磁盘上的设置不是最新的: %+v, want %+v", got, st.Get())
	}
}
