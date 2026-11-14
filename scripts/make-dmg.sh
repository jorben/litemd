#!/bin/sh
# 用 dmgbuild 把 mygo build 打出的 .app 重新打成带背景的安装 DMG（600×400 窗口，背景提示拖到 Applications），
# 覆盖 mygo 自带的 DMG。mygo 目前不支持 DMG 背景，只能在它之后替换。
#
# 用法：scripts/make-dmg.sh [build 目录，默认 build]
#   逐个替换 <build>/darwin-*/ 里的 *.dmg，装进去的是同目录下的 .app。没有 DMG（如 -skip-dmg 或只打了别的平台）时什么也不做。
#
# 必须在 mygo build 之后、对它产出的 .app 运行：mygo 只在打 DMG 时公证，公证后会把票据钉到 .app 上，
# 所以这里装进 DMG 的 .app 已经公证过。签名与公证沿用 mygo.config.ts 读的两个环境变量：
#   MACOS_SIGNING_IDENTITY  设置且不是 "-" 时，用它给 DMG 签名（本机 ad-hoc 构建与 mygo 一样不签 DMG）
#   NOTARY_KEYCHAIN         设置时，用其中名为 notary 的 notarytool 凭据公证 DMG，再把票据钉到 DMG 上
#
# 需要 dmgbuild。PATH 里没有时，在 .mygo/dmgbuild 建一个 venv 并安装下面固定的版本；DMGBUILD 可指定可执行文件。
set -eu

DMGBUILD_VERSION=1.6.5

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD=${1:-$ROOT/build}

set -- "$BUILD"/darwin-*/*.dmg
[ -e "$1" ] || { echo "No disk images in $BUILD/darwin-*/, nothing to restyle"; exit 0; }

if [ -z "${DMGBUILD:-}" ]; then
	if command -v dmgbuild >/dev/null 2>&1; then
		DMGBUILD=dmgbuild
	else
		venv="$ROOT/.mygo/dmgbuild"
		if [ ! -x "$venv/bin/dmgbuild" ]; then
			echo "Installing dmgbuild $DMGBUILD_VERSION into $venv"
			python3 -m venv "$venv"
			"$venv/bin/python" -m pip install --quiet --disable-pip-version-check "dmgbuild==$DMGBUILD_VERSION"
		fi
		DMGBUILD="$venv/bin/dmgbuild"
	fi
fi

restyle() {
	DMG=$1
	APP=$(find "$(dirname -- "$DMG")" -maxdepth 1 -name '*.app' -type d | head -n 1)
	[ -n "$APP" ] || { echo "no .app next to $DMG" >&2; exit 1; }
	VOLUME_NAME=$(basename "$APP" .app) # 与 mygo 一致：卷名即 dmgTitle，默认是应用名

	# 先写到临时文件：中途失败时保留 mygo 原来的 DMG。
	tmp="$(dirname -- "$DMG")/.$(basename -- "$DMG" .dmg).styled.dmg"
	trap 'rm -f "$tmp"' EXIT
	rm -f "$tmp"
	echo "Creating $(basename -- "$DMG") with the installer background"
	"$DMGBUILD" \
		-s "$ROOT/scripts/dmg/settings.py" \
		-D app="$APP" \
		-D background="$ROOT/scripts/dmg/background.png" \
		"$VOLUME_NAME" "$tmp"

	identity=${MACOS_SIGNING_IDENTITY:-}
	if [ -n "$identity" ] && [ "$identity" != "-" ]; then
		codesign --force --timestamp --sign "$identity" "$tmp"
	fi

	if [ -n "${NOTARY_KEYCHAIN:-}" ]; then
		echo "Notarizing $(basename -- "$DMG") (usually takes a few minutes)"
		# notarytool 在公证被拒（Invalid）时也可能返回 0，所以按输出里的状态判断。
		out=$(xcrun notarytool submit "$tmp" --keychain-profile notary --keychain "$NOTARY_KEYCHAIN" \
			--wait --output-format json) || { echo "$out" >&2; exit 1; }
		if ! printf '%s' "$out" | tr -d ' \t\n' | grep -q '"status":"Accepted"'; then
			echo "notarization failed: $out" >&2
			exit 1
		fi
		xcrun stapler staple "$tmp"
	fi

	mv -f "$tmp" "$DMG"
	trap - EXIT
	echo "Created $DMG"
}

for dmg in "$@"; do
	restyle "$dmg"
done
