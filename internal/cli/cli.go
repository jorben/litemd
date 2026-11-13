// Package cli 处理命令行参数中 mygo 不投递的部分（PRD F1.5，技术方案 3.8 节）。
//
// mygo 只把已存在、且扩展名在 fileAssociations 里的文件交给 OnOpenFile。这里处理其余的：
// 不存在的 Markdown / .txt 文件（先以 O_EXCL 创建空文件），已存在的 .txt，没有扩展名的路径（补 .md）。
// 与 mygo 重复处理同一个文件没有副作用：docs.Open 遇到已打开的文件只会聚焦。
package cli

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
)

var markdownExt = map[string]bool{".md": true, ".markdown": true, ".mdown": true, ".mkd": true}

// Action 是对一个参数的处理。
type Action struct {
	Path   string // 绝对路径
	Create bool   // 不存在，需要先创建空文件
}

// Plan 计算参数的处理方式；不处理的参数（选项、mygo 会投递的文件、目录、其他扩展名）不出现在结果里。
// exists 便于测试注入。
func Plan(args []string, workingDir string, exists func(string) (isDir, ok bool)) []Action {
	var out []Action
	for _, a := range args {
		if a == "" || strings.HasPrefix(a, "-") || strings.Contains(a, "://") {
			continue
		}
		p := a
		if !filepath.IsAbs(p) {
			p = filepath.Join(workingDir, p)
		}
		p = filepath.Clean(p)
		ext := strings.ToLower(filepath.Ext(p))
		isDir, ok := exists(p)
		if isDir {
			continue
		}
		switch {
		case ext == "" && !ok:
			p += ".md"
			if d, ok2 := exists(p); !d {
				out = append(out, Action{Path: p, Create: !ok2})
			}
		case (markdownExt[ext] || ext == ".txt") && !ok:
			out = append(out, Action{Path: p, Create: true})
		case ext == ".txt" && ok:
			out = append(out, Action{Path: p})
		}
	}
	return out
}

// Exists 是 Plan 的默认实现。
func Exists(p string) (isDir, ok bool) {
	fi, err := os.Stat(p)
	if err != nil {
		return false, false
	}
	return fi.IsDir(), true
}

// CreateEmpty 以 O_EXCL 创建空文件；文件已被别人创建时不算错误。
func CreateEmpty(p string) error {
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, os.ErrExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return f.Close()
}

// Opener 打开一个文件（docs.Open 的包装）。
type Opener func(path string) error

// Install 注册命令行处理：首次启动的 os.Args（WhenReady 之后），以及第二个实例转来的参数
// （mygo 转发的是 os.Args[1:]，不含程序名）。expect 在每个即将打开的文件前调用，
// 告诉启动窗口有文件要打开；首次启动时在 WhenReady 之前就调用，避免启动窗口先出现。
func Install(open Opener, expect func()) {
	run := func(actions []Action) {
		for _, a := range actions {
			if a.Create && CreateEmpty(a.Path) != nil {
				continue
			}
			go func(p string) { _ = open(p) }(a.Path)
		}
	}
	wd, _ := os.Getwd()
	first := Plan(os.Args[1:], wd, Exists)
	for range first {
		expect()
	}
	mygo.App.WhenReady(func() { run(first) })
	mygo.App.OnSecondInstance(func(args []string, workingDir string) {
		actions := Plan(args, workingDir, Exists)
		for range actions {
			expect()
		}
		run(actions)
	})
}
