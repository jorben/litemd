package assets

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

var png = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")

func TestSniff(t *testing.T) {
	cases := []struct {
		head []byte
		ext  string
		ok   bool
	}{
		{png, ".png", true},
		{png, ".jpg", true}, // 扩展名不对但内容是图片：仍按图片提供
		{[]byte{0xFF, 0xD8, 0xFF, 0xE0}, ".jpg", true},
		{[]byte("GIF89a..."), ".gif", true},
		{[]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), ".webp", true},
		{[]byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), ".svg", true},
		{[]byte("<?xml version='1.0'?><svg/>"), ".SVG", true},
		{[]byte("#!/bin/sh\nrm -rf /"), ".png", false}, // 伪装成图片的脚本
		{png, ".txt", false},                           // 非图片扩展名一律拒绝
		{[]byte("hello"), ".md", false},
		{[]byte("<html><script>"), ".svg", false},
	}
	for _, c := range cases {
		if _, ok := Sniff(c.head, c.ext); ok != c.ok {
			t.Errorf("Sniff(%q, %s) = %v", c.head[:min(len(c.head), 12)], c.ext, ok)
		}
	}
}

// abs 把 /x/y 写成本机的绝对路径：Windows 上加盘符 C:。
func abs(p string) string {
	if runtime.GOOS == "windows" {
		return `C:` + filepath.FromSlash(p)
	}
	return p
}

func TestResolve(t *testing.T) {
	dir := abs("/docs/proj")
	cases := map[string]string{
		"./assets/a.png":            "/docs/proj/assets/a.png",
		"assets/a%20b.png":          "/docs/proj/assets/a b.png",
		"../images/x.png":           "/docs/images/x.png", // NF5：允许文档目录之外
		"/abs/y.png":                "/abs/y.png",         // Windows：当前盘的根，取文档目录的盘符
		"file:///abs/z.png":         "/abs/z.png",
		"https://example.com/a.png": "",
		"a.png?v=1#frag":            "/docs/proj/a.png",
	}
	for ref, want := range cases {
		if want != "" {
			want = abs(want)
		}
		if got := Resolve(dir, ref); got != want {
			t.Errorf("Resolve(%q) = %q, want %q", ref, got, want)
		}
	}
	if Resolve("", "a.png") != "" {
		t.Error("未命名文档没有目录，相对路径无法解析")
	}
}

// Windows：文档所在共享之外的 UNC 路径不解析（不连接远程主机），同一共享里的照常解析。
// 卷的判断见 localpath.TestForeignUNC（任何系统都跑）。
func TestResolveUNC(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("UNC 路径只在 Windows 上存在")
	}
	cases := []struct{ dir, ref, want string }{
		{`\\srv\share\docs`, "img/a.png", `\\srv\share\docs\img\a.png`},
		{`\\srv\share\docs`, "//srv/share/b.png", `\\srv\share\b.png`},
		{`\\srv\share\docs`, "file://srv/share/b.png", `\\srv\share\b.png`},
		{`\\srv\share\docs`, "//evil.example/s/x.png", ""},
		{`C:\docs`, "//evil.example/s/x.png", ""},
		{`C:\docs`, `\\evil.example\s\x.png`, ""},
		{`C:\docs`, "file://evil.example/s/x.png", ""},
		{`C:\docs`, "file:////evil.example/s/x.png", ""},
		{"", "//evil.example/s/x.png", ""},
	}
	for _, c := range cases {
		if got := Resolve(c.dir, c.ref); got != c.want {
			t.Errorf("Resolve(%q, %q) = %q, want %q", c.dir, c.ref, got, c.want)
		}
	}
}

func TestSaveImage(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "notes.md")
	now := time.Date(2026, 11, 14, 2, 15, 30, 0, time.UTC)
	rel, err := SaveImage(doc, png, now, Rule{Kind: "assets"})
	if err != nil || rel != "assets/image-20261114-021530.png" {
		t.Fatalf("%q %v", rel, err)
	}
	rel2, _ := SaveImage(doc, png, now, Rule{Kind: "assets"})
	if rel2 != "assets/image-20261114-021530-2.png" {
		t.Fatalf("重名应加序号: %q", rel2)
	}
	if r, _ := SaveImage(doc, png, now, Rule{Kind: "named"}); r != "notes.assets/image-20261114-021530.png" {
		t.Fatalf("named: %q", r)
	}
	if r, _ := SaveImage(doc, png, now, Rule{Kind: "same"}); r != "image-20261114-021530.png" {
		t.Fatalf("same: %q", r)
	}
	if r, _ := SaveImage(doc, png, now, Rule{Kind: "custom", Custom: "pics/2026"}); r != "pics/2026/image-20261114-021530.png" {
		t.Fatalf("custom: %q", r)
	}
	if _, err := SaveImage(doc, png, now, Rule{Kind: "custom", Custom: "../outside"}); err == nil {
		t.Fatal("自定义目录不能跑出文档目录")
	}
	if _, err := SaveImage("", png, now, Rule{}); !errors.Is(err, ErrNeedSave) {
		t.Fatalf("未命名文档: %v", err)
	}
	if _, err := SaveImage(doc, []byte("not an image"), now, Rule{}); !errors.Is(err, ErrNotImage) {
		t.Fatalf("非图片: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "assets", "image-20261114-021530.png")); string(b) != string(png) {
		t.Fatal("写入内容不对")
	}
}

func TestRelTo(t *testing.T) {
	if r, _ := RelTo("/a/b/doc.md", "/a/c/file.pdf"); r != "../c/file.pdf" {
		t.Fatal(r)
	}
}

