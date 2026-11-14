#!/usr/bin/env python3
# NF1–NF4 测量（docs/perf-report.md）：冷启动、已运行时打开新文件、多窗口内存、1 MB 文档在
# 所见即所得 / 源码模式下的输入延迟、保真写回耗时、安装包大小。
#
# 先构建带自动化插件的版本（非 -debug 构建带 mygo_noinspector 标签，不含自动化插件，只能用 -debug）：
#   GOFLAGS=-tags=e2e go tool mygo build -debug -skip-dmg -o /tmp/litemd-perf
# 再运行：python3 scripts/perf.py [DMG 路径]
import glob, json, os, statistics, subprocess, sys, time

APP = "/tmp/litemd-perf/darwin-arm64/LiteMd.app/Contents/MacOS/LiteMd"
D = "/tmp/litemd-perf-docs"
SOCK = "/tmp/litemd-perf-docs/app.sock"
CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "testdata", "fidelity")
os.makedirs(D, exist_ok=True)


def ma(*args):
    return subprocess.run(["mygo-automation", *args], capture_output=True, text=True).stdout.strip()


def make_doc(name, size):
    parts, n, i = [], 0, 0
    files = sorted(glob.glob(CORPUS + "/**/*.md", recursive=True))
    while n < size:
        t = open(files[i % len(files)], encoding="utf-8", errors="replace").read()
        parts.append(t)
        n += len(t.encode())
        i += 1
    p = os.path.join(D, name)
    text = "\n\n".join(parts).encode()[:size].decode("utf-8", "ignore")
    open(p, "w").write(text.rsplit("\n", 1)[0] + "\n")
    return p


def stop():
    subprocess.run(["pkill", "-f", APP])
    time.sleep(0.8)


def select(title, timeout=15):
    """选中标题为 title 的窗口，返回其页面的 readyAt（内容渲染完成的绝对时间，毫秒）。"""
    end = time.time() + timeout
    while time.time() < end:
        for line in ma("windows").splitlines():
            if f'"{title}"' in line:
                ma("window", line.split()[0])
                r = ma("eval", "String(window.__litemd && window.__litemd.readyAt || '')")
                if r:
                    return float(r)
        time.sleep(0.05)
    raise SystemExit("timeout " + title)


WEBKIT = ("WebKit.WebContent", "WebKit.GPU", "WebKit.Networking")
OTHER_WEBKIT = set()  # 启动 LiteMd 之前就存在的 WebKit 进程（其他应用的），不计入


def webkit_pids():
    out = subprocess.run(["ps", "-axo", "pid=,comm="], capture_output=True, text=True).stdout
    return {l.split(None, 1)[0] for l in out.splitlines() if any(k in l for k in WEBKIT)}


def footprint_mb(pid):
    out = subprocess.run(["footprint", pid], capture_output=True, text=True).stdout
    for l in out.splitlines():
        if "Footprint:" in l:
            v, unit = l.split("Footprint:")[1].split()[:2]
            return float(v) * {"KB": 1 / 1024, "MB": 1, "GB": 1024}.get(unit, 1)
    return 0.0


def rss_total():
    """(应用 RSS, WebKit RSS, 应用 footprint, WebKit footprint)，单位 MB；只算 LiteMd 的 WebKit 进程。"""
    pid = subprocess.run(["pgrep", "-f", APP], capture_output=True, text=True).stdout.split()[0]
    mine = webkit_pids() - OTHER_WEBKIT
    out = subprocess.run(["ps", "-axo", "pid=,rss="], capture_output=True, text=True).stdout
    rss = {l.split()[0]: int(l.split()[1]) / 1024 for l in out.splitlines() if len(l.split()) == 2}
    return rss.get(pid, 0), sum(rss.get(p, 0) for p in mine), footprint_mb(pid), sum(footprint_mb(p) for p in mine)


def mem(n):
    a, w, fa, fw = rss_total()
    return {"rss_app": round(a), "rss_webkit": round(w), "footprint_app": round(fa), "footprint_webkit": round(fw),
            "footprint_per_window": round((fa + fw) / n), "rss_per_window": round((a + w) / n)}


def cpu_idle(seconds=5):
    pid = subprocess.run(["pgrep", "-f", APP], capture_output=True, text=True).stdout.split()[0]
    out = subprocess.run(["top", "-l", "2", "-s", str(seconds), "-pid", pid, "-stats", "cpu"], capture_output=True, text=True).stdout
    vals = [l.strip() for l in out.splitlines() if l.strip().replace(".", "").isdigit()]
    return float(vals[-1]) if vals else None


