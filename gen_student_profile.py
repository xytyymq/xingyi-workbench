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
import subprocess, json, time, urllib.request, zipfile, io, xml.etree.ElementTree as ET, os, re, datetime, base64, hashlib, sys

def _locate_tdoc_skill():
    """动态定位 tencent-docs 插件下的 tencentdocs.py（插件版本升级会改目录名，
    原硬编码 5.5.1 路径已失效导致体测档案每晚生成失败）。"""
    import glob as _glob
    base = "C:/Users/Administrator/.workbuddy/plugins/cache/workbuddy-builtin/tencent-docs-plugin"
    cands = _glob.glob(os.path.join(base, "*", "skills", "tencent-docs", "tencentdocs.py"))
    if cands:
        cands.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return os.path.dirname(cands[0])
    return "C:/Users/Administrator/.workbuddy/plugins/cache/workbuddy-builtin/tencent-docs-plugin/5.5.1-wb.37570276.g9af62480.h1a8f7c37fe76/skills/tencent-docs"

SKILL = _locate_tdoc_skill()
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
    sc = r.get("result", {}).get("structuredContent") or {}
    task = sc.get("task_id")
    if not task:
        raise RuntimeError("腾讯文档导出失败：manage.export_file 未返回 task_id，响应=%s" % json.dumps(r, ensure_ascii=False)[:500])
    url = None
    for _ in range(60):  # 最多等 120s，避免大表导出未完成时误判为失败
        p = tdoc("tencent-docs", "manage.export_progress", json.dumps({"task_id": task}))
        psc = p.get("result", {}).get("structuredContent") or {}
        url = psc.get("file_url")
        if url:
            break
        time.sleep(2)
    if not url:
        raise RuntimeError("腾讯文档导出超时：task_id=%s 在 120s 内未返回 file_url" % task)
    return urllib.request.urlopen(url, timeout=60).read()

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

# 教练填表错别字/异体字映射（与 gen_parent_msg.py / gen_points.py 保持一致）
# ⚠️ 方向 = 错字 → 正确名。2026-10-22 大哥确认：邹书云/黄文晧 是同一人的错写。
NAME_ALIAS = {
    "徐梓宸": "徐梓辰",
    "彭嘉妤": "彭嘉好",
    "彭佳妤": "彭嘉好",
    "邓琬妮": "邓琬宁",
    "熊沁杰尼": "熊沁杰妮",
    "黄文晧": "黄文皓",
    "振洪宇": "洪振宇",
    "振洪新": "洪振新",
    "邹书云": "邹书芸",
    "刘欣玥": "刘昕玥",
    "刘铭俊": "刘铭燇",
    "刘铭翰": "刘铭燇",
    "吴帛绅": "吴帛珅",
    "黄智远": "黄知远",
    "吴予楠": "吴宇楠"
}

def split_names(s):
    """姓名含 '/' 或 '、' 直接拆成多个学员；错别字/异体字统一映射到正确名。"""
    s = (s or '').strip()
    if not s:
        return []
    return [NAME_ALIAS.get(p.strip(), p.strip()) for p in re.split(r'[/、]', s) if p.strip()]

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

# 待回查清单（大哥 2026-10-08 批第 3、5 项）：这些值只标记、不删——
# 可能确实是真的（新手颠球 1 个），需人工回查原始登记表后再定。
# 同时堵住真实的「未测占位」：坐位体前屈允许负数，跳绳不得为 0，未测请留空。
SUSPECT = []


def sanity_check(m, name, date):
    bad = []
    sr = m.get('sitReach')
    if sr in (0, 1):
        bad.append('坐位体前屈=%s（正常 -20~25，0/1 多为未测占位）' % sr)
    if m.get('rope') == 0:
        bad.append('跳绳=0（几乎不可能，疑似未测）')
    if m.get('run50') in (0, 1):
        bad.append('50米跑=%s（秒数不合理）' % m.get('run50'))
    if m.get('serve') == 0 and not m.get('wallSquat'):
        bad.append('发球进区=0 且靠墙静蹲缺失（疑似整行漏填）')
    if bad:
        SUSPECT.append({'name': name, 'date': date, 'items': bad})


def to_test(t, name=''):
    m = to_m(t)
    date = t.get('测试日期', '')
    if name:
        sanity_check(m, name, date)
    return {'date': date, 'm': m, 'note': t.get('备注', '') or ''}

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

