package session

import (
	"context"
	"log"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/doc"
)

// Docs 是 LiteMd 的文档集合类型。
type Docs = mygo.Documents[doc.MdContent]

// Document 是 LiteMd 的文档类型。
type Document = mygo.Document[doc.MdContent]

// FlushRequest 是发给页面的收齐请求（技术方案 5.3 节）。
type FlushRequest struct {
	N int64 `json:"n"`
}

// Flush 事件：页面收到后立即推送未同步的编辑，再调用 Session.flushed(n)。
var Flush = mygo.NewEvent[FlushRequest]("flush")

// ErrNoDocument：调用者窗口没有对应的文档（例如启动窗口、设置窗口）。
var ErrNoDocument = errors.New("session: 调用者窗口没有文档")

// entry 是一个文档窗口的会话状态。
type entry struct {
	doc       *Document
	sync      *Sync
	token     string
	recovered bool
	closeOK   atomic.Bool // 已收齐，下一次关窗放行给 mygo
}

var (
	mu       sync.Mutex
	byWindow = map[*mygo.Window]*entry{}
	quitting atomic.Bool // 退出流程已放行：关窗不再拦截（拦截会取消整个退出）
)

var debugEnabled = os.Getenv("LITEMD_DEBUG") != ""

func newToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Attach 在文档窗口创建后、mygo attach 之前调用（newDocWindow 内）：登记会话，并注册关窗收齐。
// recovered 表示文档是从恢复副本重建的（窗口创建时已是「已编辑」，技术方案 3.3 节）。
func Attach(w *mygo.Window, d *Document, recovered bool) {
	e := &entry{doc: d, sync: NewSync(), token: newToken(), recovered: recovered}
	mu.Lock()
	byWindow[w] = e
	mu.Unlock()
	w.OnClose(func(ev *mygo.CloseEvent) {
		if quitting.Load() || e.closeOK.Swap(false) || !e.sync.NeedsFlush() {
			return
		}
		ev.PreventDefault() // mygo 看到已阻止就不处理；收齐后再关一次
		debugf("close: flushing window %d", w.ID())
		go func() {
			FlushWindow(w)
			e.closeOK.Store(true)
			w.Close()
		}()
	})
	w.OnClosed(func() {
		mu.Lock()
		delete(byWindow, w)
		mu.Unlock()
	})
	d.OnReload(func() { e.sync.Reset(e.sync.Seq()) })
	// markDirty 的 SetEdited(true) 会启动自动保存计时；若页面推送晚于计时，自动保存写的是上一版内容并把
	// 文档标回「未编辑」。此时页面仍有未推送的编辑：重新标记已编辑，并立即请求收齐（M0 报告 V2）。
	d.OnStateChange(func(st mygo.DocumentState) {
		if !st.Edited && e.sync.NeedsFlush() && !d.Content().Lossy {
			debugf("state: unedited with unpushed edits, re-marking window %d", w.ID())
			d.SetEdited(true)
			go FlushWindow(w)
		}
	})
}

// debugf 在设置了 LITEMD_DEBUG 时把同步过程写到标准错误（M0 实测用）。
func debugf(format string, args ...any) {
	if debugEnabled {
		log.Printf("[session] "+format, args...)
	}
}

func entryFor(w *mygo.Window) *entry {
	mu.Lock()
	defer mu.Unlock()
	return byWindow[w]
}

// DocForToken 返回令牌所属窗口的文档（lmasset 协议用）。
func DocForToken(token string) (*Document, *mygo.Window) {
	mu.Lock()
	defer mu.Unlock()
	for w, e := range byWindow {
		if e.token == token {
			return e.doc, w
		}
	}
	return nil, nil
}

// FlushWindow 收齐一个窗口（保存、导出、打印前调用；不可在主线程调用）。
func FlushWindow(w *mygo.Window) bool {
	e := entryFor(w)
	if e == nil {
		return true
	}
	ok := e.sync.Flush(func(n int64) error {
		err := Flush.Emit(w, FlushRequest{N: n})
		debugf("flush %d emitted to window %d: err=%v", n, w.ID(), err)
		return err
	}, FlushTimeout)
	debugf("flush window %d done ok=%v", w.ID(), ok)
	return ok
}

