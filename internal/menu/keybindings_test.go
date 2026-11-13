package menu

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// docs/keybindings.md 由菜单表生成，保证文档与实际快捷键一致。
// 更新：LITEMD_UPDATE_GOLDEN=1 go test ./internal/menu

// roleKeys 是 mygo 菜单角色的系统快捷键（mygo 按平台惯例设置，菜单表里不写）。
var roleKeys = map[string][2]string{
	"new": {"CmdOrCtrl+N", "CmdOrCtrl+N"}, "open": {"CmdOrCtrl+O", "CmdOrCtrl+O"},
	"close": {"CmdOrCtrl+W", "CmdOrCtrl+W"}, "quit": {"CmdOrCtrl+Q", ""}, // Windows 的「退出」没有加速键，Linux 为 Ctrl+Q（见下方说明）
	"cut": {"CmdOrCtrl+X", "CmdOrCtrl+X"}, "copy": {"CmdOrCtrl+C", "CmdOrCtrl+C"},
	"paste": {"CmdOrCtrl+V", "CmdOrCtrl+V"}, "selectAll": {"CmdOrCtrl+A", "CmdOrCtrl+A"},
	"minimize": {"CmdOrCtrl+M", ""}, "hide": {"CmdOrCtrl+H", ""}, "hideOthers": {"CmdOrCtrl+Alt+H", ""},
	"togglefullscreen": {"Ctrl+CmdOrCtrl+F", "F11"},
}

var roleNames = map[string]string{
	"new": "新建", "open": "打开…", "close": "关闭", "quit": "退出", "cut": "剪切", "copy": "拷贝", "paste": "粘贴",
	"selectAll": "全选", "minimize": "最小化", "hide": "隐藏 LiteMd", "hideOthers": "隐藏其他", "togglefullscreen": "进入全屏",
}

// keyText 把 mygo 写法转成显示用的按键：macOS 用 ⌃⌥⇧⌘ 符号，其他平台用 Ctrl+Alt+Shift+键。
func keyText(accel string, mac bool) string {
	if accel == "" {
		return ""
	}
	parts := strings.Split(accel, "+")
	key := parts[len(parts)-1]
	if key == "" { // "CmdOrCtrl+Plus" 之外的 "+" 不会出现；防御
		key = "+"
	}
	if key == "Plus" {
		key = "+"
	}
	has := map[string]bool{}
	for _, m := range parts[:len(parts)-1] {
		has[m] = true
	}
	if mac {
		s := ""
		if has["Ctrl"] {
			s += "⌃"
		}
		if has["Alt"] {
			s += "⌥"
		}
		if has["Shift"] {
			s += "⇧"
		}
		if has["CmdOrCtrl"] {
			s += "⌘"
		}
		return s + key
	}
	var mods []string
	if has["CmdOrCtrl"] || has["Ctrl"] {
		mods = append(mods, "Ctrl")
	}
	if has["Alt"] {
		mods = append(mods, "Alt")
	}
	if has["Shift"] {
		mods = append(mods, "Shift")
	}
	return strings.Join(append(mods, key), "+")
}

