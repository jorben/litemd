package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/doc"
	"github.com/jorben/litemd/internal/l10n"
)

// Docs 是 LiteMd 的文档集合类型。
type Docs = mygo.Documents[doc.MdContent]

// Document 是 LiteMd 的文档类型。
type Document = mygo.Document[doc.MdContent]

// FlushRequest 是发给页面的收齐请求（技术方案 5.3 节）。
// Force：竞态冲突中用户在关窗或退出对话框里选了「保留我的版本」，页面即使暂停推送也要推送（5.4 节）。
type FlushRequest struct {
	N     int64 `json:"n"`
	Force bool  `json:"force,omitempty"`
}

// Flush 事件：页面收到后立即推送未同步的编辑，再调用 Session.flushed(n)。
var Flush = mygo.NewEvent[FlushRequest]("flush")

// ConflictResolution 是 Go 侧结束竞态冲突暂停的结果（技术方案 5.4 节）。
// Choice：keep 是「保留我的版本」，页面恢复推送；disk 是「载入磁盘版本」或菜单「还原」，页面丢弃本地编辑并重新取正文。
type ConflictResolution struct {
	Choice string `json:"choice"`
}

// ConflictResolution.Choice 的取值。
const (
	ConflictKeep = "keep"
	ConflictDisk = "disk"
)

// ConflictResolved 事件：Go 侧（关窗、退出对话框或菜单「还原」）结束了竞态冲突的暂停。页面自己的提示条按钮不触发它。
var ConflictResolved = mygo.NewEvent[ConflictResolution]("conflict-resolved")

// ErrNoDocument：调用者窗口没有对应的文档（例如启动窗口、设置窗口）。
var ErrNoDocument = errors.New("session: 调用者窗口没有文档")

// entry 是一个文档窗口的会话状态。
type entry struct {
	doc       *Document
	sync      *Sync
	token     string
	recovered bool
	stateMu   sync.Mutex
	pageState any         // 页面通过 setMenuState 报告的状态（menu.PageState），菜单据此置灰
	closeOK   atomic.Bool // 已收齐（或已选定版本），下一次关窗放行给 mygo
	asking    atomic.Bool // 正在弹竞态冲突对话框（hold.go）
}

