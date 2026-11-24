// Package defaultapp 查询并设置 LiteMd 是否为 Markdown 文件的默认应用（设置 › 通用 › 默认 Markdown 应用）。
//
// mygo 的 fileAssociations 只声明 LiteMd「能打开」这些文件：用户或其他应用已经选过默认应用时，
// 系统不会因为安装了 LiteMd 就改用它，应用也不应自行抢占。这里在用户点击「设为默认」后才修改。
// mygo 只有查询（Shell.DefaultApp），没有设置文件类型默认应用的接口，所以各平台自己实现：
// 目前只有 macOS（NSWorkspace，经 purego/objc 调用），其他平台 Supported 为 false，设置页不显示这一项。
package defaultapp

import (
	"context"
	"errors"

	"github.com/egoist/mygo"
)

// Exts 与 mygo.config.ts 的 fileAssociations 一致。
var Exts = []string{"md", "markdown", "mdown", "mkd"}

// DefaultStatus 是设置页看到的状态。
type DefaultStatus struct {
	Supported bool   `json:"supported"` // 本平台、本构建能设置（开发版不声明文件类型，也为 false）
	IsDefault bool   `json:"isDefault"` // 全部 Markdown 扩展名都由 LiteMd 打开
	Current   string `json:"current"`   // 不是 LiteMd 时，当前打开 .md 的应用名称；没有默认应用时为空
}

// handler 是某个文件类型当前的默认应用。ID 为空表示没有。
type handler struct{ ID, Name string }

// evaluate 由各文件类型的默认应用得出状态。hs 按 Exts 的顺序（第一个是 .md）。
func evaluate(self string, hs []handler) DefaultStatus {
	st := DefaultStatus{Supported: true, IsDefault: len(hs) > 0}
	for _, h := range hs {
		if h.ID == self {
			continue
		}
		st.IsDefault = false
		if st.Current == "" {
			st.Current = h.Name
		}
	}
	return st
}

// ErrNoWindow：只有应用自己的窗口能调用。
var ErrNoWindow = errors.New("defaultapp: 只有应用窗口能调用")

// ErrUnsupported：本平台或本构建不能设置默认应用。
var ErrUnsupported = errors.New("defaultapp: 不支持设置默认应用")

// Service 是绑定给设置页的服务。
type Service struct{}

// Status 返回 LiteMd 是否为 Markdown 文件的默认应用。
func (Service) Status(ctx context.Context) (DefaultStatus, error) {
	if mygo.CallerWindow(ctx) == nil {
		return DefaultStatus{}, ErrNoWindow
	}
	return status()
}

// SetDefault 把 LiteMd 设为全部 Markdown 扩展名的默认应用，返回设置后的状态。
func (Service) SetDefault(ctx context.Context) (DefaultStatus, error) {
	if mygo.CallerWindow(ctx) == nil {
		return DefaultStatus{}, ErrNoWindow
	}
	if err := setDefault(); err != nil {
		return DefaultStatus{}, err
	}
	return status()
}
