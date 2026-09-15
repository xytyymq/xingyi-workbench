#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_points.py — 星羿积分「到课1节」每日自动发放
读 class_records.csv（fetch_records.py 产出）→ 按 学员×日期 去重发放 +10
（src=auto, reason=到课1节）→ GET 云端 data/points.json 合并(保留教练手动分)
→ PUT 推回。auto 记录以 aid=A|到课1节|姓名|日期 去重，不重复发放。
用法：python gen_points.py            # 正式运行（取数→合并→推送）
      python gen_points.py dry        # 只计算并打印，不推送（预览）
"""
import os, re, sys, json, base64, csv, uuid, urllib.request, urllib.error
from datetime import date, datetime, timedelta

WD = os.path.dirname(os.path.abspath(__file__))
REPO = "xytyymq/xingyi-workbench"
POINTS_PATH = "data/points.json"
CSV_PATH = os.path.join(WD, "class_records.csv")
LOCAL_POINTS = os.path.join(WD, "data", "points.json")
CUTOFF = date(2026, 9, 1)   # 只自动发放 2026-09 起（对齐老板口径；如需回溯 8 月改此值）
DELTA = 10
REASON = "到课1节"


def resolve_token():
    t = os.environ.get("GITHUB_TOKEN")
    if t:
        return t
    try:
        env = open(os.path.join(WD, ".env")).read()
        return env.split("GITHUB_TOKEN=")[1].split("\n")[0].strip().strip('"')
    except Exception:
        return ""


TOKEN = resolve_token()


def parse_date(s):
    s = str(s).strip()
    if re.fullmatch(r"\d{4,5}", s):
        try:
            return date(1899, 12, 30) + timedelta(days=int(s))
        except Exception:
            pass
    m = re.search(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"(\d{1,2})[.月/ ](\d{1,2})", s)
    if m:
        return date(2026, int(m.group(1)), int(m.group(2)))
    return None


def split_students(s):
    s = str(s).strip()
    if not s:
        return []
    # 兼容 / 、 , ， 以及空格（如「振洪宇 振洪新」）分隔的多名学员
    parts = re.split(r"[、,，/\s]+", s)
    return [p.strip() for p in parts if p.strip()]


def get_remote_points():
    url = f"https://api.github.com/repos/{REPO}/contents/{POINTS_PATH}?ref=main"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"})
    d = json.load(urllib.request.urlopen(req))
    arr = json.loads(base64.b64decode(d["content"]).decode("utf-8"))
    return arr, d["sha"]


def put_remote_points(arr, sha):
    url = f"https://api.github.com/repos/{REPO}/contents/{POINTS_PATH}"
    body = {
        "message": f"学员积分自动发放 {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "content": base64.b64encode(json.dumps(arr, ensure_ascii=False, indent=2).encode("utf-8")).decode("ascii"),
        "sha": sha,
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"},
        method="PUT",
    )
    return urllib.request.urlopen(req).status


def main():
    dry = len(sys.argv) > 1 and sys.argv[1].lower() in ("dry", "--dry")
    # 基线：优先云端最新（确保保留教练手动加分），失败回退本地
    try:
        baseline, sha = get_remote_points()
        offline = False
    except Exception as e:
        print("⚠️ 获取云端 points.json 失败，回退本地:", e)
        baseline = json.load(open(LOCAL_POINTS, encoding="utf-8"))
        sha = None
        offline = True
    src_label = "本地" if offline else "云端"
    print(f"基线 points.json: {len(baseline)} 条 (源={src_label})")

    exist_auto = {e.get("aid") for e in baseline if isinstance(e, dict) and e.get("src") == "auto"}
    manual_cnt = sum(1 for e in baseline if isinstance(e, dict) and e.get("src") != "auto")

    rows = list(csv.reader(open(CSV_PATH, encoding="utf-8-sig")))
    hdr = rows[0]
    ci_s = hdr.index("学员")
    ci_d = hdr.index("日期")
    seen = set()
    candidates = []
    total_pairs = 0
    for r in rows[1:]:
        if not any(r):
            continue
        stu = r[ci_s] if ci_s < len(r) else ""
        d = parse_date(r[ci_d] if ci_d < len(r) else "")
        if not d or d < CUTOFF:
            continue
        for nm in split_students(stu):
            key = (nm, d.isoformat())
            if key in seen:
                continue
            seen.add(key)
            total_pairs += 1
            aid = f"A|{REASON}|{nm}|{d.isoformat()}"
            if aid in exist_auto:
                continue
            candidates.append({
                "aid": aid, "name": nm, "delta": DELTA, "reason": REASON,
                "memo": "按上课记录自动发放", "by": "系统自动",
                "date": d.isoformat(), "src": "auto",
                "_id": "AUTO" + uuid.uuid4().hex,
                "createdAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            })

    print(f"9月起到课 学员×日期 去重 {total_pairs} 对 | 新增待发 {len(candidates)} 条 | "
          f"已存在(auto)跳过 {total_pairs - len(candidates)} 条 | 保留手动分 {manual_cnt} 条")

    if not candidates:
        print("✅ 无新增到课积分，points.json 无需更新")
        return

    final = baseline + candidates
    if dry or offline:
        json.dump(final, open(LOCAL_POINTS, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"✅ {'dry预览' if dry else '离线'} 写出本地 data/points.json ({len(final)} 条)，{'未推送' if dry else '云端不可达'}")
        return
    status = put_remote_points(final, sha)
    print(f"✅ 推送 points.json (HTTP {status}) | 总 {len(final)} 条 | 新增 {len(candidates)} 条到课积分")


if __name__ == "__main__":
    main()
