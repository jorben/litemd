# LiteMd website

LiteMd 的产品介绍页，使用独立的 HTML、CSS 和 JavaScript；没有构建步骤或第三方运行时依赖。

## 本地预览

从仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory website
```

打开 <http://127.0.0.1:4173/>。使用 `?lang=zh` 或 `?lang=en` 指定语言；页面切换语言时会保留锚点并记住偏好，默认跟随浏览器语言。禁用 JavaScript 时仍提供完整的中文介绍、截图和 Releases 下载链接。

页面从 GitHub 的公开 Releases API 读取最新正式版，并在找到实际安装包时替换 macOS / Windows 的下载链接。接口超时、限流或没有对应安装包时，链接保持指向最新 Release 页面。Linux 用户在 Release 页面选择发行版及架构。无需维护版本号或包含令牌。

## 目录与素材

- `index.html`：中文页面、语义结构、社交分享信息。
- `styles.css`：响应式布局与设计变量，遵守减少动态效果偏好。
- `main.js`：中英文切换、四种模式的说明示例、下载链接增强。
- `assets/icon.png`、`assets/icon-large.png`：由 `resources/icon.png` 缩小生成。
- `assets/screenshot.png`：复制自 `docs/images/screenshot.png` 的真实应用截图。更新应用截图时同步此文件。

设计使用白色 `#ffffff`、石墨色 `#24272d`、正文辅助色 `#626a77`、品牌蓝 `#275dc5`、浅底色 `#f5f7fb`、边框色 `#e3e7ed`。字体优先 Avenir Next，依次回退至 Segoe UI 与系统中文字体，不请求第三方字体。真实截图是首屏重点，模式区是明确标注的示意，保真区通过单块文本改动说明保存行为。

## GitHub Pages 发布

1. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（首次设置）。
2. 将介绍页及 `.github/workflows/pages.yml` 合并到 `master`。
3. 网站相关文件的后续推送会自动运行 `Deploy website to GitHub Pages`。也可以在 Actions 中选 `master` 手动运行；其他分支的手动运行会跳过部署。

默认地址：<https://jorben.github.io/litemd/>。

工作流仅上传 `website/`，不需要 `gh-pages` 分支，不构建桌面应用。使用相对路径访问本地资源，兼容仓库 Pages 的 `/litemd/` 子路径。介绍页改动仍走普通 feature 分支和 PR。

## 验证

```sh
node --check website/main.js
actionlint .github/workflows/pages.yml  # 已安装 actionlint 时
git diff --check
```

浏览器中检查 320、390、768 和 1440px 的布局、中英文切换、四种模式、键盘焦点以及下载链接。测试 GitHub API 不可用时，应仍能通过下载入口进入最新 Release 页面。
