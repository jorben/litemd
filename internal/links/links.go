// Package links 处理文档中的链接（PRD F5.5、NF5；技术方案 3.4、7 节）和页面加固：
// 外部链接交给系统浏览器；相对 .md 链接用 LiteMd 新窗口打开；其他本地文件先确认（显示完整路径）；
// 可执行文件一律拒绝。页面只能导航到前端自身，不在应用内开新窗口，权限请求一律拒绝。
package links

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
	"github.com/jorben/litemd/internal/l10n"
	"github.com/jorben/litemd/internal/localpath"

	"github.com/jorben/litemd/internal/session"
)

// Kind 是链接的类别。
type Kind int

const (
	Invalid Kind = iota
	Anchor
	External   // http(s)、mailto
	Markdown   // 本地 Markdown 文件：新窗口打开
	LocalFile  // 其他本地文件：确认后用默认应用打开
	Executable // 可执行文件：拒绝
)

var markdownExt = map[string]bool{".md": true, ".markdown": true, ".mdown": true, ".mkd": true}

// 可执行文件扩展名（第 7 节）。
var execExt = map[string]bool{
	".app": true, ".exe": true, ".bat": true, ".cmd": true, ".com": true, ".msi": true, ".ps1": true, ".vbs": true,
	".lnk": true, ".url": true, ".scr": true, ".sh": true, ".command": true, ".tool": true, ".scpt": true,
	".jar": true, ".desktop": true, ".appimage": true, ".pkg": true, ".dmg": true, ".workflow": true, ".terminal": true,
}

// Classify 把链接分类并解析出目标（本地文件为绝对路径）。dir 是文档所在目录（未命名文档为空）。
// isExecFile 用于检查 Unix 可执行权限和目录，便于测试注入。文档所在共享之外的 Windows UNC 路径
// 只按扩展名分类，不调用 isExecFile（不访问远程主机），Open 在用户确认后再检查。
func Classify(href, dir string, isExecFile func(string) bool) (Kind, string) {
	href = strings.TrimSpace(href)
	if href == "" {
		return Invalid, ""
	}
	if strings.HasPrefix(href, "#") {
		return Anchor, href
	}
	u, err := url.Parse(href)
	if err != nil {
		return Invalid, ""
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https", "mailto":
		return External, href
	case "file":
		href = localpath.FromFileURL(u)
	case "":
		p, err := url.PathUnescape(schemelessPath(u))
		if err != nil {
			return Invalid, ""
		}
		href = filepath.FromSlash(p)
	default:
		if len(u.Scheme) == 1 { // Windows 盘符 C:\...
			break
		}
		return Invalid, "" // javascript:、data:、其他协议一律不打开
	}
	p := localpath.Join(dir, href)
	if p == "" {
		return Invalid, ""
	}
	ext := strings.ToLower(filepath.Ext(p))
	switch {
	case execExt[ext]:
		return Executable, p
	case markdownExt[ext]:
		return Markdown, p
	case localpath.ForeignUNC(dir, p):
		return LocalFile, p
	case isExecFile(p):
		return Executable, p
	}
	return LocalFile, p
}

// schemelessPath 返回没有协议的链接的路径部分。url.Parse 把 //host/share/x 的 host 放进 Host，这里拼回去，
// 与图片（assets.Resolve）一样当作 UNC 路径（技术方案 3.5 节），否则 Join 会把它当成「当前盘的根」丢掉主机。
func schemelessPath(u *url.URL) string {
	if u.Host != "" {
		return "//" + u.Host + u.Path
	}
	return u.Path
}

// IsExecFile 报告路径是目录或带可执行权限的文件（Unix）。
func IsExecFile(p string) bool {
	fi, err := os.Stat(p)
	if err != nil {
		return false
	}
	if fi.IsDir() {
		return true
	}
	return fi.Mode().Perm()&0o111 != 0
}

// 错误。
var (
	ErrRefused  = errors.New("links: 不会打开可执行文件")
	ErrNotFound = errors.New("links: 找不到文件")
	ErrInvalid  = errors.New("links: 无法打开这个链接")
)

// Service 是绑定给文档页面的 Links 服务。
type Service struct{}

// Open 打开文档中的链接（用户点击或 ⌘ 点击时由页面调用）。
func (Service) Open(ctx context.Context, href string) error {
	w := mygo.CallerWindow(ctx)
	d := session.ForWindow(w)
	if d == nil {
		return session.ErrNoDocument
	}
	dir := ""
	if p := d.State().Path; p != "" {
		dir = filepath.Dir(p)
	}
	kind, target := Classify(href, dir, IsExecFile)
	if (kind == Markdown || kind == LocalFile) && localpath.ForeignUNC(dir, target) {
		return openForeignUNC(w, kind, target)
	}
	switch kind {
	case External:
		return mygo.Shell.OpenExternal(target)
	case Markdown:
		if _, err := os.Stat(target); err != nil {
			message(w, mygo.MessageWarning, l10n.F("找不到「%s」", filepath.Base(target)), target, []string{l10n.T("好")})
			return ErrNotFound
		}
		return session.OpenPath(target)
	case LocalFile:
		if _, err := os.Stat(target); err != nil {
			message(w, mygo.MessageWarning, l10n.F("找不到「%s」", filepath.Base(target)), target, []string{l10n.T("好")})
			return ErrNotFound
		}
		if message(w, mygo.MessageQuestion, l10n.T("要用默认应用打开这个文件吗？"), target, []string{l10n.T("打开"), l10n.T("取消")}) != 0 {
			return nil
		}
		return mygo.Shell.OpenPath(target)
	case Executable:
		return refuseExecutable(w, target)
	case Anchor:
		return nil
	}
	return ErrInvalid
}

