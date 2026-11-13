package links

import (
	"path/filepath"
	"testing"
)

func TestClassify(t *testing.T) {
	execs := map[string]bool{"/d/run": true, "/d/folder": true}
	isExec := func(p string) bool { return execs[filepath.ToSlash(p)] }
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
		k, got := Classify(c.href, "/d", isExec)
		if k != c.kind || filepath.ToSlash(got) != c.want {
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
