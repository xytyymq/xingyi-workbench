/* octa/app.js — 八人转（合并版：统一 Award 模块） */
(function () {
  'use strict';
  const E = window.OctaEngine, A = window.Award;
  const KEY = 'octaApp_v2';

  let S = load() || {
    players: [], cfg: { scoreMode: '21x1', handicapOn: true, date: '', venue: '九江·开发区' },
    matches: [], byeByRound: {}, started: false, tab: 'schedule'
  };

  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function uid(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 1800); }
  function $(id) { return document.getElementById(id); }
  function nameOf(id) { const p = S.players.find(x => x.id === id); return p ? p.name : id; }
  function genderOf(id) { const p = S.players.find(x => x.id === id); return p ? p.gender : ''; }

  function render() { if (!S.started) renderSetup(); else renderMain(); save(); }

  function renderSetup() {
    $('main').style.display = 'none';
    const setup = $('setup');
    const pl = S.players.map(p =>
      `<div class="pl"><span>${esc(p.name)} <span style="background:#0e1f14;border:1px solid var(--line);border-radius:20px;padding:2px 10px;font-size:12px;color:var(--sub)">${p.gender || '未知'}</span></span><button class="x" onclick="App.delPlayer('${p.id}')">×</button></div>`
    ).join('');
    setup.innerHTML = `
      <div class="card">
        <div class="field"><label>添加选手（到场签到，建议 5-8 人）</label>
          <div class="row">
            <input id="pname" placeholder="姓名" />
            <select id="pgender" style="flex:0 0 110px"><option value="男">男</option><option value="女">女</option></select>
            <button class="sm" style="flex:0 0 80px" onclick="App.addPlayer()">+ 添加</button>
          </div>
        </div>
        <div id="plist">${pl || '<div style="color:var(--sub);font-size:13px">还没有选手，先在上方添加（至少 4 人）</div>'}</div>
      </div>
      <div class="card">
        <div class="row">
          <div class="field" style="flex:1"><label>单局分制</label>
            <select id="cfgScore"><option value="21x1" ${S.cfg.scoreMode === '21x1' ? 'selected' : ''}>21 分</option><option value="31x1" ${S.cfg.scoreMode === '31x1' ? 'selected' : ''}>31 分</option></select>
          </div>
          <div class="field" style="flex:1"><label>性别让分</label>
            <select id="cfgHandi"><option value="1" ${S.cfg.handicapOn ? 'selected' : ''}>开启</option><option value="0" ${!S.cfg.handicapOn ? 'selected' : ''}>关闭</option></select>
          </div>
        </div>
        <div class="row">
          <div class="field" style="flex:1"><label>日期</label><input id="cfgDate" value="${S.cfg.date}"></div>
          <div class="field" style="flex:1"><label>地点</label><input id="cfgVenue" value="${S.cfg.venue}"></div>
        </div>
        <button class="primary" style="margin-top:8px;width:100%" onclick="App.start()" ${S.players.length < 4 ? 'disabled' : ''}>生成完整赛程</button>
        ${S.players.length < 4 ? '<div style="color:var(--gold);font-size:13px;text-align:center;margin-top:6px">还需 ' + (4 - S.players.length) + ' 人才能开赛</div>' : ''}
        <div style="color:var(--sub);font-size:12px;text-align:center;margin-top:8px">每人恰好与其他每人搭档一次，全 ${S.players.length >= 4 ? (S.players.length % 2 ? S.players.length : S.players.length - 1) : '?'} 轮</div>
      </div>`;
  }

  function renderMain() {
    $('setup').innerHTML = '';
    $('main').style.display = 'block';
    const tab = S.tab || 'schedule';
    $('main').innerHTML = `
      <div class="tabs">
        <button class="${tab === 'schedule' ? 'on' : ''}" onclick="App.switchTab('schedule')">赛程</button>
        <button class="${tab === 'standings' ? 'on' : ''}" onclick="App.switchTab('standings')">名次</button>
        <button class="${tab === 'award' ? 'on' : ''}" onclick="App.switchTab('award')">颁奖</button>
      </div>
      <div id="tabBody"></div>`;
    if (tab === 'schedule') renderSchedule();
    else if (tab === 'standings') renderStandings();
    else renderAward();
  }

  function renderSchedule() {
    const total = S.matches.length ? Math.max.apply(null, S.matches.map(m => m.round)) : 0;
    const scored = S.matches.filter(m => m.result).length;
    let html = `<div class="card" style="color:var(--sub);font-size:13px;text-align:center">共 ${total} 轮 · ${S.matches.length} 场 · 已录 ${scored} 场　${scored === S.matches.length ? '🏆 全部打完' : ''}</div>`;
    for (let r = 1; r <= total; r++) {
      const ms = S.matches.filter(m => m.round === r).sort((a, b) => (a.court || 0) - (b.court || 0));
      const byeId = S.byeByRound[r];
      html += `<div class="card"><h2 style="margin:0 0 8px;font-size:18px">第 ${r} 轮</h2>`;
      if (byeId) html += `<div style="color:var(--gold);font-size:13px;margin-bottom:8px">本轮轮空：${esc(nameOf(byeId))}</div>`;
      ms.forEach(m => html += matchCard(m));
      html += `</div>`;
    }
    $('tabBody').innerHTML = html;
  }

  function matchCard(m) {
    const aNames = m.a.map(nameOf).join(' / ');
    const bNames = m.b.map(nameOf).join(' / ');
    const aStart = m.aStart || 0, bStart = m.bStart || 0;
    let res = '';
    if (m.result) {
      const w = m.result.winner === 'a' ? aNames : bNames;
      res = `<div class="res">${esc(aNames)} ${m.result.aPoints} : ${m.result.bPoints} ${esc(bNames)}　胜：<b>${esc(w)}</b></div>`;
    }
    return `
      <div class="match">
        <div class="top"><span>${m.court ? '场地 ' + m.court : '无场地'}</span><span>${aStart || bStart ? '让分 ' + (aStart ? 'A+' + aStart : '') + (bStart ? ' B+' + bStart : '') : '平等'} · ${m.aType || ''}vs${m.bType || ''}</span></div>
        <div class="vs">
          <div class="team a"><div class="n">${esc(aNames)}</div>${aStart ? '<div class="s">起分 +' + aStart + '</div>' : ''}</div>
          <div class="mid">VS</div>
          <div class="team b"><div class="n">${esc(bNames)}</div>${bStart ? '<div class="s">起分 +' + bStart + '</div>' : ''}</div>
        </div>
        ${res}
        <div style="margin-top:8px"><button class="sm ${m.result ? 'ghost' : 'primary'}" onclick="App.openScore('${m.id}')">${m.result ? '修改比分' : '录分'}</button></div>
      </div>`;
  }

  function renderStandings() {
    const rk = E.ranking(S.players, S.matches);
    let html = '<div class="card"><table><thead><tr><th>#</th><th style="text-align:left">姓名</th><th>性别</th><th>胜</th><th>负</th><th>净胜分</th></tr></thead><tbody>';
    rk.forEach(r => {
      html += `<tr><td class="${r.rank === 1 ? 'rk1' : ''}">${r.rank}</td><td class="name">${esc(r.name)}</td><td>${r.gender || '-'}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.net}</td></tr>`;
    });
    html += '</tbody></table></div>';
    $('tabBody').innerHTML = html;
  }

  function renderAward() {
    const rk = E.ranking(S.players, S.matches);
    const top3 = rk.slice(0, 3);
    const svg = A.buildAwardSVG(top3, { title: '八人转 · 全员轮转赛', date: S.cfg.date, venue: '星羿羽毛球馆 · ' + (S.cfg.venue || ''), theme: 'octa', tag: '全员轮转 · 搭档不重样 · 以球会友' });
    $('tabBody').innerHTML = `
      <div class="card">
        <div style="color:var(--gold);font-weight:800;margin-bottom:8px">🏆 前三名颁奖图（自动填名 + 积分）</div>
        <img class="award-prev" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="颁奖图"/>
        <button class="primary" style="width:100%;margin-top:10px" onclick="App.downloadAward()">下载 PNG 发群</button>
        <button class="ghost" style="width:100%;margin-top:8px" onclick="App.resetAll()">重置本场</button>
      </div>`;
  }

  function addPlayer() {
    const n = $('pname').value.trim();
    if (!n) { toast('请输入姓名'); return; }
    S.players.push({ id: uid('p'), name: n, gender: $('pgender').value });
    $('pname').value = '';
    renderSetup();
  }
  function delPlayer(id) { S.players = S.players.filter(p => p.id !== id); renderSetup(); }

  function start() {
    S.cfg.scoreMode = $('cfgScore').value;
    S.cfg.handicapOn = $('cfgHandi').value === '1';
    S.cfg.date = $('cfgDate').value.trim();
    S.cfg.venue = $('cfgVenue').value.trim();
    if (S.players.length < 4) { toast('至少 4 人'); return; }
    const res = E.generateSchedule(S.players, { scoreMode: S.cfg.scoreMode, handicapOn: S.cfg.handicapOn });
    if (res.error) { toast(res.error); return; }
    res.matches.forEach(m => { m.id = uid('m'); });
    S.matches = res.matches;
    S.byeByRound = res.byeByRound || {};
    S.started = true;
    toast('已生成 ' + res.totalRounds + ' 轮完整赛程');
    render();
  }

  function openScore(id) {
    const m = S.matches.find(x => x.id === id); if (!m) return;
    const aNames = m.a.map(nameOf).join(' / ');
    const bNames = m.b.map(nameOf).join(' / ');
    const aStart = m.aStart || 0, bStart = m.bStart || 0;
    const box = $('modalBox');
    box.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:18px">录分 · 第 ${m.round} 轮</h2>
      <div style="color:var(--sub);font-size:13px">${m.court ? '场地 ' + m.court : ''} ${aStart || bStart ? '· 让分 A+' + aStart + ' B+' + bStart : '· 平等'}　（${E.RULES[S.cfg.scoreMode].name}）</div>
      <div style="margin:12px 0">
        <div style="font-weight:700">${esc(aNames)}</div>
        <input id="sa" type="number" value="${m.result ? m.result.aPoints : aStart}" style="margin-top:4px">
      </div>
      <div style="margin:12px 0">
        <div style="font-weight:700;text-align:right">${esc(bNames)}</div>
        <input id="sb" type="number" value="${m.result ? m.result.bPoints : bStart}" style="margin-top:4px">
      </div>
      <div class="row" style="margin-top:14px">
        <button class="ghost" onclick="App.closeModal()">取消</button>
        <button class="primary" onclick="App.saveScore('${id}')">保存</button>
      </div>`;
    $('modal').style.display = 'flex';
  }
  function closeModal() { $('modal').style.display = 'none'; }

  function saveScore(id) {
    const m = S.matches.find(x => x.id === id); if (!m) return;
    const aRaw = parseInt($('sa').value, 10), bRaw = parseInt($('sb').value, 10);
    if (isNaN(aRaw) || isNaN(bRaw)) { toast('请填完整比分'); return; }
    const err = E.validateGame(aRaw, bRaw, m.aStart, m.bStart, S.cfg.scoreMode);
    if (err) { toast(err); return; }
    const winner = aRaw > bRaw ? 'a' : 'b';
    m.result = { winner: winner, aPoints: aRaw, bPoints: bRaw };
    closeModal();
    render();
  }

  function switchTab(t) { S.tab = t; renderMain(); }
  function downloadAward() {
    const rk = E.ranking(S.players, S.matches);
    const svg = A.buildAwardSVG(rk.slice(0, 3), { title: '八人转 · 全员轮转赛', date: S.cfg.date, venue: '星羿羽毛球馆 · ' + (S.cfg.venue || ''), theme: 'octa', tag: '全员轮转 · 搭档不重样 · 以球会友' });
    A.downloadPNG(svg, '八人转颁奖_' + (S.cfg.date || '') + '.png');
  }
  function resetAll() {
    if (!confirm('确认重置本场？所有对阵与比分清空。')) return;
    S.matches = []; S.byeByRound = {}; S.started = false; S.tab = 'schedule';
    render();
  }

  function esc(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

  window.App = { addPlayer, delPlayer, start, openScore, closeModal, saveScore, switchTab, downloadAward, resetAll };
  render();
})();