// openForeignUNC 打开文档所在共享之外的 Windows UNC 路径：访问它会连接远程主机并发送 NTLM 凭据，
// 所以先显示完整路径请用户确认，确认前不访问文件系统；确认后再做本地文件的那些检查。
func openForeignUNC(w *mygo.Window, kind Kind, target string) error {
	if message(w, mygo.MessageQuestion, l10n.T("要打开网络位置上的这个文件吗？"), target, []string{l10n.T("打开"), l10n.T("取消")}) != 0 {
		return nil
	}
	if _, err := os.Stat(target); err != nil {
		message(w, mygo.MessageWarning, l10n.F("找不到「%s」", filepath.Base(target)), target, []string{l10n.T("好")})
		return ErrNotFound
	}
	if kind == Markdown {
		return session.OpenPath(target)
	}
	if IsExecFile(target) {
		return refuseExecutable(w, target)
	}
	return mygo.Shell.OpenPath(target)
}

func refuseExecutable(w *mygo.Window, target string) error {
	message(w, mygo.MessageWarning, l10n.T("LiteMd 不会打开可执行文件"), l10n.F("为了安全，文档中指向程序或脚本的链接不会被打开：\n%s", target), []string{l10n.T("好")})
	return ErrRefused
}

func message(w *mygo.Window, t mygo.MessageType, msg, detail string, buttons []string) int {
	r, err := mygo.Dialog.Message(mygo.MessageOptions{Parent: w, Type: t, Message: msg, Detail: detail,
		Buttons: buttons, DefaultButton: 0, CancelButton: len(buttons) - 1})
	if err != nil {
		return -1
	}
	return r.Button
}

// ShellService 提供在访达中显示、拷贝路径（F6.6）。
type ShellService struct{}

// RevealInFolder 在访达 / 资源管理器中显示文档本身，或文档引用的文件（ref 为空时为文档）。
func (ShellService) RevealInFolder(ctx context.Context, ref string) error {
	w := mygo.CallerWindow(ctx)
	d := session.ForWindow(w)
	if d == nil {
		return session.ErrNoDocument
	}
	p := d.State().Path
	if p == "" {
		return ErrNotFound
	}
	if ref != "" {
		kind, t := Classify(ref, filepath.Dir(p), func(string) bool { return false })
		if kind != LocalFile && kind != Markdown && kind != Executable {
			return ErrInvalid
		}
		// 文档所在共享之外的 UNC 路径：确认后才访问（见 openForeignUNC）
		if localpath.ForeignUNC(filepath.Dir(p), t) &&
			message(w, mygo.MessageQuestion, l10n.T("要显示网络位置上的这个文件吗？"), t, []string{l10n.T("显示"), l10n.T("取消")}) != 0 {
			return nil
		}
		p = t
	}
	mygo.Shell.ShowItemInFolder(p)
	return nil
}

// CopyPath 拷贝文档的完整路径。
func (ShellService) CopyPath(ctx context.Context) error {
	d := session.ForWindow(mygo.CallerWindow(ctx))
	if d == nil || d.State().Path == "" {
		return ErrNotFound
	}
	mygo.Clipboard.WriteText(d.State().Path)
	return nil
}

// ReadClipboardText 读取剪贴板文本（vmark markdownPaste 的「粘贴为 Markdown」用）。
func (ShellService) ReadClipboardText(ctx context.Context) (string, error) {
	if mygo.CallerWindow(ctx) == nil {
		return "", session.ErrNoDocument
	}
	return mygo.Clipboard.ReadText(), nil
}

// SameOrigin 报告 target 是否与 current 同源（scheme + host + port）。
func SameOrigin(current, target string) bool {
	a, err1 := url.Parse(current)
	b, err2 := url.Parse(target)
	if err1 != nil || err2 != nil || a.Scheme == "" {
		return false
	}
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

// Harden 为页面加上导航拦截、新窗口处理和权限拒绝（第 7 节）。在创建窗口后立即调用。
func Harden(w *mygo.Window) {
	p := w.Page()
	if p == nil {
		return
	}
	p.OnWillNavigate(func(e *mygo.NavigateEvent) {
		cur := p.URL()
		if cur == "" || cur == "about:blank" || SameOrigin(cur, e.URL) {
			return
		}
		e.PreventDefault()
		if e.UserInitiated {
			if k, t := Classify(e.URL, "", func(string) bool { return false }); k == External {
				go mygo.Shell.OpenExternal(t)
			}
		}
	})
	p.SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
		if req.UserInitiated {
			if k, t := Classify(req.URL, "", func(string) bool { return false }); k == External {
				go mygo.Shell.OpenExternal(t)
			}
		}
		return nil // 一律不在应用内开窗口
	})
	p.SetPermissionHandler(func(mygo.PermissionRequest) bool { return false })
}
