package clitool

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestScript(t *testing.T) {
	s := Script("/Applications/Lite Md.app/Contents/MacOS/LiteMd")
	if !strings.HasPrefix(s, "#!/bin/sh\n") || !strings.Contains(s, `'/Applications/Lite Md.app/Contents/MacOS/LiteMd' "$@"`) {
		t.Fatal(s)
	}
	if shellQuote("a'b") != `'a'\''b'` {
		t.Fatal(shellQuote("a'b"))
	}
}

// 应用路径里的 $、反引号、引号不能被 sh 展开或执行：脚本必须原样调用这个路径，并把参数原样转交。
func TestScriptRunsPathLiterally(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("命令行工具脚本只在 macOS 上安装")
	}
	root := t.TempDir()
	dir := filepath.Join(root, "Lite $HOME `touch pwned` $(touch pwned2) 'q\" Md.app")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(root, "args.txt")
	exe := filepath.Join(dir, "LiteMd")
	fake := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + shellQuote(out+".tmp") + " && mv " + shellQuote(out+".tmp") + " " + shellQuote(out) + "\n"
	if err := os.WriteFile(exe, []byte(fake), 0o755); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(root, "litemd")
	if err := os.WriteFile(script, []byte(Script(exe)), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", script, "a b.md", "$HOME")
	cmd.Dir = root
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, b)
	}
	var got []byte
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if b, err := os.ReadFile(out); err == nil {
			got = b
			break
		}
	}
	if string(got) != "a b.md\n$HOME\n" {
		t.Fatalf("参数没有原样转交给应用: %q", got)
	}
	for _, name := range []string{"pwned", "pwned2"} {
		if _, err := os.Stat(filepath.Join(root, name)); err == nil {
			t.Fatalf("路径中的命令被执行了: %s", name)
		}
	}
}
