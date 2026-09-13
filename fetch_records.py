#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_records.py — 从腾讯文档《星羿·学员体测档案》第1子表取数，转成 gen_parent_msg.py 要的 CSV。
列映射：上课日期->日期, 姓名->学员, 班级->班级, 教练->教练, 进步点->今日进步, 待加强->下节课重点
依赖：同目录的 tencentdocs.py（腾讯文档 MCP CLI，票据由宿主注入）。
"""
import subprocess, json, time, urllib.request, zipfile, io, xml.etree.ElementTree as ET, os, csv, sys, re

SKILL = "C:/Users/Administrator/.workbuddy/plugins/cache/workbuddy-builtin/tencent-docs-plugin/5.5.1-wb.37570276.g9af62480.h1a8f7c37fe76/skills/tencent-docs"
PY = "C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe"
FILE_ID = "BCmMnaVvBTRo"  # 星羿·学员体测档案
OUT = "class_records.csv"

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

def xlsx_rows(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(NS + 'si'):
            ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    target = None
    for sh in sorted(n for n in z.namelist() if 'worksheets/sheet' in n):
        root = ET.fromstring(z.read(sh))
        grid = []
        for row in root.iter(NS + 'row'):
            d = {}
            maxc = -1
            for c in row.findall(NS + 'c'):
                ci = col_to_idx(c.get('r'))
                d[ci] = cell_val(c, ss)
                maxc = max(maxc, ci)
            grid.append([d.get(i, '') for i in range(maxc + 1)])
        if grid and any('学员ID' in (h or '') for h in grid[0]):
            target = grid
            break
    if not target:
        sh = sorted(n for n in z.namelist() if 'worksheets/sheet' in n)[0]
        root = ET.fromstring(z.read(sh))
        grid = []
        for row in root.iter(NS + 'row'):
            d = {}
            maxc = -1
            for c in row.findall(NS + 'c'):
                ci = col_to_idx(c.get('r'))
                d[ci] = cell_val(c, ss)
                maxc = max(maxc, ci)
            grid.append([d.get(i, '') for i in range(maxc + 1)])
        target = grid
    return target[0], target[1:]

def main():
    print("导出《星羿·学员体测档案》...")
    data = export_and_download(FILE_ID)
    hdr, rows = xlsx_rows(data)
    # 定位源列
    def idx(*names):
        for n in names:
            for i, h in enumerate(hdr):
                if h.strip() == n:
                    return i
        return -1
    c_date = idx("上课日期")
    c_name = idx("姓名")
    c_id = idx("学员ID")
    c_class = idx("班级")
    c_coach = idx("教练")
    c_good = idx("进步点", "今日进步")
    c_bad = idx("待加强", "下节课重点")
    if c_date < 0:
        print("错误：未找到 上课日期 列，表头=", hdr)
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["日期", "学员", "班级", "教练", "今日进步", "下节课重点"])
        n = 0
        for r in rows[1:]:
            if not any(r):
                continue
            g = lambda i: r[i] if 0 <= i < len(r) else ""
            name = g(c_name) or g(c_id)
            w.writerow([g(c_date), name, g(c_class), g(c_coach), g(c_good), g(c_bad)])
            n += 1
    print(f"已生成 {OUT}，数据行数：{n}")

if __name__ == "__main__":
    main()
