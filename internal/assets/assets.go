// Package assets 提供文档引用的本地图片（lmasset 协议）、图片粘贴/拖入落盘和单张网络图片加载
// （PRD F6，技术方案 3.5 节与第 7 节）。
//
// 安全约束（NF5）：
//   - 协议按窗口令牌限定作用域，并核对请求来自令牌所属窗口；
//   - 只提供图片类文件（扩展名与文件头双重判断），允许 ../ 等文档目录之外的路径；
//   - 写盘只发生在文档目录下的图片目录；拖入的路径必须是本窗口最近一次拖放登记过的；
//   - 网络图片只接受 http(s)，拒绝回环、内网、链路本地地址，只返回图片，上限 20 MB。
package assets

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/session"
)

// Scheme 是本地图片协议名。
const Scheme = "lmasset"

// 大小上限。
const (
	MaxPaste = 50 << 20
	MaxFetch = 20 << 20
)

var imageExt = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".ico": "image/x-icon", ".svg": "image/svg+xml",
}

// 错误。
var (
	ErrNotImage    = errors.New("assets: 不是图片")
	ErrNeedSave    = errors.New("assets: 未命名文档请先保存再粘贴图片") // F6.4
	ErrTooLarge    = errors.New("assets: 文件太大")
	ErrNotDropped  = errors.New("assets: 路径不是本窗口拖入的")
	ErrBadURL      = errors.New("assets: 只能加载 http(s) 图片")
	ErrPrivateAddr = errors.New("assets: 不能加载本机或内网地址的图片")
)

// Base 返回某个令牌的协议 URL 前缀（Windows 上 WebView2 把自定义协议映射到 http://<scheme>.localhost）。
func Base(token string) string {
	if runtime.GOOS == "windows" {
		return "http://" + Scheme + ".localhost/" + token + "/"
	}
	return Scheme + "://localhost/" + token + "/"
}

// Sniff 按文件头判断是不是图片，返回 MIME 类型。ext 用于 SVG（文本格式，没有魔数）。
func Sniff(head []byte, ext string) (string, bool) {
	want, ok := imageExt[strings.ToLower(ext)]
	if !ok {
		return "", false
	}
	if want == "image/svg+xml" {
		h := strings.ToLower(string(bytes.TrimLeft(head, "\ufeff \t\r\n")))
		return want, strings.HasPrefix(h, "<svg") || strings.HasPrefix(h, "<?xml") || strings.HasPrefix(h, "<!--")
	}
	switch {
	case bytes.HasPrefix(head, []byte("\x89PNG\r\n\x1a\n")),
		bytes.HasPrefix(head, []byte{0xFF, 0xD8, 0xFF}),
		bytes.HasPrefix(head, []byte("GIF87a")), bytes.HasPrefix(head, []byte("GIF89a")),
		len(head) >= 12 && string(head[0:4]) == "RIFF" && string(head[8:12]) == "WEBP",
		len(head) >= 12 && string(head[4:8]) == "ftyp" && (string(head[8:12]) == "avif" || string(head[8:12]) == "avis"),
		bytes.HasPrefix(head, []byte("BM")),
		bytes.HasPrefix(head, []byte{0, 0, 1, 0}):
		return want, true
	}
	return "", false
}

// DetectExt 按文件头返回位图的扩展名（粘贴的图片没有文件名）；不是位图时返回空字符串。
func DetectExt(head []byte) string {
	switch {
	case bytes.HasPrefix(head, []byte("\x89PNG\r\n\x1a\n")):
		return ".png"
	case bytes.HasPrefix(head, []byte{0xFF, 0xD8, 0xFF}):
		return ".jpg"
	case bytes.HasPrefix(head, []byte("GIF87a")), bytes.HasPrefix(head, []byte("GIF89a")):
		return ".gif"
	case len(head) >= 12 && string(head[0:4]) == "RIFF" && string(head[8:12]) == "WEBP":
		return ".webp"
	case len(head) >= 12 && string(head[4:8]) == "ftyp" && (string(head[8:12]) == "avif" || string(head[8:12]) == "avis"):
		return ".avif"
	case bytes.HasPrefix(head, []byte("BM")):
		return ".bmp"
	}
	return ""
}

