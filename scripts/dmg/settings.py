# LiteMd 安装 DMG 的 dmgbuild 配置，由 scripts/make-dmg.sh 调用，不要直接运行。
# 背景 background.png 是 600×400 pt，旁边的 background@2x.png 由 dmgbuild 合成进同一张 TIFF 供 Retina 用；
# 原图是 docs/images/dmg-background-source.png（1536×1024），改图后用 sips 重新导出这两个尺寸。
# 布局与背景配套：箭头在窗口正中 (300, 200)，应用在左、Applications 在右。
import os.path

app = defines["app"]  # noqa: F821（dmgbuild 注入）
app_name = os.path.basename(app)

# 与 mygo 自带的 DMG 一致：HFS+，LZMA 压缩（ULMO 需 macOS 10.15，低于最低支持的 13.0）。
format = "ULMO"
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
# 不设 hide_extension：它给 .app 加 Finder 标志，会让签名过不了严格校验（mygo dmg.go 里也因此不隐藏）。
# 卷图标沿用应用图标，与 mygo 的 DMG 一样。
icon = os.path.join(app, "Contents", "Resources", "AppIcon.icns")

background = defines["background"]  # noqa: F821
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

window_rect = ((200, 160), (600, 400))
default_view = "icon-view"
icon_size = 112
text_size = 13
arrange_by = None
icon_locations = {
    app_name: (150, 200),
    "Applications": (450, 200),
}
