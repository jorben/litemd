package localpath

import (
	"net/url"
	"runtime"
	"testing"
)

func TestFromFileURL(t *testing.T) {
	cases := map[string]string{
		"file:///etc/hosts":       "/etc/hosts",
		"file:///a%20b/c.md":      "/a b/c.md",
		"file://localhost/x/y.md": "/x/y.md",
	}
	if runtime.GOOS == "windows" {
		cases = map[string]string{
			"file:///C:/Users/a/x.png":  `C:\Users\a\x.png`,
			"file:///c:/a%20b/c.md":     `c:\a b\c.md`,
			"file:///abs/z.png":         `\abs\z.png`, // 没有盘符：由 Join 补上
			"file://server/share/a.md":  `\\server\share\a.md`,
			"file://localhost/C:/x.png": `C:\x.png`,
		}
	}
	for raw, want := range cases {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if got := FromFileURL(u); got != want {
			t.Errorf("FromFileURL(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestJoin(t *testing.T) {
	cases := []struct{ dir, p, want string }{
		{"/d", "a.md", "/d/a.md"},
		{"/d/x", "../b/c.md", "/d/b/c.md"},
		{"/d", "/abs/y.png", "/abs/y.png"},
		{"", "/abs/y.png", "/abs/y.png"},
		{"", "a.md", ""},
	}
	if runtime.GOOS == "windows" {
		cases = []struct{ dir, p, want string }{
			{`C:\d`, "a.md", `C:\d\a.md`},
			{`C:\d\x`, `..\b\c.md`, `C:\d\b\c.md`},
			{`C:\d`, `D:\y.png`, `D:\y.png`},
			{`C:\d`, `D:/y.png`, `D:\y.png`},
			{`D:\d`, `\abs\y.png`, `D:\abs\y.png`}, // 当前盘的根
			{`D:\d`, `/abs/y.png`, `D:\abs\y.png`},
			{`\\srv\share\d`, `\abs\y.png`, `\\srv\share\abs\y.png`},
			{"", `C:\y.png`, `C:\y.png`},
			{"", `\abs\y.png`, ""},
			{"", "a.md", ""},
		}
	}
	for _, c := range cases {
		if got := Join(c.dir, c.p); got != c.want {
			t.Errorf("Join(%q, %q) = %q, want %q", c.dir, c.p, got, c.want)
		}
	}
}

// UNC 卷的判断是纯字符串处理，Windows 路径的用例在任何系统上都跑。
func TestForeignUNC(t *testing.T) {
	cases := []struct {
		dir, p string
		want   bool
	}{
		{`\\srv\share\docs`, `\\srv\share\img\a.png`, false}, // 文档所在共享：照常使用
		{`\\srv\share\docs`, `\\SRV\Share\a.png`, false},     // 卷名不区分大小写
		{`\\srv\share\docs`, `//srv/share/a.png`, false},
		{`\\srv\share\docs`, `\\srv\other\a.png`, true}, // 同一主机的其他共享
		{`\\srv\share\docs`, `\\evil.example\s\x.png`, true},
		{`\\srv\share\docs`, `\\srv\sharex\a.png`, true},
		{`C:\docs`, `\\evil.example\s\x.png`, true},
		{`C:\docs`, `//evil.example/s/x.png`, true},
		{`C:\docs`, `\\evil.example`, true},
		{"", `\\evil.example\s\x.png`, true}, // 未命名文档
		{`C:\docs`, `\\?\UNC\evil\s\x.png`, true},
		{`\\srv\share\docs`, `\\?\UNC\srv\share\x.png`, true}, // 卷的写法不同：保守拒绝
		{`\\?\UNC\srv\share\docs`, `\\?\unc\srv\share\x.png`, false},
		{`\\?\UNC\srv\share\docs`, `\\?\UNC\srv\other\x.png`, true},
		{`C:\docs`, `\\?\C:\x.png`, true},
		{`C:\docs`, `\\.\pipe\x`, true},
		{`C:\docs`, `\??\UNC\evil\s\x.png`, true},
		{`C:\docs`, `C:\img\a.png`, false},
		{`C:\docs`, `D:\a.png`, false},
		{`\\srv\share\docs`, `C:\a.png`, false},
		{`C:\docs`, `\abs\a.png`, false},
		{"/Users/a", "/Users/a/b.png", false},
	}
	for _, c := range cases {
		if got := foreignUNC(c.dir, c.p); got != c.want {
			t.Errorf("foreignUNC(%q, %q) = %v, want %v", c.dir, c.p, got, c.want)
		}
	}
	if runtime.GOOS != "windows" && ForeignUNC("/d", `\\evil\s\x.png`) {
		t.Error("其他系统没有 UNC 路径")
	}
}
