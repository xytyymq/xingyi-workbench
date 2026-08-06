/* csv.js — 导入导出：分隔符嗅探 + 表头映射 + JSON 备份
 * 复用 archive.html 的 download(BOM)/exportJSON/importJSON 范式。
 */
window.CSVUtil = (function () {
  const DISC_BY_CODE = { MS: "男单", WS: "女单", MD: "男双", WD: "女双", XD: "混双" };
  const CODE_BY_NAME = { "男单": "MS", "女单": "WS", "男双": "MD", "女双": "WD", "混双": "XD" };

  const HEADER_MAP = {
    "姓名": "name", "名字": "name", "选手": "name", "选手1": "name", "name": "name",
    "搭档": "partner", "选手2": "partner", "伙伴": "partner", "partner": "partner",
    "性别": "gender", "gender": "gender", "sex": "gender",
    "项目": "disciplines", "参赛项目": "disciplines", "报名项目": "disciplines",
    "单位": "club", "俱乐部": "club", "学校": "club", "班级": "club", "队伍": "club",
    "电话": "phone", "手机": "phone", "联系方式": "phone",
    "水平": "level", "等级": "level", "分档": "level",
    "种子": "seed", "备注": "note"
  };

  function sniffDelimiter(line) {
    const cands = ["\t", ",", "，", ";", "；"];
    let best = "\t", bestCount = -1;
    for (const d of cands) {
      const c = line.split(d).length;
      if (c > bestCount) { bestCount = c; best = d; }
    }
    return best;
  }

  function parseCSVLine(line, delim) {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === delim) { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function parseTable(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
    if (!lines.length) return { headers: [], rows: [] };
    const delim = sniffDelimiter(lines[0]);
    const headers = parseCSVLine(lines[0], delim);
    const rows = lines.slice(1).map(l => parseCSVLine(l, delim));
    return { headers, rows };
  }

  function resolveCodes(val) {
    if (!val) return [];
    const parts = String(val).split(/[\/,，、\s]+/).filter(Boolean);
    const codes = [];
    for (const p of parts) {
      if (DISC_BY_CODE[p]) codes.push(p);
      else if (CODE_BY_NAME[p]) codes.push(CODE_BY_NAME[p]);
      else {
        const up = p.toUpperCase();
        if (DISC_BY_CODE[up]) codes.push(up);
      }
    }
    return Array.from(new Set(codes));
  }

  function mapRow(headers, row) {
    const o = {};
    headers.forEach((h, i) => {
      const key = HEADER_MAP[h] || null;
      if (!key) return;
      const v = (row[i] !== undefined ? row[i] : "").trim();
      if (key === "disciplines") o.disciplines = resolveCodes(v);
      else if (key === "level") o.level = v ? parseInt(v, 10) || null : null;
      else if (key === "seed") o.seed = v ? parseInt(v, 10) || 0 : 0;
      else if (v) o[key] = v;
    });
    return o;
  }

  /* 文本/文件 → Player[]（未入库） */
  function rowsToPlayers(text, existingNames) {
    const { headers, rows } = parseTable(text);
    const players = [];
    const seen = existingNames ? new Set(existingNames) : new Set();
    for (const row of rows) {
      const o = mapRow(headers, row);
      if (!o.name) continue;
      const disciplines = o.disciplines && o.disciplines.length ? o.disciplines : [];
      const key = o.name + "|" + (o.partner || "") + "|" + disciplines.join(",");
      if (seen.has(key)) continue; // 同次导入去重
      seen.add(key);
      players.push({
        id: null,
        name: o.name,
        gender: o.gender || "",
        club: o.club || "",
        phone: o.phone || "",
        level: o.level || null,
        disciplines: disciplines,
        partner: o.partner || "",
        seed: o.seed || 0,
        present: false,
        checkinAt: null,
        note: o.note || ""
      });
    }
    return players;
  }

  /* ---------- 导出 ---------- */
  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJSON() {
    download("比赛数据备份_" + dateStamp() + ".json", JSON.stringify(Store.emptyDB ? buildBackup() : {}, null, 2), "application/json");
  }
  function buildBackup() {
    // 直接序列化当前 DB
    try { return JSON.parse(localStorage.getItem(Store.LS_KEY) || "{}"); } catch (e) { return {}; }
  }

  function exportPlayersCSV() {
    const headers = ["姓名", "搭档", "性别", "项目", "单位", "水平", "电话", "签到"];
    const rows = Store.allPlayers().map(p => [
      p.name, p.partner || "", p.gender || "", (p.disciplines || []).join("/"),
      p.club || "", p.level || "", p.phone || "", p.present ? "已到" : "未到"
    ]);
    const csv = [headers.join(",")].concat(rows.map(r => r.map(csvCell).join(","))).join("\n");
    download("选手名单_" + dateStamp() + ".csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
  }

  function exportRankCSV(disc) {
    const rank = Stats.finalRanking(disc);
    const headers = ["名次", "参赛单元", "类型"];
    const rows = rank.map(r => [r.rank, r.label, r.kind === "pair" ? "双打" : "单打"]);
    const csv = [headers.join(",")].concat(rows.map(r => r.map(csvCell).join(","))).join("\n");
    download((disc.name || "排名") + "_名次_" + dateStamp() + ".csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
  }

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function dateStamp() {
    const d = new Date();
    const p = n => (n < 10 ? "0" + n : "" + n);
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
  }

  return {
    DISC_BY_CODE, CODE_BY_NAME, HEADER_MAP,
    sniffDelimiter, parseCSVLine, parseTable, resolveCodes, rowsToPlayers,
    download, exportJSON, exportPlayersCSV, exportRankCSV, csvCell, dateStamp
  };
})();
