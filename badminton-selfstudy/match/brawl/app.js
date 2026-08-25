/* brawl/app.js — 大乱斗前端（合并版：统一 Award 模块 + 常驻榜） */
(function () {
  'use strict';
  const E = window.DaLuanDouEngine, A = window.Award;
  const $ = id => document.getElementById(id);
  function esc(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }
  const STORE_KEY = 'dld_state_v1';
  const BOARD_KEY = 'dld_board_v1';

  let state = null, board = null;

  function freshState() {
    return {
      players: [], partnerHist: {}, byeCounts: {},
      rounds: [], roundByes: [], current: 0, totalRounds: 5,
      config: { rule: '21x1', courts: 2, handicap: true, mode: 'swiss' },
      eventLabel: '', eventDate: new Date().toISOString().slice(0, 10)
    };
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function saveBoard() { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s) state = s;
      const b = JSON.parse(localStorage.getItem(BOARD_KEY)); board = b || { seasons: {} };
    } catch (e) {}
    if (!state) state = freshState();
    if (!board) board = { seasons: {} };
  }

  function addPlayer() {
    const name = $('pname').value.trim(); const gender = $('pgender').value;
    if (!name) return;
    state.players.push({ id: 'u' + Date.now() + Math.floor(Math.random() * 999), name, gender });
    $('pname').value = ''; save(); renderPlayers();
  }
  function delPlayer(id) { state.players = state.players.filter(p => p.id !== id); save(); renderPlayers(); }
  function renderPlayers() {
    $('plist').innerHTML = state.players.map(p =>
      `<span class="chip">${esc(p.name)}<small>${p.gender}</small> <a onclick="delPlayer('${p.id}')">✕</a></span>`).join('');
    $('pcount').textContent = state.players.length;
  }

  function startEvent() {
    if (state.players.length < 4) return alert('至少 4 人');
    state.config.rule = $('rule').value;
    state.config.courts = parseInt($('courts').value, 10) || 0;
    state.config.handicap = $('handicap').checked;
    state.config.mode = $('mode').value;
    state.totalRounds = parseInt($('rounds').value, 10) || 5;
    state.eventLabel = $('eventLabel').value.trim() || '大乱斗常规赛';
    state.eventDate = $('eventDate').value || new Date().toISOString().slice(0, 10);
    state.partnerHist = {}; state.byeCounts = {}; state.rounds = []; state.roundByes = []; state.current = 0;
    const res = E.generateRound(state.players, {}, state.partnerHist, state.byeCounts, 1, state.config.courts, state.config.handicap, state.config.mode);
    if (res.error) return alert(res.error);
    state.roundByes.push(res.byes || []);
    state.rounds.push(res.matches); state.current = 1;
    save(); show('play'); renderRound();
  }

  function nextRound() {
    const cur = state.rounds[state.current - 1];
    if (cur.some(m => !m.result)) return alert('本轮还有比赛没录分');
    if (state.current >= state.totalRounds) return alert('已是最后一轮，去颁奖/并入常驻榜');
    const st = E.computeStandings(state.players, state.rounds.flat());
    const res = E.generateRound(state.players, st, state.partnerHist, state.byeCounts, state.current + 1, state.config.courts, state.config.handicap, state.config.mode);
    if (res.error) return alert(res.error);
    state.roundByes = state.roundByes || [];
    state.roundByes.push(res.byes || []);
    state.rounds.push(res.matches); state.current++;
    save(); renderRound();
  }

  function openScore(ri, mi) {
    const m = state.rounds[ri][mi];
    const rule = E.RULES[state.config.rule];
    const ra = m.a.map(nameOf).join('+'), rb = m.b.map(nameOf).join('+');
    const aStart = m.aStart || 0, bStart = m.bStart || 0;
    const box = $('scoreModalBox');
    box.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:18px">录分 · 第 ${ri + 1} 轮</h2>
      <div style="color:#8fb7a3;font-size:13px">${aStart || bStart ? '让分 A+' + aStart + ' B+' + bStart : '平等'}　·　${rule.name}</div>
      <div style="margin:12px 0"><div style="font-weight:700">${esc(ra)}</div><input id="sa" type="number" value="${m.result ? m.result.aPoints : aStart}" style="margin-top:4px;width:100%;padding:8px;border-radius:8px;border:1px solid #2c4a3c;background:#0d1f18;color:#fff"></div>
      <div style="margin:12px 0"><div style="font-weight:700;text-align:right">${esc(rb)}</div><input id="sb" type="number" value="${m.result ? m.result.bPoints : bStart}" style="margin-top:4px;width:100%;padding:8px;border-radius:8px;border:1px solid #2c4a3c;background:#0d1f18;color:#fff"></div>
      <div style="display:flex;gap:10px;margin-top:14px"><button class="ghost" style="flex:1" onclick="closeScoreModal()">取消</button><button class="primary" style="flex:1" onclick="saveScore(${ri},${mi})">保存</button></div>`;
    $('scoreModal').style.display = 'flex';
    setTimeout(() => { const el = $('sa'); if (el) el.focus(); }, 30);
  }
  function closeScoreModal() { $('scoreModal').style.display = 'none'; }
  function saveScore(ri, mi) {
    const m = state.rounds[ri][mi];
    const a = parseInt($('sa').value, 10), b = parseInt($('sb').value, 10);
    if (isNaN(a) || isNaN(b)) return alert('请填完整比分');
    const rule = E.RULES[state.config.rule];
    const err = E.validateGame(a, b, m.aStart, m.bStart, rule);
    if (err) return alert('比分非法：' + err);
    m.result = { winner: a > b ? 'a' : 'b', aPoints: a, bPoints: b };
    closeScoreModal(); save(); renderRound();
  }

  function renderRound() {
    const cur = state.rounds[state.current - 1];
    const byes = (state.roundByes && state.roundByes[state.current - 1]) || [];
    const byeHtml = byes.length ? `<div style="background:#1c4034;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:10px;color:#f5a623;font-size:14px">🛌 本轮休息（轮空）：${byes.map(id => esc(nameOf(id))).join('、')}</div>` : '';
    $('roundTitle').textContent = `第 ${state.current} / ${state.totalRounds} 轮`;
    $('roundBody').innerHTML = byeHtml + cur.map((m, mi) => {
      const ra = m.a.map(id => nameOf(id)).join('+');
      const rb = m.b.map(id => nameOf(id)).join('+');
      const ha = m.aStart ? ` (让${m.aStart})` : '';
      const hb = m.bStart ? ` (让${m.bStart})` : '';
      const sc = m.result ? `<b>${m.result.aPoints}</b> : <b>${m.result.bPoints}</b> ✅` : `<button onclick="openScore(${state.current - 1},${mi})">录分</button>`;
      const court = m.court ? `台${m.court}` : '练习';
      return `<div class="match"><span class="court">${court}</span><span class="ta">${esc(ra)}${ha}</span><span class="vs">VS</span><span class="tb">${esc(rb)}${hb}</span><span class="sc">${sc}</span></div>`;
    }).join('');
    const rk = E.ranking(state.players, state.rounds.flat());
    $('liveRank').innerHTML = rk.map(r =>
      `<div class="row"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}</span><span class="st">${r.wins}胜${r.losses}负 净${r.net}</span></div>`).join('');
    $('nextBtn').disabled = state.current >= state.totalRounds;
    $('finishBtn').style.display = state.current >= state.totalRounds ? 'inline-block' : 'none';
    save();
  }
  function nameOf(id) { const p = state.players.find(x => x.id === id); return p ? p.name : '?'; }

  function finalize() {
    const cur = state.rounds[state.current - 1];
    if (cur.some(m => !m.result)) return alert('还有比赛没录分，不能结算');
    const stats = E.eventStats(state.players, state.rounds.flat());
    const d = new Date(state.eventDate);
    ['all', 'year', 'month', 'week'].forEach(scope => {
      const key = E.seasonKeyFor(d, scope);
      const labelMap = { all: '总榜', year: d.getFullYear() + '年度', month: (d.getMonth() + 1) + '月', week: key + '周' };
      E.foldEvent(board, key, stats, labelMap[scope]);
    });
    saveBoard();
    const rk = E.ranking(state.players, state.rounds.flat());
    const svg = A.buildAwardSVG(rk.slice(0, 3), { title: state.eventLabel, date: state.eventDate, venue: '星羿羽毛球馆 · 九江开发区', theme: 'brawl', tag: '以球会友 · 随机配对 · 积分常驻' });
    showSVG(svg, '大乱斗颁奖_' + state.eventDate);
    alert('本场已并入常驻榜（总/年/月/周）。可在「常驻榜」页查看。');
  }

  // 取该 scope（周/月/年）下「最新一个有数据的赛季 key」
  // 修复：原逻辑用「今天」推算 key，而数据按「赛事日期」存储，跨周/跨月查看时 key 错位取不到数据
  function latestSeasonKey(scope) {
    const re = { year: /^\d{4}$/, month: /^\d{4}-\d{2}$/, week: /^\d{4}-W\d{2}$/ }[scope];
    if (!re) return null;
    const keys = Object.keys(board.seasons || {}).filter(k => re.test(k));
    if (!keys.length) return null;
    keys.sort();
    return keys[keys.length - 1];
  }
  function renderBoard() {
    const scope = $('boardScope').value;
    const key = scope === 'all' ? 'all' : latestSeasonKey(scope);
    if (!key || !board.seasons[key]) {
      $('boardList').innerHTML = '<p style="color:#8fb7a3">该周期还没有比赛数据</p>';
      $('boardTitle').textContent = '常驻榜';
      return;
    }
    const list = E.getBoard(board, key);
    $('boardList').innerHTML = list.length ? list.map(r =>
      `<div class="row"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}</span><span class="st">${r.wins}胜${r.losses}负 净${r.net} · ${r.events}场</span></div>`).join('') : '<p style="color:#8fb7a3">该周期还没有比赛数据</p>';
    $('boardTitle').textContent = (board.seasons[key] && board.seasons[key].label) || '常驻榜';
  }
  function exportBoardImg() {
    const scope = $('boardScope').value;
    const key = scope === 'all' ? 'all' : latestSeasonKey(scope);
    if (!key || !board.seasons[key]) { alert('该周期还没有比赛数据，无法导出'); return; }
    const list = E.getBoard(board, key);
    const scopeLabel = (board.seasons[key] && board.seasons[key].label) || '常驻榜';
    const svg = A.buildBoardSVG(list, { title: '大乱斗 · 积分常驻榜', scope: scopeLabel, theme: 'brawl' });
    showSVG(svg, '大乱斗常驻榜_' + scope);
  }
  function clearBoard() {
    if (confirm('确定清空常驻榜所有数据？此操作不可恢复')) { board = { seasons: {} }; saveBoard(); renderBoard(); }
  }

  let lastSVG = '';
  function showSVG(svg, fname) {
    lastSVG = svg;
    $('svgPreview').innerHTML = svg;
    $('svgDownload').onclick = () => A.downloadPNG(svg, (fname || 'award') + '.png');
    show('award');
  }

  function show(tab) {
    ['setup', 'play', 'board', 'award'].forEach(t => $('tab-' + t).style.display = (t === tab ? '' : 'none'));
    if (tab === 'board') renderBoard();
  }

  window.addPlayer = addPlayer; window.delPlayer = delPlayer;
  window.startEvent = startEvent; window.nextRound = nextRound;
  window.openScore = openScore; window.saveScore = saveScore; window.closeScoreModal = closeScoreModal;
  window.finalize = finalize;
  window.renderBoard = renderBoard; window.exportBoardImg = exportBoardImg; window.clearBoard = clearBoard;
  window.show = show;

  if (!document.getElementById('eventDate').value) document.getElementById('eventDate').value = new Date().toISOString().slice(0, 10);
  const navMap = { setup: 'nav-setup', play: 'nav-play', board: 'nav-board', award: 'nav-award' };
  new MutationObserver(() => Object.keys(navMap).forEach(k => document.getElementById(navMap[k]).classList.toggle('active', $('tab-' + k).style.display !== 'none'))).observe(document.body, { attributes: true, subtree: true });
  load(); renderPlayers(); show('setup');
})();
