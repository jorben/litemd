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
