#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_principal_report.py — 星羿羽毛球馆 · 校长日报分析生成器（每晚 23:11 + 次日 8:00 补拉）
拉取 6 张腾讯文档表 -> 规则引擎判红黄绿灯 + 交叉校验 -> 生成 data/principal-report.json 推送到
GitHub Pages 仓库 xytyymq/xingyi-workbench，工作台 report.html 每日自动刷新。

数据源 file_id：
  校长日报   BjSQzjtTUOEo  (16列：原15列删3废列+需决策事项并入"备注(选填)"，新增入学视频×2/家长沟通×2)
  招生线索   BnsxnERkHjhX  (13列)
  员工日报   BgZRrreBQYgN  (4列：日期,员工,今日完成与家长反馈,需协调问题)
  收支记账   BqAuLsZNxAVW  (5列：日期,类型,金额(元),项目,备注(付款方式))
  巡课记录   BuZCntfjSDCx  (5列：日期,教练,班级,教学五项,问题与备注)
  上课记录   BqnMnjsuhwOQ  (交叉校验开课节数)

KPI（老板拍板 2026-09-25）：试课到场率红线 80% / 线索跟进时限 48h / 月报名目标 10 人
设计目标：无状态、可在 WorkBuddy 自动化环境运行（腾讯文档连接器 + GITHUB_TOKEN）。
"""
import json, os, re, sys, time, random, datetime, urllib.request, urllib.error, base64

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetch_records import export_and_download, xlsx_rows, tdoc  # 复用健壮导出+解析；tdoc 调腾讯文档 get_content

REPO = os.environ.get("XY_REPO", "xytyymq/xingyi-workbench")
BRANCH = os.environ.get("XY_BRANCH", "main")
DATA_PATH = "data/principal-report.json"

F_PRINCIPAL = "BjSQzjtTUOEo"
F_LEADS     = "BnsxnERkHjhX"
F_EMP       = "BgZRrreBQYgN"
# F_FIN       = "BqAuLsZNxAVW"   # 收支记账（2026-10-16 移除：看板不再展示财务，改用独立财务系统）
F_XUN       = "BuZCntfjSDCx"
F_CLASS     = "BqnMnjsuhwOQ"
F_TICE      = "BCmMnaVvBTRo"   # 学员体测档案（含体测明细·测试日期）

TRIAL_RATE_RED = 0.80     # 试课到场率红线
LEAD_STALE_DAYS = 2       # 线索 48h 未跟进
MONTH_TARGET = 10         # 月报名目标
# 体测月度计划：动态 = 当月上课学生数 × 80%（大哥 2026-10-14 拍板），不再用固定常量
RENEW_GOAL_MONTH = 28800  # 续费月度目标金额（大哥 2026-10-14 拍板 ¥28800；None=不显示目标完成率）
VENUE_GOAL_MONTH = 24000  # 场地收入月度目标金额（大哥 2026-10-22 拍板 ¥24000）
REV_GOAL_MONTH = 52800   # 本月营收总目标（四类合计，大哥 2026-10-22 拍板：续费28800+场地24000 已达下限，故 52800）

CLOSED_STATUS = ("已报名", "已流失")


def _gh(api_url, tok, payload=None, method="GET", retries=3):
    """GitHub REST 调用，5xx 自动重试。返回解析后的 JSON。"""
    h = {"Authorization": f"Bearer {tok}", "User-Agent": "xy-principal-report",
         "Accept": "application/vnd.github+json", "Content-Type": "application/json"}
    last = None
    for i in range(retries):
        req = urllib.request.Request(
            api_url, data=(json.dumps(payload).encode() if payload is not None else None),
            headers=h, method=method)
        try:
            return json.loads(urllib.request.urlopen(req, timeout=60).read() or b"{}")
        except urllib.error.HTTPError as e:
            body = e.read()[:300]
            last = (e.code, body)
            if e.code in (500, 502, 503, 504):
                print(f"  [gh] HTTP {e.code}，{2 + i * 3}s 后重试（{i + 1}/{retries}）")
                time.sleep(2 + i * 3)
                continue
            raise RuntimeError(f"HTTP {e.code}: {body}")
    raise RuntimeError(f"HTTP {last[0]}（重试 {retries} 次仍失败）: {last[1]}")


def push_file(rel_path, content_bytes, message):
    """推送单文件：优先 Contents API，失败则退回 Git Data API。
    2026-10-07 实测：GitHub 写接口曾整段 500（Contents PUT / blob POST 均空响应体，
    读取正常），Git Data API(tree→commit→ref) 仍可用 —— 故保留双通道。"""
    tok = resolve_token()
    if not tok:
        print("警告：无 GITHUB_TOKEN，仅本地生成，未推送")
        return None
    api = f"https://api.github.com/repos/{REPO}/contents/{rel_path}"
    b64 = base64.b64encode(content_bytes).decode()
    sha = None
    try:
        sha = _gh(api + f"?ref={BRANCH}", tok).get("sha")
    except RuntimeError as e:
        if "404" not in str(e):
            print(f"  [contents] 取 sha 失败：{e}")
    try:
        body = {"message": message, "content": b64, "branch": BRANCH}
        if sha:
            body["sha"] = sha
        r = _gh(api, tok, body, "PUT")
        return r["commit"]["sha"]
    except RuntimeError as e:
        print(f"  [contents] PUT 失败（{e}）→ 切换 Git Data API 通道")
    # ---- 兜底：Git Data API ----
    base = f"https://api.github.com/repos/{REPO}"
    ref = _gh(f"{base}/git/ref/heads/{BRANCH}", tok)
    head = ref["object"]["sha"]
    bt = _gh(f"{base}/git/commits/{head}", tok)["tree"]["sha"]
    nt = _gh(f"{base}/git/trees", tok, {"base_tree": bt, "tree": [
        {"path": rel_path, "mode": "100644", "type": "blob",
         "content": content_bytes.decode("utf-8")}]}, "POST")["sha"]
    nc = _gh(f"{base}/git/commits", tok,
             {"message": message, "tree": nt, "parents": [head]}, "POST")["sha"]
    _gh(f"{base}/git/refs/heads/{BRANCH}", tok, {"sha": nc, "force": False}, "PATCH")
    print("  [gitdata] 已通过 Git Data API 通道推送")
    return nc


def resolve_token():
    t = os.environ.get("GITHUB_TOKEN")
    if t:
        return t
    p = os.path.join(HERE, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            s = line.strip()
            if s.startswith("GITHUB_TOKEN="):
                return s.split("=", 1)[1].strip().strip('"')
    return None


def env_key(key):
    p = os.path.join(HERE, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            s = line.strip()
            if s.startswith(key + "="):
                return s.split("=", 1)[1].strip().strip('"')
    return os.environ.get(key)


def notify_wecom(report):
    """推送红黄绿灯摘要到企业微信群机器人 webhook（.env 配 WECOM_WEBHOOK 即启用，未配则跳过）。"""
    key = env_key("WECOM_WEBHOOK")
    if not key:
        return
    ico = {"red": "🔴", "yellow": "🟡", "green": "🟢"}.get(report.get("overall"), "⚪")
    lines = [f"## {ico} 校长日报分析 {report['data_date']}", "> 星羿羽毛球馆 · 每日自动"]
    for l in (report.get("lights") or [])[:6]:
        lines.append(f"{ico_map(l['level'])} {l['text']}")
    for c in (report.get("cross_check") or []):
        if c["level"] == "red":
            lines.append(f"⚠️ {c['text']}")
    f = report.get("funnel") or {}
    lines.append(f"📣 本月报名 {f.get('month_signups', 0)}/10 · 到场率 {f.get('trial_arrive_rate') or '–'}")
    fin = report.get("finance") or {}
    if fin.get("renew"):
        lines.append(f"💰 本月续课 ¥{fin['renew'].get('month_amount', 0)} · {fin['renew'].get('month_count', 0)} 人")
    if report.get("boss_todos"):
        lines.append(f"⚡ 待你决策 {len(report['boss_todos'])} 项，详见工作台看板")
    lines.append("[查看完整看板](https://xytyymq.github.io/xingyi-workbench/report.html)")
    body = json.dumps({"msgtype": "markdown", "markdown": {"content": "\n".join(lines)}}).encode("utf-8")
    req = urllib.request.Request(key, data=body, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=30)
        print("已推送企业微信摘要")
    except Exception as e:
        print(f"企业微信推送失败（不影响看板数据）: {type(e).__name__}: {e}")


def ico_map(level):
    return {"red": "🔴", "yellow": "🟡", "green": "🟢"}.get(level, "⚪")


def fetch_table(file_id, label):
    print(f"导出《{label}》({file_id})...")
    data = export_and_download(file_id)
    hdr, rows = xlsx_rows(data)
    hdr = [str(h or "").strip() for h in hdr]
    out = []
    for r in rows:
        if not any(str(x or "").strip() for x in r):
            continue
        out.append({hdr[i]: str(r[i]).strip() if i < len(r) else "" for i in range(len(hdr))})
    print(f"  《{label}》数据行：{len(out)}")
    return out


def read_repo_daily():
    """读取表单写入的 data/principal-daily.json（校长在卡片表单提交的行）。
    返回原始 dict 列表（键=腾讯文档表头）。读取失败/缺失返回空列表，不阻断主流程。"""
    tok = resolve_token()
    if not tok:
        return []
    api = f"https://api.github.com/repos/{REPO}/contents/data/principal-daily.json?ref={BRANCH}"
    try:
        m = _gh(api, tok)
        if not m or not m.get("content"):
            return []
        import base64
        raw = base64.b64decode(m["content"]).decode("utf-8")
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except RuntimeError:
        return []
    except Exception as e:  # 任意异常都降级，保证日报仍能出
        print(f"  [repo-daily] 读取失败，降级为空：{type(e).__name__}: {e}")
        return []


def read_tice(active_students_month=None):
    """读取体测档案（腾讯文档 F_TICE），解析『体测明细』段，按时间分类聚合。
    月度计划 = 当月上课学生数 × 80%（大哥口径：先看上课学生基数）。
    返回 {month_done, month_students, quarter_done, quarter_label, total_students,
          latest_date, latest_student, active_students, month_plan, rate}；任意失败返回 None。"""
    try:
        r = tdoc("tencent-docs", "get_content", json.dumps({"file_id": F_TICE}))
        sc = r.get("result", {}).get("structuredContent", {}) or {}
        text = sc.get("content") or r.get("result", {}).get("content", "")
        if not text:
            return None
    except Exception as e:
        print(f"  [tice] 读取失败降级：{type(e).__name__}: {e}")
        return None
    lines = text.split("\n")
    # 定位体测明细表头（含 测试日期 + 学员ID）
    hdr_line = None
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s.startswith("|") and "测试日期" in s and "学员ID" in s:
            hdr_line = i
            break
    if hdr_line is None:
        return None
    hdr = [h.strip() for h in lines[hdr_line].strip().strip("|").split("|")]
    try:
        di = hdr.index("测试日期")
        id_i = hdr.index("学员ID") if "学员ID" in hdr else -1
        name_i = hdr.index("姓名") if "姓名" in hdr else -1
    except ValueError:
        return None
    recs = []
    for ln in lines[hdr_line + 2:]:  # 跳过表头行与分隔行
        s = ln.strip()
        if s.startswith("|上课明细") or s.startswith("|学员档案"):
            break
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) <= 1:
            continue
        # 日期：优先『测试日期』列；源表部分真实行未填学员ID导致整行左移，
        # 『测试日期』列错位成身高数字，真实日期落在『姓名』列。
        # 故兜底扫描整行找第一个可解析日期，保证真实体测不被漏计。
        d = parse_date(cells[di]) if (di >= 0 and di < len(cells)) else None
        if not d:
            for c in cells:
                d = parse_date(c)
                if d:
                    break
        if not d:
            continue
        sid = cells[id_i] if (id_i >= 0 and id_i < len(cells)) else ""
        nm = cells[name_i] if (name_i >= 0 and name_i < len(cells)) else ""
        # 跳过示例/demo 行（学员ID=SDEMO 或 姓名含『示例』）
        key = (sid or nm).strip()
        if not key:
            continue
        if "示例" in key or "示例" in (nm or "") or "DEMO" in key.upper():
            continue
        recs.append((d, key))
    if not recs:
        return None
    today = datetime.date.today()
    mp = today.isoformat()[:7]
    q = (today.month - 1) // 3 + 1
    month_cnt = sum(1 for d, _ in recs if d.startswith(mp))
    month_students_set = set(sid for d, sid in recs if d.startswith(mp))
    month_students = len(month_students_set)
    quarter_cnt = sum(1 for d, _ in recs
                      if d[:4] == str(today.year) and (int(d[5:7]) - 1) // 3 + 1 == q)
    seen, cum = set(), 0
    for d, sid in recs:
        if sid and sid not in seen:
            seen.add(sid)
            cum += 1
    recs_sorted = sorted(recs, key=lambda x: x[0])
    latest = recs_sorted[-1]
    # 月度计划 = 当月上课学生数 × 80%（无当月上课数据时，回退到累计建档学员数作基数）
    plan_base = active_students_month if active_students_month else cum
    plan = round(plan_base * 0.8)
    rate = (f"{month_students / plan:.0%}" if plan else "–")
    return {
        "month_done": month_cnt, "month_students": month_students,
        "quarter_done": quarter_cnt, "quarter_label": f"Q{q}",
        "total_students": cum, "latest_date": latest[0], "latest_student": latest[1],
        "active_students": active_students_month or 0,
        "month_plan": plan, "rate": rate,
    }


# 统一营收台账的 5 个类型（校长日报填写页下拉选项，与此保持一致）
# 大哥 2026-10-23 口径：订金单列（只算订金，不并入职收）；报名=新生整期报名；续费=老生续费。
# 课程实收 / 教练招生业绩 = 报名 + 续费；订金作为「待转营收」单独跟踪。
REVENUE_TYPES = ("报名", "续费", "订金", "散客/场地", "穿线")


def _read_ledger():
    """读取统一营收台账 data/revenue-ledger.json（校长日报填写页『营收台账』逐笔登记）。
    每行：{date, name, amount, type(4选1), collector(收款人)}。
    返回 list[dict]（全部历史行，含所有月份）。读取失败/缺失返回 []。"""
    tok = resolve_token()
    if not tok:
        return []
    try:
        m = _gh(f"https://api.github.com/repos/{REPO}/contents/data/revenue-ledger.json?ref={BRANCH}", tok)
        if m and m.get("content"):
            import base64 as _b64
            data = json.loads(_b64.b64decode(m["content"]).decode("utf-8"))
            if isinstance(data, list):
                return [r for r in data if isinstance(r, dict)]
    except Exception as e:
        print(f"  [ledger] 读取失败降级（返回空）：{type(e).__name__}: {e}")
    return []


def read_renew():
    """本月续费+报名额：取自统一营收台账中 type=续费 或 type=报名 的金额汇总（课程实收口径）。
    返回 {month_amount, month_count, goal, goal_rate, note}。
    关键：即使台账缺失/无数据/读取失败，也始终返回目标与达成率（金额=0、达成率=0%），
    保证校长日报永远能看到『当月续课总金额』与『达成率』，而非被『待接入』隐藏。
    注：订金(type=订金)属于报名定金，单列不计入续费；续费+报名=课程实收总额。"""
    mp = datetime.date.today().isoformat()[:7]
    rows = _read_ledger()
    month_rows = [r for r in rows if (r.get("date") or "").startswith(mp) and r.get("type") in ("续费", "报名")]
    amount = sum(to_f(r.get("amount")) for r in month_rows)
    count = len(month_rows)
    goal = RENEW_GOAL_MONTH
    rate = (f"{amount / goal:.0%}" if goal else None)
    return {
        "month_amount": amount, "month_count": count,
        "goal": goal, "goal_rate": rate, "note": "口径含报名（续费+报名=课程实收）；达成率分母为续费目标 \u00a528800。",
    }


def read_stringing():
    """穿线统计：取自统一营收台账中 type=穿线 的行（原 stringing-records.json 已并入）。
    按本月聚合：每个收款人（穿线师）的单量 / 金额。
    返回 {month_count, month_amount, month_jobs, by_stringer:[{stringer,jobs,count,amount}]}。"""
    mp = datetime.date.today().isoformat()[:7]
    rows = _read_ledger()
    month_rows = [r for r in rows if (r.get("date") or "").startswith(mp) and r.get("type") == "穿线"]
    agg = {}
    for r in month_rows:
        s = (r.get("collector") or "未记收款人").strip()
        a = to_f(r.get("amount"))
        if s not in agg:
            agg[s] = {"stringer": s, "jobs": 0, "count": 0.0, "amount": 0.0}
        agg[s]["jobs"] += 1
        agg[s]["amount"] += a
    by = sorted(agg.values(), key=lambda x: -x["amount"])
    return {
        "month_count": len(month_rows),
        "month_amount": sum(x["amount"] for x in by),
        "month_jobs": len(month_rows),
        "by_stringer": by,
    }


def read_revenue():
    """汇总统一营收台账（5 类）作为校长日报看板的『本月营收』。
    数据来源：data/revenue-ledger.json（校长日报填写页『营收台账』逐笔登记）。
    口径（大哥 2026-10-23）：报名(新生整期) + 续费(老生续费) + 订金(报名定金) + 散客/场地 + 穿线；
         收款人(collector) 仅作对账/教练业绩归属，不计入营收总额。
         订金只算订金，单列作为「待转营收」跟踪，不并入职收总额（课程实收=报名+续费）。
    派生（供校长工资核算）：课程实收=报名+续费；教练招生业绩=报名+续费；场地收入=散客/场地；订金=订金(待转)。
    返回 {month_total, today_total, by_type, derived, note}。"""
    mp = datetime.date.today().isoformat()[:7]
    today_iso = datetime.date.today().isoformat()
    rows = _read_ledger()
    by_type = {t: 0.0 for t in REVENUE_TYPES}
    for r in rows:
        t = r.get("type")
        if t not in by_type:
            continue
        amt = to_f(r.get("amount"))
        if str(r.get("date") or "").startswith(mp):
            by_type[t] += amt
    today_total = sum(to_f(r.get("amount")) for r in rows if str(r.get("date") or "") == today_iso)
    month_total = sum(by_type.values())
    by_type_list = [{"name": t, "amount": round(v)} for t, v in by_type.items() if v > 0]
    derived = {
        "course": round(by_type["报名"] + by_type["续费"]),          # 课程实收（工资页用，报名+续费）
        "coach_enroll": round(by_type["报名"] + by_type["续费"]),    # 教练招生业绩（工资页用，报名+续费）
        "deposit": round(by_type["订金"]),                            # 订金（待转营收，单列）
        "venue": round(by_type["散客/场地"]),                         # 场地收入（工资页用）
        "string": round(by_type["穿线"]),                             # 穿线（仅营收，不进工资）
    }
    return {
        "month_total": round(month_total),
        "today_total": round(today_total),
        "by_type": by_type_list,
        "derived": derived,
        "venue_goal": VENUE_GOAL_MONTH,
        "total_goal": REV_GOAL_MONTH,
        "note": "含报名·续费·订金·散客场地·穿线；订金只算订金（待转营收，单列不并入职收）。课程实收=报名+续费；收款人仅作对账/教练业绩归属，不计入营收。《收支记账》已废弃，营收以本台账为准。",
    }


def read_ledger_audit(rows=None):
    """营收台账自检（用户 2026-10-22 拍板：废弃《收支记账》，以统一营收台账为准）。
    返回 {total, checks:[{name,ok,level?,msg}], level, missing_collector:[...]}。
    level: green 全通过 / yellow 仅历史收款人缺失 / red 关键字段·金额·类型·汇总异常。"""
    if rows is None:
        rows = _read_ledger()
    VALID = ("报名", "续费", "订金", "散客/场地", "穿线")
    mp = datetime.date.today().isoformat()[:7]
    checks = []

    miss_field = [r for r in rows if not all(str(r.get(k) or '').strip() for k in ("date", "name", "amount", "type"))]
    checks.append({"name": "关键字段完整", "ok": not miss_field,
                   "msg": "date/name/amount/type 齐全" if not miss_field else f"{len(miss_field)} 笔缺关键字段"})

    nonpos = []
    for r in rows:
        try:
            if to_f(r.get("amount")) <= 0:
                nonpos.append(r)
        except Exception:
            nonpos.append(r)
    checks.append({"name": "金额合法", "ok": not nonpos,
                   "msg": "全部为正数" if not nonpos else f"{len(nonpos)} 笔金额非正/无法解析"})

    bad_type = [r for r in rows if r.get("type") not in VALID]
    checks.append({"name": "类型合法", "ok": not bad_type,
                   "msg": "均在 4 类内" if not bad_type else f"{len(bad_type)} 笔类型越界"})

    by_type = {t: 0.0 for t in VALID}
    for r in rows:
        if r.get("type") in VALID and str(r.get("date") or "").startswith(mp):
            by_type[r["type"]] += to_f(r.get("amount"))
    month_total = round(sum(by_type.values()))
    sum_by_type = round(sum(by_type.values()))
    diff = abs(month_total - sum_by_type)
    checks.append({"name": "月汇总勾稽", "ok": diff <= 1,
                   "msg": f"month_total={month_total} = Σby_type={sum_by_type}" if diff <= 1
                          else f"month_total={month_total} 与 Σby_type={sum_by_type} 差 {diff}"})

    seen = {}
    for r in rows:
        k = (r.get("date"), r.get("name"), str(r.get("amount")))
        seen[k] = seen.get(k, 0) + 1
    dups = [k for k, v in seen.items() if v > 1]
    checks.append({"name": "重复检测", "ok": not dups,
                   "msg": "无重复录入" if not dups else f"{len(dups)} 组疑似重复（同日期+同名+同金额）"})

    miss_coll = [r for r in rows if not str(r.get("collector") or '').strip()]
    checks.append({"name": "收款人", "ok": not miss_coll, "level": "warn",
                   "msg": "齐全" if not miss_coll else f"{len(miss_coll)} 笔历史缺收款人（不影响营收，影响教练业绩归属）"})

    level = "green"
    if any((not c["ok"]) for c in checks if c["name"] != "收款人"):
        level = "red"
    elif miss_coll:
        level = "yellow"
    return {
        "total": len(rows),
        "checks": checks,
        "level": level,
        "missing_collector": [
            {"date": r.get("date"), "name": r.get("name"), "type": r.get("type"),
             "amount": round(to_f(r.get("amount")))}
            for r in miss_coll
        ],
    }


def read_week_revenue():
    """本周/上周营收（按自然周，周一为界），含按类型拆分与环比。
    供周报模块 weekly-report.html 使用。"""
    rows = _read_ledger()
    today = datetime.date.today()
    wk_start = today - datetime.timedelta(days=today.weekday())
    last_start = wk_start - datetime.timedelta(days=7)
    end = wk_start + datetime.timedelta(days=7)

    def agg(start, stop):
        bt = {t: 0.0 for t in REVENUE_TYPES}
        total = 0.0
        for r in rows:
            try:
                d = datetime.date.fromisoformat(str(r.get("date") or ""))
            except ValueError:
                continue
            if start <= d < stop:
                t = r.get("type")
                if t in bt:
                    bt[t] += to_f(r.get("amount"))
                    total += to_f(r.get("amount"))
        return {"total": round(total),
                "by_type": [{"name": t, "amount": round(v)} for t, v in bt.items() if v > 0]}

    return {
        "this_week": agg(wk_start, end),
        "last_week": agg(last_start, wk_start),
    }


def parse_date(s, fallback=None):
    """兼容 2026-09-25 / 2026/9/25 / 9月25日 / Excel序列号；失败返回 fallback。"""
    s = str(s or "").strip()
    if not s:
        return fallback
    if re.fullmatch(r"\d{5}", s):
        n = int(s)
        if 40000 <= n <= 60000:
            return (datetime.date(1899, 12, 30) + datetime.timedelta(days=n)).isoformat()
    m = re.search(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", s)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            pass
    m = re.search(r"(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?", s)
    if m and fallback:
        try:
            y = int(fallback[:4])
            return datetime.date(y, int(m.group(1)), int(m.group(2))).isoformat()
        except ValueError:
            pass
    return fallback


def to_f(s):
    try:
        return float(re.sub(r"[^\d.\-]", "", str(s)) or 0)
    except ValueError:
        return 0.0


def to_n(s):
    """非负计数：负数一律按 0 算。
    大哥 2026-10-26 口径：前台填报的计数类字段（线索/试课预约/试课到场/报名/开课/
    触达/入学视频）不允许为负；历史上出现过的 -1 一律按 0 计，避免图表出现负值、
    汇总被拉低。金额类仍用 to_f（退款/冲抵可能为负，不做钳制）。"""
    v = to_f(s)
    return v if v > 0 else 0.0


def build_month_weeks(principal, cls, data_date, ledger_week=None):
    """本月按自然周（周一为界）聚合，供周会「本月每周对比」使用。
    只统计落在本月内的日期；每周带 days_filled（已填报天数），
    避免拿半周数据跟整周对比造成误判。
    ledger_week: [(date_iso, amount, type)] 来自统一营收台账，用于每周业绩。
    返回 {month, weeks:[...], totals:{...}}"""
    ledger_week = ledger_week or []
    dt = datetime.date.fromisoformat(data_date)
    mp = data_date[:7]
    m_start = datetime.date(dt.year, dt.month, 1)
    m_end = (datetime.date(dt.year + (dt.month == 12), dt.month % 12 + 1, 1)
             - datetime.timedelta(days=1))
    first_monday = m_start - datetime.timedelta(days=m_start.weekday())

    cls_by_day = {}
    for c in cls:
        if c.get("_d"):
            cls_by_day[c["_d"]] = cls_by_day.get(c["_d"], 0) + 1

    weeks = []
    ws = first_monday
    idx = 0
    while ws <= m_end:
        idx += 1
        we = ws + datetime.timedelta(days=6)          # 该周周日
        lo = max(ws, m_start)
        hi = min(we, m_end)
        rows = [r for r in principal if r.get("_d") and lo.isoformat() <= r["_d"] <= hi.isoformat()]
        by_day = {}
        for r in rows:
            by_day.setdefault(r["_d"], to_n(r.get("今日开课节数")))
        all_days = [(lo + datetime.timedelta(days=i)).isoformat()
                    for i in range((hi - lo).days + 1)]
        classes = sum(by_day.get(d, cls_by_day.get(d, 0)) for d in all_days)
        leads = sum(to_n(r.get("今日新线索数")) for r in rows)
        trials = sum(to_n(r.get("试课预约数")) for r in rows)
        arrive = sum(to_n(r.get("试课到场数")) for r in rows)
        signups = sum(to_n(r.get("今日报名数")) for r in rows)
        promo = sum(to_n(r.get("今日社交媒体推广次数")) for r in rows)
        promo_leads = sum(to_n(r.get("社交媒体咨询数")) for r in rows)
        # 业绩：营收台账按自然周聚合（只算落在本周区间的笔数）
        wk_rev = sum(amt for (d_, amt, tp) in ledger_week if lo.isoformat() <= d_ <= hi.isoformat())
        wk_sign_rev = sum(amt for (d_, amt, tp) in ledger_week
                          if lo.isoformat() <= d_ <= hi.isoformat() and tp in ("报名", "新报名", "续费", "续费/订金"))
        weeks.append({
            "idx": idx,
            "label": f"第{idx}周 {ws.strftime('%m/%d')}–{we.strftime('%m/%d')}",
            "start": ws.isoformat(), "end": we.isoformat(),
            "leads": leads, "trials": trials, "arrive": arrive,
            "signups": signups, "classes": classes,
            "promo": promo, "promo_leads": promo_leads,
            "revenue": round(wk_rev), "signup_revenue": round(wk_sign_rev),
            "arrive_rate": f"{arrive / trials:.0%}" if trials > 0 else "—",
            "days_filled": len(by_day), "days_span": len(all_days),
            "is_current": ws <= dt <= we,
        })
        ws = we + datetime.timedelta(days=1)

    # 环比：每周 vs 上一周
    for i in range(1, len(weeks)):
        for k in ("leads", "trials", "arrive", "signups", "classes", "promo", "promo_leads", "revenue"):
            weeks[i]["delta_" + k] = weeks[i][k] - weeks[i - 1][k]

    totals = {k: sum(w[k] for w in weeks)
              for k in ("leads", "trials", "arrive", "signups", "classes",
                        "promo", "promo_leads", "revenue", "signup_revenue")}
    return {"month": mp, "weeks": weeks, "totals": totals}


def build_promo_stats(principal, data_date):
    """社交媒体推广统计：今日 / 本周 / 本月次数与咨询数 + 连续打卡天数(streak)。
    口径（大哥 2026-10-26）：每天至少 1 次；只统计已填报的日报行。
    streak = 从 data_date 往前，连续「有填报且推广次数 ≥1」的天数。"""
    by_day = {}
    for r in principal:
        d = r.get("_d")
        if not d:
            continue
        by_day[d] = {
            "promo": to_n(r.get("今日社交媒体推广次数")),
            "leads": to_n(r.get("社交媒体咨询数")),
            "filled": True,
        }
    today = datetime.date.fromisoformat(data_date)
    wk_start = (today - datetime.timedelta(days=today.weekday())).isoformat()
    mp = data_date[:7]

    def agg(pred):
        rows = [v for d, v in by_day.items() if pred(d)]
        return {
            "promo": sum(v["promo"] for v in rows),
            "leads": sum(v["leads"] for v in rows),
            "days": len(rows),
        }

    today_v = by_day.get(data_date, {"promo": 0, "leads": 0, "filled": False})
    week = agg(lambda d: d >= wk_start)
    month = agg(lambda d: d.startswith(mp))

    # 连续打卡：从 data_date 往前数（跳过没填报的日子不算断）
    streak = 0
    cur = today
    for _ in range(120):
        k = cur.isoformat()
        if k not in by_day:
            break
        if by_day[k]["promo"] < 1:
            break
        streak += 1
        cur -= datetime.timedelta(days=1)

    return {
        "today_promo": today_v["promo"],
        "today_leads": today_v["leads"],
        "today_filled": today_v["filled"],
        "week_promo": week["promo"], "week_leads": week["leads"], "week_days": week["days"],
        "month_promo": month["promo"], "month_leads": month["leads"], "month_days": month["days"],
        "streak": streak,
        "target_daily": 1, "target_weekly": 5, "target_monthly": 20,
    }


def read_leads_repo():
    """读取工作台线索登记 data/leads.json（带来源渠道下拉的新登记入口）。
    返回 list[dict]；读取失败/缺失返回 []。"""
    tok = resolve_token()
    if not tok:
        return []
    try:
        m = _gh(f"https://api.github.com/repos/{REPO}/contents/data/leads.json?ref={BRANCH}", tok)
        if m and m.get("content"):
            import base64 as _b64
            d = json.loads(_b64.b64decode(m["content"]).decode("utf-8"))
            return d if isinstance(d, list) else []
    except Exception:
        return []
    return []


def build_source_mix(leads_repo, leads_tdoc, month_prefix):
    """线索来源构成：工作台新登记（有来源）+ 腾讯文档历史（无来源→未标注）。
    返回 {total, labeled, mix:[{name,count}], unlabeled}。"""
    mix = {}
    labeled = 0
    total = 0
    for r in (leads_repo or []):
        src = str(r.get("来源渠道") or r.get("source") or "").strip() or "未标注"
        d = str(r.get("登记日期") or r.get("date") or "")
        if month_prefix and d and not d.startswith(month_prefix):
            continue
        mix[src] = mix.get(src, 0) + 1
        labeled += 1 if src != "未标注" else 0
        total += 1
    # 腾讯文档历史线索：来源列全空 → 计未标注
    hist_unlabeled = 0
    for r in (leads_tdoc or []):
        d = str(r.get("_reg") or r.get("登记日期") or "")
        src = str(r.get("来源渠道") or "").strip()
        if src:
            mix[src] = mix.get(src, 0) + 1
            labeled += 1
            total += 1
        else:
            hist_unlabeled += 1
            total += 1
    items = sorted(mix.items(), key=lambda kv: -kv[1])
    if hist_unlabeled:
        mix.setdefault("未标注", 0)
        mix["未标注"] += hist_unlabeled
        items = sorted(mix.items(), key=lambda kv: -kv[1])
    return {
        "total": total,
        "labeled": labeled,
        "unlabeled": hist_unlabeled,
        "mix": [{"name": k, "count": v} for k, v in items],
    }


def main():
    today = datetime.date.today()
    today_iso = today.isoformat()

    # 2026-10-16：校长日报数据源统一为仓库 data/principal-daily.json 一张表。
    # 历史腾讯文档校长日报表（F_PRINCIPAL）已全量收编进该 JSON（见 run_merge_principal.py），
    # 脚本此后只读这一张表，不再实时拉腾讯文档校长日报表，避免双源打架。
    principal = read_repo_daily()
    if principal:
        print(f"  校长日报行数（来自仓库 principal-daily.json）：{len(principal)}")
    leads     = fetch_table(F_LEADS, "招生线索登记")
    emp       = fetch_table(F_EMP, "员工日报")
    xun       = fetch_table(F_XUN, "巡课记录")
    cls       = fetch_table(F_CLASS, "上课记录")

    # ---- 归一化 ----
    for r in principal:
        r["_d"] = parse_date(r.get("日期"), today_iso)
    for r in leads:
        r["_reg"] = parse_date(r.get("登记日期"))
        r["_touch"] = parse_date(r.get("最后跟进日期")) or r["_reg"]
    # 工作台「招生线索登记」页的新线索（data/leads.json）并入 leads：
    # 这样 48h 跟进预警、来源构成、状态漏斗对新旧线索统一生效。
    leads_tdoc = list(leads)
    _repo_leads = read_leads_repo()
    for r in _repo_leads:
        r["_reg"] = parse_date(r.get("登记日期"))
        r["_touch"] = parse_date(r.get("最后跟进日期")) or r["_reg"]
    leads = leads + _repo_leads
    for r in emp:
        r["_d"] = parse_date(r.get("日期"))
    for r in xun:
        r["_d"] = parse_date(r.get("日期"))
    for r in cls:
        r["_d"] = parse_date(r.get("日期"))

    # 2026-10-17：有效数据日期 —— 适配"每天早上跑、当天日报往往还没填"场景。
    # 今天若已填报则用今天；否则取仓库里最近有数据的一天（避免漏斗/开课/视频全是盲区）。
    _dates = sorted([r["_d"] for r in principal if r.get("_d")])
    if _dates:
        data_date = today_iso if today_iso in _dates else _dates[-1]
    else:
        data_date = today_iso
    dt = datetime.date.fromisoformat(data_date)
    today_iso = data_date  # 后续所有"当日"分析统一用 data_date

    p_today = [r for r in principal if r["_d"] == today_iso]
    cls_today = [r for r in cls if r["_d"] == today_iso]
    lights = []          # [{level, text}]
    cross_check = []

    # ---- 0. 月报名进度（独立于日报是否缺卡） ----
    month_prefix = today_iso[:7]
    month_signups = sum(to_n(r.get("今日报名数")) for r in principal if (r["_d"] or "").startswith(month_prefix))
    days_in_month = (datetime.date(dt.year + (dt.month == 12), dt.month % 12 + 1, 1) - datetime.timedelta(days=1)).day
    expected = MONTH_TARGET * dt.day / days_in_month
    behind = month_signups < expected - 0.5

    # ---- 0.5 社交媒体推广统计（灯级要用，必须先算） ----
    promo_stats = build_promo_stats(principal, today_iso)

    # ---- 1. 校长日报缺卡 ----
    if not p_today:
        lights.append({"level": "red", "text": "校长今日日报未填报（打烊前必填 1 行），今天的数据全是盲区"})
    else:
        p = p_today[0]
        # 2. 试课到场率（红线 80%）
        booked, arrive = to_n(p.get("试课预约数")), to_n(p.get("试课到场数"))
        if booked > 0:
            rate = arrive / booked
            level = "red" if rate < TRIAL_RATE_RED else "green"
            if level == "red":
                lights.append({"level": level, "text": f"试课到场率 {arrive:.0f}/{booked:.0f}={rate:.0%}，低于 80% 红线——预约了不来，跟进环节有问题"})
            else:
                lights.append({"level": "green", "text": f"试课到场率 {rate:.0%}（≥80% 达标）"})
        # 3. 月报名进度
        lights.append({"level": "yellow" if behind else "green",
                       "text": f"本月报名 {month_signups:.0f}/{MONTH_TARGET} 人，进度{'落后于' if behind else '达到'}时间线（应到 {expected:.1f}）"})
        # 3.5 社交媒体推广（大哥 2026-10-26：每天至少 1 次，0 次只黄灯不硬罚）
        _pp = promo_stats["today_promo"]
        if promo_stats["today_filled"]:
            if _pp < 1:
                lights.append({"level": "yellow", "text": "今日社交媒体推广 0 次——每天至少 1 次，抖音/小红书/视频号/朋友圈任选其一"})
            else:
                lights.append({"level": "green", "text": f"今日社交媒体推广 {_pp:.0f} 次，带来咨询 {promo_stats['today_leads']:.0f} 个"
                                                         + (f"（已连续 {promo_stats['streak']} 天）" if promo_stats["streak"] > 1 else "")})
        # 4. 交叉校验（数据打架检测）
        reported_classes = to_n(p.get("今日开课节数"))
        actual_classes = len(cls_today)
        if reported_classes and actual_classes and reported_classes != actual_classes:
            cross_check.append({"level": "red", "text": f"开课节数打架：日报报 {reported_classes:.0f} 节，上课记录实际 {actual_classes} 条，需核实"})
        if not cross_check:
            cross_check.append({"level": "green", "text": "日报 vs 上课记录 数字一致，无打架"})

    # ---- 5. 线索 48h 未跟进 ----
    stale = []
    for r in leads:
        if r.get("状态") in CLOSED_STATUS:
            continue
        touch = r["_touch"] or r["_reg"]
        if not touch:
            continue
        try:
            days = (datetime.date.fromisoformat(today_iso) - datetime.date.fromisoformat(touch)).days
        except ValueError:
            continue
        if days > LEAD_STALE_DAYS:
            stale.append({"name": r.get("孩子姓名") or "未填姓名", "days": days, "status": r.get("状态") or "新线索"})
    stale.sort(key=lambda x: -x["days"])
    if stale:
        names_5 = "、".join(x["name"] + f"({x['days']}天)" for x in stale[:5])
        lights.append({"level": "red", "text": f"{len(stale)} 条线索超 48h 未跟进：{names_5}"})

    # ---- 6. 教练管理 ----
    coach = []
    coaches_today = sorted({r.get("教练") for r in cls_today if r.get("教练")})
    emp_today = {r.get("员工") for r in emp if r["_d"] == today_iso}
    missing = [c for c in coaches_today if c not in emp_today]
    if missing:
        coach.append({"level": "yellow", "text": f"今日带课但员工日报缺卡：{'、'.join(missing)}"})
    elif coaches_today:
        coach.append({"level": "green", "text": f"今日带课教练（{'、'.join(coaches_today)}）员工日报均已填"})
    xun_today = [r for r in xun if r["_d"] == today_iso]
    if cls_today and not xun_today:
        coach.append({"level": "yellow", "text": "今日有课但巡课记录为空——巡课未执行"})
    for r in xun_today:
        mark = (r.get("教学五项(热身·纠错·反馈·纪律·拉伸)") or "").replace(" ", "")
        if mark and mark != "5✓":
            coach.append({"level": "yellow", "text": f"巡课异常：{r.get('日期')} {r.get('教练')} {r.get('班级')} 教学五项={mark}｜{r.get('问题与备注') or '无备注'}"})

    # 7. 财务：2026-10-16 移除（看板不再展示财务，改用独立财务系统）

    # ---- 8. 老板待办 ----
    todos = [f"{r['_d']}｜{r.get('备注（选填）')}" for r in principal if (r.get('备注（选填）') or '').strip() and (r.get('备注（选填）') or '').strip() != '无']
    todos = sorted(todos, reverse=True)[:5]

    # ---- 8.5 入学视频 & 家长沟通（每日填报新增列） ----
    wk_start = (dt - datetime.timedelta(days=dt.weekday())).isoformat()
    mp = today_iso[:7]
    video_today = to_n(p_today[0].get("入学视频新增数")) if p_today else 0
    video_week = sum(to_n(r.get("入学视频新增数")) for r in principal if (r["_d"] or "") >= wk_start)
    video_month = sum(to_n(r.get("入学视频新增数")) for r in principal if (r["_d"] or "").startswith(mp))
    video_title = (p_today[0].get("入学视频标题(选填)") or "").strip() if p_today else ""
    touch_count = to_n(p_today[0].get("家长沟通触达数")) if p_today else 0
    touch_feedback = (p_today[0].get("家长沟通反馈(选填)") or "").strip() if p_today else ""
    video = {"today": video_today, "this_week": video_week, "this_month": video_month,
             "latest_title": video_title, "latest_status": ""}
    touch = {"count": touch_count, "types": "微信/群消息推送", "feedback": touch_feedback}

    # ---- 8.6 体测（按时间分类）----
    # 当月上课学生数 = 上课记录(cls) 本月去重『学员』，作为体测月度计划基数（×80%）
    active_students_month = len({r.get("学员") for r in cls
                                 if (r.get("_d") or "").startswith(month_prefix) and r.get("学员")})
    tice = read_tice(active_students_month)
    # ---- 8.7 续费台账（一人一表）----
    renew = read_renew()
    # ---- 8.8 穿线台账（按月统计每个穿线师）----
    stringing = read_stringing()
    # ---- 8.9 营收汇总（统一台账）----
    revenue = read_revenue()
    week_rev = read_week_revenue()

    # ---- 9. 家长回访抽查 ----
    recent_cls = [r for r in cls if r["_d"] and r["_d"] >= (datetime.date.fromisoformat(today_iso) - datetime.timedelta(days=7)).isoformat()]
    names = sorted({r.get("学员") for r in recent_cls if r.get("学员")})
    callback = "、".join(random.sample(names, min(3, len(names)))) if names else None

    # ---- 10. 周报（近 7 天） ----
    week_rows = []
    for i in range(6, -1, -1):
        d = (datetime.date.fromisoformat(today_iso) - datetime.timedelta(days=i)).isoformat()
        prow = next((r for r in principal if r["_d"] == d), None)
        week_rows.append({
            "date": d[5:], "leads": to_n(prow.get("今日新线索数")) if prow else 0,
            "trials": to_n(prow.get("试课预约数")) if prow else 0,
            "arrive": to_n(prow.get("试课到场数")) if prow else 0,
            "signups": to_n(prow.get("今日报名数")) if prow else 0,
            "classes": to_n(prow.get("今日开课节数")) if prow else len([r for r in cls if r["_d"] == d]),
        })
    wk_classes = sum(r["classes"] for r in week_rows)
    wk_leads = sum(r["leads"] for r in week_rows)
    wk_signups = sum(r["signups"] for r in week_rows)
    wk_trials = sum(r["trials"] for r in week_rows)
    week_summary = (f"本周合计：新线索 {wk_leads:.0f} · 试课 {wk_trials:.0f} · "
                    f"报名 {wk_signups:.0f} · 开课 {wk_classes:.0f} 节")

    # ---- 10.1 本月按自然周对比（周会用） ----
    _ledger_rows = _read_ledger()
    _ledger_week = []
    for _r in _ledger_rows:
        _d = str(_r.get("date") or "")
        if not _d:
            continue
        _ledger_week.append((_d, to_f(_r.get("amount")), str(_r.get("type") or "")))
    month_weeks = build_month_weeks(principal, cls, today_iso, _ledger_week)

    # ---- 10.2 社交媒体推广统计 + 线索来源构成 ----
    if promo_stats["week_promo"] < promo_stats["target_weekly"] and promo_stats["week_days"] >= 3:
        lights.append({"level": "yellow",
                       "text": f"本周社交媒体推广 {promo_stats['week_promo']:.0f} 次（目标 {promo_stats['target_weekly']} 次/周），"
                               f"带来咨询 {promo_stats['week_leads']:.0f} 个"})
    source_mix = build_source_mix(_repo_leads, leads_tdoc, month_prefix)

    # ---- 汇总灯级 ----
    all_levels = [l["level"] for l in lights] + [c["level"] for c in cross_check] + [c["level"] for c in coach]
    overall = "red" if "red" in all_levels else ("yellow" if "yellow" in all_levels else "green")

    # ---- 漏斗 ----
    funnel = {
        "new_leads_today": to_n(p_today[0].get("今日新线索数")) if p_today else 0,
        "trial_arrive_rate": None,
        "month_signups": month_signups,
        "month_pace_note": "",
    }
    if p_today:
        booked, arrive = to_n(p_today[0].get("试课预约数")), to_n(p_today[0].get("试课到场数"))
        if booked > 0:
            funnel["trial_arrive_rate"] = f"{arrive / booked:.0%}"
        funnel["month_pace_note"] = "落后于时间线" if behind else "达标"

    report = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "data_date": today_iso,
        "overall": overall,
        "lights": lights,
        "funnel": funnel,
        "stale_leads": stale[:10],
        "finance": {
            "renew": renew,
            "revenue": revenue,
            "week": week_rev,
        },
        "coach": coach,
        "boss_todos": todos,
        "cross_check": cross_check,
        "callback": callback,
        "video": video,
        "touch": touch,
        "tice": tice,
        "stringing": stringing,
        "week_rows": week_rows,
        "week_summary": week_summary,
        "month_weeks": month_weeks,
        "promo": promo_stats,
        "source_mix": source_mix,
        "kpi": {"trial_rate_red": "80%", "lead_stale": "48h", "month_target": MONTH_TARGET},
    }

    local = os.path.join(HERE, "principal_report.json")
    with open(local, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"本地已生成 {local}（总评：{overall}，红灯 {all_levels.count('red')} / 黄灯 {all_levels.count('yellow')}）")

    # ---- 推送 GitHub（Contents API + Git Data API 双通道）----
    payload = json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8")
    sha = push_file(DATA_PATH, payload, f"chore: principal-report {today_iso} {overall}")
    if sha:
        print(f"已推送 principal-report.json (commit {sha[:7]}) 总评={overall}")
    notify_wecom(report)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FAILED: {type(e).__name__}: {e}")
        sys.exit(1)
