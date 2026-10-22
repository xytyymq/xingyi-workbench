#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
revenue_regen.py — 营收自动刷新（云端可跑，零腾讯依赖）

只做一件事：读取现有 data/principal-report.json，调用 gen_principal_report 里
"纯 GitHub API + 算术" 的 read_revenue() / read_week_revenue() 重算
finance.revenue 与 finance.week（来自 data/revenue-ledger.json），写回仓库。

不碰：
  - 腾讯文档取数（线索/上课/巡课/体测）——那需要宿主注入的登录票据，只能在本地跑全量生成器；
  - 其余灯级/漏斗——保留上次全量生成的结果，不被覆盖。

触发：GitHub Action 在 data/revenue-ledger.json 被改（on push）或每日定时（on schedule）时调用。
鉴权：环境变量 GITHUB_TOKEN（GitHub Actions 自动注入，或本地 .env）。
"""
import os, sys, json, base64, datetime, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_principal_report as G

REPO = "xytyymq/xingyi-workbench"
BRANCH = "main"
DATA = "data/principal-report.json"


def read_current(tok):
    api = f"https://api.github.com/repos/{REPO}/contents/{DATA}?ref={BRANCH}"
    req = urllib.request.Request(api, headers={
        "Authorization": f"Bearer {tok}", "User-Agent": "xy-revenue-regen",
        "Accept": "application/vnd.github+json"})
    m = json.loads(urllib.request.urlopen(req, timeout=60).read())
    return json.loads(base64.b64decode(m["content"]).decode("utf-8")), m["sha"]


def main():
    tok = os.environ.get("GITHUB_TOKEN")
    if not tok:
        print("错误：缺少 GITHUB_TOKEN 环境变量"); sys.exit(1)

    report, _sha = read_current(tok)
    rev = G.read_revenue()
    wk = G.read_week_revenue()
    report.setdefault("finance", {})
    report["finance"]["revenue"] = rev
    report["finance"]["week"] = wk
    report["generated_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M") + "（营收自动刷新）"

    payload = json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8")
    here = os.path.dirname(os.path.abspath(__file__))
    # 本地留档（便于本地渲染长图，也便于排查）
    with open(os.path.join(here, "principal_report.json"), "w", encoding="utf-8") as f:
        f.write(payload.decode("utf-8"))
    with open(os.path.join(here, DATA), "w", encoding="utf-8") as f:
        f.write(payload.decode("utf-8"))

    new_sha = G.push_file(DATA, payload,
                          f"chore: 营收自动刷新 month_total={rev['month_total']} week_this={wk['this_week']['total']}")
    print(f"OK 营收刷新：month_total={rev['month_total']} 本周={wk['this_week']['total']} 上周={wk['last_week']['total']} commit={(new_sha or '')[:7]}")


if __name__ == "__main__":
    main()
