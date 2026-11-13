// Package clitool 安装 macOS 的 litemd 命令（PRD F1.5：设置中的「安装命令行工具」）。
// 在 /usr/local/bin 放一个调用 .app 内可执行文件的脚本，需要管理员密码（系统对话框）。
package clitool

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Target 是命令的安装位置。
const Target = "/usr/local/bin/litemd"

// Script 返回命令脚本：把参数交给应用的可执行文件（已运行时转给第一个实例，F1.3）。
func Script(exe string) string {
	return fmt.Sprintf("#!/bin/sh\n# LiteMd 命令行工具（由 LiteMd 设置安装）\nexec %q \"$@\" >/dev/null 2>&1 &\n", exe)
}

// shellQuote 用单引号包住字符串（给 osascript 里的 do shell script 用）。
func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// Install 写入脚本；需要权限时通过 osascript 请求管理员授权。
func Install() error {
	if runtime.GOOS != "darwin" {
		return errors.New("clitool: 只在 macOS 上需要安装")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp("", "litemd-cli-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(Script(exe)); err != nil {
		return err
	}
	tmp.Close()
	cmd := "mkdir -p /usr/local/bin && install -m 755 " + shellQuote(tmp.Name()) + " " + shellQuote(Target)
	as := `do shell script "` + strings.ReplaceAll(strings.ReplaceAll(cmd, `\`, `\\`), `"`, `\"`) + `" with administrator privileges`
	if out, err := exec.Command("osascript", "-e", as).CombinedOutput(); err != nil {
		return fmt.Errorf("clitool: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
