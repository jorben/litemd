package session

import (
	"errors"
	"testing"
)

// 关窗：退出中、已放行时一律放行；暂停中先问；否则按需收齐（技术方案 5.3、5.4 节）。
func TestCloseActionFor(t *testing.T) {
	held := NewSync()
	held.MarkDirty(1)
	held.Hold()
	dirty := NewSync()
	dirty.MarkDirty(1)
	clean := NewSync()
	cases := []struct {
		name               string
		quitting, approved bool
		s                  *Sync
		want               closeAction
	}{
		{"退出中的暂停窗口不阻止", true, false, held, closeAllow},
		{"已选定版本后放行", false, true, held, closeAllow},
		{"暂停中先问", false, false, held, closeAskHeld},
		{"有未推送编辑先收齐", false, false, dirty, closeFlush},
		{"退出中不收齐", true, false, dirty, closeAllow},
		{"已同步直接放行", false, false, clean, closeAllow},
	}
	for _, c := range cases {
		if got := closeActionFor(c.quitting, c.approved, c.s); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

// 状态钩子：暂停中不重新标记已编辑，避免自动保存反复写盘。
func TestShouldRemark(t *testing.T) {
	s := NewSync()
	s.MarkDirty(1)
	if !shouldRemark(false, false, s) {
		t.Fatal("未编辑且有未推送编辑时应重新标记")
	}
	if shouldRemark(true, false, s) || shouldRemark(false, true, s) {
		t.Fatal("已编辑或有损文档不重新标记")
	}
	s.Hold()
	if shouldRemark(false, false, s) {
		t.Fatal("暂停中不应重新标记")
	}
	s.Release()
	s.Discard()
	if shouldRemark(false, false, s) {
		t.Fatal("丢弃后不应重新标记")
	}
}

// Go 侧结束暂停时才通知页面；取消、或之前不在暂停中（页面已用提示条处理）不发送，避免重复处理。
func TestResolutionFor(t *testing.T) {
	cases := []struct {
		c       heldChoice
		wasHeld bool
		want    string
		ok      bool
	}{
		{heldKeepMine, true, ConflictKeep, true},
		{heldLoadDisk, true, ConflictDisk, true},
		{heldCancel, true, "", false},
		{heldKeepMine, false, "", false},
		{heldLoadDisk, false, "", false},
	}
	for _, c := range cases {
		r, ok := resolutionFor(c.c, c.wasHeld)
		if ok != c.ok || r.Choice != c.want {
			t.Errorf("choice %d held %v: got %q %v want %q %v", c.c, c.wasHeld, r.Choice, ok, c.want, c.ok)
		}
	}
}

func TestHeldChoiceFor(t *testing.T) {
	if len(heldButtons()) != 3 {
		t.Fatal("对话框应有三个按钮")
	}
	cases := []struct {
		button int
		err    error
		want   heldChoice
	}{{0, nil, heldKeepMine}, {1, nil, heldLoadDisk}, {2, nil, heldCancel}, {0, errors.New("closed"), heldCancel}}
	for _, c := range cases {
		if got := heldChoiceFor(c.button, c.err); got != c.want {
			t.Errorf("button %d err %v: got %d want %d", c.button, c.err, got, c.want)
		}
	}
}
