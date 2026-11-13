# LiteMd 键盘快捷键

> 本文件由菜单表生成（`internal/menu/keybindings_test.go`），与应用菜单一致。修改快捷键后运行
> `LITEMD_UPDATE_GOLDEN=1 go test ./internal/menu` 更新，CI 会检查它是否过期。

快捷键在菜单与页面里是同一张表：菜单项有加速键，页面在捕获阶段按同一张表处理（`frontend/src/shell/keys.ts`，
由 `internal/menu/testdata/accelerators.json` 校验）。「段落」「格式」菜单只在所见即所得模式可用；编辑类命令
在预览和只读文件中不可用。Windows / Linux 一列为「—」的项在该平台没有对应快捷键；「退出」在 Linux 上为
`Ctrl+Q`，Windows 上用 `Alt+F4` 关闭窗口。

## LiteMd（仅 macOS）

| 命令 | macOS | Windows / Linux |
|---|---|---|
| 设置 | `⌘,` | `Ctrl+,` |
| 隐藏 LiteMd | `⌘H` | — |
| 隐藏其他 | `⌥⌘H` | — |
| 退出 | `⌘Q` | — |

## 文件

| 命令 | macOS | Windows / Linux |
|---|---|---|
| 新建 | `⌘N` | `Ctrl+N` |
| 打开 | `⌘O` | `Ctrl+O` |
| 关闭 | `⌘W` | `Ctrl+W` |
| 保存 | `⌘S` | `Ctrl+S` |
| 副本 | `⇧⌘S` | — |
| 另存为 | `⌥⇧⌘S` | `Ctrl+Shift+S` |
| 打印 | `⌘P` | `Ctrl+P` |

## 编辑

| 命令 | macOS | Windows / Linux |
|---|---|---|
| 撤销 | `⌘Z` | `Ctrl+Z` |
| 重做 | `⇧⌘Z` | `Ctrl+Y` |
| 剪切 | `⌘X` | `Ctrl+X` |
| 拷贝 | `⌘C` | `Ctrl+C` |
| 粘贴 | `⌘V` | `Ctrl+V` |
| 粘贴为纯文本 | `⌥⇧⌘V` | `Ctrl+Alt+Shift+V` |
| 全选 | `⌘A` | `Ctrl+A` |
| 查找 | `⌘F` | `Ctrl+F` |
| 替换 | `⌥⌘F` | `Ctrl+Alt+F` |
| 查找下一个 | `⌘G` | `Ctrl+G` |
| 查找上一个 | `⇧⌘G` | `Ctrl+Shift+G` |

## 段落

| 命令 | macOS | Windows / Linux |
|---|---|---|
| 标题 1 | `⌥⌘1` | `Ctrl+Alt+1` |
| 标题 2 | `⌥⌘2` | `Ctrl+Alt+2` |
| 标题 3 | `⌥⌘3` | `Ctrl+Alt+3` |
| 标题 4 | `⌥⌘4` | `Ctrl+Alt+4` |
| 标题 5 | `⌥⌘5` | `Ctrl+Alt+5` |
| 标题 6 | `⌥⌘6` | `Ctrl+Alt+6` |
| 正文 | `⌥⌘0` | `Ctrl+Alt+0` |
| 无序列表 | `⇧⌘8` | `Ctrl+Shift+8` |
| 有序列表 | `⇧⌘7` | `Ctrl+Shift+7` |
| 任务列表 | `⇧⌘9` | `Ctrl+Shift+9` |
| 引用 | `⇧⌘.` | `Ctrl+Shift+.` |
| 代码块 | `⌥⌘C` | `Ctrl+Alt+C` |
| 表格 | `⌥⌘T` | `Ctrl+Alt+T` |
| 公式块 | `⌥⌘B` | `Ctrl+Alt+B` |

## 格式

| 命令 | macOS | Windows / Linux |
|---|---|---|
| 加粗 | `⌘B` | `Ctrl+B` |
| 斜体 | `⌘I` | `Ctrl+I` |
| 删除线 | `⇧⌘X` | `Ctrl+Shift+X` |
| 行内代码 | `` ⌃` `` | `` Ctrl+` `` |
| 链接 | `⌘K` | `Ctrl+K` |
| 清除格式 | `⌘\` | `Ctrl+\` |

## 视图

| 命令 | macOS | Windows / Linux |
|---|---|---|
| 预览 | `⌘1` | `Ctrl+1` |
| 所见即所得 | `⌘2` | `Ctrl+2` |
| 源码 | `⌘3` | `Ctrl+3` |
| 分屏 | `⌘4` | `Ctrl+4` |
| 在预览与编辑之间切换 | `⌘E` | `Ctrl+E` |
| 大纲 | `⇧⌘O` | `Ctrl+Shift+O` |
| 放大 | `⌘+` | `Ctrl++` |
| 缩小 | `⌘-` | `Ctrl+-` |
| 实际大小 | `⌘0` | `Ctrl+0` |
| 进入全屏 | `⌃⌘F` | `F11` |

## 窗口

| 命令 | macOS | Windows / Linux |
|---|---|---|
| 最小化 | `⌘M` | — |

## 编辑器内

| 操作 | macOS | Windows / Linux |
|---|---|---|
| 预览中进入所见即所得，光标落在双击处 | 双击正文 | 双击正文 |
| 打开链接（所见即所得） | `⌘` + 点击 | `Ctrl` + 点击 |
| 打开链接（预览） | 点击 | 点击 |
| 表格：下一个 / 上一个单元格 | `Tab` / `⇧Tab` | `Tab` / `Shift+Tab` |
| 查找框：下一个 / 上一个结果 | `Enter` / `⇧Enter` | `Enter` / `Shift+Enter` |
| 关闭查找框 | `Esc` | `Esc` |
| 源码模式：添加光标 | `⌘` + 点击 | `Ctrl` + 点击 |
| 源码模式：缩进 / 取消缩进 | `Tab` / `⇧Tab` | `Tab` / `Shift+Tab` |

Markdown 输入规则（所见即所得）：行首输入 `# `–`###### ` 变标题，`- ` / `* ` 无序列表，`1. ` 有序列表，
`[ ] ` 任务，`> ` 引用，```` ``` ```` 代码块，`---` 分隔线；`**粗体**`、`*斜体*`、`` `代码` ``、`~~删除~~` 输入后转为格式。
