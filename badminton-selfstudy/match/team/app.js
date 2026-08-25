/* team/app.js — 团体赛（合并版：统一 Award 模块） */
(function () {
  'use strict';
  const E = window.TeamEngine, A = window.Award;
  const $ = id => document.getElementById(id);
  const STORE_KEY = 'team_state_v2';
  let S = null;

  function fresh() {
    return { mode: 'duel', teams: [], event: { items: ['MS', 'WS', 'MD', 'WD', 'XD'], rule: '21x1', handicapOn: true },
      fmt: 'league', ko: null, duel: null, league: { teams: [], results: [] } };
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s) S = s; } catch (e) {}
    if (!S) S = fresh();
    if (!S.event) S.event = { items: ['MS', 'WS', 'MD', 'WD', 'XD'], rule: '21x1', handicapOn: true };
  }

  function addTeam() {
    const name = $('tname').value.trim(); if (!name) return;
    S.teams.push({ id: 'T' + Date.now(), name, players: [] });
    $('tname').value = ''; save(); renderTeams();
  }
  function delTeam(id) { S.teams = S.teams.filter(t => t.id !== id); save(); renderTeams(); }
  function addPlayer(teamId) {
    const inp = $('pp_' + teamId); const name = inp.value.trim(); if (!name) return;
    const g = $('pg_' + teamId).value;
    const t = S.teams.find(x => x.id === teamId);
    t.players.push({ id: 'P' + Date.now() + Math.floor(Math.random() * 999), name, gender: g });
    inp.value = ''; save(); renderTeams();
  }
  function delPlayer(teamId, pid) { const t = S.teams.find(x => x.id === teamId); t.players = t.players.filter(p => p.id !== pid); save(); renderTeams(); }
  function renderTeams() {
    $('teamCount').textContent = S.teams.length;
    $('teamList').innerHTML = S.teams.map(t => `
      <div class="team">
        <div class="team-h"><b>${t.name}</b> <small>${t.players.length}人</small><a onclick="delTeam('${t.id}')">删除队伍</a></div>
        <div class="row-input" style="margin:8px 0">
          <input type="text" id="pp_${t.id}" placeholder="选手姓名">
          <select id="pg_${t.id}"><option value="男">男</option><option value="女">女</option></select>
          <button class="ghost" onclick="addPlayer('${t.id}')">+选手</button>
        </div>
        <div class="chips">${t.players.map(p => `<span class="chip">${p.name}<small>${p.gender}</small> <a onclick="delPlayer('${t.id}','${p.id}')">✕</a></span>`).join('')}</div>
      </div>`).join('');
    $('leagueTeams').innerHTML = S.teams.map(t =>
      `<label class="ck"><input type="checkbox" value="${t.id}" ${S.league.teams.includes(t.id) ? 'checked' : ''} onchange="toggleLeagueTeam('${t.id}')"> ${t.name}</label>`).join('');
  }
  function toggleLeagueTeam(id) {
    if (S.league.teams.includes(id)) S.league.teams = S.league.teams.filter(x => x !== id);
    else S.league.teams.push(id);
    save();
  }

  function renderItems() {
    const all = E.ITEM_DEFS;
    $('itemList').innerHTML = Object.keys(all).map(k =>
      `<label class="ck"><input type="checkbox" value="${k}" ${S.event.items.includes(k) ? 'checked' : ''} onchange="toggleItem('${k}')"> ${all[k].name}</label>`).join('');
    $('ruleSel').value = S.event.rule;
    $('handiSel').value = S.event.handicapOn ? '1' : '0';
  }
  function toggleItem(k) {
    if (S.event.items.includes(k)) S.event.items = S.event.items.filter(x => x !== k);
    else S.event.items.push(k);
    save();
  }

  function startDuel() {
    if (S.teams.length < 2) return alert('至少 2 支队伍');
    S.event.rule = $('ruleSel').value;
    S.event.handicapOn = $('handiSel').value === '1';
    const aId = $('duelA').value, bId = $('duelB').value;
    if (!aId || !bId || aId === bId) return alert('请选择两支不同队伍');
    const teamA = S.teams.find(t => t.id === aId), teamB = S.teams.find(t => t.id === bId);
    const res = E.generateMatches(teamA, teamB, S.event);
    if (res.error) return alert(res.error);
    if (res.warnings.length) alert('提醒：\n' + res.warnings.join('\n') + '\n（缺阵容的单项已跳过）');
    S.duel = { matches: res.matches, teamAId: aId, teamBId: bId };
    save(); renderDuel();
  }
  function recordDuel(mi) {
    const m = S.duel.matches[mi];
    const a = parseInt(prompt('A队(' + nameList(S.duel.teamAId, m.a) + ') 得分', ''), 10);
    const b = parseInt(prompt('B队(' + nameList(S.duel.teamBId, m.b) + ') 得分', ''), 10);
    if (isNaN(a) || isNaN(b)) return;
    const rule = E.RULES[S.event.rule];
    const err = E.validateGame(a, b, m.aStart, m.bStart, rule);
    if (err) return alert('比分非法：' + err);
    m.result = { winner: a > b ? 'a' : 'b', aPoints: a, bPoints: b };
    save(); renderDuel();
  }
  function renderDuel() {
    const teamA = S.teams.find(t => t.id === S.duel.teamAId);
    const teamB = S.teams.find(t => t.id === S.duel.teamBId);
    const done = S.duel.matches.filter(m => m.result);
    const total = S.duel.matches.length;
    $('duelBody').innerHTML = S.duel.matches.map((m, mi) => {
      const ra = nameList(S.duel.teamAId, m.a), rb = nameList(S.duel.teamBId, m.b);
      const ha = m.aStart ? `(让${m.aStart})` : '', hb = m.bStart ? `(让${m.bStart})` : '';
      const sc = m.result ? `<b>${m.result.aPoints}</b> : <b>${m.result.bPoints}</b> ✅` : `<button onclick="recordDuel(${mi})">录分</button>`;
      return `<div class="match"><span class="court">${m.itemName}</span><span class="ta">${ra}${ha}</span><span class="vs">VS</span><span class="tb">${rb}${hb}</span><span class="sc">${sc}</span></div>`;
    }).join('');
    if (done.length === total) {
      const r = E.scoreTeamMatch(teamA, teamB, S.duel.matches);
      let txt = `大比分 ${teamA.name} ${r.teamAScore} : ${r.teamBScore} ${teamB.name} — `;
      txt += r.winner === 'A' ? teamA.name + ' 胜' : r.winner === 'B' ? teamB.name + ' 胜' : '平局';
      $('duelResult').textContent = txt;
      $('duelAwardBtn').style.display = 'inline-block';
      const aPts = r.teamAScore > r.teamBScore ? 2 : r.teamAScore < r.teamBScore ? 0 : 1;
      const bPts = r.teamBScore > r.teamAScore ? 2 : r.teamBScore < r.teamAScore ? 0 : 1;
      if (!S._lastDuelKey || S._lastDuelKey !== S.duel.teamAId + S.duel.teamBId) {
        S.league.results.push({ aTeamId: S.duel.teamAId, bTeamId: S.duel.teamBId, aScore: r.teamAScore, bScore: r.teamBScore });
        S._lastDuelKey = S.duel.teamAId + S.duel.teamBId;
        save();
      }
    } else {
      $('duelResult').textContent = `已录 ${done.length}/${total}`;
      $('duelAwardBtn').style.display = 'none';
    }
  }
  function nameList(teamId, ids) {
    const t = S.teams.find(x => x.id === teamId);
    return ids.map(id => { const p = t.players.find(x => x.id === id); return p ? p.name : '?'; }).join('+');
  }
  function duelAward() {
    const teamA = S.teams.find(t => t.id === S.duel.teamAId);
    const teamB = S.teams.find(t => t.id === S.duel.teamBId);
    const r = E.scoreTeamMatch(teamA, teamB, S.duel.matches);
    const winner = r.winner === 'A' ? teamA : r.winner === 'B' ? teamB : null;
    const svg = A.buildAwardSVG(
      winner ? [{ name: winner.name, pts: r.winner === 'A' ? r.teamAScore : r.teamBScore, wins: r.teamAScore, losses: r.teamBScore }] : [],
      { title: '团体对抗赛 · 冠军', date: new Date().toISOString().slice(0, 10), theme: 'team', tag: '团结拼搏 · 以球会友' }
    );
    showSVG(svg, '团体赛_' + (winner ? winner.name : '平局'));
  }

  function renderLeague() {
    const teams = S.league.teams.map(id => S.teams.find(t => t.id === id)).filter(Boolean);
    const std = E.leagueStandings(teams, S.league.results);
    $('leagueBody').innerHTML = std.length ? std.map(r =>
      `<div class="row"><span class="rk">${r.rank}</span><span class="nm">${r.name}</span><span class="st">${r.pts}分 ｜ ${r.wins}胜${r.draws}平${r.losses}负 ｜ 净胜${r.gf - r.ga}</span></div>`).join('') : '<p class="muted">勾选参赛队伍后，在「两队对抗」里打完的比赛会自动计入这里。</p>';
    // 循环+淘汰：联赛有 ≥2 队战绩时显示「进入淘汰赛」
    $('leagueKoBar').style.display = (S.fmt === 'rrko' && std.length >= 2) ? '' : 'none';
  }
  function resetLeague() { if (confirm('清空联赛战绩（保留队伍）？')) { S.league.results = []; S._lastDuelKey = null; save(); renderLeague(); } }

  function pickTeamFmt(fmt) {
    S.fmt = fmt;
    document.querySelectorAll('#fmtPick .np').forEach(x => x.classList.toggle('on', x.dataset.fmt === fmt));
    const isKO = (fmt === 'rrko');
    $('fmtHint').textContent = isKO
      ? '先打完联赛排种子，再用队伍打单败 KO 决冠军。'
      : '多队之间打团体对抗，累计团队分，总分决定名次。';
    $('koSizeHint').style.display = isKO ? '' : 'none';
    save();
  }

  /* ---------- 队伍级淘汰赛 ---------- */
  let teamKO = { size: 8, rounds: [] };
  function enterTeamKO() {
    const teams = S.league.teams.map(id => S.teams.find(t => t.id === id)).filter(Boolean);
    const std = E.leagueStandings(teams, S.league.results);
    if (std.length < 2) { alert('联赛还没打完（至少 2 队有战绩）'); return; }
    const sizes = [2, 4, 8, 16, 32];
    let sz = teamKO.size;
    if (!sizes.includes(sz) || sz > std.length) sz = sizes.filter(s => s <= std.length).pop();
    const res = E.buildTeamKnockout(std, sz, S.event);
    if (res.error) { alert(res.error); return; }
    teamKO = { size: res.size, rounds: res.rounds };
    S.ko = teamKO;
    renderTeamKO();
    show('ko');
  }
  function pickTeamKO(sz) {
    const teams = S.league.teams.map(id => S.teams.find(t => t.id === id)).filter(Boolean);
    const std = E.leagueStandings(teams, S.league.results);
    if (sz > std.length) { alert(`只有 ${std.length} 队有战绩，最多 ${[2,4,8,16,32].filter(s=>s<=std.length).pop()} 强`); return; }
    teamKO.size = sz;
    document.querySelectorAll('#koSizePick .np').forEach(x => x.classList.toggle('on', +x.dataset.size === sz));
    $('koSize').textContent = sz;
    const res = E.buildTeamKnockout(std, sz, S.event);
    teamKO = { size: res.size, rounds: res.rounds };
    S.ko = teamKO;
    renderTeamKO();
  }
  function findTeamKOMatch(id) {
    for (const r of teamKO.rounds) { const m = r.matches.find(x => x.id === id); if (m) return m; }
    return null;
  }
  function renderTeamKO() {
    $('koSize').textContent = teamKO.size;
    $('koBracket').innerHTML = teamKO.rounds.map(r =>
      `<div class="ko-round"><h3>${r.name}</h3>${r.matches.map(m => teamKORowHtml(m)).join('')}</div>`
    ).join('');
  }
  function teamKORowHtml(m) {
    const aWin = m.result && m.result.winner === 'a';
    const bWin = m.result && m.result.winner === 'b';
    return `<div class="ko-match ${m.aTeamId && m.bTeamId ? '' : 'tbd'}">
      <span class="who ${aWin ? 'win' : ''}" style="min-width:90px">${m.aName || '待定'}</span>
      <span class="vs">VS</span>
      <span class="who ${bWin ? 'win' : ''}" style="min-width:90px">${m.bName || '待定'}</span>
      <button class="ko-win ${aWin ? 'on' : ''}" onclick="teamKOWin('${m.id}','a')">A胜</button>
      <button class="ko-win ${bWin ? 'on' : ''}" onclick="teamKOWin('${m.id}','b')">B胜</button>
    </div>`;
  }
  function teamKOWin(id, who) {
    const m = findTeamKOMatch(id);
    if (!m) return;
    if (!m.aTeamId || !m.bTeamId) { alert('这场对手还没确定（上游未出结果）'); return; }
    m.result = { winner: who };
    // 晋级：胜者队伍回填下游
    const winner = who === 'a' ? { id: m.aTeamId, name: m.aName } : { id: m.bTeamId, name: m.bName };
    const next = teamKO.rounds.flatMap(r => r.matches).find(x => x.fromA === m.id || x.fromB === m.id);
    if (next) {
      if (next.fromA === m.id) { next.aTeamId = winner.id; next.aName = winner.name; }
      else { next.bTeamId = winner.id; next.bName = winner.name; }
    }
    save();
    renderTeamKO();
  }
  function teamKOFinish() {
    const all = teamKO.rounds.flatMap(r => r.matches);
    const unfinished = all.filter(m => !m.result);
    if (unfinished.length) { alert(`还有 ${unfinished.length} 场淘汰赛没录`); return; }
    const finalM = teamKO.rounds[teamKO.rounds.length - 1].matches[0];
    const semi = teamKO.rounds.length >= 2 ? teamKO.rounds[teamKO.rounds.length - 2].matches : [];
    const champ = finalM.result.winner === 'a' ? finalM.aName : finalM.bName;
    const runner = finalM.result.winner === 'a' ? finalM.bName : finalM.aName;
    const thirds = semi.map(sm => sm.result.winner === 'a' ? sm.bName : sm.aName);
    alert(`🏆 冠军：${champ}\n🥈 亚军：${runner}\n🥉 季军：${thirds.join('、') || '—'}`);
    show('league');
  }

  let lastSVG = '';
  function showSVG(svg, fname) {
    lastSVG = svg; $('svgPreview').innerHTML = svg;
    $('svgDownload').onclick = () => A.downloadPNG(svg, (fname || 'award') + '.png');
    show('award');
  }

  function show(tab) {
    ['setup', 'duel', 'league', 'award', 'ko'].forEach(t => $('tab-' + t).style.display = (t === tab ? '' : 'none'));
    if (tab === 'league') renderLeague();
    if (tab === 'ko') renderTeamKO();
  }

  window.addTeam = addTeam; window.delTeam = delTeam;
  window.addPlayer = addPlayer; window.delPlayer = delPlayer;
  window.toggleLeagueTeam = toggleLeagueTeam;
  window.renderItems = renderItems; window.toggleItem = toggleItem;
  window.startDuel = startDuel; window.recordDuel = recordDuel; window.duelAward = duelAward;
  window.resetLeague = resetLeague;
  window.show = show;
  window.pickTeamFmt = pickTeamFmt;
  window.enterTeamKO = enterTeamKO;
  window.pickTeamKO = pickTeamKO;
  window.teamKOWin = teamKOWin;
  window.teamKOFinish = teamKOFinish;

  if (!document.getElementById('duelA').innerHTML.includes('option')) {
    // 初始化下拉
  }
  const fillSelects = () => {
    const a = document.getElementById('duelA'), b = document.getElementById('duelB');
    if (!a || !b) return;
    const opt = t => `<option value="${t.id}">${t.name}</option>`;
    a.innerHTML = '<option value="">选择 A 队</option>' + S.teams.map(opt).join('');
    b.innerHTML = '<option value="">选择 B 队</option>' + S.teams.map(opt).join('');
  };
  new MutationObserver(fillSelects).observe(document.getElementById('teamList'), { childList: true, subtree: true });
  load(); renderTeams(); renderItems(); fillSelects();
  // 恢复赛制选择
  if (!S.fmt) S.fmt = 'league';
  document.querySelectorAll('#fmtPick .np').forEach(x => x.classList.toggle('on', x.dataset.fmt === S.fmt));
  $('fmtHint').textContent = (S.fmt === 'rrko')
    ? '先打完联赛排种子，再用队伍打单败 KO 决冠军。'
    : '多队之间打团体对抗，累计团队分，总分决定名次。';
  $('koSizeHint').style.display = (S.fmt === 'rrko') ? '' : 'none';
  document.querySelectorAll('#fmtPick .np').forEach(x =>
    x.addEventListener('click', () => pickTeamFmt(x.dataset.fmt)));
  document.querySelectorAll('#koSizePick .np').forEach(x =>
    x.addEventListener('click', () => {
      document.querySelectorAll('#koSizePick .np').forEach(y => y.classList.toggle('on', y === x));
      pickTeamKO(+x.dataset.size);
    }));
  if (S.ko && S.ko.rounds) { teamKO = S.ko; }
  show('setup');
})();
