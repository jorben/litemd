// Package export 提供页面导出文件的入口（PRD F8；技术方案 3.4、7 节）。
//
// 写盘只发生在用户在保存对话框里选的路径：ChoosePath 弹对话框并登记路径，WriteChosen 只接受
// 本窗口最近登记、未过期的路径，写一次后作废。页面无法借此写任意路径（NF5）。
package export

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/doc"
)

// ChosenTTL 是登记路径的有效期。
const ChosenTTL = 2 * time.Minute

// ErrNotChosen：路径不是本窗口在保存对话框里选的。
var ErrNotChosen = errors.New("export: 只能写入保存对话框里选择的路径")

type chosen struct {
	path string
	at   time.Time
}

var (
	mu    sync.Mutex
	paths = map[any][]chosen{}
	now   = time.Now
)

func register(w any, p string) {
	mu.Lock()
	defer mu.Unlock()
	paths[w] = append(paths[w], chosen{filepath.Clean(p), now()})
}

// take 检查并作废登记的路径。
func take(w any, p string) bool {
	mu.Lock()
	defer mu.Unlock()
	p = filepath.Clean(p)
	list := paths[w]
	for i, c := range list {
		if c.path == p && now().Sub(c.at) < ChosenTTL {
			paths[w] = append(list[:i:i], list[i+1:]...)
			return true
		}
	}
	return false
}

// Filter 是保存对话框的文件类型。
type Filter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

// Service 是绑定给文档页面的 Export 服务。
type Service struct{}

// ChoosePath 弹保存对话框，返回用户选择的路径（取消时为空字符串）。
func (Service) ChoosePath(ctx context.Context, defaultName string, filters []Filter) (string, error) {
	w := mygo.CallerWindow(ctx)
	if w == nil {
		return "", ErrNotChosen
	}
	fs := make([]mygo.FileFilter, 0, len(filters))
	for _, f := range filters {
		fs = append(fs, mygo.FileFilter{Name: f.Name, Extensions: f.Extensions})
	}
	p, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: w, DefaultPath: defaultName, Filters: fs, CreateDirectories: true})
	if errors.Is(err, mygo.ErrCanceled) || p == "" {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	register(w, p)
	return p, nil
}

// WriteChosen 把数据写到 ChoosePath 选择的路径（原子写入）。
func (Service) WriteChosen(ctx context.Context, path string, data []byte) error {
	w := mygo.CallerWindow(ctx)
	if w == nil || !take(w, path) {
		return ErrNotChosen
	}
	return doc.WriteFileAtomic(path, data)
}

// ---- 导出 HTML / PDF、打印（PRD F8，技术方案第 7 节） ----
// 页面生成自包含的 HTML（样式内联、图片转 data:、无脚本），Go 写盘或在隐藏的 Untrusted 窗口里
// 打印：mygo 把不带 base URL 的 LoadHTML 视为应用自己的受信任页面，必须设 Untrusted，
// 导出页面不能调用任何 Go 方法。

// ErrTimeout：导出页面没有在限定时间内载入。
var ErrTimeout = errors.New("export: 导出页面载入超时")

func ensureHTML(name string) string {
	if !strings.HasSuffix(strings.ToLower(name), ".html") && !strings.HasSuffix(strings.ToLower(name), ".htm") {
		name += ".html"
	}
	return name
}

// HTML 弹保存对话框并写入导出的 HTML（F8.1）。返回写入的路径，取消时为空。
func (Service) HTML(ctx context.Context, html, defaultName string) (string, error) {
	w := mygo.CallerWindow(ctx)
	p, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: w, DefaultPath: ensureHTML(defaultName), CreateDirectories: true,
		Filters: []mygo.FileFilter{{Name: "HTML", Extensions: []string{"html"}}}})
	if errors.Is(err, mygo.ErrCanceled) || p == "" {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return p, doc.WriteFileAtomic(p, []byte(html))
}

// renderHidden 在隐藏的 Untrusted 窗口中载入 html，载入完成后在主线程调用 fn。
func renderHidden(html string, fn func(*mygo.Window) error) error {
	done := make(chan error, 1)
	mygo.RunOnMain(func() {
		w := mygo.NewWindow(mygo.WindowOptions{Hidden: true, Width: 900, Height: 1200, Page: mygo.PageOptions{Untrusted: true}})
		var once sync.Once
		finish := func(err error) { once.Do(func() { done <- err }) }
		w.Page().OnDidFinishLoad(func() {
			// 给 Mermaid 的 SVG、KaTeX 字体一点排版时间
			time.AfterFunc(300*time.Millisecond, func() {
				mygo.RunOnMain(func() {
					err := fn(w)
					w.Destroy()
					finish(err)
				})
			})
		})
		time.AfterFunc(20*time.Second, func() { mygo.RunOnMain(func() { w.Destroy() }); finish(ErrTimeout) })
		w.Page().LoadHTML(html, "")
	})
	return <-done
}

// PDF 弹保存对话框，在隐藏窗口里把导出的 HTML 打印成 PDF（F8.2：A4 或 Letter，浅色版式）。
func (Service) PDF(ctx context.Context, html, defaultName, paper string) (string, error) {
	w := mygo.CallerWindow(ctx)
	name := strings.TrimSuffix(strings.TrimSuffix(defaultName, ".html"), ".md")
	if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		name += ".pdf"
	}
	p, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: w, DefaultPath: name, CreateDirectories: true,
		Filters: []mygo.FileFilter{{Name: "PDF", Extensions: []string{"pdf"}}}})
	if errors.Is(err, mygo.ErrCanceled) || p == "" {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	size := mygo.PageA4
	if paper == "letter" {
		size = mygo.PageLetter
	}
	var data []byte
	err = renderHidden(html, func(hw *mygo.Window) error {
		var e error
		data, e = hw.Page().PrintToPDF(mygo.PDFOptions{PageSize: size, Background: true})
		return e
	})
	if err != nil {
		return "", err
	}
	return p, doc.WriteFileAtomic(p, data)
}

// Print 用系统打印面板打印导出的 HTML（F8.3）。
func (Service) Print(_ context.Context, html string) error {
	return renderHidden(html, func(hw *mygo.Window) error {
		hw.Page().Print()
		return nil
	})
}
