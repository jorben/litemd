// Package localpath 把文档里的链接、命令行参数解析成本机绝对路径。
//
// Windows 与 Unix 有两处不同，这里统一处理：
//   - file URL 的路径带盘符：file:///C:/x.png 的 Path 是 /C:/x.png，要去掉开头的 /；
//     带主机名的 file://server/share/x 是 UNC 路径 \\server\share\x。
//   - 以 \ 或 / 开头、没有盘符的路径不是绝对路径，而是「当前盘的根」，取所在目录的盘符。
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

func isLetter(c byte) bool {
	return 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z'
}
