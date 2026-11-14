# LiteMd website

LiteMd 的产品介绍页，使用独立的 HTML、CSS 和 JavaScript；没有构建步骤或第三方运行时依赖。

## 本地预览

从仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory website
```

打开 <http://127.0.0.1:4173/>。使用 `?lang=zh` 或 `?lang=en` 指定语言；页面切换语言时会保留锚点并记住偏好，默认跟随浏览器语言。禁用 JavaScript 时仍提供完整的中文介绍、截图和 Releases 下载链接。

导航栏提供浅色、深色、跟随系统三种外观，默认跟随系统。偏好保存到 `localStorage` 并在刷新前恢复，浏览器存储不可用时仍能在当前页面切换。跟随系统会响应系统外观变化；禁用 JavaScript 时，CSS 仍跟随系统配色。移动端选择器以图标显示，保留原生选择菜单和键盘操作。

页面从 GitHub 的公开 Releases API 读取最新正式版，并在找到实际安装包时替换 macOS / Windows 的下载链接。接口超时、限流或没有对应安装包时，链接保持指向最新 Release 页面。Linux 用户在 Release 页面选择发行版及架构。无需维护版本号或包含令牌。

## 目录与素材

- `index.html`：中文页面、语义结构、社交分享信息。
- `styles.css`：响应式布局、明暗两套语义配色，遵守减少动态效果偏好。
- `theme.js`：在样式加载前恢复主题偏好，减少外观闪烁。
- `main.js`：主题与中英文切换、四种模式的说明示例、下载链接增强。
- `assets/icon.png`、`assets/icon-large.png`：由 `resources/icon.png` 缩小生成。
- `assets/screenshot.png`：复制自 `docs/images/screenshot.png` 的真实应用截图。更新应用截图时同步此文件。

设计通过 CSS `light-dark()` 与 `color-scheme` 统一控制明暗外观（面向支持 `light-dark()` 的现代浏览器）。浅色以白色 `#ffffff`、石墨色 `#24272d` 和品牌蓝 `#275dc5` 为主；深色以 `#14171e` 为背景、`#1c2029` 为卡片底色、`#edf1f7` 为正文，并用浅蓝 `#98b8ff` 标识链接。按钮使用独立的前景色；差异高亮、源码、边框和阴影都有对应的语义变量。

字体优先 Avenir Next，依次回退至 Segoe UI 与系统中文字体，不请求第三方字体。正文与说明文字按阅读层级设置，辅助文字不低于 12px。真实截图保持原貌，模式区是明确标注的示意，保真区通过单块文本改动说明保存行为。

## GitHub Pages 发布

1. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（首次设置）。
2. 将介绍页及 `.github/workflows/pages.yml` 合并到 `master`。
3. 网站相关文件的后续推送会自动运行 `Deploy website to GitHub Pages`。也可以在 Actions 中选 `master` 手动运行；其他分支的手动运行会跳过部署。

默认地址：<https://jorben.github.io/litemd/>。

工作流仅上传 `website/`，不需要 `gh-pages` 分支，不构建桌面应用。使用相对路径访问本地资源，兼容仓库 Pages 的 `/litemd/` 子路径。介绍页改动仍走普通 feature 分支和 PR。

## 验证

```sh
node --check website/theme.js
node --check website/main.js
actionlint .github/workflows/pages.yml  # 已安装 actionlint 时
git diff --check
```

浏览器中检查 320、390、768 和 1440px 下中英文与明暗主题的布局、四种模式、键盘焦点以及下载链接；检查主题刷新恢复、跟随系统变化、跨标签页同步、减少动态效果和无 JavaScript 时的外观。主要文字与背景的对比度至少为 4.5:1。测试 GitHub API 不可用时，应仍能通过下载入口进入最新 Release 页面。
