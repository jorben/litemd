// Package l10n 是 Go 侧的界面文案（PRD F12：简体中文与英文），与页面的 src/shell/i18n.ts 同一规则：
// 源文案即简体中文，英文查表，缺的条目回落到中文。语言在启动时按设置确定，重启后生效。
package l10n

import (
	"fmt"
	"strings"
	"sync/atomic"

	"github.com/egoist/mygo"
	_ "github.com/egoist/mygo/locales/zh-Hans" // mygo 自己的文案（存储面板、关闭询问等）的简体中文
)

var english atomic.Bool

// IsEnglish 由设置的界面语言（system / zh-Hans / en）与系统首选语言决定。
func IsEnglish(setting string, preferred []string) bool {
	switch setting {
	case "en":
		return true
	case "zh-Hans":
		return false
	}
	return len(preferred) > 0 && !strings.HasPrefix(strings.ToLower(preferred[0]), "zh")
}

// Init 在启动时调用：声明应用的语言（mygo 自己的菜单项、存储面板等随之切换），并确定 T 的语言。
func Init(setting string) {
	en := IsEnglish(setting, mygo.App.PreferredLanguages())
	english.Store(en)
	mygo.App.SetLanguages("en", "zh-Hans")
	if en {
		mygo.App.SetLocale("en")
	} else {
		mygo.App.SetLocale("zh-Hans")
	}
}

// SetEnglish 供测试使用。
func SetEnglish(v bool) { english.Store(v) }

// T 翻译文案。
func T(s string) string {
	if english.Load() {
		if e, ok := en[s]; ok {
			return e
		}
	}
	return s
}

// F 翻译带 %s 等占位的文案再格式化。
func F(format string, args ...any) string { return fmt.Sprintf(T(format), args...) }

var en = map[string]string{
	// 菜单
	"新建": "New", "打开…": "Open…", "打开最近": "Open Recent", "关闭": "Close", "保存": "Save", "副本": "Duplicate",
	"另存为…": "Save As…", "重命名…": "Rename…", "移动到…": "Move To…", "还原到上次保存的版本…": "Revert to Saved…", "还原": "Revert",
	"导出 HTML…": "Export HTML…", "导出 PDF…": "Export PDF…", "打印…": "Print…", "设置…": "Settings…", "退出": "Exit",
	"撤销": "Undo", "重做": "Redo", "剪切": "Cut", "拷贝": "Copy", "粘贴": "Paste", "粘贴为纯文本": "Paste as Plain Text", "全选": "Select All",
	"查找…": "Find…", "替换…": "Replace…", "查找下一个": "Find Next", "查找上一个": "Find Previous",
	"标题 1": "Heading 1", "标题 2": "Heading 2", "标题 3": "Heading 3", "标题 4": "Heading 4", "标题 5": "Heading 5", "标题 6": "Heading 6",
	"正文": "Paragraph", "无序列表": "Bulleted List", "有序列表": "Numbered List", "任务列表": "Task List", "引用": "Quote",
	"代码块": "Code Block", "表格": "Table", "公式块": "Math Block", "分隔线": "Horizontal Rule",
	"加粗": "Bold", "斜体": "Italic", "删除线": "Strikethrough", "行内代码": "Inline Code", "链接…": "Link…", "清除格式": "Clear Formatting",
	"预览": "Preview", "所见即所得": "WYSIWYG", "源码": "Source", "分屏": "Split", "在预览与编辑之间切换": "Toggle Preview and Editing",
	"大纲": "Outline", "状态栏": "Status Bar", "放大": "Zoom In", "缩小": "Zoom Out", "实际大小": "Actual Size",
	"正文宽度": "Text Width", "窄": "Narrow", "中": "Medium", "宽": "Wide", "铺满": "Full",
	"LiteMd 帮助": "LiteMd Help", "Markdown 语法速查": "Markdown Syntax", "键盘快捷键": "Keyboard Shortcuts",
	"检查更新…": "Check for Updates…", "关于 LiteMd": "About LiteMd", "安装命令行工具…": "Install Command Line Tool…",
	"文件": "File", "编辑": "Edit", "段落": "Paragraph", "格式": "Format", "视图": "View", "窗口": "Window", "帮助": "Help",
	// 对话框
	"好": "OK", "取消": "Cancel", "打开": "Open", "设置": "Settings", "另存为 UTF-8": "Save as UTF-8",
	"将「%s」还原到上次保存的版本？": "Revert “%s” to the last saved version?", "当前未保存的改动会丢失。": "Your unsaved changes will be lost.",
	"「%s」在磁盘上已被修改": "“%s” changed on disk", "你在这里还有未保存的改动。选择保留哪个版本。": "You have unsaved changes here. Choose which version to keep.",
	"保留我的版本": "Keep My Version", "载入磁盘版本": "Load Disk Version", "没有保存「%s」": "Couldn't save “%s”",
	"已安装 litemd 命令": "Installed the litemd command", "之后可以在终端用 litemd 文件.md 打开文件。": "You can now open files from Terminal with litemd file.md.",
	"没有安装命令行工具":  "The command line tool wasn't installed",
	"当前版本不能自动更新": "This version can't update itself", "开发版本或安装位置不可写时无法自动更新。": "Development builds, or apps installed where they can't write, can't update automatically.",
	"检查更新失败": "Couldn't check for updates", "LiteMd 已是最新版本": "LiteMd is up to date", "当前版本 %s": "Current version %s",
	"找不到「%s」": "Can't find “%s”", "要用默认应用打开这个文件吗？": "Open this file with its default app?",
	"要打开网络位置上的这个文件吗？": "Open this file from a network location?",
	"要显示网络位置上的这个文件吗？": "Show this file from a network location?", "显示": "Show",
	"LiteMd 不会打开可执行文件":             "LiteMd won't open executable files",
	"为了安全，文档中指向程序或脚本的链接不会被打开：\n%s": "For safety, links to programs or scripts aren't opened:\n%s",
}
