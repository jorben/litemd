#!/usr/bin/env python3
# M0 V6 性能测量：冷启动、已运行时打开新文件、内存、1 MB 文档输入。
import glob, json, os, subprocess, time

APP = "/tmp/litemd-e2e/darwin-arm64/LiteMd.app/Contents/MacOS/LiteMd"
D = "/tmp/litemd-m0/perf"
SOCK = "/tmp/litemd-m0/app.sock"
CORPUS = "/Users/jorben/Documents/Codespace/litemd/testdata/fidelity"
os.makedirs(D, exist_ok=True)

def ma(*args):
    return subprocess.run(["mygo-automation", *args], capture_output=True, text=True).stdout.strip()

def make_doc(name, size):
    parts, n = [], 0
    files = sorted(glob.glob(CORPUS + "/**/*.md", recursive=True))
    i = 0
    while n < size:
        t = open(files[i % len(files)], encoding="utf-8", errors="replace").read()
        parts.append(t); n += len(t.encode()); i += 1
    p = os.path.join(D, name)
    open(p, "w").write("\n\n".join(parts)[:size])
    return p

def stop():
    subprocess.run(["pkill", "-f", APP]); time.sleep(0.8)

def wait_ready(title, timeout=15):
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

def rss_total():
    pid = subprocess.run(["pgrep", "-f", APP], capture_output=True, text=True).stdout.split()[0]
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,rss=,comm="], capture_output=True, text=True).stdout
    app, web = 0, 0
    for l in out.splitlines():
        f = l.split(None, 3)
        if len(f) < 4: continue
        if f[0] == pid: app = int(f[2])
        elif "WebKit.WebContent" in f[3] or "WebKit.GPU" in f[3] or "WebKit.Networking" in f[3]: web += int(f[2])
    return app / 1024, web / 1024

res = {}
small = make_doc("doc100k.md", 100_000)
big = make_doc("doc1m.md", 1_000_000)
others = [make_doc(f"doc100k-{i}.md", 100_000) for i in range(5)]

# 冷启动（3 次取中位数）
cold = []
for k in range(3):
    stop()
    if os.path.exists(SOCK): os.remove(SOCK)
    t0 = time.time() * 1000
    subprocess.Popen([APP, small], env={**os.environ, "MYGO_AUTOMATION": SOCK},
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while not os.path.exists(SOCK): time.sleep(0.01)
    ma("open", "--socket", SOCK)
    cold.append(wait_ready("doc100k.md") - t0)
res["cold_start_ms"] = sorted(cold)

# 已运行时打开新文件（第二实例转发）
warm = []
for p in others:
    t0 = time.time() * 1000
    subprocess.run([APP, p])
    warm.append(wait_ready(os.path.basename(p)) - t0)
res["open_running_ms"] = sorted(warm)
time.sleep(2)
a, w = rss_total()
res["rss_6_windows_mb"] = {"app": round(a), "webkit": round(w), "per_window": round((a + w) / 6)}

# 1 MB 文档：打开耗时与 CodeMirror 输入（含推送序列化，源码模式不经保真层）
t0 = time.time() * 1000
subprocess.run([APP, big])
res["open_1mb_ms"] = round(wait_ready("doc1m.md") - t0)
r = ma("eval", """(() => { const v = window.__litemd.view; const ts = [];
  for (let i = 0; i < 200; i++) { const t = performance.now();
    v.dispatch({ changes: { from: 500000, insert: "字" }, userEvent: "input.type" });
    ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b); return JSON.stringify({ p50: ts[100], p95: ts[190], max: ts[199] }); })()""")
res["input_1mb_dispatch_ms"] = json.loads(r)
t = ma("eval", """(async () => { const t = performance.now(); await window.__litemd.sync.push(); return performance.now() - t; })()""")
res["push_1mb_ms"] = round(float(t), 1)
time.sleep(2)
a, w = rss_total()
res["rss_7_windows_mb"] = {"app": round(a), "webkit": round(w)}
res["bundle"] = subprocess.run(["du", "-sh", "/tmp/litemd-e2e/darwin-arm64/LiteMd.app"], capture_output=True, text=True).stdout.split()[0]
print(json.dumps(res, ensure_ascii=False, indent=1))
stop()
