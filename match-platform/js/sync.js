/* sync.js — 跨设备云端同步引擎（复用 archive.html 自动同步范式）
 * 读：GitHub Pages 上公开的 state.json（无需 token）
 * 写：GitHub Contents API（token 来自 XYGate.ghToken()，与 archive 同源共享）
 * 触发：每次 Store.save() 自动防抖上传；页面启动自动拉取合并。
 * 合并策略：id-union，双方新增实体都保留，同 id 本地优先，避免任一端丢数据。
 */
(function () {
  const GH_REPO = 'xytyymq/xingyi-workbench';
  const GH_PATH = 'match-platform/data/state.json';                 // 仓库内路径（API 用）
  const GH_API = 'https://api.github.com/repos/' + GH_REPO + '/contents/' + GH_PATH;
  const READ_PATH = 'data/state.json';                              // 相对 match-platform 页面（公开读）

  const LS_DIRTY = 'xy_match_dirty';
  const LS_LASTOK = 'xy_match_lastok';
  let _syncTimer = null, _syncing = false, _retryN = 0, _booted = false;

  function b64utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function decodeB64(str) {
    try { return decodeURIComponent(escape(atob(str.replace(/\s/g, '')))); }
    catch (e) { return ''; }
  }
  function _dirty(v) { try { v ? localStorage.setItem(LS_DIRTY, '1') : localStorage.removeItem(LS_DIRTY); } catch (e) {} }
  function _isDirty() { try { return localStorage.getItem(LS_DIRTY) === '1'; } catch (e) { return false; } }
  function _hhmm() { const d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function _gt() { return (window.XYGate && XYGate.ghToken) ? XYGate.ghToken() : ''; }

  // ---- id-union 合并整库 ----
  function mergeDB(local, cloud) {
    local = local || {}; cloud = cloud || {};
    const out = {
      schema: 1,
      meta: Object.assign({ venue: '星羿羽毛球馆' }, local.meta, cloud.meta),
      players: [], events: []
    };
    const lp = {}, cp = {};
    (local.players || []).forEach(p => lp[p.id] = p);
    (cloud.players || []).forEach(p => cp[p.id] = p);
    const pids = new Set([...Object.keys(lp), ...Object.keys(cp)]);
    out.players = [...pids].map(id => lp[id] || cp[id]);

    const le = {}, ce = {};
    (local.events || []).forEach(e => le[e.id] = e);
    (cloud.events || []).forEach(e => ce[e.id] = e);
    const eids = new Set([...Object.keys(le), ...Object.keys(ce)]);
    out.events = [...eids].map(id => mergeEvent(le[id], ce[id]));

    const lu = local.meta && local.meta.updatedAt, cu = cloud.meta && cloud.meta.updatedAt;
    out.meta.updatedAt = (lu && cu) ? (lu > cu ? lu : cu) : (lu || cu || null);
    return out;
  }
  function mergeEvent(l, c) {
    if (l && !c) return l;
    if (!l && c) return c;
    const base = JSON.parse(JSON.stringify(l));
    base.disciplines = base.disciplines || [];
    const cm = {}; (c.disciplines || []).forEach(d => cm[d.id] = d);
    const lm = {}; base.disciplines.forEach(d => lm[d.id] = d);
    (c.disciplines || []).forEach(d => { if (!lm[d.id]) base.disciplines.push(d); });
    base.disciplines.forEach(d => {
      if (!d.matches) return;
      const cM = {}; ((cm[d.id] && cm[d.id].matches) || []).forEach(m => cM[m.id] = m);
      const lM = {}; d.matches.forEach(m => lM[m.id] = m);
      const ids = new Set([...Object.keys(lM), ...Object.keys(cM)]);
      d.matches = [...ids].map(id => lM[id] || cM[id]);
    });
    return base;
  }

  // ---- 自动防抖上传 ----
  function scheduleSync(delay) {
    _dirty(true);
    if (_booted) setSync('pending');
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(runSync, typeof delay === 'number' ? delay : 1500);
  }
  window.scheduleSync = scheduleSync;

  async function runSync() {
    if (_syncing || !_isDirty()) return;
    if (!navigator.onLine) { setSync('offline'); return; }
    if (!_gt()) { setSync('nogt'); return; }
    _syncing = true; setSync('syncing');
    let ok = false;
    try { ok = await pushOnce(_gt()); } catch (e) { ok = false; }
    _syncing = false;
    if (ok) {
      _retryN = 0; _dirty(false);
      try { localStorage.setItem(LS_LASTOK, Date.now() + ''); } catch (e) {}
      setSync('ok'); return;
    }
    const waits = [5000, 15000, 60000, 180000, 600000];
    if (_retryN < waits.length) {
      const w = waits[_retryN++]; setSync('retry');
      clearTimeout(_syncTimer); _syncTimer = setTimeout(runSync, w);
    } else setSync('fail');
  }

  async function pushOnce(gt) {
    const H = { 'Authorization': 'token ' + gt, 'Accept': 'application/vnd.github+json' };
    const gr = await fetch(GH_API, { headers: H, cache: 'no-store' });
    let sha = null, cloud = null;
    if (gr.ok) {
      const gj = await gr.json();
      sha = gj.sha || null;
      try { cloud = JSON.parse(decodeB64(gj.content)); } catch (e) { cloud = null; }
    } else if (gr.status !== 404) {
      return false; // 非 404 的异常（如 401 无权限）等下一轮
    }
    const local = (window.Store && Store.getRaw) ? Store.getRaw() : null;
    if (!local) return false;
    const merged = mergeDB(local, cloud);
    const body = {
      message: '比赛平台自动同步 ' + new Date().toISOString().slice(0, 19).replace('T', ' '),
      content: b64utf8(JSON.stringify(merged, null, 2))
    };
    if (sha) body.sha = sha; // 文件已存在才带 sha；404 首次创建不带
    const put = await fetch(GH_API, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, H),
      body: JSON.stringify(body)
    });
    if (put.ok) {
      if (window.Store && Store.replaceAll) Store.replaceAll(merged, true); // 静默写回，不触发再上传
      if (window.UI && UI.render) UI.render();
      return true;
    }
    return false; // 409 冲突：下一轮重新取 sha，自然解决
  }

  function setSync(state) {
    const el = document.getElementById('syncStatus');
    const btn = document.getElementById('syncRetry');
    if (!el) return;
    const last = (function () { try { const t = +localStorage.getItem(LS_LASTOK); return t ? new Date(t) : null; } catch (e) { return null; } })();
    const lastTxt = last ? ('（上次成功 ' + ('0' + last.getHours()).slice(-2) + ':' + ('0' + last.getMinutes()).slice(-2) + '）') : '';
    const M = {
      ok:      ['✅ 已自动同步云端 · ' + _hhmm(), '#0f766e'],
      syncing: ['⏳ 正在自动同步…', '#0369a1'],
      pending: ['⏳ 有新数据，马上自动上传…', '#0369a1'],
      retry:   ['⏳ 网络不太稳，正在自动重试…' + lastTxt, '#b45309'],
      offline: ['📴 当前无网络，联网后会自动补传' + lastTxt, '#b45309'],
      nogt:    ['📱 本机仅本地：找老板开一次授权链接，点开后永久自动同步', '#b45309'],
      fail:    ['⚠️ 自动同步暂时失败，数据已安全存在本机' + lastTxt, '#b91c1c'],
      idle:    ['✅ 数据已是最新' + lastTxt, '#0f766e']
    };
    const m = M[state] || M.idle;
    el.textContent = m[0]; el.style.color = m[1];
    if (btn) btn.style.display = (state === 'fail') ? 'inline-block' : 'none';
  }
  window.setSync = setSync;

  async function getCloud() {
    try {
      const r = await fetch(READ_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  // ---- 启动：拉公开主档合并 + 自动补传 ----
  async function bootCloud() {
    const cloud = await getCloud();
    const local = (window.Store && Store.getRaw) ? Store.getRaw() : null;
    let needPush = false;
    if (cloud && local) {
      const cm = {}; (cloud.players || []).forEach(p => cm[p.id] = 1);
      const em = {}; (cloud.events || []).forEach(e => em[e.id] = 1);
      const lm = {}; (local.players || []).forEach(p => lm[p.id] = 1);
      const le = {}; (local.events || []).forEach(e => le[e.id] = 1);
      const cloudHasNew = Object.keys(cm).some(id => !lm[id]) || Object.keys(em).some(id => !le[id]);
      const localHasNew = Object.keys(lm).some(id => !cm[id]) || Object.keys(le).some(id => !em[id]);
      needPush = cloudHasNew || localHasNew;
      const merged = mergeDB(local, cloud);
      if (window.Store && Store.replaceAll) Store.replaceAll(merged, true);
      if (window.UI && UI.render) UI.render();
    }
    _booted = true;
    if (needPush || _isDirty()) scheduleSync(1200);
    else setSync(_gt() ? 'idle' : 'nogt');
  }

  // 立即重试按钮
  const rb = document.getElementById('syncRetry');
  if (rb) rb.addEventListener('click', function () { _retryN = 0; scheduleSync(0); });

  if (document.readyState !== 'loading') bootCloud();
  else document.addEventListener('DOMContentLoaded', bootCloud);

  // 网络恢复 / 回到前台 / 定时兜底：自动补传，用户无感
  window.addEventListener('online', function () { if (_isDirty()) { _retryN = 0; scheduleSync(800); } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && _isDirty()) { _retryN = 0; scheduleSync(800); } });
  setInterval(function () { if (_isDirty() && !_syncing) runSync(); }, 180000);

  // 暴露纯函数便于测试/调试
  window.XYSync = { mergeDB, mergeEvent, b64utf8, decodeB64 };
})();