var (
	mu         sync.Mutex
	byWindow   = map[*mygo.Window]*entry{}
	quitting   atomic.Bool // 退出流程已放行：关窗不再拦截（拦截会取消整个退出）
	quitAsking atomic.Bool // 退出前正在逐个询问竞态冲突的窗口
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
		q := quitting.Load()
		switch closeActionFor(q, !q && e.closeOK.Swap(false), e.sync) {
		case closeAllow:
			return
		case closeAskHeld:
			ev.PreventDefault() // 竞态冲突：先问保留哪个版本，选定后再关一次；取消则不关
			if e.asking.Load() {
				return
			}
			go func() {
				if askAndResolveHeld(w, e) {
					e.closeOK.Store(true)
					w.Close()
				}
			}()
		case closeFlush:
			ev.PreventDefault() // mygo 看到已阻止就不处理；收齐后再关一次
			debugf("close: flushing window %d", w.ID())
			go func() {
				FlushWindow(w)
				e.closeOK.Store(true)
				w.Close()
			}()
		}
	})
	w.OnClosed(func() {
		mu.Lock()
		delete(byWindow, w)
		mu.Unlock()
		OnMenuState()
	})
	w.OnFocus(func() { OnMenuState() })
	d.OnStateChange(func(mygo.DocumentState) { OnMenuState() })
	d.OnReload(func() { e.sync.Reset(e.sync.Seq()) })
	// markDirty 的 SetEdited(true) 会启动自动保存计时；若页面推送晚于计时，自动保存写的是上一版内容并把
	// 文档标回「未编辑」。此时页面仍有未推送的编辑：重新标记已编辑，并立即请求收齐（M0 报告 V2）。
	// 竞态冲突暂停中页面不推送，不重新标记（hold.go）。
	d.OnStateChange(func(st mygo.DocumentState) {
		if shouldRemark(st.Edited, d.Content().Lossy, e.sync) {
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

// ForWindow 返回窗口对应的文档（不是文档窗口时为 nil）。
func ForWindow(w *mygo.Window) *Document {
	if e := entryFor(w); e != nil {
		return e.doc
	}
	return nil
}

// PageStateOf 返回窗口最近一次报告的页面状态。
func PageStateOf(w *mygo.Window) (any, bool) {
	e := entryFor(w)
	if e == nil {
		return nil, false
	}
	e.stateMu.Lock()
	defer e.stateMu.Unlock()
	return e.pageState, e.pageState != nil
}

// OnMenuState 由 main 注入：页面状态变化后刷新菜单（在主线程调用）。
var OnMenuState = func() {}

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
// 竞态冲突暂停中的窗口在这里逐个问保留哪个版本（在 mygo 关窗之前；退出中的关窗不能阻止），任一取消就取消退出。
func InstallQuitFlush() {
	mygo.App.OnBeforeQuit(func(ev *mygo.QuitEvent) {
		if ev.SessionEnding {
			quitting.Store(true) // 关机、注销：不能等待，只能依赖最近一次推送
			return
		}
		type heldWindow struct {
			w *mygo.Window
			e *entry
		}
		var held []heldWindow
		var pending []*mygo.Window
		mu.Lock()
		for w, e := range byWindow {
			if e.sync.Held() {
				held = append(held, heldWindow{w, e})
			} else if e.sync.NeedsFlush() {
				pending = append(pending, w)
			}
		}
		mu.Unlock()
		if len(held) == 0 && len(pending) == 0 {
			quitting.Store(true)
			return
		}
		ev.PreventDefault() // mygo 随即触发 OnQuitCanceled，quitting 保持未放行
		if len(held) > 0 {
			if !quitAsking.CompareAndSwap(false, true) {
				return // 上一次退出还在询问
			}
			go func() {
				defer quitAsking.Store(false)
				for _, h := range held {
					if entryFor(h.w) != h.e {
						continue // 窗口已关
					}
					if !h.e.sync.Held() {
						continue // 询问前一个窗口期间，用户已在这个窗口的提示条上做了选择；其余编辑由第二次退出照常收齐
					}
					if !askAndResolveHeld(h.w, h.e) {
						return // 取消：不再退出
					}
				}
				mygo.App.Quit() // 第二次进入时不再有暂停的窗口，其余窗口照常收齐
			}()
			return
		}
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

// Ready 返回页面需要的一次性上下文。刚载入（或重新载入）的页面没有未推送的编辑，也不在暂停中：
// Discard 结束旧页面留下的暂停和待推送序号，否则 held 永远不解除，新页面的 markDirty 也会被当成旧序号丢掉。
func (s Service) Ready(ctx context.Context) (ReadyInfo, error) {
	e, err := s.entry(ctx)
	if err != nil {
		return ReadyInfo{}, err
	}
	e.sync.Discard()
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
// 页面已丢弃未推送的编辑：先 Discard，否则 NeedsFlush 一直为真，状态钩子会让自动保存反复写盘。
func (s Service) Revert(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	e.sync.Discard()
	return e.doc.Revert()
}

// HoldConflict：页面收到 onDocumentReload 时还有未推送的编辑，已暂停推送并显示冲突提示条（技术方案 5.4 节）。
// 解除之前不重新标记已编辑、不发起收齐；关窗和退出时先问保留哪个版本（hold.go）。
func (s Service) HoldConflict(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	e.sync.Hold()
	return nil
}

// SaveAnyway：冲突时「保留我的版本」。页面已恢复推送，结束竞态冲突的暂停。
func (s Service) SaveAnyway(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	e.sync.Release()
	return e.doc.SaveAnyway()
}

// RevertWindow 是菜单「还原到上次保存的版本」：先丢弃页面未推送的编辑（否则自动保存会反复写盘），再重新读盘。
// 竞态冲突暂停中的页面不载入 onDocumentReload（5.4），所以再发 conflictResolved「disk」让它载入；
// 读盘失败时也发，Go 侧已不在暂停中，页面显示 Go 侧的内容。
func RevertWindow(w *mygo.Window, d *Document) error {
	wasHeld := false
	if e := entryFor(w); e != nil {
		wasHeld = e.sync.Discard()
	}
	err := d.Revert()
	notifyResolved(w, heldLoadDisk, wasHeld)
	return err
}

// Save：页面发起的保存（菜单保存走 Go 侧，先收齐）。
func (s Service) Save(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	return e.doc.Save()
}

// MenuState 是页面报告的当前模式与可编辑状态（与 menu.PageState 字段一致）。
type MenuState struct {
	Mode      string `json:"mode"`
	Editable  bool   `json:"editable"`
	Lossy     bool   `json:"lossy"`
	Outline   bool   `json:"outline"`
	Statusbar bool   `json:"statusbar"`
}

// SetMenuState：页面报告当前模式，Go 据此置灰菜单（技术方案 3.4 节）。
func (s Service) SetMenuState(ctx context.Context, st MenuState) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	e.stateMu.Lock()
	e.pageState = st
	e.stateMu.Unlock()
	mygo.App.WhenReady(OnMenuState) // WhenReady 在应用已就绪时于主线程执行
	return nil
}

// SaveAsUTF8：非 UTF-8 文档另存为 UTF-8（技术方案 3.2 节，D14）。不走 mygo 的 SaveAs：
// 那会经过拒绝写回的 Write，也会把当前文档改指向新路径。
func (s Service) SaveAsUTF8(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	return SaveAsUTF8(mygo.CallerWindow(ctx), e.doc)
}

// OpenPath 由 main 注入：打开一个文件（docs.Open）。
var OpenPath = func(string) error { return nil }

// SaveAsUTF8 弹保存对话框，把文档内容以 UTF-8 写到目标路径，关闭当前窗口并打开新文件。
func SaveAsUTF8(w *mygo.Window, d *Document) error {
	st, c := d.State(), d.Content()
	def := doc.UTF8Name(st.Path)
	if st.Path == "" {
		def = st.Name + ".md"
	}
	target, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: w, Title: l10n.T("另存为 UTF-8"), DefaultPath: def,
		Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md", "markdown", "mdown", "mkd", "txt"}}}})
	if err != nil {
		if errors.Is(err, mygo.ErrCanceled) {
			return nil
		}
		return err
	}
	if err := doc.WriteFileAtomic(target, c.UTF8Copy().Encode()); err != nil {
		return err
	}
	// 选了原路径时也先关窗再打开，避免 Open 只聚焦旧窗口
	d.SetEdited(false)
	d.Close()
	return OpenPath(target)
}

// SaveAs：「另存为…」（文件被删除时的提示条等）。先收齐。
func (s Service) SaveAs(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	FlushWindow(mygo.CallerWindow(ctx))
	if err := e.doc.SaveAs(""); err != nil && !errors.Is(err, mygo.ErrCanceled) {
		return err
	}
	return nil
}

// Duplicate：「存储副本」（只读文件提示条）。
func (s Service) Duplicate(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	e.doc.Duplicate()
	return nil
}

// DiscardRecovered：恢复提示条「丢弃，载入磁盘版本」（技术方案 3.3 节，D10）。
// 有路径的文档重新读盘；未命名文档标为未编辑后关窗（mygo 随之删除恢复副本）。
func (s Service) DiscardRecovered(ctx context.Context) error {
	e, err := s.entry(ctx)
	if err != nil {
		return err
	}
	e.recovered = false
	e.sync.Discard()
	if e.doc.State().Path == "" {
		e.doc.SetEdited(false)
		e.doc.Close()
		return nil
	}
	return e.doc.Revert()
}

// State 返回文档的当前状态（页面启动时取一次；之后由 mygo 的 onDocumentState 推送变化）。
func (s Service) State(ctx context.Context) (mygo.DocumentState, error) {
	e, err := s.entry(ctx)
	if err != nil {
		return mygo.DocumentState{}, err
	}
	return e.doc.State(), nil
}
