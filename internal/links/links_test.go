package links

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// abs 把 /x/y 写成本机的绝对路径：Windows 上加盘符 C:。
func abs(p string) string {
	if runtime.GOOS == "windows" {
		return `C:` + filepath.FromSlash(p)
	}
	return p
}

func TestClassify(t *testing.T) {
	execs := map[string]bool{abs("/d/run"): true, abs("/d/folder"): true}
	isExec := func(p string) bool { return execs[p] }
	cases := []struct {
		href string
		kind Kind
		want string
	}{
		{"https://example.com/a", External, "https://example.com/a"},
		{"mailto:a@b.c", External, "mailto:a@b.c"},
		{"#section", Anchor, "#section"},
		{"./CHANGELOG.md", Markdown, "/d/CHANGELOG.md"},
		{"../other/README.markdown", Markdown, "/other/README.markdown"},
		{"docs/my%20notes.md", Markdown, "/d/docs/my notes.md"},
		{"report.pdf", LocalFile, "/d/report.pdf"},
		{"file:///etc/hosts", LocalFile, "/etc/hosts"},
		{"./scripts/install.sh", Executable, "/d/scripts/install.sh"},
		{"Setup.EXE", Executable, "/d/Setup.EXE"},
		{"/Applications/Calculator.app", Executable, "/Applications/Calculator.app"},
		{"run", Executable, "/d/run"},       // 带可执行权限、无扩展名
		{"folder", Executable, "/d/folder"}, // 目录
		{"javascript:alert(1)", Invalid, ""},
		{"data:text/html,<script>", Invalid, ""},
		{"vbscript:x", Invalid, ""},
		{"", Invalid, ""},
	}
	for _, c := range cases {
		want := c.want
		if strings.HasPrefix(want, "/") { // 本地路径；Windows 上无盘符的根路径取文档目录的盘符
			want = abs(want)
		}
		k, got := Classify(c.href, abs("/d"), isExec)
		if k != c.kind || got != want {
			t.Errorf("Classify(%q) = %v %q, want %v %q", c.href, k, got, c.kind, c.want)
		}
	}
	if k, _ := Classify("a.md", "", isExec); k != Invalid {
		t.Error("未命名文档的相对链接无法解析")
	}
}

func TestSameOrigin(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"mygo://localhost/", "mygo://localhost/#/start", true},
		{"http://localhost:5173/", "http://localhost:5173/x", true},
		{"mygo://localhost/", "https://evil.example/", false},
		{"http://localhost:5173/", "http://localhost:5174/", false},
		{"mygo://localhost/", "file:///etc/passwd", false},
	}
	for _, c := range cases {
		if SameOrigin(c.a, c.b) != c.want {
			t.Errorf("SameOrigin(%q, %q) != %v", c.a, c.b, c.want)
		}
	}
}
