// Package menu 定义 LiteMd 的菜单与快捷键（技术方案 3.6 节，docs/keybindings.md）。
//
// spec.go 是与 mygo 无关的菜单表，便于测试（快捷键不冲突、每个页面命令都有处理）。
// 菜单项分三类：
//   - Role：mygo 自带的行为（新建、打开、最近打开、关闭、剪切复制粘贴、窗口菜单等）；
//   - Go：在 Go 侧执行，保存类命令先收齐页面内容（第 5.3 节）；
//   - Page：通过 command 事件发给当前窗口的页面，由页面的命令注册表执行。
package menu

// Kind 是菜单项的执行方式。
type Kind int

const (
	KindRole Kind = iota
	KindGo
	KindPage
	KindSeparator
	KindSubmenu
)

// Spec 是一个菜单项。
type Spec struct {
	ID    string // Go / Page 命令的 ID
	Label string
	Kind  Kind
	Role  string // KindRole 时的 mygo MenuRole
	// Accel 是 mygo 加速键写法，如 "CmdOrCtrl+S"；空表示没有
	Accel string
	// NeedsDoc：只在当前窗口是文档窗口时可用
	NeedsDoc bool
	// Editing：只在可编辑（所见即所得、源码、分屏，且文档可写）时可用
	Editing bool
	// WYSIWYG：只在所见即所得模式可用（段落、格式）
	WYSIWYG bool
	Items   []Spec
}

func sep() Spec                  { return Spec{Kind: KindSeparator} }
func role(r string) Spec         { return Spec{Kind: KindRole, Role: r} }
func roleL(r, label string) Spec { return Spec{Kind: KindRole, Role: r, Label: label} }
func goCmd(id, label, accel string) Spec {
	return Spec{ID: id, Label: label, Kind: KindGo, Accel: accel, NeedsDoc: true}
}
func page(id, label, accel string) Spec {
	return Spec{ID: id, Label: label, Kind: KindPage, Accel: accel, NeedsDoc: true}
}
func edit(id, label, accel string) Spec { s := page(id, label, accel); s.Editing = true; return s }
func wys(id, label, accel string) Spec  { s := edit(id, label, accel); s.WYSIWYG = true; return s }
func sub(label string, items ...Spec) Spec {
	return Spec{Label: label, Kind: KindSubmenu, Items: items}
}

