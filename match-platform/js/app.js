/* app.js — 启动 + Tab 切换 + 全局事件委托（data-act 分发） */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function init() {
    Store.load();
    const ui = Store.getUI();
    if (!ui.activeTab) ui.activeTab = "events";
    UI.render();
    bind();
  }

  function bind() {
    // Tab 切换
    $$(".tab").forEach(t => t.addEventListener("click", () => {
      Store.setUI({ activeTab: t.getAttribute("data-tab") });
      UI.render();
    }));
    // 顶部汉堡：折叠/展开 Tab 栏
    const nav = $("#navToggle"), tabbar = $("#tabbar");
    if (nav) nav.addEventListener("click", () => {
      tabbar.style.display = tabbar.style.display === "none" ? "" : "none";
    });
    // 全局点击委托
    document.addEventListener("click", onClick);
    // 文件导入 / 台号输入
    document.addEventListener("change", onChange);
    // 文本框实时预览（导入名单）
    document.addEventListener("input", onInput);
  }

  function onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.getAttribute("data-act");
    const id = el.getAttribute("data-id");
    switch (act) {
      case "new-event": UI.openModal(UI.eventForm(null)); break;
      case "create-event": createEvent(); break;
      case "edit-event": {
        const ev = Store.getEvent(id); if (ev) UI.openModal(UI.eventForm(ev)); break;
      }
      case "save-event": saveEvent(id); break;
      case "del-event":
        if (confirm("确认删除该赛事？其下所有项目与对阵将一并删除。")) { Store.delEvent(id); UI.render(); }
        break;
      case "open-event":
        Store.setUI({ activeEventId: id, activeDisciplineId: null }); UI.render(); break;

      case "new-player": UI.openModal(UI.playerForm()); break;
      case "save-player": savePlayer(); break;
      case "del-player":
        if (confirm("确认删除该选手？")) { Store.delPlayer(id); UI.render(); } break;
      case "import-players": UI.openModal(UI.importForm()); break;
      case "confirm-import": confirmImport(); break;
      case "export-players": CSVUtil.exportPlayersCSV(); break;

      case "toggle-present": {
        Checkin.toggle(id); UI.render(); break;
      }
      case "checkin-all":
        Checkin.markAll(id === "1"); UI.render(); break;

      case "set-disc":
        Store.setUI({ activeDisciplineId: id }); UI.render(); break;
      case "draw": drawBracket(); break;
      case "draw-team": drawTeam(); break;
      case "team-gc": teamGroupCount(parseInt(el.getAttribute("data-d") || "0", 10)); break;

      case "score": openScore(id); break;
      case "save-score": saveScore(id); break;
      case "clear-score": clearScore(id); break;

      case "export-rank": {
        const d = UI.activeDisc();
        if (d) { if (d.kind === "team") CSVUtil.exportTeamRankCSV(d); else CSVUtil.exportRankCSV(d); }
        break;
      }
      case "export-json": CSVUtil.exportJSON(); break;
      case "import-json": triggerImport(); break;
      case "reset-all":
        if (confirm("确认清空所有数据（赛事、选手、对阵）？此操作不可恢复。")) { Store.resetAll(); UI.render(); }
        break;

      case "close-modal": UI.closeModal(); break;
    }
  }

  function onChange(e) {
    const t = e.target;
    if (!t) return;
    if (t.id === "imp_json") { /* 选中后由 import-json 按钮触发 */ return; }
    if (t.id === "imp_csv") { loadCsvFile(t); return; }
    // 团体赛：手选分组
    if (t.classList && t.classList.contains("gassign")) {
      const pid = t.getAttribute("data-pid");
      assignGroup(pid, t.value);
      return;
    }
    // 赛程台号输入
    if (t.id && t.id.indexOf("court_") === 0) {
      const d = UI.activeDisc(); if (!d) return;
      const mid = t.id.slice(6);
      const m = Store.getMatch(d, mid);
      if (m) { m.court = t.value.trim(); Store.save(); }
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t && t.id === "imp_text") previewImport();
  }

  function loadCsvFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const ta = $("#imp_text");
      if (ta) ta.value = reader.result;
      previewImport();
    };
    reader.readAsText(file, "utf-8");
  }

  function previewImport() {
    const ta = $("#imp_text"); if (!ta) return;
    const prev = $("#imp_preview"); if (!prev) return;
    const text = ta.value;
    if (!text.trim()) { prev.textContent = ""; return; }
    const existing = Store.allPlayers().map(p => p.name + "|" + (p.partner || "") + "|" + (p.disciplines || []).join(","));
    const players = CSVUtil.rowsToPlayers(text, existing);
    if (!players.length) { prev.innerHTML = "未解析到有效选手（空行或缺少姓名会被跳过）。"; return; }
    prev.innerHTML = "将导入 <b>" + players.length + "</b> 名选手（空行 / 缺姓名 / 重复项已自动跳过）。";
  }

  /* ---------- 赛事 ---------- */
  function createEvent() {
    const name = $("#f_name").value.trim();
    if (!name) { UI.toast("请填写赛事名称"); return; }
    const discs = $$('#modalCard input[name="disc"]:checked').map(c => c.value);
    if (!discs.length) { UI.toast("请至少选择一个比赛项目"); return; }
    const ev = {
      name: name,
      date: $("#f_date").value.trim(),
      venue: $("#f_venue").value.trim(),
      note: $("#f_note").value.trim(),
      disciplines: discs.map(c => UI.newDiscipline(c))
    };
    const created = Store.addEvent(ev);
    Store.setUI({ activeEventId: created.id, activeDisciplineId: created.disciplines[0].id });
    UI.closeModal(); UI.render(); UI.toast("赛事已创建");
  }
  function saveEvent(id) {
    const ev = Store.getEvent(id); if (!ev) return;
    ev.name = $("#f_name").value.trim() || ev.name;
    ev.date = $("#f_date").value.trim();
    ev.venue = $("#f_venue").value.trim();
    ev.note = $("#f_note").value.trim();
    // 编辑时支持增删比赛项目（含团体赛）
    const wanted = $$('#modalCard input[name="disc"]:checked').map(c => c.value);
    const have = (ev.disciplines || []).map(x => x.code);
    wanted.filter(c => !have.includes(c)).forEach(c => ev.disciplines.push(UI.newDiscipline(c)));
    ev.disciplines = (ev.disciplines || []).filter(x => wanted.includes(x.code));
    Store.save(); UI.closeModal(); UI.render(); UI.toast("已保存");
  }

  /* ---------- 选手 ---------- */
  function savePlayer() {
    const name = $("#p_name").value.trim();
    if (!name) { UI.toast("请填写姓名"); return; }
    const discs = $$('#modalCard input[name="pdisc"]:checked').map(c => c.value);
    const lv = $("#p_level").value.trim();
    const sd = $("#p_seed").value.trim();
    const p = {
      id: null, name: name,
      gender: $("#p_gender").value.trim(),
      partner: $("#p_partner").value.trim(),
      club: $("#p_club").value.trim(),
      phone: $("#p_phone").value.trim(),
      level: lv ? parseInt(lv, 10) : null,
      disciplines: discs,
      seed: sd ? parseInt(sd, 10) || 0 : 0,
      present: false, checkinAt: null, note: ""
    };
    Store.addPlayer(p);
    UI.closeModal(); UI.render(); UI.toast("已添加 " + name);
  }

  function confirmImport() {
    const text = $("#imp_text").value;
    if (!text.trim()) { UI.toast("请粘贴名单"); return; }
    const existing = Store.allPlayers().map(p => p.name + "|" + (p.partner || "") + "|" + (p.disciplines || []).join(","));
    const players = CSVUtil.rowsToPlayers(text, existing);
    if (!players.length) { UI.toast("未解析到有效选手（可能重复）"); return; }
    players.forEach(p => Store.addPlayer(p));
    UI.closeModal(); UI.render();
    UI.toast("成功导入 " + players.length + " 名选手");
  }

  /* ---------- 分组 / 生成对阵 ---------- */
  function drawBracket() {
    const d = UI.activeDisc(); if (!d || d.kind === "team") return;
    d.scoringMode = $("#g_scoring").value;
    d.thirdPlace = $("#g_third").checked;
    const sd = parseInt($("#g_seed").value, 10) || 0;
    d.seedCount = sd;
    const entrants = Seeding.buildEntrants(d);
    if (entrants.length < 2) { UI.toast("到场可参赛人数不足 2 人"); return; }
    if (sd > entrants.length) { UI.toast("种子数不能超过人数"); d.seedCount = entrants.length; }
    Seeding.makeBracket(d);
    UI.render();
    UI.toast("对阵已生成（签表 " + d.bracketSize + "，轮空 " + d.byeCount + "）");
  }

  /* ---------- 团体赛：分组 / 生成对阵 ---------- */
  function drawTeam() {
    const d = UI.activeDisc(); if (!d || d.kind !== "team") return;
    const sm = document.getElementById("g_scoring");
    if (sm) d.scoringMode = sm.value;
    const nonEmpty = (d.groups || []).filter(g => (g.playerIds || []).length > 0);
    if (nonEmpty.length < 2) { UI.toast("请至少把 2 个组各安排 1 名以上选手"); return; }
    const res = Seeding.generateTeamMatches(d);
    UI.render(); UI.toast("组间循环对阵已生成（" + res.groups + " 组 · " + res.matches.length + " 场）");
  }

  function teamGroupCount(delta) {
    const d = UI.activeDisc(); if (!d || d.kind !== "team") return;
    let n = (d.groupCount || 2) + delta;
    n = Math.max(1, Math.min(Seeding.TEAM_MAX_GROUPS, n));
    if (n === d.groupCount) { UI.toast("分组数范围 1–8"); return; }
    const names = Seeding.GROUP_LETTERS.slice(0, n).split("");
    const newGroups = names.map((nm, i) => d.groups[i] ? d.groups[i] : { name: nm, playerIds: [] });
    d.groupCount = n;
    d.groups = newGroups;
    Store.save(); UI.render();
  }

  function assignGroup(pid, groupName) {
    const d = UI.activeDisc(); if (!d || d.kind !== "team") return;
    (d.groups || []).forEach(g => {
      const idx = (g.playerIds || []).indexOf(pid);
      if (idx >= 0) g.playerIds.splice(idx, 1);
    });
    if (groupName) {
      const g = (d.groups || []).find(x => x.name === groupName);
      if (g) g.playerIds.push(pid);
    }
    Store.save(); UI.render();
  }

  /* ---------- 比分录入 ---------- */
  function openScore(matchId) {
    const d = UI.activeDisc(); if (!d) return;
    const m = Store.getMatch(d, matchId);
    if (!m) return;
    if (m.status !== "ready" && m.status !== "done") { UI.toast("该场尚未就绪（需先有两名选手）"); return; }
    UI.openModal(UI.scoreModal(d, m));
  }
  function saveScore(matchId) {
    const d = UI.activeDisc(); if (!d) return;
    const m = Store.getMatch(d, matchId);
    if (!m) return;
    if (d.kind === "team" || m.stage === "team") { saveTeamScore(d, m); return; }
    const rule = Scoring.RULES[d.scoringMode] || Scoring.RULES["31x1"];
    const wo = $("#wo_type").value;
    let reason = "normal", side = null, games = [];
    if (wo !== "normal") {
      const map = { wo_a: ["walkover", "b"], wo_b: ["walkover", "a"], ret_a: ["retire", "b"], ret_b: ["retire", "a"] };
      [reason, side] = map[wo];
    } else {
      games = [];
      for (let i = 0; i < rule.bestOf; i++) {
        const a = $("#g_" + i + "_a").value.trim();
        const b = $("#g_" + i + "_b").value.trim();
        if (a === "" && b === "") continue;
        if (a === "" || b === "") { UI.toast("第" + (i + 1) + "局比分不完整"); return; }
        games.push([parseInt(a, 10), parseInt(b, 10)]);
      }
      if (!games.length) { UI.toast("请录入至少一局比分"); return; }
    }
    const res = Scoring.submitResult(d, matchId, games, reason, side);
    if (!res.ok) { UI.toast(res.msg); return; }
    UI.closeModal(); UI.render();
  }
  function saveTeamScore(d, m) {
    const a = parseInt($("#t_a").value, 10);
    const b = parseInt($("#t_b").value, 10);
    if (isNaN(a) || isNaN(b)) { UI.toast("请填写双方总比分"); return; }
    if (a < 0 || b < 0) { UI.toast("比分不能为负"); return; }
    Scoring.submitTeamResult(d, m.id, a, b);
    UI.closeModal(); UI.render();
  }
  function clearScore(matchId) {
    const d = UI.activeDisc(); if (!d) return;
    Scoring.clearResult(d, matchId);
    UI.closeModal(); UI.render(); UI.toast("已清除本场成绩");
  }

  /* ---------- 备份导入 ---------- */
  function triggerImport() {
    const input = $("#imp_json");
    if (!input || !input.files || !input.files[0]) { UI.toast("请先选择 JSON 文件"); return; }
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        if (confirm("导入将覆盖当前所有数据，确认继续？")) {
          Store.replaceAll(data);
          UI.render(); UI.toast("导入成功");
        }
      } catch (err) { UI.toast("JSON 解析失败：" + err.message); }
    };
    reader.readAsText(file);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
