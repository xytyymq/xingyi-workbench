#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_coach_lessons.py — 按 教练 × 日期 × 时段 三维统计教练课时。
数据源：fetch_records.py 产出的 class_records.csv（含 时段 列）。
口径：每条上课记录 = 1 课时（一个学员一节课）。
输出：data/coach-lessons.json（数据）+ coach-lessons.html（内嵌数据，自包含可手机看）
      两者均推送到 GitHub Pages 仓库 xytyymq/xingyi-workbench。

时段六个标准值（方案B）：早上10点 / 下午2点 / 下午4点 / 下午6点 / 成人班1V4 / 成人班1V1
依赖：同目录 .env 的 GITHUB_TOKEN（勿提交仓库）。
"""
import csv, json, os, re, base64, urllib.request, urllib.error, datetime
from datetime import date, timedelta

WD = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(WD, "class_records.csv")
OUT_JSON = os.path.join(WD, "data", "coach-lessons.json")
OUT_HTML = os.path.join(WD, "coach-lessons.html")
ENV = os.path.join(WD, ".env")
REPO = "xytyymq/xingyi-workbench"

SLOT_STD = ["早上10点", "下午2点", "下午4点", "下午6点", "成人班1V4", "成人班1V1"]

# 教练名归一：去尾随数字 + 音近异写别名（以排课表 schedule.json 干净名为准）
COACH_ALIAS = {
    "杜愈滨": "杜渝彬", "杜愈滨1": "杜渝彬",
    "张玉玲": "张玉玲", "张玉玲1": "张玉玲",
    "周震": "周震", "周震1": "周震",
}

def norm_coach(s):
    s = (s or "").strip()
    if not s:
        return "未填教练"
    s2 = re.sub(r"\d+$", "", s)  # 去尾随数字
    if s in COACH_ALIAS:
        return COACH_ALIAS[s]
    if s2 in COACH_ALIAS:
        return COACH_ALIAS[s2]
    return COACH_ALIAS.get(s, s)

def parse_date(s):
    s = str(s).strip()
    if re.fullmatch(r"\d{4,5}", s):  # Excel 序列号 46275
        try:
            d = date(1899, 12, 30) + timedelta(days=int(s))
            return f"{d.month}.{d.day}"
        except Exception:
            pass
    m = re.search(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", s)
    if m:
        return f"{int(m.group(2))}.{int(m.group(3))}"
    m = re.search(r"(\d{1,2})[.月/ ](\d{1,2})", s)
    if m:
        return f"{int(m.group(1))}.{int(m.group(2))}"
    return s or "未知"

def norm_slot(s):
    s = (s or "").strip()
    if not s:
        return ""
    t = s.replace(" ", "")
    if t in SLOT_STD:
        return t
    rules = [
        ("早上10", "早上10点"), ("10点", "早上10点"), ("上午10", "早上10点"),
        ("下午2", "下午2点"), ("2点", "下午2点"), ("下午14", "下午2点"),
        ("下午4", "下午4点"), ("4点", "下午4点"), ("下午16", "下午4点"),
        ("下午6", "下午6点"), ("6点", "下午6点"), ("晚上6", "下午6点"), ("晚6", "下午6点"),
        ("1v4", "成人班1V4"), ("1V4", "成人班1V4"), ("一对四", "成人班1V4"), ("1对4", "成人班1V4"),
        ("1v1", "成人班1V1"), ("1V1", "成人班1V1"), ("一对一", "成人班1V1"), ("1对1", "成人班1V1"),
    ]
    for k, v in rules:
        if k in t:
            return v
    return s

def resolve_token():
    t = os.environ.get("GITHUB_TOKEN")
    if t:
        return t
    try:
        txt = open(ENV, encoding="utf-8").read()
        m = re.search(r"GITHUB_TOKEN\s*=\s*[\"']?([^\s\"']+)", txt)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None

def push_bytes(content, path, msg):
    tok = resolve_token()
    if not tok:
        print(f"⚠️ 无 GITHUB_TOKEN，仅生成本地：{path}")
        return False
    api = f"https://api.github.com/repos/{REPO}/contents/{path}"
    req = urllib.request.Request(api, headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"})
    sha = None
    try:
        sha = json.load(urllib.request.urlopen(req, timeout=30)).get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    b64 = base64.b64encode(content).decode()
    body = {"message": msg, "content": b64}
    if sha:
        body["sha"] = sha
    req2 = urllib.request.Request(api, data=json.dumps(body).encode(),
                                  headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json",
                                           "Content-Type": "application/json"}, method="PUT")
    r = urllib.request.urlopen(req2, timeout=60)
    print(f"✅ 推送 {path} 成功 HTTP {r.status}")
    return True

HTML_TPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>星羿 · 教练课时统计</title>
<style>
  :root{--g1:#0f9d58;--g2:#34c759;--o:#ff7a18;--ink:#1f2a37;--mut:#8a93a2;--bg:#f4f7f5;--card:#fff;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,"PingFang SC",Segoe UI,sans-serif;background:var(--bg);color:var(--ink);padding:14px;max-width:760px;margin:0 auto}
  header{display:flex;align-items:center;gap:10px;margin-bottom:4px}
  header .logo{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff 0 22%,var(--o) 24% 38%,var(--g1) 40%);box-shadow:0 1px 4px rgba(0,0,0,.15)}
  h1{font-size:18px}
  .meta{color:var(--mut);font-size:12px;margin:2px 0 12px}
  .kpis{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
  .kpi{flex:1;min-width:84px;background:var(--card);border-radius:12px;padding:10px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .kpi b{display:block;font-size:20px;color:var(--g1)}
  .kpi span{font-size:11px;color:var(--mut)}
  .controls{display:flex;gap:8px;align-items:center;margin-bottom:12px}
  select{flex:1;padding:9px 10px;border:1px solid #d8e0db;border-radius:10px;font-size:14px;background:#fff}
  .sec{background:var(--card);border-radius:14px;padding:12px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .sec h2{font-size:14px;margin-bottom:10px;color:var(--g1)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:7px 6px;text-align:center;border-bottom:1px solid #eef1ef}
  th{color:var(--mut);font-weight:600}
  td.name,th.name{text-align:left;font-weight:600}
  tr.total td{font-weight:700;background:#f0faf4}
  .bar{height:14px;border-radius:7px;background:linear-gradient(90deg,var(--g2),var(--g1));min-width:2px}
  .barcell{text-align:left;min-width:90px}
  .legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--mut);margin-top:8px}
  .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:3px;vertical-align:-1px}
  .note{font-size:12px;color:var(--o);background:#fff6ee;border-radius:10px;padding:9px 10px;margin-bottom:12px}
  .empty{color:var(--mut);font-size:13px;text-align:center;padding:18px}
  .shade{display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--g1);opacity:.18;margin-right:4px}
</style>
</head>
<body>
<header><div class="logo"></div><h1>教练课时统计</h1></header>
<div class="meta" id="meta"></div>
<div id="warn"></div>
<div class="controls">
  <select id="coachSel"><option value="__ALL__">全部教练</option></select>
</div>
<div class="kpis" id="kpis"></div>
<div class="sec"><h2>教练 × 时段 课时分布</h2><div id="cross"></div></div>
<div class="sec"><h2 id="matrixTitle">按日期 × 时段 明细</h2><div id="matrix"></div></div>

<script>
const DATA = __DATA_JSON__;
const SLOTS = DATA.slots.filter(s=>s!=="未录");
const SLOT_COLORS = {"早上10点":"#0f9d58","下午2点":"#34c759","下午4点":"#ffb020","下午6点":"#ff7a18","成人班1V4":"#5b8def","成人班1V1":"#9b6dff"};
function fmtD(k){const p=k.split(".");return p.length===2?p[0]+"月"+p[1]+"日":k;}
function esc(s){return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}

document.getElementById("meta").textContent = "更新于 "+DATA.updated+" · 共 "+DATA.dates.length+" 个上课日 · 数据来源《学员上课记录》";

// 教练下拉
const sel=document.getElementById("coachSel");
Object.keys(DATA.coaches).forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c+"（"+DATA.coaches[c].total+"节）";sel.appendChild(o);});
sel.addEventListener("change",()=>render(sel.value));

function coachList(filter){
  let names=Object.keys(DATA.coaches);
  if(filter && filter!=="__ALL__") names=names.filter(n=>n===filter);
  return names.sort((a,b)=>DATA.coaches[b].total-DATA.coaches[a].total);
}

function renderKpis(filter){
  const names=coachList(filter);
  let total=0,days=new Set();
  names.forEach(n=>{total+=DATA.coaches[n].total;Object.keys(DATA.coaches[n].byDate).forEach(d=>days.add(d));});
  const kpis=[
    ["总课时",total+" 节"],
    ["教练",names.length+" 人"],
    ["上课日",days.size+" 天"],
    ["时段档",SLOTS.length+" 类"],
  ];
  document.getElementById("kpis").innerHTML=kpis.map(k=>`<div class="kpi"><b>${k[1]}</b><span>${k[0]}</span></div>`).join("");
}

function renderCross(filter){
  const names=coachList(filter);
  let html="<table><tr><th class='name'>教练</th>"+SLOTS.map(s=>`<th>${esc(s)}</th>`).join("")+"<th>未录</th><th>合计</th></tr>";
  let tot=[0]*(SLOTS.length+1);
  names.forEach(n=>{
    const c=DATA.coaches[n];let row=0;
    html+="<tr><td class='name'>"+esc(n)+"</td>";
    SLOTS.forEach((s,i)=>{const v=c.bySlot[s]||0;tot[i]+=v;row+=v;html+=`<td>${v||""}</td>`;});
    const un=c.bySlot["未录"]||0;tot[SLOTS.length]+=un;row+=un;
    html+=`<td>${un||""}</td><td>${row}</td></tr>`;
  });
  if(names.length>1){
    html+="<tr class='total'><td class='name'>合计</td>";
    tot.forEach(v=>html+=`<td>${v}</td>`);
    html+="</tr>";
  }
  html+="</table>";
  // 图例
  html+="<div class='legend'>"+SLOTS.map(s=>`<span><i style="background:${SLOT_COLORS[s]}"></i>${esc(s)}</span>`).join("")+"</div>";
  document.getElementById("cross").innerHTML=html;
}

function renderMatrix(filter){
  const names=coachList(filter);
  if(names.length>1){
    document.getElementById("matrixTitle").textContent="按日期 × 时段 明细（请选择单个教练）";
    document.getElementById("matrix").innerHTML="<div class='empty'>在上方选择一位教练，查看其每日各时段的课时明细</div>";
    return;
  }
  const n=names[0];const c=DATA.coaches[n];
  document.getElementById("matrixTitle").textContent=n+" · 每日 × 时段 明细";
  const dates=DATA.dates.filter(d=>c.byDate[d]);
  if(!dates.length){document.getElementById("matrix").innerHTML="<div class='empty'>暂无数据</div>";return;}
  let html="<table><tr><th class='name'>日期</th>"+SLOTS.map(s=>`<th>${esc(s)}</th>`).join("")+"<th>合计</th></tr>";
  dates.forEach(d=>{
    html+="<tr><td class='name'>"+fmtD(d)+"</td>";let row=0;
    SLOTS.forEach(s=>{const v=c.bySlot[s]||0;row+=v;html+=`<td>${v?v:'·'}</td>`;});
    html+=`<td>${row}</td></tr>`;
  });
  html+="</table>";
  document.getElementById("matrix").innerHTML=html;
}

function render(filter){
  renderKpis(filter);renderCross(filter);renderMatrix(filter);
}
// 未录提示
const unTotal=Object.values(DATA.coaches).reduce((a,c)=>a+(c.bySlot["未录"]||0),0);
if(unTotal>0){
  document.getElementById("warn").innerHTML=`<div class="note">⚠️ 当前有 ${unTotal} 节课时尚未录入「时段」（源表《学员上课记录》未填时段列）。教练补录时段后，三维统计自动生效。</div>`;
}
render("__ALL__");
</script>
</body>
</html>
"""