// Build 返回某个平台的菜单栏。mac 为 true 时按 macOS 惯例（D9）。
func Build(mac bool) []Spec {
	file := []Spec{
		roleL("new", "新建"),
		roleL("open", "打开…"),
		roleL("openRecent", "打开最近"),
		sep(),
	}
	if mac {
		file = append(file,
			roleL("close", "关闭"),
			goCmd("save", "保存", "CmdOrCtrl+S"),
			goCmd("duplicate", "副本", "CmdOrCtrl+Shift+S"),
			goCmd("save-as", "另存为…", "CmdOrCtrl+Alt+Shift+S"),
			goCmd("rename", "重命名…", ""),
			goCmd("move-to", "移动到…", ""),
			goCmd("revert", "还原到上次保存的版本…", ""),
		)
	} else {
		file = append(file,
			goCmd("save", "保存", "CmdOrCtrl+S"),
			goCmd("save-as", "另存为…", "CmdOrCtrl+Shift+S"),
			goCmd("revert", "还原", ""),
		)
	}
	file = append(file, sep(),
		goCmd("export-html", "导出 HTML…", ""),
		goCmd("export-pdf", "导出 PDF…", ""),
		goCmd("print", "打印…", "CmdOrCtrl+P"),
	)
	if !mac {
		file = append(file, sep(),
			Spec{ID: "settings", Label: "设置…", Kind: KindGo, Accel: "CmdOrCtrl+,"},
			sep(), roleL("close", "关闭"), roleL("quit", "退出"))
	}

	editMenu := []Spec{
		edit("undo", "撤销", "CmdOrCtrl+Z"),
		edit("redo", "重做", map[bool]string{true: "CmdOrCtrl+Shift+Z", false: "CmdOrCtrl+Y"}[mac]),
		sep(),
		roleL("cut", "剪切"), roleL("copy", "拷贝"), roleL("paste", "粘贴"),
		edit("paste-plain", "粘贴为纯文本", "CmdOrCtrl+Alt+Shift+V"),
		roleL("selectAll", "全选"),
		sep(),
		page("find", "查找…", "CmdOrCtrl+F"),
		edit("replace", "替换…", "CmdOrCtrl+Alt+F"),
		page("find-next", "查找下一个", "CmdOrCtrl+G"),
		page("find-prev", "查找上一个", "CmdOrCtrl+Shift+G"),
	}

	para := []Spec{}
	for _, l := range []string{"1", "2", "3", "4", "5", "6"} {
		para = append(para, wys("heading-"+l, "标题 "+l, "CmdOrCtrl+Alt+"+l))
	}
	para = append(para,
		wys("paragraph", "正文", "CmdOrCtrl+Alt+0"),
		sep(),
		wys("bullet-list", "无序列表", "CmdOrCtrl+Shift+8"),
		wys("ordered-list", "有序列表", "CmdOrCtrl+Shift+7"),
		wys("task-list", "任务列表", "CmdOrCtrl+Shift+9"),
		wys("blockquote", "引用", "CmdOrCtrl+Shift+."),
		wys("code-block", "代码块", "CmdOrCtrl+Alt+C"),
		wys("table", "表格", "CmdOrCtrl+Alt+T"),
		wys("math-block", "公式块", "CmdOrCtrl+Alt+B"),
		wys("hr", "分隔线", ""),
	)

	format := []Spec{
		wys("bold", "加粗", "CmdOrCtrl+B"),
		wys("italic", "斜体", "CmdOrCtrl+I"),
		wys("strike", "删除线", "CmdOrCtrl+Shift+X"),
		wys("inline-code", "行内代码", "Ctrl+`"),
		wys("link", "链接…", "CmdOrCtrl+K"),
		sep(),
		wys("clear-format", "清除格式", "CmdOrCtrl+\\"),
	}

	view := []Spec{
		page("mode-preview", "预览", "CmdOrCtrl+1"),
		page("mode-wysiwyg", "所见即所得", "CmdOrCtrl+2"),
		page("mode-source", "源码", "CmdOrCtrl+3"),
		page("mode-split", "分屏", "CmdOrCtrl+4"),
		page("toggle-edit", "在预览与编辑之间切换", "CmdOrCtrl+E"),
		sep(),
		page("outline", "大纲", "CmdOrCtrl+Shift+O"),
		page("statusbar", "状态栏", ""),
		sep(),
		page("zoom-in", "放大", "CmdOrCtrl+Plus"),
		page("zoom-out", "缩小", "CmdOrCtrl+-"),
		page("zoom-reset", "实际大小", "CmdOrCtrl+0"),
		sub("正文宽度",
			page("width-narrow", "窄", ""), page("width-medium", "中", ""),
			page("width-wide", "宽", ""), page("width-full", "铺满", "")),
		sep(),
		role("togglefullscreen"),
	}

	help := []Spec{
		{ID: "help", Label: "LiteMd 帮助", Kind: KindGo},
		{ID: "syntax", Label: "Markdown 语法速查", Kind: KindGo},
		{ID: "keybindings", Label: "键盘快捷键", Kind: KindGo},
	}
	if !mac {
		help = append(help, sep(),
			Spec{ID: "check-update", Label: "检查更新…", Kind: KindGo},
			Spec{ID: "about", Label: "关于 LiteMd", Kind: KindGo})
	}

	bar := []Spec{}
	if mac {
		bar = append(bar, sub("LiteMd",
			Spec{ID: "about", Label: "关于 LiteMd", Kind: KindGo},
			Spec{ID: "check-update", Label: "检查更新…", Kind: KindGo},
			sep(),
			Spec{ID: "settings", Label: "设置…", Kind: KindGo, Accel: "CmdOrCtrl+,"},
			sep(),
			Spec{ID: "install-cli", Label: "安装命令行工具…", Kind: KindGo},
			sep(), role("services"), sep(), role("hide"), role("hideOthers"), role("unhide"), sep(), role("quit")))
	}
	bar = append(bar,
		sub("文件", file...),
		sub("编辑", editMenu...),
		sub("段落", para...),
		sub("格式", format...),
		sub("视图", view...),
	)
	if mac {
		bar = append(bar, sub("窗口", role("minimize"), role("zoom"), sep(), role("front"), sep(), role("window")))
	}
	bar = append(bar, sub("帮助", help...))
	return bar
}

// Walk 依次访问所有菜单项（深度优先）。
func Walk(items []Spec, fn func(Spec)) {
	for _, it := range items {
		fn(it)
		if it.Kind == KindSubmenu {
			Walk(it.Items, fn)
		}
	}
}

// PageCommands 返回页面需要处理的全部命令 ID。
func PageCommands(mac bool) []string {
	var out []string
	Walk(Build(mac), func(s Spec) {
		if s.Kind == KindPage {
			out = append(out, s.ID)
		}
	})
	return out
}
