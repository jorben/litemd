// Package update 实现应用内自动更新（PRD F11.4，技术方案 3.9 节）。
// 启动后在后台检查（设置中可关闭）；有新版本时下载并校验签名，然后用提示条告诉所有文档窗口
// 「已下载，重启后完成更新」。检查不上传任何用户数据（mygo 只请求 GitHub Release 的清单）。
package update

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/jorben/litemd/internal/l10n"
)

// Status 是发给页面的更新状态。
type Status struct {
	State   string `json:"state"`   // idle / checking / none / downloading / ready / error / disabled
	Version string `json:"version"` // 新版本号
	Message string `json:"message"`
}

// Changed 在更新状态变化时广播。
var Changed = mygo.NewEvent[Status]("update-status")

var (
	mu  sync.Mutex
	cur = Status{State: "idle"}
	run sync.Mutex
)

func set(s Status) {
	mu.Lock()
	cur = s
	mu.Unlock()
	_ = Changed.Broadcast(s)
}

// Current 返回当前状态。
func Current() Status {
	mu.Lock()
	defer mu.Unlock()
	return cur
}

// Check 检查并下载新版本。manual 为真时（菜单「检查更新…」）把结果用对话框告诉用户。
func Check(manual bool) {
	if !run.TryLock() {
		return
	}
	defer run.Unlock()
	if !mygo.Updater.Enabled() {
		set(Status{State: "disabled"})
		if manual {
			info(l10n.T("当前版本不能自动更新"), l10n.T("开发版本或安装位置不可写时无法自动更新。"))
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	set(Status{State: "checking"})
	up, err := mygo.Updater.Check(ctx)
	if err != nil {
		set(Status{State: "error", Message: err.Error()})
		if manual {
			info(l10n.T("检查更新失败"), err.Error())
		}
		return
	}
	if up == nil {
		set(Status{State: "none"})
		if manual {
			info(l10n.T("LiteMd 已是最新版本"), l10n.F("当前版本 %s", mygo.App.Version()))
		}
		return
	}
	set(Status{State: "downloading", Version: up.Version})
	if err := up.Install(ctx, nil); err != nil {
		set(Status{State: "error", Version: up.Version, Message: err.Error()})
		return
	}
	set(Status{State: "ready", Version: up.Version})
}

func info(msg, detail string) {
	_, _ = mygo.Dialog.Message(mygo.MessageOptions{Type: mygo.MessageInfo, Message: msg, Detail: detail, Buttons: []string{l10n.T("好")}})
}

// Install 在启动后延迟检查一次（enabled 为设置中的「自动检查更新」）。
func Install(enabled func() bool) {
	mygo.App.WhenReady(func() {
		time.AfterFunc(5*time.Second, func() {
			if enabled() {
				Check(false)
			}
		})
	})
}

// ErrNotReady：没有已下载的更新。
var ErrNotReady = errors.New("update: 没有已下载的更新")

// Service 是绑定给页面的 Update 服务。
type Service struct{}

// Status 返回当前更新状态（页面启动时取一次）。
func (Service) Status(context.Context) Status { return Current() }

// Restart：提示条「立即重启」。先让 mygo 正常退出（收齐、保存或保留文档），再启动新版本。
func (Service) Restart(context.Context) error {
	if Current().State != "ready" {
		return ErrNotReady
	}
	mygo.App.Relaunch()
	return nil
}

// Check：关于页「检查更新」。
func (Service) Check(context.Context) { go Check(true) }
