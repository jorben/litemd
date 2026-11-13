package menu

import (
	"strings"
	"testing"
)

// 每个平台的加速键不能重复（D9、docs/keybindings.md）。
func TestNoDuplicateAccelerators(t *testing.T) {
	for _, mac := range []bool{true, false} {
		seen := map[string]string{}
		Walk(Build(mac), func(s Spec) {
			if s.Accel == "" {
				return
			}
			k := strings.ToLower(s.Accel)
			if prev, ok := seen[k]; ok {
				t.Errorf("mac=%v: %s 同时用于 %s 和 %s", mac, s.Accel, prev, s.ID)
			}
			seen[k] = s.ID
		})
	}
}

// 与 mygo 自带角色的快捷键也不能冲突（⌘N ⌘O ⌘W ⌘Q ⌘X ⌘C ⌘V ⌘A ⌘M ⌘H）。
func TestNoClashWithRoles(t *testing.T) {
	reserved := map[string]bool{"cmdorctrl+n": true, "cmdorctrl+o": true, "cmdorctrl+w": true, "cmdorctrl+q": true,
		"cmdorctrl+x": true, "cmdorctrl+c": true, "cmdorctrl+v": true, "cmdorctrl+a": true, "cmdorctrl+m": true, "cmdorctrl+h": true}
	Walk(Build(true), func(s Spec) {
		if reserved[strings.ToLower(s.Accel)] {
			t.Errorf("%s 占用了系统角色的快捷键 %s", s.ID, s.Accel)
		}
	})
}

// 平台差异（D9）：macOS 另存为 ⌥⇧⌘S、副本 ⇧⌘S；Windows/Linux 另存为 Ctrl+Shift+S、没有副本。
func TestPlatformFileMenu(t *testing.T) {
	acc := func(mac bool) map[string]string {
		m := map[string]string{}
		Walk(Build(mac), func(s Spec) { m[s.ID] = s.Accel })
		return m
	}
	m, w := acc(true), acc(false)
	if m["save-as"] != "CmdOrCtrl+Alt+Shift+S" || m["duplicate"] != "CmdOrCtrl+Shift+S" {
		t.Fatalf("mac: %q %q", m["save-as"], m["duplicate"])
	}
	if w["save-as"] != "CmdOrCtrl+Shift+S" {
		t.Fatalf("win save-as: %q", w["save-as"])
	}
	if _, ok := w["duplicate"]; ok {
		t.Fatal("Windows 不应有副本")
	}
	if _, ok := w["settings"]; !ok {
		t.Fatal("Windows 设置在文件菜单")
	}
}

func TestEnabled(t *testing.T) {
	find := func(id string) Spec {
		var out Spec
		Walk(Build(true), func(s Spec) {
			if s.ID == id {
				out = s
			}
		})
		return out
	}
	pv := PageState{Mode: "preview", Editable: true}
	wy := PageState{Mode: "wysiwyg", Editable: true}
	src := PageState{Mode: "source", Editable: true}
	lossy := PageState{Mode: "preview", Lossy: true}
	ro := PageState{Mode: "preview"}
	cases := []struct {
		id    string
		isDoc bool
		st    PageState
		want  bool
	}{
		{"save", false, pv, false},   // 启动窗口里保存类置灰
		{"save", true, lossy, false}, // 非 UTF-8 文档保存类置灰
		{"save", true, pv, true},
		{"bold", true, pv, false},  // 预览中不能格式化（D15）
		{"bold", true, src, false}, // 源码模式不用 WYSIWYG 格式命令
		{"bold", true, wy, true},
		{"undo", true, pv, false},
		{"undo", true, src, true},
		{"replace", true, pv, false}, // F7.3：预览只能查找
		{"find", true, pv, true},
		{"mode-wysiwyg", true, ro, false}, // 只读文件不能编辑
		{"mode-source", true, ro, true},
		{"mode-source", true, lossy, false},
		{"settings", false, pv, true},
	}
	for _, c := range cases {
		if got := Enabled(find(c.id), c.isDoc, c.st); got != c.want {
			t.Errorf("%s isDoc=%v %+v: got %v want %v", c.id, c.isDoc, c.st, got, c.want)
		}
	}
}
