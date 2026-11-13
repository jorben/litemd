// LiteMd：一个文件一个窗口的 Markdown 查看与编辑器。
package main

import (
	"log"
	"time"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/cli"
	"github.com/jorben/litemd/internal/doc"
	"github.com/jorben/litemd/internal/session"
	"github.com/jorben/litemd/internal/start"
)

func main() {
	if !mygo.App.RequestSingleInstanceLock() { // F1.3
		return
	}
	// 以下两项必须在 NewDocuments 之前注册：mygo 的退出处理和打开文件处理在 NewDocuments 里注册，
	// 收齐和启动窗口的计数要排在它们前面（技术方案 3.1、5.3 节）。
	session.InstallQuitFlush()
	start.TrackOpenFiles()

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
		AutosaveDelay: time.Second, // F2.2：约 1 秒
		NoUntitled:    true,        // F1.9 / D7：不自动新建，显示启动窗口
	})
	cli.Install(func(p string) error { _, err := docs.Open(p); return err }, start.Expect) // F1.5
	start.Install(docs)                                                                    // F1.12
	mygo.BindAs("Session", session.Service{})
	mygo.BindAs("Start", start.Service{})
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
		BackgroundColor: "light-dark(#ffffff, #1e1e1e)", // 避免白屏闪烁
	}
	if f := focusedDocWindow(); f != nil { // F1.8：相对当前窗口向右下层叠
		x, y := f.Position()
		opts.X, opts.Y = x+24, y+24
	}
	w := mygo.NewWindow(opts)
	session.Attach(w, d, recovered) // OnClose 收齐：mygo 在本函数返回后才 attach，所以排在它前面
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
