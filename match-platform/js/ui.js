/* ui.js — 渲染层：8 个 Tab + 弹窗 + 对阵图 + 比分录入
 * 纯 DOM 字符串渲染 + 事件委托（app.js 统一分发 data-act）。
 */
window.UI = (function () {
  const DISC_CODES = ["MS", "WS", "MD", "WD", "XD", "TEAM"];
  const DISC_NAMES = CSVUtil.DISC_BY_CODE;
  let editingPlayerId = null; // 编辑选手时回填用（当前仅添加，预留）

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 1800);
  }
  function openModal(html) {
    const mask = document.getElementById("modal");
    document.getElementById("modalCard").innerHTML = html;
    mask.hidden = false;
  }
  function closeModal() { document.getElementById("modal").hidden = true; }

  /* ---------- context helpers ---------- */
  function activeEvent() { return Store.curEvent(); }
  function activeDisc() {
    const ev = activeEvent(); if (!ev) return null;
    const discs = ev.disciplines || [];
    const ui = Store.getUI();
    let d = discs.find(x => x.id === ui.activeDisciplineId);
    if (!d && discs.length) d = discs[0];
    return d || null;
  }

  function newDiscipline(code) {
    if (code === "TEAM") {
      const names = Seeding.GROUP_LETTERS.slice(0, 2).split("");
      const fmt = Seeding.TEAM_FORMATS.overall;
      return {
        id: Store.uid("D"), code: "TEAM", name: "团体赛", kind: "team",
        teamFormat: "overall", teamGender: "男", teamSlots: [],
        scoringMode: "31x1", thirdPlace: false, seedCount: 0,
        groupCount: 2,
        groups: names.map(n => ({ name: n, playerIds: [], lineup: {} })),
        entrants: [], matches: [], totalRounds: 0, bracketSize: 0, byeCount: 0, status: "empty"
      };
    }
    return {
      id: Store.uid("D"), code: code, name: DISC_NAMES[code],
      scoringMode: "31x1", thirdPlace: true, seedCount: 0,
      entrants: [], matches: [], totalRounds: 0, bracketSize: 0, byeCount: 0, status: "empty"
    };
  }

  function entrantLabel(disc, id) {
    if (!id) return null;
    const e = Store.getEntrant(disc, id);
    return e ? e.label : "?";
  }

  /* ============================================================
   *  TAB: 赛事
   * ========================================================== */
  function renderEvents() {
    const events = Store.allEvents();
    let h = '<div class="card"><div class="spread"><h2>赛事管理</h2>'
      + '<button class="btn primary sm" data-act="new-event">+ 新建赛事</button></div>';
    if (!events.length) {
      h += '<div class="empty">还没有赛事，点右上角「新建赛事」开始。</div>';
    } else {
      events.forEach(ev => {
        const isActive = Store.getUI().activeEventId === ev.id;
        const discTxt = (ev.disciplines || []).map(d => esc(d.name)).join("、") || "无项目";
        h += '<div class="list-item">'
          + '<div class="avatar">' + esc((ev.name || "赛")[0]) + '</div>'
          + '<div class="item-main"><div class="nm">' + esc(ev.name) + (isActive ? ' <span class="badge done">当前</span>' : '') + '</div>'
          + '<div class="sub">' + esc(ev.date || "日期未设") + ' · ' + esc(ev.venue || "地点未设") + ' · ' + discTxt + '</div></div>'
          + '<button class="btn sm" data-act="open-event" data-id="' + ev.id + '">打开</button>'
          + '<button class="btn sm" data-act="edit-event" data-id="' + ev.id + '">编辑</button>'
          + '<button class="btn sm danger" data-act="del-event" data-id="' + ev.id + '">删除</button>'
          + '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  function eventForm(ev) {
    const isEdit = !!ev;
    const e = ev || { name: "", date: "", venue: "星羿羽毛球馆", note: "", disciplines: [] };
    const checked = {};
    (e.disciplines || []).forEach(d => { checked[d.code] = true; });
    let chips = DISC_CODES.map(c =>
      '<label class="chip ' + (checked[c] ? "on" : "") + '"><input type="checkbox" name="disc" value="' + c + '" ' + (checked[c] ? "checked" : "") + '> ' + DISC_NAMES[c] + '</label>'
    ).join("");
    return '<div class="modal-card">'
      + '<h3>' + (isEdit ? "编辑赛事" : "新建赛事") + '</h3>'
      + '<div class="field"><label>赛事名称</label><input id="f_name" value="' + esc(e.name) + '" placeholder="如：2026 星羿杯"></div>'
      + '<div class="row">'
      + '<div class="field" style="flex:1"><label>日期</label><input id="f_date" value="' + esc(e.date) + '" placeholder="2026-08-10"></div>'
      + '<div class="field" style="flex:1"><label>地点</label><input id="f_venue" value="' + esc(e.venue) + '"></div></div>'
      + '<div class="field"><label>比赛项目（可多选）</label><div class="check-grid">' + chips + '</div></div>'
      + '<div class="field"><label>备注</label><input id="f_note" value="' + esc(e.note) + '"></div>'
      + '<div class="row" style="margin-top:8px">'
      + '<button class="btn primary block" data-act="' + (isEdit ? "save-event" : "create-event") + '" ' + (isEdit ? 'data-id="' + e.id + '"' : '') + '>保存</button>'
      + '<button class="btn block" data-act="close-modal">取消</button></div>'
      + '</div>';
  }

  /* ============================================================
   *  TAB: 名单
   * ========================================================== */
  function renderRoster() {
    const players = Store.allPlayers();
    let h = '<div class="card"><div class="spread"><h2>选手名单</h2>'
      + '<div class="row">'
      + '<button class="btn sm" data-act="import-players">从表格导入</button>'
      + '<button class="btn sm" data-act="new-player">+ 添加</button>'
      + '<button class="btn sm" data-act="export-players">导出</button>'
      + '</div></div>';
    if (!players.length) {
      h += '<div class="empty">还没有选手。可手动添加，或粘贴 Excel / 微信导出的表格批量导入。</div>';
    } else {
      h += '<div class="tbl-wrap"><table><thead><tr><th>姓名</th><th>性别</th><th>搭档</th><th>项目</th><th>单位</th><th></th></tr></thead><tbody>';
      players.forEach(p => {
        const discs = (p.disciplines || []).map(c => DISC_NAMES[c] || c).join("/");
        h += '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.gender || "—") + '</td><td>' + esc(partnerName(p) || "—") + '</td><td>' + esc(discs || "—") + '</td><td>' + esc(p.club || "—") + '</td>'
          + '<td><button class="btn sm danger" data-act="del-player" data-id="' + p.id + '">删</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  function partnerOptionsHtml() {
    const sel = document.getElementById("p_partner");
    const cur = sel ? sel.value : "";
    const discs = Array.prototype.slice.call(document.querySelectorAll('#modalCard input[name="pdisc"]:checked')).map(c => c.value);
    const myGender = (document.getElementById("p_gender") || {}).value || "";
    const others = Store.allPlayers().filter(p => p.id !== (editingPlayerId || ""));
    let allow = null; // 允许的搭档性别：'男' / '女' / null=不限
    if (discs.indexOf("XD") >= 0) allow = myGender === "男" ? "女" : (myGender === "女" ? "男" : null);
    else if (discs.length && discs.every(d => d === "MD")) allow = "男";
    else if (discs.length && discs.every(d => d === "WD")) allow = "女";
    else if (discs.indexOf("MD") >= 0 || discs.indexOf("WD") >= 0) allow = myGender || null;
    const list = allow ? others.filter(p => p.gender === allow) : others;
    let opts = '<option value="">— 未选 —</option>';
    list.forEach(p => {
      opts += '<option value="' + p.id + '"' + (p.id === cur ? " selected" : "") + '>' + esc(p.name) + '（' + (p.gender || "?") + '）</option>';
    });
    return opts;
  }

  function partnerName(p) {
    if (!p.partner) return "";
    const pp = Store.getPlayer(p.partner);
    return pp ? pp.name : p.partner;
  }

  function playerForm() {
    let chips = DISC_CODES.map(c =>
      '<label class="chip"><input type="checkbox" name="pdisc" value="' + c + '"> ' + DISC_NAMES[c] + '</label>'
    ).join("");
    return '<h3>添加选手</h3>'
      + '<div class="field"><label>姓名</label><input id="p_name" placeholder="必填"></div>'
      + '<div class="row">'
      + '<div class="field" style="flex:1"><label>搭档（双打·从名单选取）</label><select id="p_partner">' + partnerOptionsHtml() + '</select></div>'
      + '<div class="field" style="flex:1"><label>性别（必填）</label><input id="p_gender" placeholder="男 / 女（M/F/1/0 均可）"></div></div>'
      + '<div class="row">'
      + '<div class="field" style="flex:1"><label>单位/俱乐部</label><input id="p_club"></div>'
      + '<div class="field" style="flex:1"><label>电话</label><input id="p_phone"></div></div>'
      + '<div class="row">'
      + '<div class="field" style="flex:1"><label>水平分档（用于种子排序）</label><input id="p_level" type="number" placeholder="数字越大越强"></div>'
      + '<div class="field" style="flex:1"><label>种子号</label><input id="p_seed" type="number" placeholder="0=非种子"></div></div>'
      + '<div class="field"><label>报名项目</label><div class="check-grid">' + chips + '</div></div>'
      + '<div class="row" style="margin-top:8px">'
      + '<button class="btn primary block" data-act="save-player">保存</button>'
      + '<button class="btn block" data-act="close-modal">取消</button></div>';
  }

  function importForm() {
    return '<h3>从表格导入</h3>'
      + '<p class="muted" style="margin:0 0 8px">支持两种方式：① 点下方「选择文件」直接上传 .csv / .txt / 制表符表格；② 从 Excel / 微信复制后粘贴到文本框。'
      + '只需 <b>姓名 + 性别</b> 两列即可（项目 / 单位等可选，不填也能用）。性别支持 男/女/M/F/男生/女生/1/0 等写法会自动归一化。逗号 / 制表符 / 中文逗号均可。同名且同项目自动去重。搭档请在添加选手后于「选手名单」中从名单下拉选取。</p>'
      + '<div class="field"><label>从文件导入</label><input type="file" id="imp_csv" accept=".csv,.txt,.tsv,text/csv,text/plain"></div>'
      + '<textarea id="imp_text" placeholder="姓名,项目,单位\n张三,男单/男双,星羿\n李四,女单,星羿"></textarea>'
      + '<div id="imp_preview" class="muted" style="margin:8px 0"></div>'
      + '<div class="row">'
      + '<button class="btn primary block" data-act="confirm-import">解析并导入</button>'
      + '<button class="btn block" data-act="close-modal">取消</button></div>';
  }

  /* ============================================================
   *  TAB: 签到
   * ========================================================== */
  function renderCheckin() {
    const players = Store.allPlayers();
    const sum = Checkin.summary();
    let h = '<div class="card"><div class="stat-grid">'
      + '<div class="stat-box"><div class="stat-num">' + sum.total + '</div><div class="muted">总人数</div></div>'
      + '<div class="stat-box"><div class="stat-num" style="color:var(--ok)">' + sum.present + '</div><div class="muted">已签到</div></div>'
      + '<div class="stat-box"><div class="stat-num" style="color:var(--bad)">' + sum.absent + '</div><div class="muted">未到</div></div>'
      + '</div>';
    const dc = DISC_CODES.filter(c => sum.byDisc[c]).map(c => DISC_NAMES[c] + " " + sum.byDisc[c]).join(" · ");
    if (dc) h += '<div class="muted" style="margin-top:8px">各项目到场：' + dc + '</div>';
    h += '<div class="row" style="margin-top:10px">'
      + '<button class="btn sm primary" data-act="checkin-all" data-id="1">全部签到</button>'
      + '<button class="btn sm" data-act="checkin-all" data-id="0">全部取消</button>'
      + '</div></div>';

    h += '<div class="card"><h2>签到名单</h2>';
    if (!players.length) h += '<div class="empty">名单为空，请先到「名单」添加选手。</div>';
    else {
      players.forEach(p => {
        const discs = (p.disciplines || []).map(c => DISC_NAMES[c] || c).join("/");
        h += '<div class="list-item">'
          + '<div class="avatar">' + esc((p.name || "?")[0]) + '</div>'
          + '<div class="item-main"><div class="nm">' + esc(p.name) + (p.present ? ' <span class="badge done">已到</span>' : '') + '</div>'
          + '<div class="sub">' + esc(discs || "无项目") + (p.club ? ' · ' + esc(p.club) : '') + '</div></div>'
          + '<label class="switch"><input type="checkbox" ' + (p.present ? "checked" : "") + ' data-act="toggle-present" data-id="' + p.id + '"><span class="slider"></span></label>'
          + '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  /* ============================================================
   *  通用：项目选择器
   * ========================================================== */
  function disciplineSelector() {
    const ev = activeEvent(); if (!ev) return "";
    const discs = ev.disciplines || [];
    const cur = activeDisc();
    if (!discs.length) return '<div class="empty">该赛事未设置比赛项目。</div>';
    let h = '<div class="disc-select">';
    discs.forEach(d => {
      h += '<button class="disc-pill ' + (cur && cur.id === d.id ? "active" : "") + '" data-act="set-disc" data-id="' + d.id + '">' + esc(d.name) + '</button>';
    });
    h += '</div>';
    return h;
  }

  /* ============================================================
   *  TAB: 分组 / 生成对阵
   * ========================================================== */
  function renderGroup() {
    const ev = activeEvent();
    if (!ev) return '<div class="card"><div class="empty">请先在「赛事」中创建并打开一个赛事。</div></div>';
    const sel = disciplineSelector();
    const d = activeDisc();
    if (!d) return '<div class="card">' + sel + '<div class="empty">请选择比赛项目。</div></div>';
    if (d.kind === "team") return renderTeamGroup(d, sel);

    const entrants = Seeding.buildEntrants(d);
    let h = '<div class="card">' + sel;
    h += '<div class="spread"><h2>' + esc(d.name) + ' · 分组与对阵</h2></div>';

    // 配置
    const rules = Scoring.RULES;
    let ruleOpts = Object.keys(rules).map(k => '<option value="' + k + '" ' + (d.scoringMode === k ? "selected" : "") + '>' + rules[k].name + '</option>').join("");
    h += '<div class="row" style="margin:8px 0">'
      + '<div class="field" style="flex:1"><label>赛制（计分）</label><select id="g_scoring">' + ruleOpts + '</select></div>'
      + '<div class="field" style="flex:1"><label>种子数量</label><input id="g_seed" type="number" min="0" value="' + (d.seedCount || 0) + '"></div>'
      + '<div class="field" style="flex:0 0 auto"><label>&nbsp;</label><label class="chip ' + (d.thirdPlace ? "on" : "") + '"><input type="checkbox" id="g_third" ' + (d.thirdPlace ? "checked" : "") + '> 打三四名</label></div>'
      + '</div>';

    // 到场人数
    h += '<div class="muted">当前到场可参赛人数：<b>' + entrants.length + '</b> 人'
      + (d.code === "MS" || d.code === "WS" ? '（单打，每人 1 席）' : '（双打，需已填搭档）') + '</div>';
    if (d.code !== "MS" && d.code !== "WS") {
      const miss = Seeding.missingPartner(d);
      if (miss.length) h += '<div class="badge bye">有 ' + miss.length + ' 名到场选手未从名单选取搭档，将无法成组</div>';
    }
    if (!entrants.length) {
      h += '<div class="empty">到场人数不足。请先到「签到」让选手签到。</div>';
    }

    // 已生成状态
    if (d.status === "drawn" && d.matches.length) {
      h += '<div class="row" style="margin-top:10px">'
        + '<span class="badge done">已生成对阵</span>'
        + '<span class="muted">签表 ' + d.bracketSize + ' · 轮空 ' + d.byeCount + ' · 共 ' + d.matches.length + ' 场</span>'
        + '<button class="btn sm primary" data-act="draw">重新生成</button></div>';
    } else {
      h += '<div class="row" style="margin-top:10px">'
        + '<button class="btn primary" data-act="draw"' + (entrants.length < 2 ? " disabled" : "") + '>生成对阵</button></div>';
    }

    // 名单预览
    if (entrants.length) {
      h += '<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>#</th><th>参赛单元</th><th>种子</th></tr></thead><tbody>';
      entrants.forEach((e, i) => {
        h += '<tr><td>' + (i + 1) + '</td><td>' + esc(e.label) + '</td><td>' + (e.seed > 0 ? "S" + e.seed : "—") + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  /* ---------- 团体赛 helpers ---------- */
  function slotGender(code) {
    if (code === "MS" || code === "MD") return "男";
    if (code === "WS" || code === "WD") return "女";
    return null;
  }
  function isDoublesCode(code) { return code === "MD" || code === "WD" || code === "XD"; }

  // 取某队（组）中可打该 slot 的选手（按性别过滤）
  function teamPlayersForSlot(disc, group, slot) {
    const code = Seeding.slotCodeOf(disc, slot);
    const g = slotGender(code);
    return (group.playerIds || []).map(id => Store.getPlayer(id)).filter(p => p && (!g || p.gender === g));
  }

  function teamFormatOptionsHtml(disc) {
    const fmts = Seeding.TEAM_FORMATS;
    let opts = "";
    Object.keys(fmts).forEach(k => {
      opts += '<option value="' + k + '" ' + (disc.teamFormat === k ? "selected" : "") + '>' + fmts[k].label + '</option>';
    });
    return opts;
  }

  // amateur 模式的 slot 编辑（项目下拉 + 上移/下移/删除 + 新增）
  function slotConfigHtml(disc) {
    const slots = disc.teamSlots || [];
    let h = '<div class="field"><label>出场顺序 / 项目（业余五场混合可自定义）</label><div class="slot-cfg">';
    slots.forEach((s, i) => {
      const code = s.code || Seeding.slotCodeOf(disc, s);
      const codeOpts = ["MS", "WS", "MD", "WD", "XD"].map(c =>
        '<option value="' + c + '" ' + (c === code ? "selected" : "") + '>' + (CSVUtil.DISC_BY_CODE[c] || c) + '</option>').join("");
      h += '<div class="slot-cfg-row">'
        + '<span class="idx">' + (i + 1) + '.</span>'
        + '<select class="tslot-code" data-i="' + i + '">' + codeOpts + '</select>'
        + '<button class="btn sm" data-act="team-slot-up" data-i="' + i + '"' + (i === 0 ? " disabled" : "") + '>↑</button>'
        + '<button class="btn sm" data-act="team-slot-down" data-i="' + i + '"' + (i === slots.length - 1 ? " disabled" : "") + '>↓</button>'
        + '<button class="btn sm danger" data-act="team-slot-del" data-i="' + i + '"' + (slots.length <= 2 ? " disabled" : "") + '>删</button>'
        + '</div>';
    });
    h += '<button class="btn sm" data-act="team-slot-add"' + (slots.length >= 7 ? " disabled" : "") + '>＋ 增加一项</button>';
    h += '</div></div>';
    return h;
  }

  // discipline 模式：各队排阵 UI
  function lineupEditorHtml(disc) {
    const slots = Seeding.currentSlots(disc);
    const groups = (disc.groups || []).filter(g => (g.playerIds || []).length > 0);
    if (!groups.length) return '<div class="empty">请先给各组分配至少 1 名选手。</div>';
    let h = '<div class="field"><label>各队排阵（每队按下列分项填入出场选手）</label>';
    groups.forEach((g, gi) => {
      const gname = esc(g.name);
      h += '<div class="lineup-card" style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0">';
      h += '<div class="tg-head" style="margin-bottom:6px"><b>' + gname + ' 组</b> <span class="muted">（' + (g.playerIds || []).length + ' 人）</span></div>';
      slots.forEach(s => {
        const code = Seeding.slotCodeOf(disc, s);
        const pool = teamPlayersForSlot(disc, g, s);
        const selName = "tl_" + gi + "_" + s.key;
        const assigned = (g.lineup && g.lineup[s.key]) || [];
        if (isDoublesCode(code)) {
          const p1 = pool.map(p => '<option value="' + p.id + '" ' + (assigned[0] === p.id ? "selected" : "") + '>' + esc(p.name) + '</option>').join("");
          const p2 = pool.map(p => '<option value="' + p.id + '" ' + (assigned[1] === p.id ? "selected" : "") + '>' + esc(p.name) + '</option>').join("");
          h += '<div class="lineup-row"><span class="ln">' + esc(s.name) + '</span>'
            + '<select class="tlineup" data-gi="' + gi + '" data-slot="' + s.key + '" data-pos="0"><option value="">—</option>' + p1 + '</select>'
            + '<span class="vs-sep">/</span>'
            + '<select class="tlineup" data-gi="' + gi + '" data-slot="' + s.key + '" data-pos="1"><option value="">—</option>' + p2 + '</select></div>';
        } else {
          const p1 = pool.map(p => '<option value="' + p.id + '" ' + (assigned[0] === p.id ? "selected" : "") + '>' + esc(p.name) + '</option>').join("");
          h += '<div class="lineup-row"><span class="ln">' + esc(s.name) + '</span>'
            + '<select class="tlineup" data-gi="' + gi + '" data-slot="' + s.key + '" data-pos="0"><option value="">—</option>' + p1 + '</select></div>';
        }
      });
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  /* ---------- 团体赛：手选分组 + 组间循环对阵 ---------- */
  function renderTeamGroup(d, sel) {
    const rules = Scoring.RULES;
    let ruleOpts = Object.keys(rules).map(k => '<option value="' + k + '" ' + (d.scoringMode === k ? "selected" : "") + '>' + rules[k].name + '</option>').join("");
    let h = '<div class="card">' + sel;
    h += '<div class="spread"><h2>' + esc(d.name) + ' · 分组与对阵</h2></div>';

    // 团体赛赛制选择
    h += '<div class="field" style="margin:8px 0"><label>团体赛赛制</label><select id="team_format">' + teamFormatOptionsHtml(d) + '</select></div>';

    const isDisc = d.teamFormat && d.teamFormat !== "overall";
    if (d.teamFormat === "thomas") {
      h += '<div class="field"><label>队伍性别</label><div class="row" style="align-items:center">'
        + '<button class="btn sm" data-act="team-gender" data-g="男"' + (d.teamGender === "男" ? ' style="font-weight:800"' : "") + '>男子团体</button>'
        + '<button class="btn sm" data-act="team-gender" data-g="女"' + (d.teamGender === "女" ? ' style="font-weight:800"' : "") + '>女子团体</button>'
        + '</div></div>';
    }
    if (isDisc && Seeding.TEAM_FORMATS[d.teamFormat] && Seeding.TEAM_FORMATS[d.teamFormat].slotsEditable) {
      h += slotConfigHtml(d);
    }

    // 赛制（计分）
    h += '<div class="field" style="margin:8px 0"><label>赛制（计分）</label><select id="g_scoring">' + ruleOpts + '</select></div>';

    // 分组数量
    h += '<div class="field"><label>分组数量（最多 8 组，每组=一支队伍）</label>'
      + '<div class="row" style="align-items:center">'
      + '<button class="btn sm" data-act="team-gc" data-d="-1">－</button>'
      + '<div style="min-width:72px;text-align:center;font-size:18px;font-weight:800">' + d.groupCount + ' 组</div>'
      + '<button class="btn sm" data-act="team-gc" data-d="1">＋</button>'
      + '<span class="muted" style="margin-left:8px">组名：' + (d.groups || []).map(g => esc(g.name)).join("、") + '</span>'
      + '</div></div>';

    // 手选名单（分组）
    const players = Store.allPlayers();
    if (!players.length) {
      h += '<div class="empty">名单为空，请先到「名单」添加选手。</div>';
    } else {
      h += '<p class="muted" style="margin:6px 0">将下方选手分到各组（每组=一支队伍），未分组的不会参赛。</p>';
      h += '<div class="tbl-wrap"><table><thead><tr><th>选手</th><th>单位</th><th>分组</th></tr></thead><tbody>';
      players.forEach(p => {
        const opts = '<option value="">未分组</option>' + (d.groups || []).map(g =>
          '<option value="' + esc(g.name) + '" ' + ((g.playerIds || []).indexOf(p.id) >= 0 ? "selected" : "") + '>' + esc(g.name) + ' 组</option>'
        ).join("");
        h += '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.club || "—") + '</td>'
          + '<td><select class="gassign" data-pid="' + p.id + '">' + opts + '</select></td></tr>';
      });
      h += '</tbody></table></div>';
    }

    // 排阵（discipline 模式）
    if (isDisc) h += lineupEditorHtml(d);

    // 生成 / 重生成
    if (d.status === "drawn" && d.matches.length) {
      h += '<div class="row" style="margin-top:10px">'
        + '<span class="badge done">已生成组间循环对阵</span>'
        + '<span class="muted">共 ' + (d.groups || []).filter(g => (g.playerIds || []).length > 0).length + ' 队 · ' + d.matches.length + ' 场' + (isDisc ? '（每场 ' + (Seeding.currentSlots(d).length) + ' 分项）' : ' 组间循环') + '</span>'
        + '<button class="btn sm primary" data-act="draw-team">重新生成</button></div>';
      h += renderTeamFixtures(d);
    } else {
      h += '<div class="row" style="margin-top:10px">'
        + '<button class="btn primary" data-act="draw-team">生成分组对阵</button></div>';
    }
    h += '</div>';
    return h;
  }

  // 组间循环赛对阵展示（分组页、赛程页共用）
  function renderTeamFixtures(d) {
    let h = "";
    const matches = d.matches || [];
    if (!matches.length) return h;
    const isDisc = d.teamFormat && d.teamFormat !== "overall";
    const rounds = {};
    matches.forEach(m => { (rounds[m.round] = rounds[m.round] || []).push(m); });
    const rkeys = Object.keys(rounds).map(Number).sort((a, b) => a - b);
    rkeys.forEach(r => {
      const ms = rounds[r].slice().sort((a, b) => a.slotIndex - b.slotIndex);
      h += '<div class="team-group" style="margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:10px 12px">';
      h += '<div class="tg-head" style="margin-bottom:6px"><b>第 ' + r + ' 轮</b></div>';
      if (isDisc) {
        ms.forEach(m => { h += teamMatchBlock(d, m); });
      } else {
        h += '<div class="tbl-wrap"><table><thead><tr><th>组间对抗</th><th>总比分</th><th>台</th><th>操作</th></tr></thead><tbody>';
        ms.forEach(m => {
          const aL = entrantLabel(d, m.a.entrantId), bL = entrantLabel(d, m.b.entrantId);
          const score = m.result ? (m.result.aTeam + " : " + m.result.bTeam) : "";
          const op = m.status === "done"
            ? '<button class="btn sm" data-act="score" data-id="' + m.id + '">修改</button>'
            : '<button class="btn sm primary" data-act="score" data-id="' + m.id + '">录入</button>';
          h += '<tr><td>' + esc(aL || "待定") + ' <b>VS</b> ' + esc(bL || "待定") + '</td>'
            + '<td>' + (score ? '<span class="muted">' + score + '</span>' : "—") + '</td>'
            + '<td><input id="court_' + m.id + '" value="' + esc(m.court || "") + '" style="width:46px;padding:4px 5px" placeholder="台"></td>'
            + '<td>' + op + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }
      h += '</div>';
    });
    return h;
  }

  // discipline 模式：一场团体对抗 = 多个分项小场
  function teamMatchBlock(d, m) {
    const aL = entrantLabel(d, m.a.entrantId), bL = entrantLabel(d, m.b.entrantId);
    let h = '<div class="team-match" style="border:1px dashed var(--line);border-radius:10px;padding:8px 10px;margin:8px 0">';
    const tscore = m.result ? ('<b>' + (m.result.aWins || 0) + ' : ' + (m.result.bWins || 0) + '</b>') : '<span class="muted">—</span>';
    h += '<div class="tm-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
      + '<span><b>' + esc(aL || "待定") + '</b> VS <b>' + esc(bL || "待定") + '</b></span>'
      + '<span>分项比分 ' + tscore + (m.status === "done" ? ' <span class="badge done">已定</span>' : '') + '</span></div>';
    (m.subs || []).forEach((s, i) => {
      const aIds = s.a.playerIds || [], bIds = s.b.playerIds || [];
      const aNames = aIds.map(id => { const p = Store.getPlayer(id); return p ? p.name : "?"; }).join("/") || "—";
      const bNames = bIds.map(id => { const p = Store.getPlayer(id); return p ? p.name : "?"; }).join("/") || "—";
      let sc = "—";
      if (s.result) sc = s.result.games.map(g => g[0] + ":" + g[1]).join("，");
      else if (!aIds.length || !bIds.length) sc = "（未排阵）";
      const btn = (s.result || (!aIds.length || !bIds.length))
        ? '<button class="btn sm" data-act="score-sub" data-id="' + m.id + '" data-sub="' + i + '">'
          + (s.result ? (aIds.length && bIds.length ? "改" : "判") : (aIds.length && bIds.length ? "录" : "判")) + '</button>'
        : '<button class="btn sm primary" data-act="score-sub" data-id="' + m.id + '" data-sub="' + i + '">录</button>';
      h += '<div class="lineup-row" style="padding:3px 0">'
        + '<span class="ln">' + esc(s.name) + '</span>'
        + '<span class="vs">' + esc(aNames) + ' <small>VS</small> ' + esc(bNames) + '</span>'
        + '<span class="muted">' + sc + '</span>'
        + btn + '</div>';
    });
    h += '<div class="row" style="margin-top:4px"><span class="muted">台号</span><input id="court_' + m.id + '" value="' + esc(m.court || "") + '" style="width:54px;padding:4px 6px" placeholder="台"></div>';
    h += '</div>';
    return h;
  }

  /* ============================================================
   *  TAB: 赛程
   * ========================================================== */
  function renderSchedule() {
    const ev = activeEvent();
    if (!ev) return '<div class="card"><div class="empty">请先创建并打开赛事。</div></div>';
    const sel = disciplineSelector();
    const d = activeDisc();
    if (!d) return '<div class="card">' + sel + '<div class="empty">请选择比赛项目。</div></div>';
    if (d.kind === "team") return '<div class="card">' + sel + '<h2>赛程 · ' + esc(d.name) + '</h2>' + renderTeamFixtures(d) + '</div>';
    if (d.status !== "drawn") return '<div class="card">' + sel + '<div class="empty">尚未生成对阵，请先到「分组」生成。</div></div>';

    const rounds = {};
    d.matches.forEach(m => { (rounds[m.round] = rounds[m.round] || []).push(m); });
    const rkeys = Object.keys(rounds).map(Number).sort((a, b) => a - b);

    let h = '<div class="card">' + sel + '<h2>赛程 · ' + esc(d.name) + '</h2>';
    rkeys.forEach(r => {
      const ms = rounds[r].slice().sort((a, b) => a.slotIndex - b.slotIndex);
      h += '<h3>' + esc(ms[0].roundLabel || ("第" + r + "轮")) + '</h3>';
      h += '<div class="tbl-wrap"><table><thead><tr><th>场序</th><th>对阵</th><th>状态</th><th>台号</th><th>操作</th></tr></thead><tbody>';
      ms.forEach((m, i) => {
        const aL = entrantLabel(d, m.a.entrantId), bL = entrantLabel(d, m.b.entrantId);
        let vs = (!aL ? "待定" : esc(aL)) + " vs " + (!bL ? "待定" : esc(bL));
        if (m.a.source && m.a.source.type === "bye") vs = "轮空 → " + esc(bL || "待定");
        else if (m.b.source && m.b.source.type === "bye") vs = esc(aL || "待定") + " → 轮空";
        const score = m.result ? m.result.games.map(g => g[0] + ":" + g[1]).join("，") : "";
        const stCls = m.status === "done" ? "done" : (m.status === "ready" ? "ready" : "pending");
        const stTxt = m.status === "done" ? "已录" : (m.status === "ready" ? "可进行" : "待定");
        const op = m.status === "done"
          ? '<button class="btn sm" data-act="score" data-id="' + m.id + '">修改</button>'
          : '<button class="btn sm primary" data-act="score" data-id="' + m.id + '"' + (m.status !== "ready" ? " disabled" : "") + '>录入</button>';
        h += '<tr><td>' + (i + 1) + '</td><td>' + vs + (score ? ' <span class="muted">(' + score + ')</span>' : '') + '</td>'
          + '<td><span class="badge ' + stCls + '">' + stTxt + '</span></td>'
          + '<td><input id="court_' + m.id + '" value="' + esc(m.court || "") + '" style="width:54px;padding:5px 6px" placeholder="台"></td>'
          + '<td>' + op + '</td></tr>';
      });
      h += '</tbody></table></div>';
    });
    h += '</div>';
    return h;
  }

  /* ============================================================
   *  TAB: 对阵图
   * ========================================================== */
  function renderBracket() {
    const ev = activeEvent();
    if (!ev) return '<div class="card"><div class="empty">请先创建并打开赛事。</div></div>';
    const sel = disciplineSelector();
    const d = activeDisc();
    if (!d) return '<div class="card">' + sel + '<div class="empty">请选择比赛项目。</div></div>';
    if (d.kind === "team") return renderTeamBracket(d, sel);
    if (d.status !== "drawn") return '<div class="card">' + sel + '<div class="empty">尚未生成对阵，请先到「分组」生成。</div></div>';

    const total = d.totalRounds || 1;
    let h = '<div class="card">' + sel + '<h2>对阵图 · ' + esc(d.name) + '</h2>';
    h += '<div class="bracket-scroll"><div class="bracket">';
    for (let r = 1; r <= total; r++) {
      const ms = d.matches.filter(m => m.round === r && m.stage === "ko")
        .slice().sort((a, b) => a.slotIndex - b.slotIndex);
      if (r === total) {
        const third = d.matches.find(m => m.stage === "third");
        if (third) ms.push(third);
      }
      h += '<div class="round"><div class="round-label">' + esc(ms[0] && ms[0].stage === "third" ? "三四名" : (ms[0] ? ms[0].roundLabel : "R" + r)) + '</div>';
      ms.forEach(m => { h += matchCard(d, m); });
      h += '</div>';
    }
    h += '</div></div></div>';
    return h;
  }

  function renderTeamBracket(d, sel) {
    const rows = Stats.teamStandings(d);
    const isDisc = d.teamFormat && d.teamFormat !== "overall";
    let h = '<div class="card">' + sel + '<h2>积分榜 · ' + esc(d.name) + '</h2>';
    if (!rows.length) {
      h += '<div class="empty">尚未生成对阵或组间无有效比赛。</div>';
    } else {
      h += '<div class="tbl-wrap"><table><thead><tr><th>名次</th><th>' + (isDisc ? "队" : "组") + '</th>'
        + (isDisc ? '<th>团队胜-负</th><th>分项胜-负</th>' : '<th>胜-平-负</th>')
        + '<th>总比分(进-失)</th><th>积分</th></tr></thead><tbody>';
      rows.forEach((r, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
        h += '<tr><td class="rank-' + (i + 1) + '">' + (i < 3 ? medal + " " : "") + (i + 1) + '</td>'
          + '<td>' + esc(r.name) + '</td>';
        if (isDisc) {
          h += '<td>' + r.twins + '-' + r.tlosses + '</td><td>' + r.dwins + '-' + r.dlosses + '</td>';
        } else {
          h += '<td>' + r.win + '-' + r.draw + '-' + r.loss + '</td>';
        }
        h += '<td>' + r.gf + '-' + r.ga + '</td>'
          + '<td><b>' + (r.pts % 1 === 0 ? r.pts : r.pts.toFixed(1)) + '</b></td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<hr style="border:none;border-top:1px solid var(--line);margin:14px 0">';
      h += '<h3>' + (isDisc ? "团体对阵（分项小场）" : "组间对阵") + '</h3>' + renderTeamFixtures(d);
    }
    h += '</div>';
    return h;
  }

  function matchCard(d, m) {
    const aL = entrantLabel(d, m.a.entrantId), bL = entrantLabel(d, m.b.entrantId);
    const isByeA = m.a.source && m.a.source.type === "bye";
    const isByeB = m.b.source && m.b.source.type === "bye";
    const winSide = m.result ? m.result.winner : null;
    const score = m.result ? m.result.games.map(g => g[0] + ":" + g[1]).join(" ") : "";
    function slot(side, label, isBye) {
      if (!label && !isBye) return '<div class="slot empty"><span class="nm">待定</span></div>';
      let cls = "slot";
      if (m.result) cls += (winSide === side ? " win" : " lose");
      const nm = isBye ? "轮空" : label;
      return '<div class="' + cls + '"><span class="nm">' + esc(nm) + '</span>' + (score && winSide === side ? '<span class="sc">' + esc(score) + '</span>' : (isBye ? '<span class="sc">轮空</span>' : '')) + '</div>';
    }
    const clickable = m.status === "ready" || m.status === "done";
    const attr = clickable ? ' data-act="score" data-id="' + m.id + '" style="cursor:pointer"' : '';
    return '<div class="match ' + (m.status === "done" ? "done" : "tbd") + '"' + attr + '>'
      + slot("a", aL, isByeA)
      + slot("b", bL, isByeB)
      + '</div>';
  }

  /* ============================================================
   *  TAB: 汇总
   * ========================================================== */
  function renderSummary() {
    const ev = activeEvent();
    if (!ev) return '<div class="card"><div class="empty">请先创建并打开赛事。</div></div>';
    const sel = disciplineSelector();
    const d = activeDisc();
    if (!d) return '<div class="card">' + sel + '<div class="empty">请选择比赛项目。</div></div>';
    if (d.kind === "team") return renderTeamSummary(d, sel);
    if (d.status !== "drawn") return '<div class="card">' + sel + '<div class="empty">尚未生成对阵。</div></div>';

    const done = d.matches.filter(m => m.result).length;
    const total = d.matches.length;
    let h = '<div class="card">' + sel + '<h2>汇总 · ' + esc(d.name) + '</h2>';
    h += '<div class="stat-grid">'
      + '<div class="stat-box"><div class="stat-num">' + done + '/' + total + '</div><div class="muted">已录场次</div></div>'
      + '<div class="stat-box"><div class="stat-num">' + (d.entrants ? d.entrants.length : 0) + '</div><div class="muted">参赛单元</div></div>'
      + '<div class="stat-box"><div class="stat-num">' + d.bracketSize + '</div><div class="muted">签表</div></div>'
      + '<div class="stat-box"><div class="stat-num">' + d.byeCount + '</div><div class="muted">轮空</div></div>'
      + '</div>';
    h += '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="export-rank">导出名次 CSV</button></div>';

    const rank = Stats.finalRanking(d);
    if (rank.length) {
      h += '<h3>最终名次</h3><div class="tbl-wrap"><table><thead><tr><th>名次</th><th>参赛单元</th><th>类型</th></tr></thead><tbody>';
      rank.forEach(r => {
        const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank;
        h += '<tr><td class="rank-' + r.rank + '">' + (typeof medal === "string" && r.rank <= 3 ? medal + " " : "") + r.rank + '</td><td>' + esc(r.label) + '</td><td>' + (r.kind === "pair" ? "双打" : "单打") + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else {
      h += '<div class="empty">比赛尚未产生名次，录完决赛后自动生成。</div>';
    }
    h += '</div>';
    return h;
  }

  function renderTeamSummary(d, sel) {
    const rows = Stats.teamStandings(d);
    const isDisc = d.teamFormat && d.teamFormat !== "overall";
    let h = '<div class="card">' + sel + '<h2>汇总 · ' + esc(d.name) + '</h2>';
    const groups = d.groups || [];
    const activeGroups = groups.filter(g => (g.playerIds || []).length > 0);
    const totalPlayers = groups.reduce((s, g) => s + (g.playerIds || []).length, 0);
    const done = (d.matches || []).filter(m => m.result).length;
    h += '<div class="stat-grid">'
      + '<div class="stat-box"><div class="stat-num">' + activeGroups.length + '</div><div class="muted">参赛队数</div></div>'
      + '<div class="stat-box"><div class="stat-num">' + totalPlayers + '</div><div class="muted">参赛人数</div></div>'
      + '<div class="stat-box"><div class="stat-num">' + done + '/' + (d.matches || []).length + '</div><div class="muted">已录场数</div></div>'
      + '</div>';
    h += '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="export-rank">导出' + (isDisc ? "团体" : "分组") + '名次 CSV</button></div>';
    if (rows.length) {
      h += '<h3>' + (isDisc ? "团体名次" : "分组名次") + '</h3><div class="tbl-wrap"><table><thead><tr><th>名次</th><th>' + (isDisc ? "队" : "组") + '</th>'
        + (isDisc ? '<th>团队胜-负</th><th>分项胜-负</th>' : '<th>胜-平-负</th>')
        + '<th>总比分(进-失)</th><th>积分</th></tr></thead><tbody>';
      rows.forEach((r, i) => {
        h += '<tr><td class="rank-' + (i + 1) + '">' + (i < 3 ? (i === 0 ? "🥇 " : i === 1 ? "🥈 " : "🥉 ") : "") + (i + 1) + '</td>'
          + '<td>' + esc(r.name) + '</td>';
        if (isDisc) {
          h += '<td>' + r.twins + '-' + r.tlosses + '</td><td>' + r.dwins + '-' + r.dlosses + '</td>';
        } else {
          h += '<td>' + r.win + '-' + r.draw + '-' + r.loss + '</td>';
        }
        h += '<td>' + r.gf + '-' + r.ga + '</td>'
          + '<td><b>' + (r.pts % 1 === 0 ? r.pts : r.pts.toFixed(1)) + '</b></td></tr>';
      });
      h += '</tbody></table></div>';
    } else {
      h += '<div class="empty">比赛尚未生成或暂无成绩。</div>';
    }
    h += '</div>';
    return h;
  }

  /* ============================================================
   *  TAB: 数据备份
   * ========================================================== */
  function renderBackup() {
    return '<div class="card"><h2>数据备份与恢复</h2>'
      + '<p class="muted">所有数据保存在本机浏览器（localStorage）。换设备请用「导出 JSON」备份，再到新设备「导入 JSON」。</p>'
      + '<div class="row" style="margin-top:6px">'
      + '<button class="btn" data-act="export-json">导出全部数据(JSON)</button>'
      + '<button class="btn" data-act="export-players">导出选手名单(CSV)</button>'
      + '</div>'
      + '<div class="field" style="margin-top:12px"><label>导入 JSON 备份</label>'
      + '<input type="file" id="imp_json" accept="application/json,.json"></div>'
      + '<button class="btn primary" data-act="import-json">选择文件并导入</button>'
      + '<hr style="border:none;border-top:1px solid var(--line);margin:16px 0">'
      + '<button class="btn danger" data-act="reset-all">清空所有数据</button>'
      + '</div>';
  }

  /* ============================================================
   *  比分录入弹窗
   * ========================================================== */
  function scoreModal(disc, m, subIdx) {
    if (disc.kind === "team" || m.stage === "team") {
      if (m.subs && subIdx != null) return subScoreModal(disc, m, subIdx);
      return teamScoreModal(disc, m);
    }
    const aL = entrantLabel(disc, m.a.entrantId) || "待定";
    const bL = entrantLabel(disc, m.b.entrantId) || "待定";
    const rule = Scoring.RULES[disc.scoringMode] || Scoring.RULES["31x1"];
    let games = "";
    for (let i = 0; i < rule.bestOf; i++) {
      const g = m.result && m.result.games[i];
      games += '<div class="game-row"><span class="gl">第' + (i + 1) + '局</span>'
        + '<input id="g_' + i + '_a" inputmode="numeric" value="' + (g ? g[0] : "") + '" placeholder="A">'
        + '<span class="vs-sep">:</span>'
        + '<input id="g_' + i + '_b" inputmode="numeric" value="' + (g ? g[1] : "") + '" placeholder="B"></div>';
    }
    const exi = m.result ? m.result.reason : "normal";
    return '<h3>录入比分</h3>'
      + '<div class="vs">' + esc(aL) + ' <small>VS</small> ' + esc(bL) + '</div>'
      + '<div id="scoreGames">' + games + '</div>'
      + '<div class="wo-row"><label class="muted">特殊情况：</label>'
      + '<select id="wo_type">'
      + '<option value="normal" ' + (exi === "normal" ? "selected" : "") + '>正常比赛</option>'
      + '<option value="wo_a" ' + (m.result && m.result.reason === "walkover" && m.result.winner === "b" ? "selected" : "") + '>A 弃权（B 胜）</option>'
      + '<option value="wo_b" ' + (m.result && m.result.reason === "walkover" && m.result.winner === "a" ? "selected" : "") + '>B 弃权（A 胜）</option>'
      + '<option value="ret_a" ' + (m.result && m.result.reason === "retire" && m.result.winner === "b" ? "selected" : "") + '>A 退赛（B 胜）</option>'
      + '<option value="ret_b" ' + (m.result && m.result.reason === "retire" && m.result.winner === "a" ? "selected" : "") + '>B 退赛（A 胜）</option>'
      + '</select></div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn primary block" data-act="save-score" data-id="' + m.id + '">保存</button>'
      + '<button class="btn block" data-act="close-modal">取消</button></div>'
      + (m.result ? '<div class="row" style="margin-top:8px"><button class="btn sm danger block" data-act="clear-score" data-id="' + m.id + '">清除本场成绩</button></div>' : '');
  }

  // 团体赛：整组当整体，只录入一个团体总比分
  function teamScoreModal(disc, m) {
    const aL = entrantLabel(disc, m.a.entrantId) || "待定";
    const bL = entrantLabel(disc, m.b.entrantId) || "待定";
    const exi = m.result;
    const aT = exi ? exi.aTeam : "";
    const bT = exi ? exi.bTeam : "";
    return '<h3>录入组间总比分</h3>'
      + '<div class="vs">' + esc(aL) + ' <small>VS</small> ' + esc(bL) + '</div>'
      + '<p class="muted" style="margin:4px 0 8px">整组当作一支队伍，只记一个团体总比分（如 ' + esc(aL) + ' 3 : 1 ' + esc(bL) + '）。平局按 0.5 分计。</p>'
      + '<div class="row">'
      + '<div class="field" style="flex:1"><label>' + esc(aL) + ' 总比分</label><input id="t_a" inputmode="numeric" value="' + aT + '" placeholder="0"></div>'
      + '<div class="field" style="flex:1"><label>' + esc(bL) + ' 总比分</label><input id="t_b" inputmode="numeric" value="' + bT + '" placeholder="0"></div>'
      + '</div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn primary block" data-act="save-score" data-id="' + m.id + '">保存</button>'
      + '<button class="btn block" data-act="close-modal">取消</button></div>'
      + (exi ? '<div class="row" style="margin-top:8px"><button class="btn sm danger block" data-act="clear-score" data-id="' + m.id + '">清除本场成绩</button></div>' : '');
  }

  // 分项团体：录入某一分项小场比分（按名单中排阵的两名/两对选手）
  function subScoreModal(disc, m, idx) {
    const sub = m.subs[idx];
    if (!sub) return '<h3>错误</h3><p>找不到该分项</p>';
    const nameA = (sub.a.playerIds || []).map(id => { const p = Store.getPlayer(id); return p ? p.name : "?"; }).join("/") || "（未排阵）";
    const nameB = (sub.b.playerIds || []).map(id => { const p = Store.getPlayer(id); return p ? p.name : "?"; }).join("/") || "（未排阵）";
    const rule = Scoring.RULES[disc.scoringMode] || Scoring.RULES["31x1"];
    let games = "";
    for (let i = 0; i < rule.bestOf; i++) {
      const g = sub.result && sub.result.games[i];
      games += '<div class="game-row"><span class="gl">第' + (i + 1) + '局</span>'
        + '<input id="g_' + i + '_a" inputmode="numeric" value="' + (g ? g[0] : "") + '" placeholder="A">'
        + '<span class="vs-sep">:</span>'
        + '<input id="g_' + i + '_b" inputmode="numeric" value="' + (g ? g[1] : "") + '" placeholder="B"></div>';
    }
    const exi = sub.result ? sub.result.reason : "normal";
    const missA = !(sub.a.playerIds || []).length, missB = !(sub.b.playerIds || []).length;
    let warn = "";
    if (missA || missB) warn = '<p class="badge bye" style="margin:6px 0">该分项一方未排阵，只能判对方胜（弃权/退赛）。</p>';
    return '<h3>录入分项 · ' + esc(sub.name) + '</h3>'
      + '<div class="vs">' + esc(nameA) + ' <small>VS</small> ' + esc(nameB) + '</div>'
      + warn
      + '<div id="scoreGames">' + games + '</div>'
      + '<div class="wo-row"><label class="muted">特殊情况：</label>'
      + '<select id="wo_type">'
      + '<option value="normal" ' + (exi === "normal" ? "selected" : "") + '>正常比赛</option>'
      + '<option value="wo_a" ' + (sub.result && sub.result.reason === "walkover" && sub.result.winner === "b" ? "selected" : "") + '>A 弃权（B 胜）</option>'
      + '<option value="wo_b" ' + (sub.result && sub.result.reason === "walkover" && sub.result.winner === "a" ? "selected" : "") + '>B 弃权（A 胜）</option>'
      + '<option value="ret_a" ' + (sub.result && sub.result.reason === "retire" && sub.result.winner === "b" ? "selected" : "") + '>A 退赛（B 胜）</option>'
      + '<option value="ret_b" ' + (sub.result && sub.result.reason === "retire" && sub.result.winner === "a" ? "selected" : "") + '>B 退赛（A 胜）</option>'
      + '</select></div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn primary block" data-act="save-sub" data-id="' + m.id + '" data-sub="' + idx + '">保存</button>'
      + '<button class="btn block" data-act="close-modal">取消</button></div>'
      + (sub.result ? '<div class="row" style="margin-top:8px"><button class="btn sm danger block" data-act="clear-sub" data-id="' + m.id + '" data-sub="' + idx + '">清除本分项</button></div>' : '');
  }

  /* ============================================================
   *  主渲染分发
   * ========================================================== */
  function render() {
    const tab = Store.getUI().activeTab || "events";
    const view = document.getElementById("view");
    let html = "";
    if (tab === "events") html = renderEvents();
    else if (tab === "roster") html = renderRoster();
    else if (tab === "checkin") html = renderCheckin();
    else if (tab === "group") html = renderGroup();
    else if (tab === "schedule") html = renderSchedule();
    else if (tab === "bracket") html = renderBracket();
    else if (tab === "summary") html = renderSummary();
    else if (tab === "backup") html = renderBackup();
    view.innerHTML = html;
    // 同步 Tab 高亮
    document.querySelectorAll(".tab").forEach(t => {
      t.classList.toggle("active", t.getAttribute("data-tab") === tab);
    });
    // 同步上下文条
    const ev = activeEvent();
    const ctx = document.getElementById("ctxBar");
    if (ctx) {
      if (!ev) ctx.textContent = "未选择赛事";
      else {
        const d = activeDisc();
        ctx.textContent = esc(ev.name) + (d ? " · " + esc(d.name) : "");
      }
    }
  }

  // 各队排阵：把某个 slot 的第 pos 个位置设为 val（单打 size=1，双打 size=2）
  function applyLineup(d, gi, slotKey, pos, val) {
    if (!d) return;
    const g = (d.groups || [])[gi]; if (!g) return;
    if (!g.lineup) g.lineup = {};
    const slotDef = (Seeding.currentSlots(d) || []).find(s => s.key === slotKey) || { key: slotKey };
    const code = Seeding.slotCodeOf(d, slotDef);
    const size = isDoublesCode(code) ? 2 : 1;
    let arr = (g.lineup[slotKey] || []).slice();
    while (arr.length < size) arr.push("");
    arr[pos] = val;
    g.lineup[slotKey] = arr;
    Store.save();
  }

  return {
    esc, toast, openModal, closeModal, render, activeEvent, activeDisc,
    eventForm, playerForm, importForm, scoreModal, newDiscipline,
    entrantLabel, partnerOptionsHtml, partnerName, applyLineup,
    teamFormatOptionsHtml, slotConfigHtml, lineupEditorHtml
  };
})();