# 每次按键：一次事务 + 强制布局（输入到可上屏的同步部分）；跳过前 20 次预热
TYPE_WYSIWYG = """(async () => { await window.__litemd.setMode("wysiwyg"); const ed = window.__litemd.rich.editor;
  const pos = Math.floor(ed.state.doc.content.size / 2); ed.commands.setTextSelection(pos);
  const r = ed.view.coordsAtPos(ed.state.selection.from); ed.view.dom.closest(".editor-content").scrollTop += r.top - 300;
  await new Promise(r => setTimeout(r, 300)); const ts = [];
  for (let i = 0; i < 220; i++) { const t = performance.now();
    ed.view.dispatch(ed.state.tr.insertText("字")); void ed.view.dom.offsetHeight;
    if (i >= 20) ts.push(performance.now() - t); await new Promise(r => requestAnimationFrame(r)); }
  ts.sort((a, b) => a - b); const p = q => +ts[Math.floor(q * (ts.length - 1))].toFixed(2);
  return JSON.stringify({ p50: p(0.5), p95: p(0.95), max: p(1) }); })()"""
TYPE_SOURCE = """(async () => { await window.__litemd.setMode("source"); const v = window.__litemd.source().view;
  const pos = Math.floor(v.state.doc.length / 2); v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  await new Promise(r => setTimeout(r, 300)); const ts = [];
  for (let i = 0; i < 220; i++) { const t = performance.now();
    v.dispatch(v.state.replaceSelection("字"), { userEvent: "input.type" }); void v.dom.offsetHeight;
    if (i >= 20) ts.push(performance.now() - t); await new Promise(r => requestAnimationFrame(r)); }
  ts.sort((a, b) => a - b); const p = q => +ts[Math.floor(q * (ts.length - 1))].toFixed(2);
  return JSON.stringify({ p50: p(0.5), p95: p(0.95), max: p(1) }); })()"""
PUSH = """(async () => { const t = performance.now(); await window.__litemd.sync.push(); return performance.now() - t; })()"""

res = {}
small = make_doc("doc100k.md", 100_000)
big = make_doc("doc1m.md", 1_000_000)
others = [make_doc(f"doc100k-{i}.md", 100_000) for i in range(5)]

# NF1 冷启动（5 次取中位数），预览模式
stop()
OTHER_WEBKIT |= webkit_pids()
cold = []
for k in range(5):
    stop()
    if os.path.exists(SOCK):
        os.remove(SOCK)
    t0 = time.time() * 1000
    subprocess.Popen([APP, small], env={**os.environ, "MYGO_AUTOMATION": SOCK}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    end = time.time() + 20
    while not os.path.exists(SOCK):
        if time.time() > end:
            raise SystemExit("自动化 socket 没有出现：需要 -debug 构建")
        time.sleep(0.01)
    ma("open", "--socket", SOCK)
    cold.append(round(select("doc100k.md") - t0))
res["cold_start_ms"] = {"runs": sorted(cold), "median": statistics.median(cold)}

# NF1 已运行时打开新文件（第二实例启动并转发给第一实例）。每次之前空闲 3 秒：
# 连续打开时前一个窗口还在渲染（Mermaid、KaTeX），测到的是排队时间；连续打开另记一组
warm = []
for p in others[:3]:
    time.sleep(3)
    t0 = time.time() * 1000
    subprocess.run([APP, p])
    warm.append(round(select(os.path.basename(p)) - t0))
res["open_running_ms"] = {"runs": sorted(warm), "median": statistics.median(warm)}
burst = []
for p in others[3:]:
    t0 = time.time() * 1000
    subprocess.run([APP, p])
    burst.append(round(select(os.path.basename(p)) - t0))
res["open_running_back_to_back_ms"] = sorted(burst)

# NF3 6 个窗口的内存与空闲 CPU（等渲染结束、WebKit 回收后再采样）
time.sleep(3)
res["mem_6_windows_after_3s_mb"] = mem(6)
time.sleep(12)
res["mem_6_windows_mb"] = mem(6)
res["idle_cpu_percent"] = cpu_idle()

# NF2 1 MB 文档：打开（预览）、所见即所得与源码输入、写回
t0 = time.time() * 1000
subprocess.run([APP, big])
res["open_1mb_ms"] = round(select("doc1m.md") - t0)
res["type_1mb_wysiwyg_ms"] = json.loads(ma("eval", TYPE_WYSIWYG))
res["push_1mb_wysiwyg_ms"] = round(float(ma("eval", PUSH)), 1)
res["type_1mb_source_ms"] = json.loads(ma("eval", TYPE_SOURCE))
res["push_1mb_source_ms"] = round(float(ma("eval", PUSH)), 1)
time.sleep(5)
res["mem_7_windows_incl_1mb_mb"] = mem(7)

# NF4 安装包
res["app_bundle"] = subprocess.run(["du", "-sh", os.path.dirname(os.path.dirname(os.path.dirname(APP)))], capture_output=True, text=True).stdout.split()[0]
if len(sys.argv) > 1:
    res["dmg_mb"] = round(os.path.getsize(sys.argv[1]) / 1e6, 1)
print(json.dumps(res, ensure_ascii=False, indent=1))
stop()
for f in glob.glob(D + "/doc*.md"):
    os.remove(f)
