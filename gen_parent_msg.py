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
import argparse, base64, csv, datetime, hashlib, json, os, re, time, urllib.request, urllib.error

REPO = os.environ.get("XY_REPO", "xytyymq/xingyi-workbench")
BRANCH = os.environ.get("XY_BRANCH", "main")
DATA_PATH = "data/parent-msg.json"
API = f"https://api.github.com/repos/{REPO}/contents/{DATA_PATH}"

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_POINTS = os.path.join(HERE, "data", "points.json")
DATA_PROFILES = os.path.join(HERE, "data", "profiles.json")

# 教练填表错别字/异体字映射（与上课记录同步管线保持一致，发现新错法两处都加）
# ⚠️ 方向 = 错字 → 正确名。2026-10-09 大哥裁定：邓琬宁/徐梓辰/彭嘉妤 为准，
#    原先把「徐梓辰→徐梓宸」映射成错字，已反转。
NAME_ALIAS = {
    "徐梓宸": "徐梓辰", "彭嘉妤": "彭嘉好", "彭佳妤": "彭嘉好",
    "邓琬妮": "邓琬宁",
    "熊沁杰尼": "熊沁杰妮",
    "黄文晧": "黄文皓", "振洪宇": "洪振宇", "振洪新": "洪振新",
    "邹书云": "邹书芸",
}


def canon_names(names_str):
    """学员列纠错：拆分（/、,，空格）→ 别名纠正 → 重新拼接。"""
    parts = re.split(r"[/、,，\s　]+", str(names_str or "").strip())
    fixed = [NAME_ALIAS.get(p.strip(), p.strip()) for p in parts if p.strip()]
    return "、".join(fixed)

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
    (["步伐", "步法", "移动", "启动", "跑动"], "每天在家跳绳1分钟，练脚下频率与启动反应"),
    (["发球", "高远球", "挑球", "打高"], "原地蹬转对墙扔球 20个一组×3组，体会蹬转→展臂发力顺序"),
    (["挥拍", "架拍", "动作", "姿势"], "空拍原地蹬转挥拍 30 次，注意架拍高度与手腕固定"),
    (["体能", "耐力", "体力", "力量", "素质"], "不间断跳绳 2 分钟，提升心肺与腿部力量"),
    (["专注", "注意力", "集中", "走神"], "在家做 5 分钟颠球计数小游戏"),
    (["接杀", "防守", "反应", "手感"], "家长轻抛球让孩子接 20 个×2 组"),
    (["网前", "搓球", "放网", "勾对角"], "轻轻颠球5分钟，体会手腕轻送与控点"),
    (["吊球", "劈吊", "落点", "控制"], "在家随便找一个箱子保持一定距离把球打进去，打50个，练落点控制"),
    (["握拍", "换握", "正手", "反手"], "空手练习正/反手握拍颠球切换握拍 20 次"),
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

# ===== 转介绍钩子发送策略（2026-10-03 改）=====
# 不每天发：同一学员 14 天内最多 1 次 + 随机概率，避免打扰。
HOOK_PROB = 0.6                  # 冷却期外、每次有资格时随机发的概率（可调）
HOOK_COOLDOWN_DAYS = 14          # 同一学员两次钩子最小间隔（天）


def _hook_doy(month, day):
    """M.D -> 年内 day-of-year（跨年边界忽略，足够本场景）。"""
    try:
        return (datetime.date(2026, int(month), int(day)) - datetime.date(2026, 1, 1)).days + 1
    except Exception:
        return 0


def _hook_md(key):
    m = re.match(r"(\d{1,2})\.(\d{1,2})", str(key))
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def should_send_hook(name, key, all_msgs):
    """转介绍钩子：同一学员 14 天冷却 + 随机概率。返回 True 才发。"""
    cur_m, cur_d = _hook_md(key)
    if not cur_m:
        return False
    cur = _hook_doy(cur_m, cur_d)
    # 查该学员历史是否近期已发过钩子（同日期自身跳过）
    for dk, entries in (all_msgs or {}).items():
        if dk == key:
            continue
        for e in (entries or []):
            names = [(n or "").strip() for n in (e.get("names") or [])]
            if name not in names:
                continue
            if not e.get("hook"):
                continue
            m, d = _hook_md(dk)
            if m and abs(_hook_doy(m, d) - cur) <= HOOK_COOLDOWN_DAYS:
                return False
    # 冷却外：按 学员+日期 固定种子随机，保证重跑幂等
    seed = int(hashlib.md5(("%s|%s" % (name, key)).encode("utf-8")).hexdigest(), 16)
    return (seed % 1000) / 1000.0 < HOOK_PROB


