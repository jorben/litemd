#!/bin/sh
# PRD 第 7 节第 4 条冒烟清单的 macOS 自动部分（docs/v1-acceptance.md 引用其输出）。
# 先构建带自动化插件的版本：GOFLAGS=-tags=e2e go tool mygo build -skip-dmg -o /tmp/litemd-e2e
# 需要 mygo-automation（npm mygo-cli 自带）。运行：sh scripts/smoke-macos.sh
set -u
APP=/tmp/litemd-e2e/darwin-arm64/LiteMd.app/Contents/MacOS/LiteMd
ROOT=$(cd "$(dirname "$0")/.." && pwd)
D=$(mktemp -d /tmp/litemd-smoke.XXXXXX)
SOCK=$D/app.sock
REC="$HOME/Library/Application Support/LiteMd/Recovery"
pass=0; fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
no() { echo "FAIL  $1 — $2"; fail=$((fail + 1)); }
ma() { mygo-automation "$@" 2>&1; }
ev() { ma eval "$1"; }
sel() { # 选中标题含 $1 的窗口
  i=0; while [ $i -lt 60 ]; do
    w=$(ma windows | grep "\"$1" | head -1 | awk '{print $1}')
    if [ -n "$w" ]; then ma window "$w" >/dev/null; [ "$(ev 'typeof window.__litemd')" = object ] && return 0; fi
    sleep 0.1; i=$((i + 1)); done; return 1; }
start() { rm -f "$SOCK"; (MYGO_AUTOMATION=$SOCK "$APP" "$@" >"$D/app.log" 2>&1 &)
  i=0; while [ ! -S "$SOCK" ] && [ $i -lt 80 ]; do sleep 0.1; i=$((i + 1)); done; ma open --socket "$SOCK" >/dev/null; }
stop() { pkill -f "$APP"; sleep 0.8; }

cp "$ROOT/testdata/fidelity/mygo-docs-zh/README.md" "$D/a.md"; cp "$D/a.md" "$D/a.orig"
printf '# B\n\n正文\n' > "$D/b.md"
printf '# 只读\n' > "$D/ro.md"; chmod 444 "$D/ro.md"
printf '# 缺图\n\n![丢失](assets/none.png)\n' > "$D/img.md"; cp "$D/img.md" "$D/img.orig"
stop

# 1 双击打开（以 open 模拟访达）、打开不改文件
start "$D/a.md"
if sel a.md && cmp -s "$D/a.md" "$D/a.orig"; then ok "打开文件显示内容、文件不被改动"; else no "打开" "窗口或字节"; fi

# 2 单实例 + 多窗口：再次启动可执行文件打开另一个文件
"$APP" "$D/b.md" >/dev/null 2>&1
n=$(pgrep -f "$APP" | wc -l | tr -d ' ')
if sel b.md && [ "$n" = 1 ]; then ok "单实例：第二个文件在同一进程的新窗口打开"; else no "单实例" "进程数 $n"; fi
"$APP" "$D/a.md" >/dev/null 2>&1; sleep 0.5
c=$(ma windows | grep -c '"a.md')
[ "$c" = 1 ] && ok "同一文件再次打开只聚焦已有窗口" || no "同一文件" "窗口数 $c"

# 3 自动保存：所见即所得中编辑，约 1 秒后写盘，只改动一行
sel b.md
ev '(async () => { await window.__litemd.setMode("wysiwyg"); const e = window.__litemd.rich.editor; e.chain().focus().setTextSelection(e.state.doc.content.size - 1).insertContent("追加").run(); return "ok"; })()' >/dev/null
sleep 2.5
if [ "$(cat "$D/b.md")" = "$(printf '# B\n\n正文追加')" ]; then ok "自动保存：编辑后约 1 秒写盘，内容正确"; else no "自动保存" "$(cat "$D/b.md" | head -3)"; fi

# 4 外部修改：未编辑时直接重新载入；有未保存改动时提示冲突
printf '# B\n\n外部修改\n' > "$D/b.md"; sleep 2
t=$(ev 'window.__litemd.text()')
case "$t" in *外部修改*) ok "外部修改：无未保存改动时自动载入磁盘版本" ;; *) no "外部修改" "$t" ;; esac

# 5 只读文件
start_ro() { "$APP" "$D/ro.md" >/dev/null 2>&1; sel ro.md; }
start_ro
b=$(ev 'JSON.stringify(window.__litemd.banners())'); st=$(ev 'document.querySelector(".lm-status").innerText')
case "$b$st" in *readonly*|*只读*) ok "只读文件以只读打开并有标记" ;; *) no "只读" "$b $st" ;; esac

# 6 缺失图片：占位并显示原路径，不报错
"$APP" "$D/img.md" >/dev/null 2>&1; sel img.md; sleep 1
r=$(ev '(() => { const f = document.querySelector(".lm-rich .image-error[data-lm-missing]"); return f ? f.dataset.lmMissing + " " + getComputedStyle(f, "::after").content : "none"; })()')
case "$r" in *'assets/none.png "assets/none.png"'*) ok "缺失图片显示占位与原始路径" ;; *) no "缺失图片" "$r" ;; esac
cmp -s "$D/img.md" "$D/img.orig" || no "缺失图片" "文件被改动"

# 7 图片粘贴：保存到 assets/ 并插入相对路径
sel a.md
p=$(ev '(async () => { await window.__litemd.setMode("source"); const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)); const f = new File([png], "x.png", { type: "image/png" }); const dt = new DataTransfer(); dt.items.add(f); const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }); window.__litemd.source().view.contentDOM.dispatchEvent(ev); await new Promise((r) => setTimeout(r, 1500)); return window.__litemd.text().match(/!\[[^\]]*\]\((assets\/[^)]+)\)/)?.[1] ?? "none"; })()')
if [ -f "$D/$p" ]; then ok "图片粘贴：保存为 $p 并插入引用"; else no "图片粘贴" "$p"; fi
sleep 2

# 8 崩溃恢复（mygo：自动保存的文件约 1 秒写盘；未命名、冲突中的文档写恢复副本）
sel a.md
ev '(async () => { await window.__litemd.setMode("source"); window.__litemd.source().insert("自动保存后强制结束"); return "ok"; })()' >/dev/null
ma menu 文件 新建 >/dev/null; sleep 1; sel 未命名
ev '(async () => { const L = window.__litemd; L.rich.editor.chain().focus().insertContent("未命名恢复测试").run(); await L.sync.push(); return "ok"; })()' >/dev/null
sleep 2.5; pkill -9 -f "$APP"; sleep 1
grep -q 自动保存后强制结束 "$D/a.md" && ok "强制结束前已自动保存的编辑在磁盘上" || no "强制结束" "a.md 没有写盘"
start; sleep 2
if sel 未命名; then
  b=$(ev 'JSON.stringify(window.__litemd.banners())'); t=$(ev 'window.__litemd.text()')
  case "$b$t" in *recovered*未命名恢复测试*) ok "崩溃恢复：重开后恢复未命名文档并提示" ;; *) no "崩溃恢复" "$b $t" ;; esac
else no "崩溃恢复" "没有恢复出未命名窗口"; fi
# 清理：丢弃恢复出的未命名文档（「丢弃，载入磁盘版本」），不在用户数据里留下副本
ev '(() => { const b = [...document.querySelectorAll("button")].find((x) => /丢弃|Discard/.test(x.textContent)); b?.click(); return 1; })()' >/dev/null 2>&1; sleep 1
stop
chmod 644 "$D/ro.md"; rm -rf "$D"
echo "通过 ${pass}，失败 ${fail}"
[ "$fail" = 0 ]