func renderKeybindings() string {
	type row struct{ label, mac, other string }
	type section struct {
		title string
		rows  []row
	}
	var secs []section
	index := map[string]int{}
	add := func(menu string, r row) {
		i, ok := index[menu]
		if !ok {
			i = len(secs)
			index[menu] = i
			secs = append(secs, section{title: menu})
		}
		for _, x := range secs[i].rows {
			if x.label == r.label {
				return
			}
		}
		secs[i].rows = append(secs[i].rows, r)
	}
	other := map[string]string{} // ID 或角色 → 其他平台的加速键
	var collect func(items []Spec, mac bool, fn func(Spec))
	collect = func(items []Spec, mac bool, fn func(Spec)) {
		for _, it := range items {
			if it.Kind == KindSubmenu {
				collect(it.Items, mac, fn)
				continue
			}
			fn(it)
		}
	}
	for _, top := range Build(false) {
		collect(top.Items, false, func(s Spec) {
			if s.Kind == KindRole {
				other["role:"+s.Role] = roleKeys[s.Role][1]
			} else if s.ID != "" {
				other[s.ID] = s.Accel
			}
		})
	}
	for _, top := range Build(true) {
		menuName := top.Label
		if menuName == "LiteMd" {
			menuName = "LiteMd（仅 macOS）"
		}
		collect(top.Items, true, func(s Spec) {
			var label, macKey, otherKey string
			switch {
			case s.Kind == KindRole:
				k, ok := roleKeys[s.Role]
				if !ok {
					return
				}
				label = s.Label
				if label == "" {
					label = roleNames[s.Role]
				}
				macKey, otherKey = k[0], other["role:"+s.Role]
			case s.ID != "" && s.Accel != "":
				label, macKey, otherKey = s.Label, s.Accel, other[s.ID]
			default:
				return
			}
			add(menuName, row{label, keyText(macKey, true), keyText(otherKey, false)})
		})
	}

	var b strings.Builder
	b.WriteString(`# LiteMd 键盘快捷键

> 本文件由菜单表生成（` + "`internal/menu/keybindings_test.go`" + `），与应用菜单一致。修改快捷键后运行
> ` + "`LITEMD_UPDATE_GOLDEN=1 go test ./internal/menu`" + ` 更新，CI 会检查它是否过期。

快捷键在菜单与页面里是同一张表：菜单项有加速键，页面在捕获阶段按同一张表处理（` + "`frontend/src/shell/keys.ts`" + `，
由 ` + "`internal/menu/testdata/accelerators.json`" + ` 校验）。「段落」「格式」菜单只在所见即所得模式可用；编辑类命令
在预览和只读文件中不可用。Windows / Linux 一列为「—」的项在该平台没有对应快捷键；「退出」在 Linux 上为
` + "`Ctrl+Q`" + `，Windows 上用 ` + "`Alt+F4`" + ` 关闭窗口。

`)
	for _, s := range secs {
		if len(s.rows) == 0 {
			continue
		}
		fmt.Fprintf(&b, "## %s\n\n| 命令 | macOS | Windows / Linux |\n|---|---|---|\n", s.title)
		for _, r := range s.rows {
			o := r.other
			if o == "" {
				o = "—"
			}
			fmt.Fprintf(&b, "| %s | %s | %s |\n", strings.TrimSuffix(r.label, "…"), code(r.mac), code(o))
		}
		b.WriteString("\n")
	}
	b.WriteString(`## 编辑器内

| 操作 | macOS | Windows / Linux |
|---|---|---|
| 预览中进入所见即所得，光标落在双击处 | 双击正文 | 双击正文 |
| 打开链接（所见即所得） | ` + "`⌘` + 点击" + ` | ` + "`Ctrl` + 点击" + ` |
| 打开链接（预览） | 点击 | 点击 |
| 表格：下一个 / 上一个单元格 | ` + "`Tab` / `⇧Tab`" + ` | ` + "`Tab` / `Shift+Tab`" + ` |
| 查找框：下一个 / 上一个结果 | ` + "`Enter` / `⇧Enter`" + ` | ` + "`Enter` / `Shift+Enter`" + ` |
| 关闭查找框 | ` + "`Esc`" + ` | ` + "`Esc`" + ` |
| 源码模式：添加光标 | ` + "`⌘` + 点击" + ` | ` + "`Ctrl` + 点击" + ` |
| 源码模式：缩进 / 取消缩进 | ` + "`Tab` / `⇧Tab`" + ` | ` + "`Tab` / `Shift+Tab`" + ` |

Markdown 输入规则（所见即所得）：行首输入 ` + "`# `" + `–` + "`###### `" + ` 变标题，` + "`- `" + ` / ` + "`* `" + ` 无序列表，` + "`1. `" + ` 有序列表，
` + "`[ ] `" + ` 任务，` + "`> `" + ` 引用，` + "```` ``` ````" + ` 代码块，` + "`---`" + ` 分隔线；` + "`**粗体**`" + `、` + "`*斜体*`" + `、` + "`` `代码` ``" + `、` + "`~~删除~~`" + ` 输入后转为格式。
`)
	return b.String()
}

// code 把按键写成行内代码；含反引号时用双反引号包住。「—」不加格式。
func code(k string) string {
	if k == "—" {
		return k
	}
	if strings.Contains(k, "`") {
		return "`` " + k + " ``"
	}
	return "`" + k + "`"
}

func TestKeybindingsDoc(t *testing.T) {
	p := filepath.Join("..", "..", "docs", "keybindings.md")
	want := renderKeybindings()
	if os.Getenv("LITEMD_UPDATE_GOLDEN") != "" {
		if err := os.WriteFile(p, []byte(want), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(p)
	if err != nil || string(got) != want {
		t.Fatal("docs/keybindings.md 过期：LITEMD_UPDATE_GOLDEN=1 go test ./internal/menu")
	}
}

func TestKeyText(t *testing.T) {
	cases := map[string][2]string{
		"CmdOrCtrl+Alt+Shift+V": {"⌥⇧⌘V", "Ctrl+Alt+Shift+V"},
		"Ctrl+`":                {"⌃`", "Ctrl+`"},
		"CmdOrCtrl+Plus":        {"⌘+", "Ctrl++"},
		"Ctrl+CmdOrCtrl+F":      {"⌃⌘F", "Ctrl+F"},
	}
	for in, want := range cases {
		if keyText(in, true) != want[0] || keyText(in, false) != want[1] {
			t.Errorf("%s → %s / %s", in, keyText(in, true), keyText(in, false))
		}
	}
}