def reconcile_hooks(messages, pts_acc, prof_by_name):
    """对 messages 内【全部】条目统一重算 hook 标记（含历史遗留），保证整库一致：
       有资格 + 14 天冷却 + 固定种子随机。仅当标记变化时才重建 msg 文本。
       按日期升序处理，使冷却判定与输入顺序无关（幂等）。返回最终 hook 条数。"""
    items = []  # (datekey, name, entry)
    for key, entries in messages.items():
        for e in (entries or []):
            nm = (e.get("names") or [""])[0]
            if nm:
                items.append((key, nm, e))
    # 有资格判定
    def eligible_of(e):
        good = (e.get("good") or "").strip()
        nm = (e.get("names") or [""])[0]
        return is_progress_strong(good) or milestone_for(nm, pts_acc, prof_by_name)
    items.sort(key=lambda t: sortkey(t[0]))
    sent = {}  # name -> 上次发送 day-of-year
    for key, name, e in items:
        m, d = _hook_md(key)
        cur = _hook_doy(m, d) if m else 0
        # 历史兼容：advice 早期存成字符串，归一化为列表并重建文本
        adv = e.get("advice")
        adv_was_str = isinstance(adv, str)
        if adv_was_str:
            e["advice"] = [adv] if adv.strip() else []
        elig = eligible_of(e)
        if not elig:
            if e.get("hook"):
                e["hook"] = False
                _rebuild_msg(e, key, False)
            elif adv_was_str:
                _rebuild_msg(e, key, False)
            continue
        last = sent.get(name)
        cool = (last is not None) and abs(cur - last) <= HOOK_COOLDOWN_DAYS
        seed = int(hashlib.md5(("%s|%s" % (name, key)).encode("utf-8")).hexdigest(), 16)
        roll = (seed % 1000) / 1000.0 < HOOK_PROB
        new_hook = (not cool) and roll
        if new_hook:
            sent[name] = cur
        if bool(e.get("hook")) != new_hook:
            e["hook"] = new_hook
            _rebuild_msg(e, key, new_hook)
        elif adv_was_str:
            # 仅修正 advice 形态，钩子不变
            _rebuild_msg(e, key, bool(e.get("hook")))
    # 最终 hook 条数（避免重复计数）
    return sum(1 for _, _, e in items if e.get("hook"))


def _rebuild_msg(e, key, hook):
    """用条目既有字段重建 msg 文本（仅 hook 标记变化时使用）。"""
    nm = (e.get("names") or [""])[0]
    cls = (e.get("class") or "基础班").strip() or "基础班"
    coach = (e.get("coach") or "").strip()
    good = (e.get("good") or "").strip()
    bad = (e.get("bad") or "").strip()
    m, d = _hook_md(key)
    e["msg"] = build_msg(nm, cls, coach, good, bad, m or 1, d or 1, e.get("advice") or [], hook)


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
    """根据待加强关键词映射家庭小练习；命中几条出几条；无命中返回空列表(不瞎编)。"""
    if not bad or not bad.strip():
        return []
    hit = []
    for kws, txt in ADVICE_MAP:
        if any(k in bad for k in kws):
            hit.append(txt)
    # 去重保序（同一文案不会重复出现）
    seen, uniq = set(), []
    for t in hit:
        if t not in seen:
            seen.add(t); uniq.append(t)
    return uniq


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