def write_html(out):
    html = HTML_TPL.replace("__DATA_JSON__", json.dumps(out, ensure_ascii=False))
    open(OUT_HTML, "w", encoding="utf-8").write(html)
    return html

def main():
    if not os.path.exists(CSV):
        print("错误：找不到 class_records.csv，请先运行 fetch_records.py")
        raise SystemExit(1)
    rows = list(csv.reader(open(CSV, encoding="utf-8-sig")))
    hdr = rows[0]
    data = [r for r in rows[1:] if any(r)]

    def col(*ns):
        for n in ns:
            for i, h in enumerate(hdr):
                if h.strip() == n:
                    return i
        return -1

    ci_date = col("日期")
    ci_coach = col("教练")
    ci_slot = col("时段", "时间段", "时间")
    if ci_date < 0 or ci_coach < 0:
        print("错误：缺少 日期/教练 列，表头=", hdr)
        raise SystemExit(1)

    coaches = {}
    dates_set = set()
    unknowns = 0
    for r in data:
        g = lambda i: r[i] if 0 <= i < len(r) else ""
        coach = norm_coach(g(ci_coach))
        d = parse_date(g(ci_date))
        slot = norm_slot(g(ci_slot)) or "未录"
        if d == "未知":
            unknowns += 1
        dates_set.add(d)
        c = coaches.setdefault(coach, {"total": 0, "byDate": {}, "bySlot": {}})
        c["total"] += 1
        c["byDate"][d] = c["byDate"].get(d, 0) + 1
        c["bySlot"][slot] = c["bySlot"].get(slot, 0) + 1

    def dkey(k):
        p = k.split(".")
        return (int(p[0]) if len(p) > 0 and p[0].isdigit() else 0,
                int(p[1]) if len(p) > 1 and p[1].isdigit() else 0)
    dates = sorted(dates_set, key=dkey)

    out = {
        "updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "slots": SLOT_STD + ["未录"],
        "coaches": coaches,
        "dates": dates,
        "unknownDates": unknowns,
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    html = write_html(out)
    print(f"✅ 生成 coach-lessons.json + coach-lessons.html | 教练 {len(coaches)} 人 | 总课时 {sum(c['total'] for c in coaches.values())} 节 | 时段未录 {sum(c['bySlot'].get('未录',0) for c in coaches.values())} 节")
    if unknowns:
        print(f"⚠️ {unknowns} 条日期无法解析，请检查源数据")
    push_bytes(json.dumps(out, ensure_ascii=False, indent=1).encode("utf-8"), "data/coach-lessons.json", "chore: 更新教练课时统计 coach-lessons.json")
    push_bytes(html.encode("utf-8"), "coach-lessons.html", "chore: 更新教练课时统计页 coach-lessons.html")

if __name__ == "__main__":
    main()
