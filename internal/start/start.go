// Package start 实现启动窗口（PRD F1.9、F1.10、F1.12，决策 D7；技术方案 3.3.1 节）。
//
// mygo 在 NoUntitled 时不会自动新建文档，但没有「启动时的打开流程已结束」的回调：
// WhenReady 之后命令行文件和恢复副本才在 goroutine 里打开。所以用「已知要打开、窗口还没出现
// 的文件数」加短暂等待来判断是否无文件启动。
package start

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/session"
)

// IdleDelay 是 WhenReady 之后等待恢复副本、命令行文件打开的时间（V7 实测）。
var IdleDelay = 300 * time.Millisecond

// MaxWait 是有文件在读时最多再等的时间。
const MaxWait = 3 * time.Second

// CloseDelay 是启动窗口先隐藏、再真正关闭的间隔。
//
// 从启动窗口拖入文件时，文档窗口是在页面的 drop 事件里（经 mygo 桥）打开的，此时 WebKit 的
// 拖放往返还没结束。立刻关闭启动窗口会销毁它的 WKWebView：WebContent 进程随后为这个页面
// 发来的剪贴板请求被判为非法消息而被杀掉，UI 进程里 WebPageProxy::performDragOperation 的
// 回调再访问已销毁的页面，空指针崩溃，整个应用以 exit(2) 退出（macOS 27 上必现）。
// 所以先隐藏（页面保留，拖放能正常收尾），过一会儿再关闭。
var CloseDelay = time.Second

var (
	docs    *session.Docs
	pending atomic.Int32
	mu      sync.Mutex
	win     *mygo.Window
	readyAt time.Time
	// OnFocus 由 main 注入：启动窗口获得焦点时刷新菜单（保存类命令置灰）。
	OnFocus = func() {}
	// Harden 由 main 注入（links.Harden），避免 start 依赖 links
	Harden func(*mygo.Window)
	// Shown 记录启动窗口出现的次数，供自动化测试和 M0 报告读取。
	Shown atomic.Int32
)

// TrackOpenFiles 必须在 NewDocuments 之前调用：先于 mygo 记下启动时要打开的文件。
func TrackOpenFiles() {
	mygo.App.OnOpenFile(func(path string) { Expect() })
}

// Expect 记一个即将出现的文档窗口；DocumentShown 或超时后减一。
func Expect() {
	pending.Add(1)
	time.AfterFunc(MaxWait, func() { decrement() })
}

func decrement() {
	for {
		v := pending.Load()
		if v <= 0 || pending.CompareAndSwap(v, v-1) {
			return
		}
	}
}

// DocumentShown 由 newDocWindow 在文档窗口创建后调用：计数减一，并关闭启动窗口（规则②）。
func DocumentShown() {
	decrement()
	Close()
}

// Install 在 NewDocuments 之后调用。
func Install(d *session.Docs) {
	docs = d
	mygo.App.WhenReady(func() {
		readyAt = time.Now()
		time.AfterFunc(IdleDelay, showIfIdle)
	})
	mygo.App.OnActivate(func(visible bool) { // macOS 点 Dock（F1.10）
		if !visible {
			go showIfIdle()
		}
	})
}

func showIfIdle() {
	if len(docs.Documents()) > 0 {
		return // 带文件启动，或恢复了崩溃前的文档
	}
	if pending.Load() > 0 && time.Since(readyAt) < MaxWait {
		time.AfterFunc(100*time.Millisecond, showIfIdle)
		return
	}
	Show()
}

// Show 显示启动窗口；全局只有一个，已存在则聚焦（规则①）。
func Show() {
	mu.Lock()
	defer mu.Unlock()
	if win != nil && !win.IsDestroyed() {
		win.Show()
		win.Focus()
		return
	}
	Shown.Add(1)
	w := mygo.NewWindow(mygo.WindowOptions{
		Title:           "LiteMd",
		URL:             "/#/start",
		Width:           480,
		Height:          320,
		DisableResize:   true,
		DisableMaximize: true,
		BackgroundColor: "light-dark(#ffffff, #1e1e1e)",
	})
	w.OnFileDrop(func(e *mygo.FileDropEvent) {
		for _, p := range e.Paths {
			if IsOpenable(p) {
				go func(p string) { _, _ = docs.Open(p) }(p)
			}
		}
	})
	if Harden != nil {
		Harden(w)
	}
	w.OnFocus(func() { OnFocus() })
	w.OnClosed(func() {
		mu.Lock()
		if win == w {
			win = nil
		}
		mu.Unlock()
	})
	win = w
}

// Close 关闭启动窗口（任何文档窗口出现后，规则②）：立即隐藏，CloseDelay 后再关闭，见 CloseDelay。
func Close() {
	mu.Lock()
	w := win
	win = nil
	mu.Unlock()
	if w == nil || w.IsDestroyed() {
		return
	}
	w.Hide()
	time.AfterFunc(CloseDelay, func() {
		if !w.IsDestroyed() {
			w.Close()
		}
	})
}

// Window 返回当前的启动窗口（没有时为 nil）。
func Window() *mygo.Window {
	mu.Lock()
	defer mu.Unlock()
	return win
}

// IsOpenable：Markdown 扩展名和 .txt 可以从启动窗口拖入打开（PRD 3.2）。
func IsOpenable(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".md", ".markdown", ".mdown", ".mkd", ".txt":
		return true
	}
	return false
}

// ErrNotStart：只有启动窗口能调用 Start 服务。
var ErrNotStart = errors.New("start: 只有启动窗口能调用")

// Service 是绑定给启动窗口页面的服务。
type Service struct{}

func check(ctx context.Context) error {
	if w := mygo.CallerWindow(ctx); w == nil || w != Window() {
		return ErrNotStart
	}
	return nil
}

// NewDocument：「新建」按钮。
func (Service) NewDocument(ctx context.Context) error {
	if err := check(ctx); err != nil {
		return err
	}
	docs.New()
	return nil
}

// Open：「打开…」按钮。取消时什么都不做，启动窗口保留（规则③）。
func (Service) Open(ctx context.Context) error {
	if err := check(ctx); err != nil {
		return err
	}
	_, err := docs.OpenDialog()
	if errors.Is(err, mygo.ErrCanceled) {
		return nil
	}
	return err
}
