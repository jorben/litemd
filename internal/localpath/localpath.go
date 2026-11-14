// Package localpath 把文档里的链接、命令行参数解析成本机绝对路径。
//
// Windows 与 Unix 有两处不同，这里统一处理：
//   - file URL 的路径带盘符：file:///C:/x.png 的 Path 是 /C:/x.png，要去掉开头的 /；
//     带主机名的 file://server/share/x 是 UNC 路径 \\server\share\x。
//   - 以 \ 或 / 开头、没有盘符的路径不是绝对路径，而是「当前盘的根」，取所在目录的盘符。
//   - UNC 路径指向网络位置，文档目录所在共享之外的 UNC 路径不能自动访问（ForeignUNC）。
package localpath

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// FromFileURL 返回 file URL 指向的本地路径（未清理，可能不是绝对路径）。
func FromFileURL(u *url.URL) string {
	p := u.Path
	if runtime.GOOS == "windows" {
		if u.Host != "" && !strings.EqualFold(u.Host, "localhost") {
			return `\\` + u.Host + filepath.FromSlash(p)
		}
		if len(p) >= 3 && p[0] == '/' && isLetter(p[1]) && p[2] == ':' {
			p = p[1:]
		}
	}
	return filepath.FromSlash(p)
}

// Join 把 p 解析为清理过的绝对路径：绝对路径原样返回；Windows 上以分隔符开头、没有盘符的路径
// 取 dir 的盘符；其余相对 dir 拼接。dir 为空且 p 不是绝对路径时无法解析，返回 ""。
func Join(dir, p string) string {
	if filepath.IsAbs(p) {
		return filepath.Clean(p)
	}
	if dir == "" {
		return ""
	}
	if p != "" && os.IsPathSeparator(p[0]) && filepath.VolumeName(p) == "" {
		return filepath.Clean(filepath.VolumeName(dir) + p)
	}
	return filepath.Join(dir, p)
}

// ForeignUNC 报告 p 是否为 Windows UNC / 设备路径（\\server\share\…、\\?\UNC\…、\\.\…），且它的卷与文档目录 dir
// 的卷不同。访问这样的路径会连接远程主机（SMB 会自动发送当前用户的 NTLM 凭据），所以文档引用它时
// 不能自动访问：图片一律拒绝，链接先确认再访问。同一共享里的文档（dir 也在该卷上）照常使用。
// p 应是 Join 清理过的路径。其他系统没有 UNC 路径，总是返回 false。
func ForeignUNC(dir, p string) bool {
	return runtime.GOOS == "windows" && foreignUNC(dir, p)
}

func foreignUNC(dir, p string) bool {
	v := uncVolume(p)
	return v != "" && !strings.EqualFold(v, uncVolume(dir))
}

// uncVolume 按 Windows 规则返回 p 的 UNC / 设备卷（分隔符统一为 \）：\\server\share、\\?\UNC\server\share、
// \\?\C: 等；p 不以两个分隔符或 \??\ 开头时返回 ""。纯字符串处理，任何系统上结果相同，便于测试。
func uncVolume(p string) string {
	p = strings.ReplaceAll(p, "/", `\`)
	var prefix, rest string
	parts := 2 // 卷包含的路径段数：server、share
	switch {
	case hasPrefixFold(p, `\\.\`), hasPrefixFold(p, `\\?\`), hasPrefixFold(p, `\??\`):
		prefix, rest = p[:4], p[4:]
		parts = 1 // 设备名或盘符
		if first, _, _ := strings.Cut(rest, `\`); strings.EqualFold(first, "UNC") {
			parts = 3 // UNC、server、share
		}
	case strings.HasPrefix(p, `\\`):
		prefix, rest = p[:2], p[2:]
	default:
		return ""
	}
	seg := strings.SplitN(rest, `\`, parts+1)
	if len(seg) > parts {
		seg = seg[:parts]
	}
	return prefix + strings.Join(seg, `\`)
}

func hasPrefixFold(s, prefix string) bool {
	return len(s) >= len(prefix) && strings.EqualFold(s[:len(prefix)], prefix)
}

func isLetter(c byte) bool {
	return 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z'
}
