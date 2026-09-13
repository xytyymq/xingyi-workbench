#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_parent_msg.py — 星羿羽毛球馆 · 家长消息夜间生成器
读取《学员上课记录》CSV -> 套用模板 -> 更新 GitHub Pages 仓库的 data/parent-msg.json

设计目标：无状态、可在 WorkBuddy 自动化环境运行（仅需网络 + GITHUB_TOKEN）。
旧版 gen_parent_msg.py 因系统重装丢失，此脚本按历史消息反推的模板等价重写。
"""
import argparse, base64, csv, datetime, json, os, re, urllib.request, urllib.error

REPO = os.environ.get("XY_REPO", "xytyymq/xingyi-workbench")
BRANCH = os.environ.get("XY_BRANCH", "main")
DATA_PATH = "data/parent-msg.json"
API = f"https://api.github.com/repos/{REPO}/contents/{DATA_PATH}"

# CSV 列名映射（兼容中英文表头，取第一个命中）
COLMAP = {
    "date":  ["日期", "date", "训练日期", "上课日期", "时间"],
    "names": ["学员", "姓名", "学生", "names", "学员姓名"],
    "class": ["班级", "班型", "class", "课程"],
    "coach": ["教练", "coach", "带课教练"],
    "good":  ["今日进步", "进步", "good", "亮点", "表扬", "进步点"],
    "bad":   ["下节课重点", "重点", "待加强", "bad", "需改进", "改进"],
}


def resolve_token():
    """优先用环境变量 GITHUB_TOKEN；没有则从脚本同目录的 .env 读取（便于夜间自动化在本工作区直接运行）。"""
    t = os.environ.get("GITHUB_TOKEN")
    if t:
        return t
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            s = line.strip()
            if s.startswith("GITHUB_TOKEN="):
                return s.split("=", 1)[1].strip().strip('"')
    return None


def map_cols(header):
    h = [str(x).strip() for x in header]
    out = {}
    for key, cands in COLMAP.items():
        for i, name in enumerate(h):
            if name in cands or name.lower() in [c.lower() for c in cands]:
                out[key] = i
                break
    return out


def parse_date(s):
    s = str(s).strip()
    # 完整日期：2026-09-12 / 2026/9/12 / 2026年9月12日（先吞掉4位年份）
    m = re.search(r'(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})', s)
    if m:
        return int(m.group(2)), int(m.group(3))
    # M月D日 / M-D / M.D
    m = re.search(r'(\d{1,2})\s*[月./-]\s*(\d{1,2})', s)
    if m:
        return int(m.group(1)), int(m.group(2))
    # "9 10" 空格分隔
    m = re.search(r'(\d{1,2})\s+(\d{1,2})', s)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def fmt_key(month, day):
    return f"{month}.{day}"


def fmt_display(month, day):
    return f"{month}月{day}日"


def build_msg(names_str, cls, coach, good, bad, month, day):
    lines = ["【星羿少儿羽毛球 · 今日训练反馈】",
             f"{names_str}家长您好，孩子今天{cls}的训练已完成 ✅"]
    if good and good.strip():
        lines.append(f"🌟 今日进步：{good.strip()}")
    if bad and bad.strip():
        lines.append(f"💪 下节课重点：{bad.strip()}")
    lines.append(f"教练：{coach}")
    lines.append("—————————")
    lines.append(f"📅 {fmt_display(month, day)}　星羿羽毛球馆")
    return "\n".join(lines)


def sortkey(k):
    try:
        a, b = k.replace(" ", ".").split(".")
        return (int(a), int(b))
    except Exception:
        return (0, 0)


def load_existing(token):
    if token:
        try:
            req = urllib.request.Request(API, headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                obj = json.load(r)
                data = json.loads(base64.b64decode(obj["content"]))
                return data, obj.get("sha")
        except Exception as e:
            print("warn: 取现有文件失败，改用自己的本地/空:", e)
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, encoding="utf-8") as f:
            return json.load(f), None
    return {"updated": "", "latest": "", "dates": [], "messages": {}}, None


def github_put(token, content_str, sha):
    body = {"message": f"chore: 更新家长消息 {datetime.datetime.now():%Y-%m-%d %H:%M}",
            "content": base64.b64encode(content_str.encode("utf-8")).decode("ascii"),
            "branch": BRANCH}
    if sha:
        body["sha"] = sha
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API, data=data, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def main():
    global REPO, BRANCH, API
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--token", default=resolve_token())
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--branch", default=BRANCH)
    args = ap.parse_args()

    REPO = args.repo
    BRANCH = args.branch
    API = f"https://api.github.com/repos/{REPO}/contents/{DATA_PATH}"

    rows = []
    with open(args.csv, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
        cmap = map_cols(header)
        for r in reader:
            if not any(c.strip() for c in r):
                continue
            if len(r) <= max(cmap.values(), default=-1):
                print("skip 列不足行:", r)
                continue
            rows.append({k: (r[i] if i < len(r) else "") for k, i in cmap.items()})

    existing, sha = load_existing(args.token)
    messages = existing.get("messages", {})
    added = 0

    for d in rows:
        month, day = parse_date(d.get("date", ""))
        if not month:
            print("skip 无日期行:", d)
            continue
        names_str = (d.get("names") or "").strip()
        if not names_str:
            continue
        cls = (d.get("class") or "基础班").strip() or "基础班"
        coach = (d.get("coach") or "").strip()
        good = (d.get("good") or "").strip()
        bad = (d.get("bad") or "").strip()
        key = fmt_key(month, day)
        msg_text = build_msg(names_str, cls, coach, good, bad, month, day)
        entry = {"names": [names_str], "class": cls, "coach": coach,
                 "good": good, "bad": bad, "msg": msg_text}
        msgs = messages.setdefault(key, [])
        if not any((e.get("names") or [""])[0] == names_str for e in msgs):
            msgs.append(entry)
            added += 1

    dates = sorted(messages.keys(), key=sortkey, reverse=True)
    out = {"updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
           "latest": dates[0] if dates else existing.get("latest", ""),
           "dates": dates,
           "messages": messages}
    content_str = json.dumps(out, ensure_ascii=False, indent=1)

    os.makedirs(os.path.dirname(DATA_PATH) or ".", exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        f.write(content_str)

    if args.token:
        st = github_put(args.token, content_str, sha)
        print(f"已推送 parent-msg.json (HTTP {st})，本次新增 {added} 条")
    else:
        print(f"未推送（无 GITHUB_TOKEN）。本地已生成 {DATA_PATH}，本次新增 {added} 条。")
    print("updated:", out["updated"], "| latest:", out["latest"], "| 总日期数:", len(dates))


if __name__ == "__main__":
    main()
