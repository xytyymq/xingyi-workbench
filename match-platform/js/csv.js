/* csv.js — 导入导出：分隔符嗅探 + 表头映射 + JSON 备份
 * 复用 archive.html 的 download(BOM)/exportJSON/importJSON 范式。
 */
window.CSVUtil = (function () {
  const DISC_BY_CODE = { MS: "男单", WS: "女单", MD: "男双", WD: "女双", XD: "混双", TEAM: "团体赛" };
  const CODE_BY_NAME = { "男单": "MS", "女单": "WS", "男双": "MD", "女双": "WD", "混双": "XD", "团体赛": "TEAM" };

  const HEADER_MAP = {
    "姓名": "name", "名字": "name", "选手": "name", "选手1": "name", "name": "name",
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

  /* ---------- .xlsx 轻量解析（Excel 常被改名成 .csv） ---------- */
  function isXlsxBuffer(buf) {
    if (!buf || buf.byteLength < 4) return false;
    const v = new Uint8Array(buf);
    return v[0] === 0x50 && v[1] === 0x4B && v[2] === 0x03 && v[3] === 0x04;
  }

  // 用原生 DecompressionStream 解压 deflate-raw（xlsx 使用）
  async function inflateRawWeb(data) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持解压 .xlsx，请把文件另存为 CSV 后再上传");
    }
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    return await new Response(ds.readable).text();
  }

  // 解析 ZIP 中心目录，返回所有条目信息
  function readZipIndex(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    const len = data.length;
    // 找 End of Central Directory（最后 22 字节，signature 0x06054b50）
    let eocd = -1;
    for (let i = len - 22; i >= 0; i--) {
      if (data[i] === 0x50 && data[i + 1] === 0x4B && data[i + 2] === 0x05 && data[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 .xlsx / ZIP 文件");
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const files = {};
    let off = cdOffset;
    const end = cdOffset + cdSize;
    while (off < end) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const compMethod = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const uncompSize = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOffset = dv.getUint32(off + 42, true);
      const name = new TextDecoder().decode(data.slice(off + 46, off + 46 + nameLen));
      files[name] = { compMethod, compSize, uncompSize, localOffset };
      off += 46 + nameLen + extraLen + commentLen;
    }
    return { files, data, dv };
  }

  async function extractZipText(index, fileName, inflateRaw) {
    const e = index.files[fileName];
    if (!e) return null;
    const dv = index.dv, data = index.data;
    const loff = e.localOffset;
    const nameLen = dv.getUint16(loff + 26, true);
    const extraLen = dv.getUint16(loff + 28, true);
    const start = loff + 30 + nameLen + extraLen;
    const payload = data.slice(start, start + e.compSize);
    if (e.compMethod === 0) return new TextDecoder().decode(payload);
    if (e.compMethod === 8) {
      const fn = inflateRaw || inflateRawWeb;
      return await fn(payload);
    }
    throw new Error("不支持的 xlsx 压缩方式：" + e.compMethod);
  }

  function parseSharedStrings(xml) {
    const arr = [];
    const re = /<si[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      let text = "";
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRe.exec(m[1])) !== null) text += tm[1];
      arr.push(text);
    }
    return arr;
  }

  function colIndex(col) {
    let n = 0;
    for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n - 1;
  }

  function parseSheet(xml, shared) {
    const cellRe = /<c[^>]*r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
    const rowMap = {};
    let m;
    while ((m = cellRe.exec(xml)) !== null) {
      const col = m[1], r = parseInt(m[2], 10);
      const cAttrs = m[3];
      const inner = m[4];
      let val = "";
      const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (vMatch) {
        val = vMatch[1];
        if (cAttrs.indexOf('t="s"') >= 0 && shared) val = shared[parseInt(val, 10)] || "";
      } else {
        const isMatch = inner.match(/<is><t>([\s\S]*?)<\/t><\/is>/);
        if (isMatch) val = isMatch[1];
      }
      if (!rowMap[r]) rowMap[r] = [];
      rowMap[r].push({ idx: colIndex(col), val });
    }
    const rows = [];
    Object.keys(rowMap).map(n => parseInt(n, 10)).sort((a, b) => a - b).forEach(r => {
      const cells = rowMap[r].sort((a, b) => a.idx - b.idx);
      const maxIdx = cells.length ? cells[cells.length - 1].idx : 0;
      const arr = new Array(maxIdx + 1).fill("");
      cells.forEach(c => arr[c.idx] = c.val);
      rows.push(arr);
    });
    return rows;
  }

  function rowsToTsv(rows) {
    return rows.map(r => r.map(csvCell).join("\t")).join("\n");
  }

  // 把 .xlsx ArrayBuffer 转成制表符文本（第一行为表头），供 rowsToPlayers 继续解析
  async function parseXlsx(arrayBuffer, inflateRaw) {
    const idx = readZipIndex(arrayBuffer);
    const sst = await extractZipText(idx, "xl/sharedStrings.xml", inflateRaw);
    const shared = sst ? parseSharedStrings(sst) : [];
    let sheet = await extractZipText(idx, "xl/worksheets/sheet1.xml", inflateRaw);
    if (sheet === null) {
      // 兼容非标准 sheet 名：取第一个 worksheets 下的 sheet
      const first = Object.keys(idx.files).find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
      if (first) sheet = await extractZipText(idx, first, inflateRaw);
    }
    if (sheet === null) throw new Error("在 .xlsx 中找不到工作表");
    const rows = parseSheet(sheet, shared);
    return rowsToTsv(rows);
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

  // 性别归一化：M/F/男/女/1/0/男生/女生/男士/女士 等 → 男 / 女
  function normalizeGender(v) {
    if (!v) return "";
    const s = String(v).trim().toLowerCase();
    if (/^(m|male|1|男)/.test(s) || s.indexOf("男生") >= 0 || s.indexOf("男士") >= 0) return "男";
    if (/^(f|female|0|女)/.test(s) || s.indexOf("女生") >= 0 || s.indexOf("女士") >= 0) return "女";
    if (s.indexOf("男") >= 0) return "男";
    if (s.indexOf("女") >= 0) return "女";
    return "";
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
      else if (key === "gender") o.gender = normalizeGender(v);
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
      const key = o.name + "|" + disciplines.join(",");
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
        partner: "",
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
    const headers = ["姓名", "性别", "项目", "单位", "水平", "电话", "签到"];
    const rows = Store.allPlayers().map(p => [
      p.name, p.gender || "", (p.disciplines || []).join("/"),
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

  function exportTeamRankCSV(disc) {
    const rows = Stats.teamStandings(disc);
    const isDisc = disc.teamFormat && disc.teamFormat !== "overall";
    const headers = isDisc
      ? ["名次", "队", "团队胜-负", "分项胜-负", "总得分(进-失)", "积分"]
      : ["名次", "组", "胜-平-负", "总比分(进-失)", "积分"];
    const data = rows.map((r, i) => {
      if (isDisc) {
        return [i + 1, r.name, r.twins + "-" + r.tlosses, r.dwins + "-" + r.dlosses, r.gf + "-" + r.ga, r.pts];
      }
      return [i + 1, r.name, r.win + "-" + r.draw + "-" + r.loss, r.gf + "-" + r.ga,
        (r.pts % 1 === 0 ? r.pts : r.pts.toFixed(1))];
    });
    const csv = [headers.join(",")].concat(data.map(r => r.map(csvCell).join(","))).join("\n");
    download((disc.name || "团体赛") + "_分组名次_" + dateStamp() + ".csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
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
    DISC_BY_CODE, CODE_BY_NAME, HEADER_MAP, normalizeGender,
    isXlsxBuffer, parseXlsx,
    sniffDelimiter, parseCSVLine, parseTable, resolveCodes, rowsToPlayers,
    download, exportJSON, exportPlayersCSV, exportRankCSV, exportTeamRankCSV, csvCell, dateStamp
  };
})();
