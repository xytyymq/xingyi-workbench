#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_parent_msg.py — 星羿羽毛球馆 · 家长消息夜间生成器
读取《学员上课记录》CSV -> 套用模板 -> 更新 GitHub Pages 仓库的 data/parent-msg.json

升级(2026-09-21)：
  - 「🏠 家庭小练习」：根据教练录的「待加强」关键词映射成在家可练的小建议（规则映射，零成本）
  - 「🤝 转介绍钩子」：仅「关键时刻」触发(进步明显 / 积分里程碑 / 体测达标)，日常不打扰；软性版不绑具体积分数字
  - 里程碑判定读本地 data/points.json / data/profiles.json；读不到则离线降级(仅进步明显触发)

设计目标：无状态、可在 WorkBuddy 自动化环境运行（仅需网络 + GITHUB_TOKEN）。
"""
import argparse, base64, csv, datetime, json, os, re, urllib.request, urllib.error

REPO = os.environ.get("XY_REPO", "xytyymq/xingyi-workbench")
BRANCH = os.environ.get("XY_BRANCH", "main")
DATA_PATH = "data/parent-msg.json"
API = f"https://api.github.com/repos/{REPO}/contents/{DATA_PATH}"

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_POINTS = os.path.join(HERE, "data", "points.json")
DATA_PROFILES = os.path.join(HERE, "data", "profiles.json")

# CSV 列名映射（兼容中英文表头，取第一个命中）
COLMAP = {
    "date":  ["日期", "date", "训练日期", "上课日期", "时间"],
    "names": ["学员", "姓名", "学生", "names", "学员姓名"],
    "class": ["班级", "班型", "class", "课程"],
    "coach": ["教练", "coach", "带课教练"],
    "good":  ["今日进步", "进步", "good", "亮点", "表扬", "进步点"],
    "bad":   ["下节课重点", "重点", "待加强", "bad", "需改进", "改进"],
}

# ===== 训练建议 · 规则映射（待加强关键词 -> 家庭小练习）=====
ADVICE_MAP = [
    (["步伐", "步法", "移动", "启动", "跑动"], "在家原地拖步 3 组×20 秒，练脚下频率与启动反应"),
    (["发球", "高远球", "挑球", "打高"], "对墙打高远球 20 个，体会蹬转→展臂的发力顺序"),
    (["挥拍", "架拍", "动作", "姿势"], "空拍挥拍 30 次，注意架拍高度与手腕固定"),
    (["体能", "耐力", "体力", "力量", "素质"], "跳绳 1 分钟×3 组（间隔休息），提升心肺与腿部力量"),
    (["专注", "注意力", "集中", "走神"], "在家做 5 分钟颠球计数小游戏，练稳定性与专注"),
    (["接杀", "防守", "反应", "手感"], "家长轻抛球让孩子接 20 个×2 组，练反应与手感"),
    (["网前", "搓球", "放网", "勾对角"], "对墙轻搓 15 个，体会手腕轻送与控点"),
    (["吊球", "劈吊", "落点", "控制"], "对墙定点吊球 15 个，练落点控制与手腕切换"),
    (["握拍", "换握", "正手", "反手"], "空手练习正/反手握拍切换 20 次，形成肌肉记忆"),
]

# 正向强词：good 命中即视为「进步明显」(转介绍钩子触发条件 A)
PROGRESS_WORDS = ["明显", "很大", "进步快", "表扬", "突出", "飞跃", "突破", "很棒", "优秀", "达标", "超预期"]

# 转介绍钩子(软性版：提免费试课+专属成长礼，不绑具体积分数字)
REFERRAL_HOOK = ("🤝 孩子最近进步很明显！身边有同龄小朋友也想练羽毛球的，"
                 "欢迎带朋友来免费试课～老学员推荐好友还有【专属成长礼】🎁")

# 积分里程碑阈值：累计到课积分达此值即视为「稳定在读」(触发条件 B)
POINTS_MILESTONE = 100

# 体测正向词：最新体测 note 命中即视为「体测有成长」(触发条件 C)
PROFILE_WORDS = ["优秀", "达标", "突破", "明显", "很大", "进步"]


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
    # Excel 序列号日期（如 46275 = 2026-09-10）
    if re.fullmatch(r"\d{4,5}", s):
        n = int(s)
        if 40000 <= n <= 60000:
            dt = datetime.date(1899, 12, 30) + datetime.timedelta(days=n)
            return dt.month, dt.day
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


def build_advice(bad):
    """根据待加强关键词映射家庭小练习；无命中返回空(不瞎编)。"""
    if not bad or not bad.strip():
        return ""
    for kws, txt in ADVICE_MAP:
        if any(k in bad for k in kws):
            return txt
    return ""


def is_progress_strong(good):
    """good 命中强正向词 -> 进步明显(钩子触发条件 A)。"""
    if not good:
        return False
    return any(w in good for w in PROGRESS_WORDS)


def load_local_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def load_milestone_data():
    """加载积分累计表 + 体测按名索引（离线降级：返回空）。"""
    pts_acc = {}
    raw = load_local_json(DATA_POINTS)
    if isinstance(raw, list):
        for e in raw:
            nm = (e.get("name") or "").strip()
            if not nm:
                continue
            try:
                d = int(e.get("delta") or 0)
            except Exception:
                d = 0
            pts_acc[nm] = pts_acc.get(nm, 0) + d
    elif isinstance(raw, dict):
        for e in raw.get("list", raw.get("points", [])):
            nm = (e.get("name") or "").strip()
            if not nm:
                continue
            try:
                d = int(e.get("delta") or 0)
            except Exception:
                d = 0
            pts_acc[nm] = pts_acc.get(nm, 0) + d

    prof_by_name = {}
    prof = load_local_json(DATA_PROFILES)
    if isinstance(prof, list):
        for e in prof:
            nm = (e.get("name") or "").strip()
            if nm:
                prof_by_name[nm] = e
    elif isinstance(prof, dict):
        for e in prof.get("list", []):
            nm = (e.get("name") or "").strip()
            if nm:
                prof_by_name[nm] = e
    return pts_acc, prof_by_name


def milestone_for(names_str, pts_acc, prof_by_name):
    """转介绍钩子触发条件 B/C（积分里程碑 / 体测达标）。"""
    names = [n for n in re.split(r"[、,，/ ]+", (names_str or "").strip()) if n]
    # B: 积分累计达阈值
    for n in names:
        if pts_acc.get(n, 0) >= POINTS_MILESTONE:
            return True
    # C: 最新体测 note 命中正向词
    for n in names:
        e = prof_by_name.get(n)
        if not e:
            continue
        tests = e.get("tests") or []
        if tests:
            note = (tests[-1].get("note") or "")
            if any(w in note for w in PROFILE_WORDS):
                return True
    return False


def build_msg(names_str, cls, coach, good, bad, month, day, advice="", hook=False):
    lines = ["【星羿少儿羽毛球 · 今日训练反馈】",
             f"{names_str}家长您好，孩子今天{cls}的训练已完成 ✅"]
    if good and good.strip():
        lines.append(f"🌟 今日进步：{good.strip()}")
    if bad and bad.strip():
        lines.append(f"💪 下节课重点：{bad.strip()}")
    if advice:
        lines.append(f"🏠 家庭小练习：{advice}")
    if hook:
        lines.append(REFERRAL_HOOK)
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

    # 里程碑判定数据（本地读取，离线降级）
    pts_acc, prof_by_name = load_milestone_data()
    milestone_ready = bool(pts_acc or prof_by_name)
    print(f"里程碑数据源: {'本地 points/profiles' if milestone_ready else '离线降级(仅进步明显触发)'} "
          f"| 积分索引 {len(pts_acc)} 人 | 体测索引 {len(prof_by_name)} 人")

    existing, sha = load_existing(args.token)
    raw_msgs = existing.get("messages", {})
    norm_msgs = {}
    for k, v in raw_msgs.items():
        m, d = parse_date(k)
        nk = fmt_key(m, d) if m else k
        if nk in norm_msgs:
            seen = {(e.get("names") or [""])[0] for e in norm_msgs[nk]}
            for e in v:
                if (e.get("names") or [""])[0] not in seen:
                    norm_msgs[nk].append(e)
        else:
            norm_msgs[nk] = list(v)
    existing["messages"] = norm_msgs
    messages = norm_msgs
    added = 0
    hook_count = 0
    advice_count = 0

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
        coach = re.sub(r"\d+$", "", coach).strip()
        good = (d.get("good") or "").strip()
        bad = (d.get("bad") or "").strip()
        key = fmt_key(month, day)

        advice = build_advice(bad)
        hook = is_progress_strong(good) or milestone_for(names_str, pts_acc, prof_by_name)
        if advice:
            advice_count += 1
        if hook:
            hook_count += 1

        msg_text = build_msg(names_str, cls, coach, good, bad, month, day, advice, hook)
        entry = {"names": [names_str], "class": cls, "coach": coach,
                 "good": good, "bad": bad, "advice": advice, "hook": hook, "msg": msg_text}
        msgs = messages.setdefault(key, [])
        replaced = False
        for i, e in enumerate(msgs):
            if (e.get("names") or [""])[0] == names_str:
                msgs[i] = entry
                replaced = True
                break
        if not replaced:
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
    print(f"updated: {out['updated']} | latest: {out['latest']} | 总日期数: {len(dates)}")
    print(f"含家庭小练习 {advice_count} 条 | 含转介绍钩子 {hook_count} 条")


if __name__ == "__main__":
    main()