def build_msg(names_str, cls, coach, good, bad, month, day, advice=None, hook=False):
    # 兼容历史：advice 早期版本存成字符串，这里统一成「列表」避免按字符遍历
    if isinstance(advice, str):
        advice = [advice] if advice.strip() else []
    else:
        advice = advice or []
    lines = ["【星羿少儿羽毛球 · 今日训练反馈】",
             f"{names_str}家长您好，孩子今天{cls}的训练已完成 ✅"]
    if good and good.strip():
        lines.append(f"🌟 今日进步：{good.strip()}")
    if bad and bad.strip():
        lines.append(f"💪 下节课重点：{bad.strip()}")
    if advice:
        if len(advice) == 1:
            lines.append(f"🏠 家庭小练习：{advice[0]}")
        else:
            lines.append("🏠 家庭小练习：")
            for t in advice:
                lines.append(f"· {t}")
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
        # 2026-10-07 实测：沙箱/GitHub 侧偶发 IncompleteRead 与写接口 500，
        # 单次 GET 失败会导致 sha=None → PUT 无 sha → 422。故做 3 次退避重试。
        for attempt in range(3):
            try:
                req = urllib.request.Request(API, headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    obj = json.load(r)
                    data = json.loads(base64.b64decode(obj["content"]))
                    return data, obj.get("sha")
            except Exception as e:
                print(f"warn: 取现有文件失败（第 {attempt + 1}/3 次）: {e}")
                if attempt < 2:
                    time.sleep(2 + attempt * 3)
    if os.path.exists(DATA_PATH):
        with open(DATA_PATH, encoding="utf-8") as f:
            return json.load(f), None
    return {"updated": "", "latest": "", "dates": [], "messages": {}}, None


def remote_exists(token):
    """远程文件是否存在：True=存在 / False=404不存在 / None=无法判断（网络异常）。"""
    try:
        req = urllib.request.Request(API, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json"})
        urllib.request.urlopen(req, timeout=30).read()
        return True
    except urllib.error.HTTPError as e:
        return False if e.code == 404 else None
    except Exception:
        return None


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
        need = max(cmap.values(), default=-1)
        for r in reader:
            if not any(c.strip() for c in r):
                continue
            if len(r) <= need:
                # 2026-10-10 修：教练在「待加强」栏里换行写成 1./2./3. 多条，
                # 表格导出后被拆成"列不足"的续行（1~2 列），直接 skip 会丢记录。
                # 改为并入上一条记录的待加强栏，用「；」连接。
                if rows:
                    extra = " ".join(c.strip() for c in r if c.strip())
                    prev = rows[-1]
                    k_focus = next((k for k, i in cmap.items() if i == need), None)
                    if k_focus and extra:
                        prev[k_focus] = (prev.get(k_focus, "").rstrip("；; ") + "；" + extra).strip("；; ")
                        continue
                print("skip 列不足行(且无前序可并):", r)
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

    # 历史消息里的错别字学员名也纠正一遍（纠正后撞名的合并成一条，以后者为准）
    for k in list(messages.keys()):
        fixed = {}
        for e in messages[k]:
            e["names"] = [canon_names((e.get("names") or [""])[0])]
            fixed[e["names"][0]] = e
        messages[k] = list(fixed.values())

    for d in rows:
        month, day = parse_date(d.get("date", ""))
        if not month:
            print("skip 无日期行:", d)
            continue
        names_str = canon_names(d.get("names"))
        if not names_str:
            continue
        cls = (d.get("class") or "基础班").strip() or "基础班"
        coach = (d.get("coach") or "").strip()
        coach = re.sub(r"\d+$", "", coach).strip()
        good = (d.get("good") or "").strip()
        bad = (d.get("bad") or "").strip()
        key = fmt_key(month, day)

        advice = build_advice(bad)
        # 转介绍钩子：先判定是否有资格（进步明显 / 积分里程碑 / 体测达标），
        # 再经 14 天冷却 + 固定种子随机 门控，避免每天发。
        hook_eligible = is_progress_strong(good) or milestone_for(names_str, pts_acc, prof_by_name)
        hook = bool(hook_eligible) and should_send_hook(names_str, key, messages)
        if advice:
            advice_count += len(advice)
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

    # 全库统一重算转介绍钩子（含历史遗留），保证「随机 + 同一学员两周一次」整库一致
    hook_count = reconcile_hooks(messages, pts_acc, prof_by_name)

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
        if sha is None and remote_exists(args.token) is not False:
            print("⚠️ 云端已存在 parent-msg.json 但未取到 sha（网络抖动）——"
                  "本次只写本地、跳过推送，避免整份覆盖旧数据。待网络恢复重跑本管线即可。")
            print(f"updated: {out['updated']} | latest: {out['latest']} | 总日期数: {len(dates)}")
            return
        st = github_put(args.token, content_str, sha)
        print(f"已推送 parent-msg.json (HTTP {st})，本次新增 {added} 条")
    else:
        print(f"未推送（无 GITHUB_TOKEN）。本地已生成 {DATA_PATH}，本次新增 {added} 条。")
    print(f"updated: {out['updated']} | latest: {out['latest']} | 总日期数: {len(dates)}")
    print(f"含家庭小练习 {advice_count} 条 | 含转介绍钩子 {hook_count} 条")


if __name__ == "__main__":
    main()
