# -*- coding: utf-8 -*-
"""
校长日报长图 · 自动出图并上传
流程：
 1) 用 chrome-headless-shell --dump-dom 打开 report-card.html?shot=1，读取真实内容高度
 2) 用该高度 --screenshot 出图（无底部空白、无保存按钮）
 3) 上传到仓库 report-card-latest.png + report-card-<data_date>.png
全部 best-effort：任何一步失败只打印日志，不抛异常、不阻断主流程。
"""
import base64, glob, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error

REPO = "xytyymq/xingyi-workbench"
BRANCH = "main"
PAGE = os.environ.get("CARD_URL", "https://xytyymq.github.io/xingyi-workbench/report-card.html")
PAGE_SHOT = PAGE + "?shot=1"
TOKEN_FILE = r"C:\Users\Administrator\WorkBuddy\2026-09-21-20-34-00\gh_pat.txt"
WORKDIR = r"C:\Users\Administrator\WorkBuddy\2026-10-14-01-09-15"


def find_chrome():
    pats = [
        # Windows（本地）
        r"C:\Users\Administrator\AppData\Local\ms-playwright\chromium_headless_shell-*\chrome-headless-shell-win64\chrome-headless-shell.exe",
        r"C:\Users\Administrator\AppData\Local\ms-playwright\chromium-*\chrome-win\chrome.exe",
        # Linux / CI（playwright install chromium 安装位置）
        os.path.expanduser(r"~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/chrome-headless-shell"),
        os.path.expanduser(r"~/.cache/ms-playwright/chromium-*/chrome-linux/chrome"),
        "/github/home/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/chrome-headless-shell",
    ]
    for p in pats:
        hits = sorted(glob.glob(p))
        if hits:
            return hits[-1]
    # 最后兜底：PATH 中查找
    for name in ("chrome-headless-shell", "chromium", "chromium-browser", "google-chrome"):
        c = shutil.which(name)
        if c:
            return c
    return None


def run_chrome(chrome, args, timeout=90):
    cmd = [chrome, "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars"] + args
    r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    return r


def measure_height(chrome):
    r = run_chrome(chrome, ["--virtual-time-budget=9000", "--window-size=460,1200", "--dump-dom", PAGE_SHOT])
    dom = r.stdout.decode("utf-8", "ignore")
    m = re.search(r'data-shot-h="(\d+)"', dom)
    if not m:
        return None
    h = int(m.group(1))
    return max(600, min(4400, h))


def shoot(chrome, height, out_png):
    # device scale 2 => 高清
    r = run_chrome(chrome, [
        "--virtual-time-budget=9000",
        f"--window-size=460,{height}",
        "--force-device-scale-factor=2",
        f"--screenshot={out_png}",
        PAGE_SHOT,
    ])
    return os.path.exists(out_png) and os.path.getsize(out_png) > 20000



def _read_full(resp):
    """分块读完响应。
    注意：本机到 api.github.com 的连接会在响应中途被掐断（声明 951 字节却只吐 601 字节），
    抛出 IncompleteRead。此时不能拿"半截数据"去解析 JSON —— 必须把异常抛给上层重试，
    否则会得到 JSONDecodeError 这类误导性报错。"""
    raw = b""
    while True:
        buf = resp.read(65536)
        if not buf:
            break
        raw += buf
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
            txt = base64.b64decode(j["content"]).decode("utf-8")
            return json.loads(txt).get("data_date") or "latest"
        except Exception:
            pass
    return "latest"


def upload(png_path, repo_path, date_str):
    with open(png_path, "rb") as f:
        content = base64.b64encode(f.read()).decode("ascii")
    cur = gh_api("GET", repo_path)
    sha = cur.get("sha") if isinstance(cur, dict) else None
    payload = {"message": f"chore: 校长日报长图自动出图 {date_str}", "content": content, "branch": BRANCH}
    if sha:
        payload["sha"] = sha
    res = gh_api("PUT", repo_path, payload)
    ok = isinstance(res, dict) and res.get("commit")
    print(f"  {'OK ' if ok else 'FAIL'} {repo_path} -> {(res.get('commit') or {}).get('sha','')[:8] if ok else json.dumps(res)[:160]}")
    return ok


def main():
    chrome = find_chrome()
    if not chrome:
        print("[card-png] 未找到 chrome，跳过（不影响主流程）")
        return 0
    dd = data_date()
    h = measure_height(chrome)
    if not h:
        print("[card-png] 未能读取内容高度，回退 1600")
        h = 1600
    print(f"[card-png] data_date={dd} 内容高度={h}")
    out = os.path.join(tempfile.gettempdir(), f"report-card-{dd}.png")
    if not shoot(chrome, h, out):
        print("[card-png] 截图失败，跳过")
        return 0
    size_kb = os.path.getsize(out) // 1024
    print(f"[card-png] 出图 OK {size_kb}KB -> {out}")
    upload(out, "report-card-latest.png", dd)
    if dd and dd != "latest":
        upload(out, f"report-card-{dd}.png", dd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
