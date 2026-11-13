// LiteMd：一个文件一个窗口的 Markdown 查看与编辑器。
package main

import (
	"errors"
	"log"
	"time"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/assets"
	"github.com/jorben/litemd/internal/cli"
	"github.com/jorben/litemd/internal/doc"
	"github.com/jorben/litemd/internal/filestate"
	"github.com/jorben/litemd/internal/links"
	"github.com/jorben/litemd/internal/menu"
	"github.com/jorben/litemd/internal/session"
	"github.com/jorben/litemd/internal/settings"
	"github.com/jorben/litemd/internal/start"
)

func main() {
	if !mygo.App.RequestSingleInstanceLock() { // F1.3
		return
	}
	settings.Load() // 自动保存模式只能在 NewDocuments 时设定（D11）
	filestate.Load(settings.Default.Get().RestoreWindow)
	assets.CurrentRule = func() assets.Rule {
		st := settings.Default.Get()
		return assets.Rule{Kind: st.ImageRule, Custom: st.ImageCustom}
	}
	// 以下两项必须在 NewDocuments 之前注册：mygo 的退出处理和打开文件处理在 NewDocuments 里注册，
	// 收齐和启动窗口的计数要排在它们前面（技术方案 3.1、5.3 节）。
	session.InstallQuitFlush()
	start.TrackOpenFiles()
	assets.Register() // lmasset 协议须在建窗口前注册

	var docs *session.Docs
	docs = mygo.NewDocuments(mygo.DocumentsOptions[doc.MdContent]{
		Types: []mygo.DocumentType{
			{Name: "Markdown Document", Extensions: []string{"md", "markdown", "mdown", "mkd"}},
			{Name: "Plain Text", Extensions: []string{"txt"}}, // 只用于打开对话框；不在 fileAssociations 里
		},
		New:           doc.New,
		Read:          doc.Read,
		Write:         doc.Write,
		Equal:         doc.Equal,
		Window:        newDocWindow,
		Autosave:      settings.AutosaveMode(), // D2 默认开启
		AutosaveDelay: time.Second,             // F2.2：约 1 秒
		NoUntitled:    true,                    // F1.9 / D7：不自动新建，显示启动窗口
	})
	cli.Install(func(p string) error { _, err := docs.Open(p); return err }, start.Expect) // F1.5
	start.Install(docs)                                                                    // F1.12
	session.OpenPath = func(p string) error { _, err := docs.Open(p); return err }
	installMenu()
	mygo.BindAs("Session", session.Service{})
	mygo.BindAs("Start", start.Service{})
	mygo.BindAs("Assets", assets.Service{})
	mygo.BindAs("Links", links.Service{})
	mygo.BindAs("Shell", links.ShellService{})
	mygo.BindAs("Settings", settings.Service{})
	mygo.BindAs("FileState", filestate.Service{})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// newDocWindow 创建文档窗口（技术方案 3.3 节）。
func newDocWindow(d *session.Document) *mygo.Window {
	// mygo 从恢复副本重建的文档，在这里已是「已编辑」；正常打开的不是（D10）
	recovered := d.State().Edited
	opts := mygo.WindowOptions{
		URL:             "/",
		Width:           880,
		Height:          1000,
		MinWidth:        420,
		MinHeight:       320,
		BackgroundColor: "light-dark(#ffffff, #1e1e1e)",      // 避免白屏闪烁
		StateKey:        filestate.WindowKey(d.State().Path), // 按文件记住窗口（未命名为空）；有记录时覆盖层叠位置
	}
	if f := focusedDocWindow(); f != nil { // F1.8：相对当前窗口向右下层叠
		x, y := f.Position()
		opts.X, opts.Y = x+24, y+24
	}
	w := mygo.NewWindow(opts)
	session.Attach(w, d, recovered) // OnClose 收齐：mygo 在本函数返回后才 attach，所以排在它前面
	links.Harden(w)                 // 第 7 节：导航拦截、新窗口处理、权限拒绝
	assets.TrackDrops(w)            // 拖入路径登记
	start.DocumentShown()           // 任何文档窗口出现就关掉启动窗口（F1.12②）
	return w
}

func focusedDocWindow() *mygo.Window {
	w := mygo.FocusedWindow()
	if w == nil || w == start.Window() {
		return nil
	}
	return w
}

// installMenu 自建菜单（技术方案 3.6 节）：保存类命令先收齐页面内容，再调用 mygo 的文档操作。
func installMenu() {
	menu.IsDocWindow = func(w *mygo.Window) bool { return session.ForWindow(w) != nil }
	menu.StateOf = func(w *mygo.Window) (menu.PageState, bool) {
		v, ok := session.PageStateOf(w)
		st, _ := v.(session.MenuState)
		return menu.PageState{Mode: st.Mode, Editable: st.Editable, Lossy: st.Lossy, Outline: st.Outline, Status: st.Statusbar}, ok
	}
	session.OnMenuState = menu.Refresh
	start.OnFocus = menu.Refresh
	start.Harden = links.Harden
	// docOp 收齐后在 goroutine 里执行文档操作；取消不算错误，其余错误 mygo 已弹框
	docOp := func(op func(d *session.Document) error) func(w *mygo.Window) {
		return func(w *mygo.Window) {
			d := session.ForWindow(w)
			if d == nil {
				return
			}
			go func() {
				session.FlushWindow(w)
				if err := op(d); err != nil && !errors.Is(err, mygo.ErrCanceled) {
					log.Printf("menu: %v", err)
				}
			}()
		}
	}
	toPage := func(id string) func(w *mygo.Window) {
		return func(w *mygo.Window) {
			if session.ForWindow(w) != nil {
				go func() { session.FlushWindow(w); _ = menu.Command.Emit(w, menu.CommandRequest{ID: id}) }()
			}
		}
	}
	notYet := func(id string) func(*mygo.Window) {
		return func(*mygo.Window) { log.Printf("menu: %s 尚未实现（M2）", id) }
	}
	menu.Install(menu.Handlers{
		"save":      docOp(func(d *session.Document) error { return d.Save() }),
		"duplicate": docOp(func(d *session.Document) error { d.Duplicate(); return nil }),
		"save-as":   docOp(func(d *session.Document) error { return d.SaveAs("") }),
		"rename":    docOp(func(d *session.Document) error { return d.Rename("") }),
		"move-to":   docOp(func(d *session.Document) error { return d.MoveTo("") }),
		"revert": docOp(func(d *session.Document) error {
			// 还原前用 LiteMd 自己的文案确认（Document.Revert 本身不询问）
			r, err := mygo.Dialog.Message(mygo.MessageOptions{Parent: d.Window(), Type: mygo.MessageWarning,
				Message: "将「" + d.State().Name + "」还原到上次保存的版本？", Detail: "当前未保存的改动会丢失。",
				Buttons: []string{"还原", "取消"}, DefaultButton: 0, CancelButton: 1, DestructiveButtons: []int{0}})
			if err != nil || r.Button != 0 {
				return err
			}
			return d.Revert()
		}),
		// 导出与打印：页面生成 HTML 后调用 Export 服务（M2）
		"export-html":  toPage("export-html"),
		"export-pdf":   toPage("export-pdf"),
		"print":        toPage("print"),
		"settings":     notYet("settings"),
		"about":        notYet("about"),
		"check-update": notYet("check-update"),
		"install-cli":  notYet("install-cli"),
		"help":         notYet("help"),
		"syntax":       notYet("syntax"),
		"keybindings":  notYet("keybindings"),
	})
}