def merge_dup(a, b):
    """云端同一学员存在多条时按「并集」合并。
    archive.html 前端自动同步会产生重复条目（同一学员 2~3 条、id 不同），
    早期用 last-wins 会丢掉副本里独有的体测日期，故改为并集。
    """
    m = dict(a)
    for k in ('id', 'age', 'gender', 'cls', 'createdAt'):
        if not m.get(k) and b.get(k):
            m[k] = b[k]
    m['tests'] = merge_tests(a.get('tests', []), b.get('tests', []))
    seen, ul = set(), []
    for l in list(a.get('lessons') or []) + list(b.get('lessons') or []):
        key = json.dumps(l, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            ul.append(l)
    m['lessons'] = ul
    return m

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

def union_entry(cur, sup):
    """把「上次本地快照」的条目与本次结果做并集：本次优先，快照只补缺失。

    背景（2026-10-05）：archive.html 前端 13:00 的「上课记录自动识别新生入档」管线
    会用自己 localStorage 的主档整份覆盖云端，导致只在体测管线里存在的学员被静默抹掉
    （当日 97 → 77，丢了 邹书云 / 吴帛坤 / 戴子涵 三条及其体测数据）。
    故加此护栏：本次结果 ∪ 上次本地快照，保证任何学员一旦入过档就不会再消失。
    """
    m = dict(cur)
    for k in ('id', 'age', 'gender', 'cls', 'createdAt'):
        if not m.get(k) and sup.get(k):
            m[k] = sup[k]
    tm = {t.get('date'): t for t in (sup.get('tests') or []) if t.get('date')}
    for t in (cur.get('tests') or []):          # 本次（腾讯文档/云端）同日期优先
        if t.get('date'):
            tm[t['date']] = t
    m['tests'] = sorted(tm.values(), key=lambda x: x.get('date') or '')
    seen, ul = set(), []
    for l in list(cur.get('lessons') or []) + list(sup.get('lessons') or []):
        k = json.dumps(l, sort_keys=True, ensure_ascii=False)
        if k not in seen:
            seen.add(k)
            ul.append(l)
    m['lessons'] = ul
    return m


def union_prev_local(merged):
    """与上次本地 data/profiles.json 做并集，返回 (merged, 复活名单)。"""
    if not os.path.exists(OUT_PROFILES):
        return merged, []
    try:
        prev = json.load(open(OUT_PROFILES, encoding='utf-8'))
    except Exception as e:
        print("  · 本地快照读取失败，跳过并集护栏：%s" % e)
        return merged, []
    prev = prev if isinstance(prev, list) else (prev.get('list') or [])
    pm = {}
    for s in prev:
        n = s.get('name')
        if not n:
            continue
        pm[n] = merge_dup(pm[n], s) if n in pm else s
    cur = {s.get('name'): s for s in merged if s.get('name')}
    out, revived = [], []
    for s in merged:
        n = s.get('name')
        out.append(union_entry(s, pm[n]) if n in pm else s)
    for n, s in pm.items():
        if n not in cur:
            revived.append(n)
            out.append(s)
    return out, revived


def get_cloud(retries=4, sleep=5):
    """GET 云端 data/profiles.json，带重试。
    返回 (entries, sha, ok)。ok=False 表示读取失败——此时**绝对不能推送**，
    否则会用「仅腾讯文档」的残缺结果覆盖掉云端前端建档学员（2026-10-03 事故）。
    """
    tok = resolve_token()
    if not tok:
        return [], None, False
    H = {'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json'}
    last = None
    for i in range(retries):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(GH_API, headers=H), timeout=60))
            return json.loads(decodeB64(r.get('content', ''))), r.get('sha'), True
        except Exception as e:
            last = e
            print(f"  · 第 {i+1}/{retries} 次读取云端失败：{e}")
            time.sleep(sleep)
    print("❌ GET 云端失败（已重试 %d 次）：%s" % (retries, last))
    return [], None, False


def push_profiles(merged, sha=None):
    tok = resolve_token()
    if not tok:
        print("⚠️ 无 GITHUB_TOKEN，跳过云端推送")
        return False
    H = {'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'}
    if not sha:
        print("❌ 缺少云端 sha（云端读取失败），为防覆盖丢数据，已中止推送")
        return False
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
    cloud_entries, cloud_sha, cloud_ok = get_cloud()
    if not cloud_ok:
        print("❌ 云端 profiles.json 读取失败 → 无法做并集合并。"
              "为避免用残缺数据覆盖云端（前端建档学员会丢失），本次**不写本地、不推送**。")
        return 2
    dup = 0
    for s in cloud_entries:
        n = s.get('name')
        if not n:
            continue
        if n in cloud_by_name:
            cloud_by_name[n] = merge_dup(cloud_by_name[n], s)
            dup += 1
        else:
            cloud_by_name[n] = s
    if dup:
        print(f"ℹ️ 云端存在 {dup} 条重复学员条目（前端同步产生），已按并集合并，避免体测记录丢失")

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
            'tests': [to_test(t, name) for t in st['tests']],
            'lessons': [to_lesson(l) for l in st['lessons']],
        })

    if SUSPECT:
        print(f"⚠️ 体测可疑值 {len(SUSPECT)} 条（只标记不删除，请人工回查原始登记表）：")
        for s in SUSPECT:
            print(f"   · {s['name']} {s['date']} — {'；'.join(s['items'])}")
        try:
            with open('C:/Users/Administrator/WorkBuddy/2026-09-21-20-34-00/_tcexport/tice_review.md', 'a', encoding='utf-8') as f:
                f.write("\n## 体测可疑值待回查 %s\n" % datetime.datetime.now().strftime('%Y-%m-%d %H:%M'))
                for s in SUSPECT:
                    f.write("- %s %s：%s\n" % (s['name'], s['date'], '；'.join(s['items'])))
        except Exception as e:
            print("   （回查清单写入失败：%s）" % e)

    merged = merge_cloud(list(cloud_by_name.values()), new_list)
    # 兜底：确保每个学员 tests/lessons 都是 list（历史/云端独有学员可能缺键或为 None，否则 archive.html 读取报错）
    for s in merged:
        if not isinstance(s.get('tests'), list):
            s['tests'] = []
        if not isinstance(s.get('lessons'), list):
            s['lessons'] = []

    # 护栏：与上次本地快照并集，防止前端整份覆盖导致学员静默消失（2026-10-05 事故）
    merged, revived = union_prev_local(merged)
    if revived:
        print(f"🛟 并集护栏：从上次本地快照补回 {len(revived)} 名被前端覆盖掉的学员：{revived}")

    os.makedirs(os.path.dirname(OUT_PROFILES) or '.', exist_ok=True)
    with open(OUT_PROFILES, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)
    print(f"已生成 {OUT_PROFILES}，学员数：{len(merged)}（腾讯文档新聚合 {len(new_list)}，云端保留 {len(merged) - len(new_list)}）")
    ok = push_profiles(merged, cloud_sha)
    return 0 if ok else 3

if __name__ == "__main__":
    sys.exit(main() or 0)
