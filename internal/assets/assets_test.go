package assets

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestResolve(t *testing.T) {
	dir := "/docs/proj"
	cases := map[string]string{
		"./assets/a.png":            "/docs/proj/assets/a.png",
		"assets/a%20b.png":          "/docs/proj/assets/a b.png",
		"../images/x.png":           "/docs/images/x.png", // NF5：允许文档目录之外
		"/abs/y.png":                "/abs/y.png",
		"file:///abs/z.png":         "/abs/z.png",
		"https://example.com/a.png": "",
		"a.png?v=1#frag":            "/docs/proj/a.png",
	}
	for ref, want := range cases {
		if got := Resolve(dir, ref); got != filepath.FromSlash(want) {
			t.Errorf("Resolve(%q) = %q, want %q", ref, got, want)
		}
	}
	if Resolve("", "a.png") != "" {
		t.Error("未命名文档没有目录，相对路径无法解析")
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