// Resolve 把 Markdown 中的图片引用解析为绝对路径：相对路径按文档目录，支持 file:// 与绝对路径。
// 返回空字符串表示不是本地文件（如 http）。
func Resolve(dir, ref string) string {
	if ref == "" {
		return ""
	}
	if u, err := url.Parse(ref); err == nil && u.Scheme != "" && len(u.Scheme) > 1 {
		if u.Scheme != "file" {
			return ""
		}
		ref = filepath.FromSlash(u.Path)
	} else if dec, err := url.PathUnescape(ref); err == nil {
		ref = dec
	}
	if i := strings.IndexAny(ref, "?#"); i >= 0 {
		ref = ref[:i]
	}
	if !filepath.IsAbs(ref) {
		if dir == "" {
			return ""
		}
		ref = filepath.Join(dir, filepath.FromSlash(ref))
	}
	return filepath.Clean(ref)
}

// Register 注册 lmasset 协议，须在创建窗口之前调用。
func Register() {
	session.AssetBase = Base
	mygo.Protocol.HandleFunc(Scheme, serve)
}

func serve(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.EscapedPath(), "/"), "/", 2)
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	d, win := session.DocForToken(parts[0])
	if d == nil || mygo.CallerWindow(r.Context()) != win {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	ref, err := url.PathUnescape(parts[1])
	if err != nil {
		http.NotFound(w, r)
		return
	}
	dir := ""
	if p := d.State().Path; p != "" {
		dir = filepath.Dir(p)
	}
	p := Resolve(dir, ref)
	if p == "" {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, r) // F6.7：页面显示占位和原始路径
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || !fi.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	mime, ok := Sniff(head[:n], filepath.Ext(p))
	if !ok {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if mime == "image/svg+xml" {
		w.Header().Set("Content-Security-Policy", "script-src 'none'")
	}
	http.ServeContent(w, r, "", fi.ModTime(), f)
}

// ---- 拖入路径登记 ----

type dropSet struct {
	paths map[string]bool
	at    time.Time
}

var (
	dropMu sync.Mutex
	drops  = map[any]*dropSet{}
	now    = time.Now
)

// DropTTL 是拖放登记的有效期。
const DropTTL = 10 * time.Second

// TrackDrops 记录窗口每次拖放的路径，供 importDropped 校验（第 7 节）。
func TrackDrops(w *mygo.Window) {
	w.OnFileDrop(func(e *mygo.FileDropEvent) { recordDrop(w, e.Paths) })
	w.OnClosed(func() { dropMu.Lock(); delete(drops, w); dropMu.Unlock() })
}

func recordDrop(w any, paths []string) {
	set := &dropSet{paths: map[string]bool{}, at: now()}
	for _, p := range paths {
		set.paths[filepath.Clean(p)] = true
	}
	dropMu.Lock()
	drops[w] = set
	dropMu.Unlock()
}

func wasDropped(w any, p string) bool {
	dropMu.Lock()
	defer dropMu.Unlock()
	s := drops[w]
	return s != nil && now().Sub(s.at) < DropTTL && s.paths[filepath.Clean(p)]
}

// ---- 图片落盘 ----

// Rule 是图片保存位置规则（F6.3，设置中可改；默认 ./assets/，D4）。
type Rule struct {
	Kind   string `json:"kind"`   // assets / named / same / custom
	Custom string `json:"custom"` // custom 时的相对路径
}

// CurrentRule 由设置包注入。
var CurrentRule = func() Rule { return Rule{Kind: "assets"} }

// TargetDir 返回图片目录（绝对路径）和它相对文档目录的写法。
func TargetDir(docPath string, r Rule) (abs, rel string, err error) {
	dir := filepath.Dir(docPath)
	switch r.Kind {
	case "named":
		rel = strings.TrimSuffix(filepath.Base(docPath), filepath.Ext(docPath)) + ".assets"
	case "same":
		rel = ""
	case "custom":
		rel = filepath.Clean(filepath.FromSlash(r.Custom))
		if filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", "", errors.New("assets: 自定义目录必须在文档目录之内")
		}
		if rel == "." {
			rel = ""
		}
	default:
		rel = "assets"
	}
	return filepath.Join(dir, rel), filepath.ToSlash(rel), nil
}

// UniqueName 在 dir 中为 base 找一个不冲突的文件名：image-20261114-021530.png、…-2.png。
func UniqueName(dir, base string) string {
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	name := base
	for i := 2; ; i++ {
		if _, err := os.Lstat(filepath.Join(dir, name)); os.IsNotExist(err) {
			return name
		}
		name = fmt.Sprintf("%s-%d%s", stem, i, ext)
	}
}

