package menu

import (
	"errors"
	"runtime"

	"github.com/egoist/mygo"
)

// CommandRequest 是发给页面的菜单命令。
type CommandRequest struct {
	ID string `json:"id"`
}

// Command 事件：页面的命令注册表按 ID 执行（技术方案 3.6 节）。
var Command = mygo.NewEvent[CommandRequest]("command")

// PageState 是页面通过 Session.setMenuState 报告的状态，决定哪些菜单项可用。
type PageState struct {
	Mode     string `json:"mode"`     // preview / wysiwyg / source / split
	Editable bool   `json:"editable"` // 文档可写（非只读、非 Lossy）
	Lossy    bool   `json:"lossy"`
	Outline  bool   `json:"outline"`
	Status   bool   `json:"statusbar"`
}

// Handlers 是 Go 侧命令的实现，由 main 注入。参数 w 是命令作用的窗口（可能为 nil）。
type Handlers map[string]func(w *mygo.Window)

// IsMac 报告是否按 macOS 惯例构建菜单。
func IsMac() bool { return runtime.GOOS == "darwin" }

// IsDocWindow 由 main 注入：判断窗口是不是文档窗口。
var IsDocWindow = func(*mygo.Window) bool { return false }

// StateOf 由 main 注入：返回窗口的页面状态。
var StateOf = func(*mygo.Window) (PageState, bool) { return PageState{}, false }

var (
	built  *mygo.Menu
	specs  = map[string]Spec{}
	handle Handlers
)

// Install 构建并设置应用菜单。
func Install(h Handlers) {
	handle = h
	built = mygo.NewMenu(toItems(Build(IsMac())))
	mygo.App.SetMenu(built)
}

func target(w *mygo.Window) *mygo.Window {
	if w != nil {
		return w
	}
	return mygo.FocusedWindow()
}

func toItems(list []Spec) []*mygo.MenuItem {
	out := make([]*mygo.MenuItem, 0, len(list))
	for _, s := range list {
		s := s
		switch s.Kind {
		case KindSeparator:
			out = append(out, mygo.Separator())
		case KindSubmenu:
			out = append(out, &mygo.MenuItem{Label: s.Label, Submenu: toItems(s.Items)})
		case KindRole:
			out = append(out, &mygo.MenuItem{Role: mygo.MenuRole(s.Role), Label: s.Label})
		case KindGo:
			specs[s.ID] = s
			out = append(out, &mygo.MenuItem{ID: s.ID, Label: s.Label, Accelerator: s.Accel,
				Click: func(_ *mygo.MenuItem, w *mygo.Window) {
					if fn := handle[s.ID]; fn != nil {
						fn(target(w))
					}
				}})
		case KindPage:
			specs[s.ID] = s
			out = append(out, &mygo.MenuItem{ID: s.ID, Label: s.Label, Accelerator: s.Accel,
				Click: func(_ *mygo.MenuItem, w *mygo.Window) {
					if t := target(w); t != nil && IsDocWindow(t) {
						_ = Command.Emit(t, CommandRequest{ID: s.ID})
					}
				}})
		}
	}
	return out
}

// Enabled 计算一个菜单项在给定窗口状态下是否可用（纯函数，便于测试）。
func Enabled(s Spec, isDoc bool, st PageState) bool {
	if !s.NeedsDoc {
		return true
	}
	if !isDoc {
		return false
	}
	switch s.ID {
	case "save", "save-as", "duplicate", "rename", "move-to", "revert":
		if st.Lossy && s.ID != "duplicate" {
			return false
		}
	case "mode-wysiwyg", "mode-split":
		return st.Editable
	case "mode-source":
		return !st.Lossy
	case "toggle-edit":
		return !st.Lossy
	}
	if s.Editing && (!st.Editable || st.Mode == "preview") {
		return false
	}
	if s.WYSIWYG && st.Mode != "wysiwyg" {
		return false
	}
	return true
}

// Refresh 按当前聚焦窗口刷新菜单项的可用状态与勾选状态（窗口焦点变化、文档状态变化、setMenuState 时调用）。
func Refresh() {
	if built == nil {
		return
	}
	w := mygo.FocusedWindow()
	if w == nil {
		// 应用尚未激活（如从命令行启动后、切到其他应用时）：不改动菜单，
		// 等窗口获得焦点时 OnFocus 再刷新；否则文档类菜单项会一直置灰
		return
	}
	isDoc := IsDocWindow(w)
	st, _ := StateOf(w)
	for id, s := range specs {
		if it := built.ItemByID(id); it != nil {
			it.SetEnabled(Enabled(s, isDoc, st))
		}
	}
	for id, on := range map[string]bool{"outline": st.Outline, "statusbar": st.Status,
		"mode-preview": st.Mode == "preview", "mode-wysiwyg": st.Mode == "wysiwyg",
		"mode-source": st.Mode == "source", "mode-split": st.Mode == "split"} {
		if it := built.ItemByID(id); it != nil {
			it.SetChecked(isDoc && on)
		}
	}
}

// ErrUnknownCommand：页面报告了不认识的命令。
var ErrUnknownCommand = errors.New("menu: unknown command")
