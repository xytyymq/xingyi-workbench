#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_student_profile.py — 星羿羽毛球馆 · 学员体测档案自动生成器
读取《星羿·学员体测档案》(file_id=BCmMnaVvBTRo) 三子表：
  上课明细 / 学员档案 / 体测明细
按「学员姓名」聚合（姓名含 '/' 或 '、' 直接拆成多个学员），生成与仓库
archive.html 兼容的 data/profiles.json（list[{id,name,age,gender,cls,createdAt,tests,lessons}]），
并经 GitHub API 推送至 xytyymq/xingyi-workbench（合并策略，不破坏教练手动录入）。
依赖：同目录 tencentdocs.py（腾讯文档 MCP CLI）；.env 中 GITHUB_TOKEN。
"""
import subprocess, json, time, urllib.request, zipfile, io, xml.etree.ElementTree as ET, os, re, datetime, base64, hashlib

SKILL = "C:/Users/Administrator/.workbuddy/plugins/cache/workbuddy-builtin/tencent-docs-plugin/5.5.1-wb.37570276.g9af62480.h1a8f7c37fe76/skills/tencent-docs"
PY = "C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe"
FILE_ID = "BCmMnaVvBTRo"  # 星羿·学员体测档案
OUT_PROFILES = "data/profiles.json"
GH_REPO = "xytyymq/xingyi-workbench"
GH_PATH = "data/profiles.json"
GH_API = "https://api.github.com/repos/" + GH_REPO + "/contents/" + GH_PATH

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def tdoc(service, tool, args):
    out = subprocess.run([PY, os.path.join(SKILL, "tencentdocs.py"), "tdoc_call", service, tool, args],
                         capture_output=True, text=True).stdout
    return json.loads(out)

def export_and_download(file_id):
    r = tdoc("tencent-docs", "manage.export_file", json.dumps({"file_id": file_id}))
    task = r["result"]["structuredContent"]["task_id"]
    url = None
    for _ in range(30):
        p = tdoc("tencent-docs", "manage.export_progress", json.dumps({"task_id": task}))
        url = p["result"]["structuredContent"].get("file_url")
        if url:
            break
        time.sleep(2)
    return urllib.request.urlopen(url, timeout=30).read()

def cell_val(c, ss):
    v = c.find(NS + 'v')
    if v is None:
        return ''
    if c.get('t') == 's':
        try:
            return ss[int(v.text)]
        except Exception:
            return ''
    return v.text or ''

def col_to_idx(ref):
    m = re.match(r'([A-Z]+)\d+', ref or '')
    if not m:
        return 0
    col = 0
    for ch in m.group(1):
        col = col * 26 + (ord(ch) - 64)
    return col - 1

def split_names(s):
    """姓名含 '/' 或 '、' 直接拆成多个学员。"""
    s = (s or '').strip()
    if not s:
        return []
    return [p.strip() for p in re.split(r'[/、]', s) if p.strip()]

def read_sheets(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    names = []
    if 'xl/workbook.xml' in z.namelist():
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        for s in wb.iter(NS + 'sheet'):
            names.append(s.get('name'))
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(NS + 'si'):
            ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    sheets = sorted(n for n in z.namelist() if 'worksheets/sheet' in n)
    out = {}
    for i, sh in enumerate(sheets):
        root = ET.fromstring(z.read(sh))
        grid = []
        for row in root.iter(NS + 'row'):
            d = {}
            maxc = -1
            for c in row.findall(NS + 'c'):
                ci = col_to_idx(c.get('r'))
                d[ci] = cell_val(c, ss)
                maxc = max(maxc, ci)
            grid.append([d.get(j, '') for j in range(maxc + 1)])
        sheet_name = names[i] if i < len(names) else f"sheet{i+1}"
        out[sheet_name] = grid
    return out

# ---------------- 推送与合并 ----------------
def resolve_token():
    t = os.environ.get("GITHUB_TOKEN")
    if t:
        return t
    try:
        for line in open('.env', encoding='utf-8'):
            if line.startswith('GITHUB_TOKEN='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ''

def b64utf8(s):
    return base64.b64encode(s.encode('utf-8')).decode('ascii')

def decodeB64(s):
    return base64.b64decode((s or '').replace('\n', '')).decode('utf-8')

# 腾讯文档体测明细中文列 -> archive.html METRICS 英文键
METRIC_MAP = {
    '身高(cm)': 'height', '体重(kg)': 'weight', '坐位体前屈(cm)': 'sitReach',
    '单脚闭眼站立(秒)': 'singleStand', '靠墙静蹲(秒)': 'wallSquat', '姿态评估': 'posture',
    '50米跑(秒)': 'run50', '立定跳远(cm)': 'standingJump', '纵跳摸高(cm)': 'verticalJump',
    '跳绳(个)': 'rope', '15秒挥拍(次)': 'swing15', '米字步计时(秒)': 'footwork',
    '发球进区(个)': 'serve', '连续颠球(个)': 'rally', '正手高远球击球过网(个)': 'clear',
}

def to_m(t):
    m = {}
    for cn, en in METRIC_MAP.items():
        v = t.get(cn, '')
        if v in ('', None):
            continue
        if en != 'posture':
            try:
                v = float(v)
                if v == int(v):
                    v = int(v)
            except Exception:
                pass
        m[en] = v
    return m

def to_test(t):
    return {'date': t.get('测试日期', ''), 'm': to_m(t), 'note': t.get('备注', '') or ''}

def to_lesson(l):
    return {'date': l.get('上课日期', ''), 'cls': l.get('班级', ''), 'coach': l.get('教练', ''),
            'score': l.get('技能评分', ''), 'good': l.get('进步点', ''), 'bad': l.get('待加强', ''),
            'feedback': l.get('家长反馈', '')}

def make_id(name):
    return "S" + str(int.from_bytes(hashlib.md5(name.encode('utf-8')).digest()[:6], 'big'))

def merge_tests(ex, new):
    tm = {(t.get('date') or ''): t for t in (ex or []) if t.get('date')}
    for t in (new or []):
        if t.get('date'):
            tm[t['date']] = t
    return sorted(tm.values(), key=lambda x: (x.get('date') or ''))

def merge_cloud(old, new):
    # new = 腾讯文档聚合（权威补充体测/上课）；old = 云端现有（保留手动学员/基础信息）
    by_name = {s.get('name'): s for s in (old or [])}
    out, seen = [], set()
    for s in (new or []):
        seen.add(s['name'])
        ex = by_name.get(s['name'])
        if ex:
            m = dict(ex)
            m['tests'] = merge_tests(ex.get('tests', []), s.get('tests', []))
            m['lessons'] = s.get('lessons', ex.get('lessons', []))
            out.append(m)
        else:
            out.append(s)
    for s in (old or []):
        if s.get('name') not in seen:
            out.append(s)
    return out

def push_profiles(merged):
    tok = resolve_token()
    if not tok:
        print("⚠️ 无 GITHUB_TOKEN，跳过云端推送")
        return False
    H = {'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'}
    sha, old = None, []
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(GH_API, headers=H), timeout=30))
        sha = r.get('sha')
        old = json.loads(decodeB64(r.get('content', '')))
    except Exception as e:
        print("GET 云端失败（将尝试覆盖）：", e)
    body = {'message': '体测档案自动生成 ' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
            'content': b64utf8(json.dumps(merged, ensure_ascii=False, indent=1))}
    if sha:
        body['sha'] = sha
    req = urllib.request.Request(GH_API, data=json.dumps(body).encode('utf-8'), headers=H, method='PUT')
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print("✅ 推送 profiles.json 成功 HTTP", resp.status)
        return True
    except urllib.error.HTTPError as e:
        print("❌ 推送失败 HTTP", e.code, e.read().decode('utf-8', 'ignore')[:200])
        return False

def main():
    print("导出《星羿·学员体测档案》...")
    data = export_and_download(FILE_ID)
    sheets = read_sheets(data)

    students = {}  # name -> {name, base:{}, tests:[], lessons:[]}

    def col_of(grid, *cands):
        hdr = grid[0] if grid else []
        for c in cands:
            for i, h in enumerate(hdr):
                if h.strip() == c:
                    return i
        return -1

    def add_row(name_cell, row, kind, mapper):
        names = split_names(name_cell)
        for n in names:
            st = students.setdefault(n, {"name": n, "base": {}, "tests": [], "lessons": []})
            rec = {}
            for outk, src_col in mapper.items():
                if 0 <= src_col < len(row):
                    rec[outk] = (row[src_col] or '').strip()
            if kind == "base":
                for k, v in rec.items():
                    if v and not st["base"].get(k):
                        st["base"][k] = v
            elif kind == "test":
                st["tests"].append(rec)
            elif kind == "lesson":
                st["lessons"].append(rec)

    # 1) 学员档案 -> base
    if "学员档案" in sheets:
        g = sheets["学员档案"]
        ci = col_of(g, "学员ID"); cn = col_of(g, "姓名"); ca = col_of(g, "年龄")
        cg = col_of(g, "性别"); cc = col_of(g, "班级"); cd = col_of(g, "创建日期")
        for r in g[1:]:
            if not any(r):
                continue
            name_cell = r[cn] if cn >= 0 else ''
            add_row(name_cell, r, "base", {"id": ci, "age": ca, "gender": cg, "cls": cc, "created": cd})

    # 2) 体测明细 -> tests
    if "体测明细" in sheets:
        g = sheets["体测明细"]
        cols = ["学员ID", "姓名", "测试日期", "身高(cm)", "体重(kg)", "BMI", "坐位体前屈(cm)",
                "单脚闭眼站立(秒)", "靠墙静蹲(秒)", "姿态评估", "50米跑(秒)", "立定跳远(cm)",
                "纵跳摸高(cm)", "跳绳(个)", "15秒挥拍(次)", "米字步计时(秒)", "发球进区(个)",
                "连续颠球(个)", "对高远(个)", "正手高远球击球过网(个)", "备注"]
        idx = {c: col_of(g, c) for c in cols}
        keymap = {c: idx[c] for c in cols if idx[c] >= 0}
        for r in g[1:]:
            if not any(r):
                continue
            name_cell = r[idx["姓名"]] if idx["姓名"] >= 0 else ''
            add_row(name_cell, r, "test", {k: v for k, v in keymap.items()})

    # 3) 上课明细 -> lessons
    if "上课明细" in sheets:
        g = sheets["上课明细"]
        cols = ["学员ID", "姓名", "上课日期", "班级", "教练", "技能评分", "进步点", "待加强", "家长反馈"]
        idx = {c: col_of(g, c) for c in cols}
        keymap = {c: idx[c] for c in cols if idx[c] >= 0}
        for r in g[1:]:
            if not any(r):
                continue
            name_cell = r[idx["姓名"]] if idx["姓名"] >= 0 else ''
            add_row(name_cell, r, "lesson", {k: v for k, v in keymap.items()})

    # base.cls 兜底：学员档案空时从上课/体测取最近班级
    for st in students.values():
        if not st["base"].get("cls"):
            for src in (st["lessons"], st["tests"]):
                for rec in src:
                    if rec.get("班级"):
                        st["base"]["cls"] = rec["班级"]
                        break
                if st["base"].get("cls"):
                    break

    # 读取云端现有，按 name 合并（保留手动学员/基础信息，不重复生成 id）
    cloud_by_name = {}
    try:
        tok = resolve_token()
        if tok:
            H = {'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json'}
            r = json.load(urllib.request.urlopen(urllib.request.Request(GH_API, headers=H), timeout=30))
            for s in json.loads(decodeB64(r.get('content', ''))):
                cloud_by_name[s.get('name')] = s
    except Exception as e:
        print("读取云端现有 profiles 失败，仅用腾讯文档：", e)

    new_list = []
    for name, st in students.items():
        ex = cloud_by_name.get(name)
        base = st["base"]
        age = (ex or {}).get('age') or base.get('age', '')
        gender = (ex or {}).get('gender') or base.get('gender', '')
        cls = (ex or {}).get('cls') or base.get('cls', '')
        created = (ex or {}).get('createdAt') or base.get('created', '') or (st['tests'][0].get('测试日期', '') if st['tests'] else '')
        new_list.append({
            'id': (ex or {}).get('id') or make_id(name),
            'name': name, 'age': age, 'gender': gender, 'cls': cls, 'createdAt': created,
            'tests': [to_test(t) for t in st['tests']],
            'lessons': [to_lesson(l) for l in st['lessons']],
        })

    merged = merge_cloud(list(cloud_by_name.values()), new_list)
    # 兜底：确保每个学员 tests/lessons 都是 list（历史/云端独有学员可能缺键或为 None，否则 archive.html 读取报错）
    for s in merged:
        if not isinstance(s.get('tests'), list):
            s['tests'] = []
        if not isinstance(s.get('lessons'), list):
            s['lessons'] = []
    os.makedirs(os.path.dirname(OUT_PROFILES) or '.', exist_ok=True)
    with open(OUT_PROFILES, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)
    print(f"已生成 {OUT_PROFILES}，学员数：{len(merged)}（腾讯文档新聚合 {len(new_list)}，云端保留 {len(merged) - len(new_list)}）")
    push_profiles(merged)

if __name__ == "__main__":
    main()