func TestIsPrivate(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "::1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.1.1", "fe80::1", "0.0.0.0", "fd00::1"} {
		if !IsPrivate(net.ParseIP(s)) {
			t.Errorf("%s 应视为内网", s)
		}
	}
	for _, s := range []string{"1.1.1.1", "2606:4700::1111"} {
		if IsPrivate(net.ParseIP(s)) {
			t.Errorf("%s 不是内网", s)
		}
	}
}

func TestFetchRejects(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(png) }))
	defer srv.Close()
	ctx := context.Background()
	for _, u := range []string{srv.URL + "/a.png", "http://localhost/a.png", "http://127.0.0.1:1/a.png", "file:///etc/passwd", "javascript:alert(1)", "ftp://x/a.png"} {
		if _, _, err := Fetch(ctx, u); err == nil {
			t.Errorf("%s 应被拒绝", u)
		} else if strings.HasPrefix(u, "http") && !errors.Is(err, ErrPrivateAddr) {
			t.Errorf("%s: 期望内网拒绝，got %v", u, err)
		}
	}
}

func TestBase(t *testing.T) {
	if b := Base("tok"); !strings.HasSuffix(b, "/tok/") {
		t.Fatal(b)
	}
}

// 拖入路径必须是本窗口最近一次拖放登记过的，过期失效（第 7 节）。
func TestDropRegistry(t *testing.T) {
	w1, w2 := "w1", "w2"
	clock := time.Unix(1000, 0)
	now = func() time.Time { return clock }
	defer func() { now = time.Now }()
	recordDrop(w1, []string{"/x/a.png", "/x/b.pdf"})
	if !wasDropped(w1, "/x/a.png") || !wasDropped(w1, "/x/./b.pdf") {
		t.Fatal("登记过的路径应被接受")
	}
	if wasDropped(w2, "/x/a.png") {
		t.Fatal("其他窗口的拖放不能用")
	}
	if wasDropped(w1, "/etc/passwd") {
		t.Fatal("未拖入的路径不能用")
	}
	recordDrop(w1, []string{"/x/c.png"})
	if wasDropped(w1, "/x/a.png") {
		t.Fatal("只认最近一次拖放")
	}
	clock = clock.Add(DropTTL + time.Second)
	if wasDropped(w1, "/x/c.png") {
		t.Fatal("过期后失效")
	}
}

// 拖入的 SVG / ICO 没有 DetectExt 认得的文件头：按原扩展名核对内容后沿用原扩展名。
func TestSaveDroppedImage(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "notes.md")
	now := time.Date(2026, 11, 14, 2, 15, 30, 0, time.UTC)
	svg := []byte("<svg xmlns='http://www.w3.org/2000/svg'/>")
	ico := []byte{0, 0, 1, 0, 1, 0, 16, 16}
	cases := []struct {
		ext  string
		data []byte
		want string // 扩展名；空表示 ErrNotImage
	}{
		{".svg", svg, ".svg"},
		{".SVG", svg, ".svg"},
		{".ico", ico, ".ico"},
		{".ico", png, ".png"},                       // 内容是位图：按文件头
		{".svg", []byte("<html><script>"), ""},      // 内容不是 SVG
		{".png", ico, ""},                           // 只有 SVG / ICO 按原扩展名核对
		{".ico", []byte("#!/bin/sh\nrm -rf /"), ""}, // 伪装成图标的脚本
	}
	for _, c := range cases {
		rel, err := SaveDroppedImage(doc, c.ext, c.data, now, Rule{Kind: "assets"})
		if c.want == "" {
			if !errors.Is(err, ErrNotImage) {
				t.Errorf("SaveDroppedImage(%s, %q) = %q %v, want ErrNotImage", c.ext, c.data, rel, err)
			}
			continue
		}
		if err != nil || filepath.Ext(rel) != c.want {
			t.Errorf("SaveDroppedImage(%s, %q) = %q %v, want *%s", c.ext, c.data, rel, err, c.want)
			continue
		}
		if b, _ := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel))); string(b) != string(c.data) {
			t.Errorf("%s: 写入内容不对", rel)
		}
	}
	if _, err := SaveImage(doc, svg, now, Rule{}); !errors.Is(err, ErrNotImage) {
		t.Fatalf("粘贴的数据没有扩展名，SVG 不能落盘: %v", err)
	}
}

// 拖入一批文件时，一张坏图片不影响其他文件：它的结果为空字符串。
func TestImportDroppedSkipsBadImage(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "notes.md")
	write := func(name string, data []byte) string {
		p := filepath.Join(dir, "in", name)
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, data, 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	good := write("a.png", png)
	bad := write("b.png", []byte("not an image"))
	icon := write("c.ico", []byte{0, 0, 1, 0, 1, 0})
	pdf := write("d.pdf", []byte("%PDF"))
	missing := filepath.Join(dir, "in", "gone.svg")
	paths := []string{good, bad, icon, missing, pdf}
	w := "win"
	recordDrop(w, paths)
	defer func() { dropMu.Lock(); delete(drops, w); dropMu.Unlock() }()
	out, err := importDropped(w, doc, paths)
	if err != nil || len(out) != len(paths) {
		t.Fatalf("%q %v", out, err)
	}
	if !strings.HasPrefix(out[0], "assets/image-") || !strings.HasSuffix(out[0], ".png") ||
		out[1] != "" || !strings.HasSuffix(out[2], ".ico") || out[3] != "" || out[4] != "in/d.pdf" {
		t.Fatalf("%q", out)
	}
	if _, err := importDropped(w, "", []string{good}); !errors.Is(err, ErrNeedSave) {
		t.Fatalf("未命名文档: %v", err)
	}
	if _, err := importDropped(w, doc, []string{good, filepath.Join(dir, "other.png")}); !errors.Is(err, ErrNotDropped) {
		t.Fatalf("未拖入的路径: %v", err)
	}
}
