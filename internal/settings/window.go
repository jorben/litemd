package settings

import "github.com/egoist/mygo"

var win *mygo.Window

// ShowWindow 打开设置窗口（PRD F10）；全局只有一个，已打开则聚焦。须在主线程调用（菜单回调）。
// harden 由 main 注入（links.Harden）。
func ShowWindow(harden func(*mygo.Window)) {
	if win != nil && !win.IsDestroyed() {
		win.Show()
		win.Focus()
		return
	}
	w := mygo.NewWindow(mygo.WindowOptions{
		Title:           "设置",
		URL:             "/#/settings",
		Width:           600,
		Height:          540,
		DisableResize:   true,
		DisableMaximize: true,
		BackgroundColor: "light-dark(#ffffff, #1e1e1e)",
		StateKey:        "settings",
	})
	if harden != nil {
		harden(w)
	}
	w.OnClosed(func() {
		if win == w {
			win = nil
		}
	})
	win = w
}