// SaveImage 把图片字节写到文档的图片目录，返回插入 Markdown 用的相对路径。
func SaveImage(docPath string, data []byte, now time.Time, r Rule) (string, error) {
	if docPath == "" {
		return "", ErrNeedSave
	}
	if len(data) > MaxPaste {
		return "", ErrTooLarge
	}
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	ext := DetectExt(head)
	if ext == "" {
		return "", ErrNotImage
	}
	abs, rel, err := TargetDir(docPath, r)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", err
	}
	name := UniqueName(abs, "image-"+now.Format("20060102-150405")+ext)
	f, err := os.OpenFile(filepath.Join(abs, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return joinRel(rel, name), nil
}

func joinRel(rel, name string) string {
	if rel == "" {
		return name
	}
	return rel + "/" + name
}

// RelTo 返回 target 相对文档目录的写法（拖入非图片文件时插入链接，F6.5）。
func RelTo(docPath, target string) (string, error) {
	r, err := filepath.Rel(filepath.Dir(docPath), target)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(r), nil
}

// ---- 网络图片 ----

// IsPrivate 报告地址是否为回环、内网、链路本地或未指定地址。
func IsPrivate(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast()
}

// fetchClient 在建立连接时检查实际连接的地址，防止 DNS 重绑定绕过（第 7 节）。
var fetchClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{Timeout: 10 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip == nil || IsPrivate(ip) {
				return ErrPrivateAddr
			}
			return nil
		}}).DialContext,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("assets: 重定向太多")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return ErrBadURL
		}
		return nil
	},
}

// Fetch 下载单张网络图片（F6.2：关闭加载网络图片后，用户点击单张时）。
func Fetch(ctx context.Context, raw string) ([]byte, string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, "", ErrBadURL
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && IsPrivate(ip) {
		return nil, "", ErrPrivateAddr
	}
	if h := strings.ToLower(u.Hostname()); h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return nil, "", ErrPrivateAddr
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := fetchClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("assets: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, MaxFetch+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > MaxFetch {
		return nil, "", ErrTooLarge
	}
	ext := filepath.Ext(u.Path)
	ct := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	if ct == "image/svg+xml" {
		ext = ".svg"
	}
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	for _, e := range []string{ext, ".png", ".jpg", ".gif", ".webp", ".avif", ".bmp", ".ico"} {
		if mime, ok := Sniff(head, e); ok {
			return data, mime, nil
		}
	}
	return nil, "", ErrNotImage
}

// ---- 绑定服务 ----

// Service 是绑定给文档页面的 Assets 服务。
type Service struct{}

// Image 是 fetchImage 的结果（[]byte 在 TS 中为 base64 字符串）。
type Image struct {
	Data []byte `json:"data"`
	Mime string `json:"mime"`
}

func docPath(ctx context.Context) (*mygo.Window, string, error) {
	w := mygo.CallerWindow(ctx)
	d := session.ForWindow(w)
	if d == nil {
		return nil, "", session.ErrNoDocument
	}
	return w, d.State().Path, nil
}

// SaveImage：粘贴的图片落盘，返回相对路径（F6.3/F6.4）。
func (Service) SaveImage(ctx context.Context, data []byte) (string, error) {
	_, p, err := docPath(ctx)
	if err != nil {
		return "", err
	}
	return SaveImage(p, data, time.Now(), CurrentRule())
}

// ImportDropped：拖入正文的文件。图片复制到图片目录，其他文件只计算相对路径（F6.3/F6.5）。
func (Service) ImportDropped(ctx context.Context, paths []string) ([]string, error) {
	w, p, err := docPath(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(paths))
	for _, src := range paths {
		if !wasDropped(w, src) {
			return nil, ErrNotDropped
		}
		if _, ok := imageExt[strings.ToLower(filepath.Ext(src))]; ok {
			data, err := os.ReadFile(src)
			if err != nil {
				return nil, err
			}
			if p == "" {
				return nil, ErrNeedSave
			}
			rel, err := SaveImage(p, data, time.Now(), CurrentRule())
			if err != nil {
				return nil, err
			}
			out = append(out, rel)
			continue
		}
		if p == "" {
			out = append(out, filepath.ToSlash(src))
			continue
		}
		rel, err := RelTo(p, src)
		if err != nil {
			return nil, err
		}
		out = append(out, rel)
	}
	return out, nil
}

// FetchImage：单张网络图片。
func (Service) FetchImage(ctx context.Context, rawURL string) (Image, error) {
	if _, _, err := docPath(ctx); err != nil {
		return Image{}, err
	}
	data, mime, err := Fetch(ctx, rawURL)
	return Image{Data: data, Mime: mime}, err
}