// InstallQuitFlush 必须在 mygo.NewDocuments 之前调用，使收齐排在 mygo 的退出处理前面（技术方案 5.3 节）。
func InstallQuitFlush() {
	mygo.App.OnBeforeQuit(func(ev *mygo.QuitEvent) {
		if ev.SessionEnding {
			quitting.Store(true) // 关机、注销：不能等待，只能依赖最近一次推送
			return
		}
		var pending []*mygo.Window
		mu.Lock()
		for w, e := range byWindow {
			if e.sync.NeedsFlush() {
				pending = append(pending, w)
			}
		}
		mu.Unlock()
		if len(pending) == 0 {
			quitting.Store(true)
			return
		}
		ev.PreventDefault()
		go func() {
			var wg sync.WaitGroup
			for _, w := range pending {
				wg.Add(1)
				go func(w *mygo.Window) { defer wg.Done(); FlushWindow(w) }(w)
			}
			wg.Wait()
			mygo.App.Quit() // 第二次进入时已无需收齐，放行给 mygo
		}()
	})
	mygo.App.OnQuitCanceled(func() { quitting.Store(false) })
}

// ReadyInfo 是页面启动时拿到的上下文（技术方案 3.4 节）。
type ReadyInfo struct {
	DocToken  string `json:"docToken"`
	AssetBase string `json:"assetBase"`
	Dir       string `json:"dir"`
	Name      string `json:"name"`
	Untitled  bool   `json:"untitled"`
	ReadOnly  bool   `json:"readOnly"`
	Lossy     bool   `json:"lossy"`
	Encoding  string `json:"encoding"`
	EOL       string `json:"eol"`
	Recovered bool   `json:"recovered"`
	Size      int    `json:"size"`
}

// ContentInfo 是正文与当前序号。
type ContentInfo struct {
	Text string `json:"text"`
	Seq  int64  `json:"seq"`
}

// AssetBase 由 assets 包设置：按平台给出 lmasset 协议的 URL 前缀（技术方案 3.5 节）。
var AssetBase = func(token string) string { return "lmasset://localhost/" + token + "/" }

// Service 是绑定给页面的 Session 服务，所有方法按调用者窗口限定作用域。
type Service struct{}

func (Service) entry(ctx context.Context) (*entry, error) {
	if e := entryFor(mygo.CallerWindow(ctx)); e != nil {
		return e, nil
	}
	return nil, ErrNoDocument
}

// Ready 返回页面需要的一次性上下文。
func (s Service) Ready(ctx context.Context) (ReadyInfo, error) {
	e, err := s.entry(ctx)
	if err != nil {
		return ReadyInfo{}, err
	}
	st, c := e.doc.State(), e.doc.Content()
	dir := ""
	if st.Path != "" {
		dir = filepath.Dir(st.Path)
	}
	return ReadyInfo{
		DocToken: e.token, AssetBase: AssetBase(e.token), Dir: dir, Name: st.Name, Untitled: st.Path == "",
		ReadOnly: st.ReadOnly, Lossy: c.Lossy, Encoding: c.Encoding, EOL: c.EOL, Recovered: e.recovered, Size: len(c.Text),
	}, nil
}

// Content 返回正文（初次载入、外部修改重新载入后）。
func (s Service) Content(ctx context.Context) (ContentInfo, error) {
	e, err := s.entry(ctx)
	if err != nil {
		return ContentInfo{}, err
	}
	return ContentInfo{Text: e.doc.Content().Text, Seq: e.sync.Seq()}, nil
}

// MarkDirty：页面出现未推送的编辑，立即让文档进入「已编辑」（外部修改时进入冲突而不是被冲掉）。
func (s Service) MarkDirty(ctx context.Context, seq int64) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	if e.doc.Content().Lossy {
		return nil
	}
	if e.sync.MarkDirty(seq) {
		e.doc.SetEdited(true)
	}
	return nil
}

// SetContent 带序号推送正文，过期的推送被丢弃。返回是否应用。
func (s Service) SetContent(ctx context.Context, seq int64, text string) (bool, error) {
	e, err := s.entry(ctx)
	if err != nil {
		return false, err
	}
	if e.doc.Content().Lossy {
		return false, doc.ErrLossy
	}
	return e.sync.Accept(seq, func() {
		c := e.doc.Content()
		c.Text = text
		e.doc.Set(c)
	}), nil
}

// Flushed 回应收齐请求 n。
func (s Service) Flushed(ctx context.Context, n int64) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	e.sync.Flushed(n)
	return nil
}

// Revert 重新读盘，丢弃本地编辑（只供提示条调用，提示条本身就是确认）。
func (s Service) Revert(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	return e.doc.Revert()
}

// SaveAnyway：冲突时「保留我的版本」。
func (s Service) SaveAnyway(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	return e.doc.SaveAnyway()
}

// Save：页面发起的保存（菜单保存走 Go 侧，先收齐）。
func (s Service) Save(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	return e.doc.Save()
}
