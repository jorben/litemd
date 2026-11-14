package export

import (
	"strings"
	"testing"
	"time"
)

func TestChosenPaths(t *testing.T) {
	clock := time.Unix(100, 0)
	now = func() time.Time { return clock }
	defer func() { now = time.Now }()
	register("w1", "/out/a.png")
	if take("w2", "/out/a.png") {
		t.Fatal("其他窗口不能用")
	}
	if take("w1", "/etc/passwd") {
		t.Fatal("没选过的路径不能写")
	}
	if !take("w1", "/out/./a.png") {
		t.Fatal("选过的路径可以写一次")
	}
	if take("w1", "/out/a.png") {
		t.Fatal("写一次后作废")
	}
	register("w1", "/out/b.png")
	clock = clock.Add(ChosenTTL + time.Second)
	if take("w1", "/out/b.png") {
		t.Fatal("过期后作废")
	}
}

func TestRenderHTMLBlocksNetworkImagesWhenOff(t *testing.T) {
	const page = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta http-equiv=\"Content-Security-Policy\" content=\"img-src data: https: http:\">\n</head><body><img src=\"https://x.example/a.png\"></body></html>\n"
	meta := `<meta http-equiv="Content-Security-Policy" content="` + offlineCSP + `">`
	if strings.Contains(offlineCSP, "http") {
		t.Fatalf("关闭网络图片时的 CSP 不能含 http(s)：%q", offlineCSP)
	}
	if got := renderHTML(page, true); got != page {
		t.Fatalf("开启网络图片时原样载入，得到 %q", got)
	}
	// doctype 之后、任何元素之前插入，保持标准模式
	if got := renderHTML(page, false); !strings.HasPrefix(got, "<!doctype html>"+meta+"\n<html") {
		t.Fatalf("CSP 应紧跟 doctype，得到 %q", got)
	}
	if got := renderHTML("  <!DOCTYPE html><p>x</p>", false); got != "<!DOCTYPE html>"+meta+"<p>x</p>" {
		t.Fatalf("大写 doctype 与前导空白：得到 %q", got)
	}
	// 页面送来的 HTML 没有 doctype、元素放在前面：CSP 仍在最前
	for _, in := range []string{`<img src="http://x.example/a.png"><!doctype html>`, "", "<!doctype html"} {
		if got := renderHTML(in, false); !strings.HasPrefix(got, meta) {
			t.Fatalf("%q：CSP 应在最前，得到 %q", in, got)
		}
	}
}
