# -*- coding: utf-8 -*-
"""校长周报长图 · 自动出图并上传
流程：
 1) 用 chrome-headless-shell --dump-dom 打开 weekly-report-card.html?shot=1，读取真实内容高度
 2) 用该高度 --screenshot 出图（2 倍高清、无底部空白、无保存按钮）
 3) 上传到仓库 weekly-report-card-latest.png + weekly-report-card-<data_date>.png
全部 best-effort：任何一步失败只打印日志，不抛异常、不阻断主流程。
"""
import base64, glob, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error

REPO = "xytyymq/xingyi-workbench"
BRANCH = "main"
PAGE = os.environ.get("WEEK_CARD_URL", "https://xytyymq.github.io/xingyi-workbench/weekly-report-card.html")
PAGE_SHOT = PAGE + "?shot=1"
TOKEN_FILE = r"C:\Users\Administrator\WorkBuddy\2026-09-21-20-34-00\gh_pat.txt"


def find_chrome():
    pats = [
        r"C:\Users\Administrator\AppData\Local\ms-playwright\chromium_headless_shell-*\chrome-headless-shell-win64\chrome-headless-shell.exe",
        r"C:\Users\Administrator\AppData\Local\ms-playwright\chromium-*\chrome-win\chrome.exe",
        os.path.expanduser(r"~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/chrome-headless-shell"),
        os.path.expanduser(r"~/.cache/ms-playwright/chromium-*/chrome-linux/chrome"),
        "/github/home/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/chrome-headless-shell",
    ]
    for p in pats:
        hits = sorted(glob.glob(p))
        if hits:
            return hits[-1]
    for name in ("chrome-headless-shell", "chromium", "chromium-browser", "google-chrome"):
        w = shutil.which(name)
        if w:
            return w
    return None


def run_chrome(chrome, args, timeout=120):
    cmd = [chrome, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars"] + args
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def measure_height(chrome):
    # 用「矮视口」测高：视口远小于内容时 documentElement.scrollHeight 才等于真实内容高；
    # 若用高视口，scrollHeight 会被视口撑大，导致出图底部大片留白。
    r = run_chrome(chrome, ["--virtual-time-budget=12000", "--window-size=480,360", "--dump-dom", PAGE_SHOT])
    dom = r.stdout.decode("utf-8", "ignore")
    m = re.search(r'data-shot-h="(\d+)"', dom)
    if not m:
        return None
    h = int(m.group(1))
    if h <= 360:          # 视口没被内容撑开 → 量高失败
        return None
    return max(700, min(4400, h))


def shoot(chrome, height, out_png):
    r = run_chrome(chrome, [
        "--virtual-time-budget=12000",
        f"--window-size=480,{height}",
        "--force-device-scale-factor=2",
        f"--screenshot={out_png}",
        PAGE_SHOT,
    ])
    return os.path.exists(out_png) and os.path.getsize(out_png) > 20000



def _read_full(resp):
    """分块读完响应，处理 IncompleteRead（长连接被掐断）。"""
    raw = b""
    while True:
        try:
            buf = resp.read(65536)
            if not buf:
                break
            raw += buf
        except Exception as e:
            partial = getattr(e, "partial", None)
            if partial:
                raw += partial
            break
    return raw


def gh_api(method, path, data=None):
    url = f"https://api.github.com/repos/{REPO}/contents/{path}?ref={BRANCH}"
    req = urllib.request.Request(url, method=method)
    tok = os.environ.get("GITHUB_TOKEN") or (
        open(TOKEN_FILE, encoding="utf-8").read().strip() if os.path.exists(TOKEN_FILE) else "")
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "workbuddy-card-png")
    if data is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(data).encode("utf-8")
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(_read_full(resp).decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                body = json.loads(e.read().decode("utf-8"))
            except Exception:
                body = {"error": str(e)}
            if e.code in (409, 422) and attempt < 3:
                time.sleep(1.5 * (attempt + 1))
                continue
            return body
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            print(f"    [retry {attempt+1}/3] {last}")
            time.sleep(2.0 * (attempt + 1))
            # 重建请求（urllib.Request 的 data 不可复用）
            req = urllib.request.Request(url, method=method)
            req.add_header("Authorization", "Bearer " + tok)
            req.add_header("Accept", "application/vnd.github+json")
            req.add_header("User-Agent", "workbuddy-card-png")
            if data is not None:
                req.add_header("Content-Type", "application/json")
                req.data = json.dumps(data).encode("utf-8")
    return {"error": str(last)}

def data_date():
    j = gh_api("GET", "data/principal-report.json")
    if isinstance(j, dict) and j.get("content"):
        try:
            return json.loads(base64.b64decode(j["content"]).decode("utf-8")).get("data_date") or "latest"
        except Exception:
            pass
    return "latest"


def upload(png_path, repo_path, date_str):
    with open(png_path, "rb") as f:
        content = base64.b64encode(f.read()).decode("ascii")
    cur = gh_api("GET", repo_path)
    sha = cur.get("sha") if isinstance(cur, dict) else None
    payload = {"message": f"chore: 校长周报长图自动出图 {date_str}", "content": content, "branch": BRANCH}
    if sha:
        payload["sha"] = sha
    res = gh_api("PUT", repo_path, payload)
    ok = isinstance(res, dict) and res.get("commit")
    print(f"  {'OK ' if ok else 'FAIL'} {repo_path} -> {(res.get('commit') or {}).get('sha','')[:8] if ok else json.dumps(res, ensure_ascii=False)[:160]}")
    return ok


def main():
    chrome = find_chrome()
    if not chrome:
        print("[week-card] 未找到 chrome，跳过（不影响主流程）")
        return 0
    dd = data_date()
    h = measure_height(chrome)
    if not h:
        print("[week-card] 未能读取内容高度，回退 2400")
        h = 2400
    print(f"[week-card] data_date={dd} 内容高度={h}")
    out = os.path.join(tempfile.gettempdir(), f"weekly-report-card-{dd}.png")
    if not shoot(chrome, h, out):
        print("[week-card] 截图失败，跳过")
        return 0
    print(f"[week-card] 出图 OK {os.path.getsize(out)//1024}KB -> {out}")
    upload(out, "weekly-report-card-latest.png", dd)
    if dd and dd != "latest":
        upload(out, f"weekly-report-card-{dd}.png", dd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
