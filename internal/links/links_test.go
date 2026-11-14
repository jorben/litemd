package links

import (
	"net/url"
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

// Windows：文档所在共享之外的 UNC 路径只按扩展名分类，不调用 isExecFile（不访问远程主机）。
// 卷的判断见 localpath.TestForeignUNC（任何系统都跑）。
func TestClassifyUNC(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("UNC 路径只在 Windows 上存在")
	}
	var touched []string
	isExec := func(p string) bool { touched = append(touched, p); return false }
	cases := []struct {
		dir, href string
		kind      Kind
		want      string
	}{
		{`C:\d`, "//evil.example/s/report.pdf", LocalFile, `\\evil.example\s\report.pdf`},
		{`C:\d`, "file://evil.example/s/run", LocalFile, `\\evil.example\s\run`},
		{`C:\d`, `\\evil.example\s\notes.md`, Markdown, `\\evil.example\s\notes.md`},
		{`C:\d`, "//evil.example/s/setup.exe", Executable, `\\evil.example\s\setup.exe`}, // 按扩展名拒绝
		{`\\evil.example\other`, "//evil.example/s/x.pdf", LocalFile, `\\evil.example\s\x.pdf`},
	}
	for _, c := range cases {
		if k, got := Classify(c.href, c.dir, isExec); k != c.kind || got != c.want {
			t.Errorf("Classify(%q, %q) = %v %q, want %v %q", c.href, c.dir, k, got, c.kind, c.want)
		}
	}
	if len(touched) != 0 {
		t.Fatalf("确认前不应访问 UNC 路径: %q", touched)
	}
	// 文档所在共享里的文件照常检查
	if k, got := Classify("x.pdf", `\\srv\share\d`, isExec); k != LocalFile || got != `\\srv\share\d\x.pdf` || len(touched) != 1 {
		t.Fatalf("同一共享: %v %q %q", k, got, touched)
	}
}

// 没有协议的 //host/... 保留主机（与 assets.Resolve 一致），Windows 上随后成为 UNC 路径。纯字符串处理，任何系统都跑。
func TestSchemelessPath(t *testing.T) {
	cases := []struct{ href, want string }{
		{"//evil.example/s/report.pdf", "//evil.example/s/report.pdf"},
		{"//evil.example/s/my%20notes.md", "//evil.example/s/my notes.md"},
		{"/abs/x.pdf", "/abs/x.pdf"},
		{"docs/a.md", "docs/a.md"},
	}
	for _, c := range cases {
		u, err := url.Parse(c.href)
		if err != nil {
			t.Fatal(err)
		}
		if got := schemelessPath(u); got != c.want {
			t.Errorf("schemelessPath(%q) = %q, want %q", c.href, got, c.want)
		}
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
