package session

// hold.go：竞态冲突的暂停（技术方案 5.4 节）。页面收到 onDocumentReload 时自己还有未推送的编辑，就不载入磁盘内容、
// 暂停推送，并调用 Session.holdConflict()。在用户选定版本之前，Go 侧不重新标记已编辑、不发起收齐（否则自动保存
// 会反复写盘）；关窗和退出时先在窗口上弹模态对话框，问保留哪个版本。
// Go 侧结束暂停时（对话框、菜单「还原」）发 conflictResolved 告诉页面：关窗或退出之后还可能被取消，
// 页面不能一直停在暂停里。

import (
	"errors"
	"log"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/l10n"
)

// closeAction 是关窗监听对一次关闭的处理。
type closeAction int

const (
	closeAllow   closeAction = iota // 放行给 mygo
	closeFlush                      // 先收齐，再关一次
	closeAskHeld                    // 竞态冲突暂停中：先问保留哪个版本，再关一次
)

// closeActionFor 决定关窗怎么处理。应用正在退出时一律放行：阻止会取消整个退出，暂停中的窗口已在退出监听里问过。
// approved 表示上一轮已处理完（收齐或用户已选定版本），这次放行。
func closeActionFor(quitting, approved bool, s *Sync) closeAction {
	switch {
	case quitting || approved:
		return closeAllow
	case s.Held():
		return closeAskHeld
	case s.NeedsFlush():
		return closeFlush
	}
	return closeAllow
}

// shouldRemark 判断文档变回「未编辑」时是否要重新标记已编辑并收齐（自动保存早于页面推送，M0 报告 V2）。
// 竞态冲突暂停中页面不推送，重新标记只会让自动保存反复写盘。
func shouldRemark(edited, lossy bool, s *Sync) bool {
	return !edited && !lossy && !s.Held() && s.NeedsFlush()
}

// heldChoice 是用户在竞态冲突对话框里的选择。
type heldChoice int

const (
	heldCancel   heldChoice = iota // 取消关窗或退出
	heldKeepMine                   // 保留我的版本：强制收齐后覆盖磁盘
	heldLoadDisk                   // 载入磁盘版本：丢弃页面的编辑，不保存
)

// heldButtons 是对话框按钮，顺序与 heldChoiceFor 的下标对应。
func heldButtons() []string {
	return []string{l10n.T("保留我的版本"), l10n.T("载入磁盘版本"), l10n.T("取消")}
}

// heldChoiceFor 把对话框结果换成选择；出错（窗口已关等）按取消处理。
func heldChoiceFor(button int, err error) heldChoice {
	if err != nil {
		return heldCancel
	}
	switch button {
	case 0:
		return heldKeepMine
	case 1:
		return heldLoadDisk
	}
	return heldCancel
}

// askHeld 在窗口上弹模态对话框，问保留哪个版本。不可在主线程调用。
func askHeld(w *mygo.Window, e *entry) heldChoice {
	w.Show()
	w.Focus()
	r, err := mygo.Dialog.Message(mygo.MessageOptions{Parent: w, Type: mygo.MessageWarning,
		Message: l10n.F("「%s」在磁盘上已被修改", e.doc.State().Name), Detail: l10n.T("你在这里还有未保存的改动。选择保留哪个版本。"),
		Buttons: heldButtons(), DefaultButton: 0, CancelButton: 2})
	return heldChoiceFor(r.Button, err)
}

// resolveHeld 执行用户的选择，返回是否可以继续关窗或退出。不可在主线程调用。
func resolveHeld(w *mygo.Window, e *entry, c heldChoice) bool {
	switch c {
	case heldKeepMine:
		// 页面暂停推送：强制收齐，让页面即使暂停也推送本地内容。收不齐就不关，避免用磁盘内容覆盖用户的编辑
		if !e.sync.ForceFlush(func(n int64) error { return Flush.Emit(w, FlushRequest{N: n, Force: true}) }, FlushTimeout) {
			debugf("held: forced flush of window %d timed out", w.ID())
			return false
		}
		if err := e.doc.SaveAnyway(); err != nil {
			if !errors.Is(err, mygo.ErrCanceled) {
				log.Printf("session: save anyway: %v", err)
				_, _ = mygo.Dialog.Message(mygo.MessageOptions{Parent: w, Type: mygo.MessageError,
					Message: l10n.F("没有保存「%s」", e.doc.State().Name), Detail: err.Error()})
			}
			return false
		}
		notifyResolved(w, heldKeepMine, e.sync.Release())
		return true
	case heldLoadDisk:
		// Go 侧的内容已是磁盘版本（mygo 重新读盘后页面才暂停），只是页面没有载入
		wasHeld := e.sync.Discard()
		e.doc.SetEdited(false) // 不保存：mygo 看到未编辑就直接关窗或退出，并删除恢复副本
		notifyResolved(w, heldLoadDisk, wasHeld)
		return true
	}
	return false
}

// resolutionFor 返回 Go 侧结束暂停后要发给页面的结果。之前不在暂停中（页面已用提示条处理过、或从未暂停）
// 或用户取消时不发送。
func resolutionFor(c heldChoice, wasHeld bool) (ConflictResolution, bool) {
	if !wasHeld {
		return ConflictResolution{}, false
	}
	switch c {
	case heldKeepMine:
		return ConflictResolution{Choice: ConflictKeep}, true
	case heldLoadDisk:
		return ConflictResolution{Choice: ConflictDisk}, true
	}
	return ConflictResolution{}, false
}

// notifyResolved 把 Go 侧结束暂停的结果发给窗口的页面（conflictResolved 事件）。
func notifyResolved(w *mygo.Window, c heldChoice, wasHeld bool) {
	r, ok := resolutionFor(c, wasHeld)
	if !ok {
		return
	}
	if err := ConflictResolved.Emit(w, r); err != nil {
		debugf("held: conflictResolved to window %d: %v", w.ID(), err)
	}
}

// askAndResolveHeld 问一个暂停中的窗口并执行选择。同一窗口已有对话框时（关窗与退出同时发生）按取消处理。
func askAndResolveHeld(w *mygo.Window, e *entry) bool {
	if !e.asking.CompareAndSwap(false, true) {
		return false
	}
	defer e.asking.Store(false)
	return resolveHeld(w, e, askHeld(w, e))
}
