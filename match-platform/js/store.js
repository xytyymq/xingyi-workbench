/* store.js — 数据层：单键 localStorage + 实体 CRUD
 * 复用 archive.html 的 load/save/uid 范式，单键存储保证跨表原子写。
 */
window.Store = (function () {
  const LS_KEY = "xy_tour_db_v1";
  const LS_UI = "xy_tour_ui_v1";

  function emptyDB() {
    return {
      schema: 1,
      meta: { createdAt: null, updatedAt: null, venue: "星羿羽毛球馆" },
      players: [],
      events: []
    };
  }

  let DB = emptyDB();
  let UIState = { activeTab: "events", activeEventId: null, activeDisciplineId: null };

  function load() {
    try { const raw = localStorage.getItem(LS_KEY); DB = raw ? JSON.parse(raw) : emptyDB(); }
    catch (e) { DB = emptyDB(); }
    if (!DB.players) DB.players = [];
    if (!DB.events) DB.events = [];
    try { const u = localStorage.getItem(LS_UI); UIState = u ? JSON.parse(u) : UIState; }
    catch (e) { /* keep default */ }
  }

  function save(noSync) {
    DB.meta.updatedAt = new Date().toISOString();
    try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
    catch (e) { alert("保存失败：" + e.message + "\n（可能是隐私模式或存储空间已满）"); }
    // 挂载点：任意写入后自动排队上传云端（noSync 时不触发，避免程序内替换造成循环）
    if (!noSync && typeof window.scheduleSync === "function") window.scheduleSync();
  }

  function saveUI() {
    try { localStorage.setItem(LS_UI, JSON.stringify(UIState)); } catch (e) { /* ignore */ }
  }

  // 供云端同步引擎整体读写整库
  function getRaw() { return DB; }

  let _seq = 0;
  function uid(prefix) { _seq++; return (prefix || "") + Date.now().toString(36) + _seq.toString(36); }

  /* ---------- 选手 Player ---------- */
  function addPlayer(p) {
    p.id = uid("P");
    DB.players.push(p);
    save();
    return p;
  }
  function delPlayer(id) {
    DB.players = DB.players.filter(p => p.id !== id);
    save();
  }
  function getPlayer(id) { return DB.players.find(p => p.id === id) || null; }
  function updatePlayer(id, patch) {
    const p = getPlayer(id);
    if (p) { Object.assign(p, patch); save(); }
    return p;
  }

  /* ---------- 赛事 Event ---------- */
  function addEvent(e) {
    e.id = uid("E");
    DB.events.push(e);
    if (!UIState.activeEventId) UIState.activeEventId = e.id;
    save(); saveUI();
    return e;
  }
  function delEvent(id) {
    DB.events = DB.events.filter(e => e.id !== id);
    if (UIState.activeEventId === id) UIState.activeEventId = DB.events[0] ? DB.events[0].id : null;
    save(); saveUI();
  }
  function getEvent(id) { return DB.events.find(e => e.id === id) || null; }
  function curEvent() { return getEvent(UIState.activeEventId) || DB.events[0] || null; }

  function getDiscipline(eventId, dId) {
    const ev = getEvent(eventId);
    if (!ev) return null;
    return (ev.disciplines || []).find(d => d.id === dId) || null;
  }

  /* ---------- Match / Entrant（存在 discipline 内部） ---------- */
  function matchesOf(disc) { return disc.matches || []; }
  function getMatch(disc, id) { return (disc.matches || []).find(m => m.id === id) || null; }
  function entrantsOf(disc) { return disc.entrants || []; }
  function getEntrant(disc, eid) { return (disc.entrants || []).find(e => e.id === eid) || null; }

  function setUI(patch) { Object.assign(UIState, patch); saveUI(); }
  function getUI() { return UIState; }
  function resetAll() {
    DB = emptyDB();
    UIState = { activeTab: "events", activeEventId: null, activeDisciplineId: null };
    save(); saveUI();
  }
  function replaceAll(data, noSync) {
    const merged = emptyDB();
    if (data && typeof data === "object") {
      if (Array.isArray(data.players)) merged.players = data.players;
      if (Array.isArray(data.events)) merged.events = data.events;
      if (data.meta) merged.meta = Object.assign(merged.meta, data.meta);
    }
    DB = merged;
    if (!DB.events.length) UIState.activeEventId = null;
    else if (!DB.events.find(e => e.id === UIState.activeEventId)) UIState.activeEventId = DB.events[0].id;
    save(noSync); saveUI();
  }

  return {
    LS_KEY, load, save, saveUI, uid, emptyDB, getRaw,
    addPlayer, delPlayer, getPlayer, updatePlayer, allPlayers: () => DB.players,
    addEvent, delEvent, getEvent, curEvent, allEvents: () => DB.events,
    getDiscipline, matchesOf, getMatch, entrantsOf, getEntrant,
    setUI, getUI, resetAll, replaceAll
  };
})();
