/* app.js — 常规赛 界面逻辑（IIFE 隔离）
 *
 * 流程：① 报名 → ② 搭子 → ③ 分组 → ④ 单项+赛制 → ⑤ 对阵录分 → ⑥ 名次颁奖
 * 搭子和分组都做了，下次来接着办不用重新走。
 */
(function () {
  'use strict';
  const E = window.RegularEngine;
  const A = window.Award;
  const THEME = 'regular';
  const STORAGE_KEY = 'regular.draft.v1';

  const S = {
    players: [],
    pairSelected: [],          // 搭子页点选中的 playerId（最多 2 个）
    pairs: [],                 // [{id,item,a:[id,id],aNames:[...]}]
    groups: [],                // [{name,pairIds:[]}]
    groupMode: 'random',       // random | autoN | manual
    groupAutoN: 2,
    manualAssignments: {},     // { pairId: 'A'|.. }
    cfg: { items: ['MD', 'WD', 'XD'], scoreMode: '21x1', handicapOn: true, format: 'rr' },
    matches: [],
    standings: [],
    ko: null                 // { size, rounds:[{name, matches:[{id,round,a,b,aStart,bStart,result,fromA,fromB}]}] }
  };

  const $ = id => document.getElementById(id);
  function toast(m) { alert(m); }
  function pid() { return 'p' + Math.random().toString(36).slice(2, 9); }
  function prid() { return 'pr' + Math.random().toString(36).slice(2, 9); }

  /* ---------------- 持久化（草稿保留） ---------------- */
  function saveDraft() {
    try {
      const slim = {
        players: S.players,
        pairs: S.pairs,
        groups: S.groups,
        groupMode: S.groupMode,
        groupAutoN: S.groupAutoN,
        manualAssignments: S.manualAssignments,
        cfg: S.cfg,
        matches: S.matches,
        ko: S.ko
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch (e) { /* ignore quota */ }
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d) return;
      Object.assign(S, d);
    } catch (e) { /* ignore */ }
  }
  function clearDraft() { localStorage.removeItem(STORAGE_KEY); }

  /* ---------------- 步骤切 ---------------- */
  function goStep(n) {
    ['stepSignup', 'stepPair', 'stepGroup', 'stepConfig', 'stepMatch', 'stepRank', 'stepKO']
      .forEach((s, i) => { const el = $(s); if (el) el.style.display = (i === n) ? '' : 'none'; });
    saveDraft();
  }
  function visibleStep() {
    const all = ['stepSignup', 'stepPair', 'stepGroup', 'stepConfig', 'stepMatch', 'stepRank', 'stepKO'];
    for (let i = 0; i < all.length; i++) {
      const el = $(all[i]);
      if (el && el.style.display !== 'none') return i;
    }
    return 0;
  }

  /* ---------------- ① 报名 ---------------- */
  function addPlayer() {
    const name = $('pName').value.trim();
    const gender = $('pGender').value;
    if (!name) { toast('填个名字'); return; }
    S.players.push({ id: pid(), name, gender });
    $('pName').value = '';
    renderPlayers();
    saveDraft();
  }

  function renderPlayers() {
    const box = $('playerList');
    if (S.players.length === 0) { box.innerHTML = '<p class="muted">还没人报名</p>'; }
    else {
      box.innerHTML = S.players.map(p =>
        `<div class="rank-row"><div class="rk" style="background:#13362c;color:var(--sub)">${p.gender}</div>
         <div class="nm">${escapeHtml(p.name)}</div>
         <button class="winbtn" onclick="RA.removePlayer('${p.id}')">删</button></div>`
      ).join('');
    }
    $('goPair').style.display = S.players.length >= 2 ? '' : 'none';
  }

  function removePlayer(id) {
    S.players = S.players.filter(p => p.id !== id);
    S.pairs = E.removePair(S.pairs, id); // 同时清掉占用这人的搭子
    S.manualAssignments = {};
    S.groups = [];
    renderPlayers();
    saveDraft();
  }

  /* ---------------- ② 搭子 ---------------- */
  function renderPairPage() {
    const used = {};
    S.pairs.forEach(pr => { pr.a.forEach(id => used[id] = true); });
    const free = S.players.filter(p => !used[p.id]);
    $('waitMale').innerHTML = free.filter(p => p.gender === '男').map(p => chipHtml(p, used)).join('') ||
      '<span style="color:var(--sub);font-size:12px">（无未配对男选手）</span>';
    $('waitFemale').innerHTML = free.filter(p => p.gender === '女').map(p => chipHtml(p, used)).join('') ||
      '<span style="color:var(--sub);font-size:12px">（无未配对女选手）</span>';
    renderPairBuckets();
    renderPairErr();
  }

  function chipHtml(p, used) {
    const sel = S.pairSelected.includes(p.id);
    const cls = p.gender === '男' ? 'male' : 'female';
    return `<span class="wait-chip ${cls}${sel ? ' selected' : ''}" onclick="RA.toggleChip('${p.id}')">${p.gender}·${escapeHtml(p.name)}</span>`;
  }

  function toggleChip(id) {
    if (S.pairSelected.includes(id)) {
      S.pairSelected = S.pairSelected.filter(x => x !== id);
    } else if (S.pairSelected.length >= 2) {
      toast('最多选两个；先取消一个');
      return;
    } else {
      S.pairSelected.push(id);
    }
    if (S.pairSelected.length === 2) {
      tryMakePair();
    }
    renderPairPage();
  }

  function tryMakePair() {
    const [aId, bId] = S.pairSelected;
    const res = E.makePairs(S.players, [{ aId, bId }]);
    if (res.errors.length) { alert(res.errors.join('\n')); }
    else {
      const p = res.pairs[0];
      p.id = prid();
      S.pairs.push(p);
      S.manualAssignments = {};
      S.groups = [];
    }
    S.pairSelected = [];
  }

  function removeOnePair(id) {
    S.pairs = S.pairs.filter(p => p.id !== id);
    if (S.manualAssignments[id]) delete S.manualAssignments[id];
    S.groups = [];
    renderPairPage();
    saveDraft();
  }

  function renderPairBuckets() {
    const labels = { MD: '男双', WD: '女双', XD: '混双' };
    const buckets = { MD: [], WD: [], XD: [] };
    S.pairs.forEach(p => buckets[p.item].push(p));
    const html = ['MD', 'WD', 'XD'].map(item => {
      if (buckets[item].length === 0) return '';
      const rows = buckets[item].map(p =>
        `<div class="pair-row"><div class="nm">${escapeHtml(p.aNames.join(' + '))}</div>
         <button class="del" onclick="RA.removeOnePair('${p.id}')">删</button></div>`
      ).join('');
      return `<div class="pair-bucket"><h3>${labels[item]} <span class="ct">${buckets[item].length} 对</span></h3>${rows}</div>`;
    }).join('');
    $('pairBuckets').innerHTML = html ||
      '<p class="muted" style="font-size:13px">还没搭子，先点选两位选手配对，或点「自动搭伙」让系统按性别凑。</p>';
  }

  function renderPairErr() {
    const used = {};
    S.pairs.forEach(pr => { pr.a.forEach(id => used[id] = true); });
    const free = S.players.filter(p => !used[p.id]);
    const box = $('pairErr');
    if (free.length) {
      box.style.display = ''; box.textContent =
        `还有 ${free.length} 人未配对：${free.map(p => p.name).join('、')}。勾选两位继续，或退一步改名单。`;
    } else if (S.pairs.length) {
      box.style.display = ''; box.className = 'ok'; box.textContent = `共 ${S.pairs.length} 对搭子，可继续。`;
    } else {
      box.style.display = 'none';
    }
  }

  function autoPair() {
    if (!S.players.length) return;
    S.pairs = [];
    S.manualAssignments = {};
    S.groups = [];
    const males = S.players.filter(p => p.gender === '男');
    const females = S.players.filter(p => p.gender === '女');
    const cfgs = [];
    const tmpM = males.slice();
    const tmpF = females.slice();
    // 男双
    while (tmpM.length >= 2) { cfgs.push({ aId: tmpM[0].id, bId: tmpM[1].id }); tmpM.splice(0, 2); }
    // 女双
    while (tmpF.length >= 2) { cfgs.push({ aId: tmpF[0].id, bId: tmpF[1].id }); tmpF.splice(0, 2); }
    // 混双（剩男剩女凑）
    while (tmpM.length && tmpF.length) { cfgs.push({ aId: tmpM[0].id, bId: tmpF[0].id }); tmpM.shift(); tmpF.shift(); }
    const res = E.makePairs(S.players, cfgs);
    res.pairs.forEach((p, i) => p.id = 'pr' + (i + 1));
    S.pairs = res.pairs;
    renderPairPage();
    saveDraft();
    const leftover = tmpM.length + tmpF.length;
    if (leftover) {
      toast(`自动搭伙完成，余 ${leftover} 人没法凑成对（性别比例不均），已加入未配对提示。`);
    }
  }

  function clearPairs() {
    if (!S.pairs.length) return;
    if (!confirm('清空所有搭子？')) return;
    S.pairs = []; S.manualAssignments = {}; S.groups = [];
    S.pairSelected = [];
    renderPairPage(); saveDraft();
  }

  /* ---------------- ③ 分组 ---------------- */
  // ④ 赛制选择（开赛前）：循环 / 淘汰 / 循环+淘汰
  function pickFmt(fmt) {
    S.cfg.format = fmt;
    document.querySelectorAll('#fmtPick .np').forEach(x =>
      x.classList.toggle('on', x.dataset.fmt === fmt));
    const isRR = (fmt === 'rr' || fmt === 'rrko');
    const isKO = (fmt === 'ko' || fmt === 'rrko');
    $('fmtRR').style.display = isRR ? '' : 'none';
    $('koSizeHint').style.display = isKO ? '' : 'none';
    // 纯淘汰：跳过分组步骤无意义，但流程里 ③ 分组页仍存在；这里仅控 UI，生成时再分支
    const hints = {
      rr: '小组循环：搭子分组打循环，按积分排名次。',
      ko: '单淘汰：直接用全部搭子建单败树，胜者晋级决冠军（跳过小组循环）。',
      rrko: '先小组循环排种子，再单败淘汰决冠军。'
    };
    $('fmtHint').textContent = hints[fmt] || '';
    saveDraft();
  }

  function switchGroupMode(mode) {
    S.groupMode = mode;
    document.querySelectorAll('.tab-row .tab').forEach(t => {
      t.classList.toggle('on', t.dataset.mode === mode);
    });
    ['groupRandom', 'groupAutoN', 'groupManual'].forEach((n, i) => {
      $(n).style.display = ['random', 'autoN', 'manual'].indexOf(mode) === i ? '' : 'none';
    });
    if (mode === 'manual') renderManual();
    // 进分组页 / 切 tab 即自动生成分组预览，避免「只切 tab 没点生成」导致下一步无分组
    regenGroups();
  }

  function regenGroups() {
    if (!S.pairs.length) { S.groups = []; renderGroupResult([]); return; }
    if (S.groupMode === 'random') doRandom(true);
    else if (S.groupMode === 'autoN') doAutoN(true);
    else if (S.groupMode === 'manual') setManualFromAssignments();
  }

  // 计算最多能分几组（保证每组每单项 ≥2 对才能循环赛）
  function calcMaxN() {
    const cnt = { MD: 0, WD: 0, XD: 0 };
    S.pairs.forEach(p => cnt[p.item]++);
    const active = S.cfg.items && S.cfg.items.length ? S.cfg.items : ['MD', 'WD', 'XD'];
    const mins = active.map(it => cnt[it]).filter(c => c > 0);
    if (!mins.length) return 1;
    return Math.max(1, Math.floor(Math.min(...mins) / 2));
  }

  function doRandom(silent) {
    if (!S.pairs.length) { if (!silent) toast('先配搭子'); return; }
    let n = (S.pairs.length >= 7) ? 3 : 2;
    const maxN = calcMaxN();
    if (n > maxN) { n = maxN; if (!silent) toast(`单项搭子不足，已自动调为 ${n} 组`); }
    const res = E.assignGroups(S.pairs, 'random', { n });
    S.groups = res.groups; renderGroupResult(res.warnings);
    saveDraft();
  }

  function pickN(n) {
    S.groupAutoN = n;
    document.querySelectorAll('#nPick .np').forEach(x => x.classList.toggle('on', +x.dataset.n === n));
    if (S.groupMode === 'autoN') doAutoN(true);
  }

  function doAutoN(silent) {
    if (!S.pairs.length) { if (!silent) toast('先配搭子'); return; }
    const maxN = calcMaxN();
    let n = S.groupAutoN;
    if (n > maxN) { n = maxN; if (!silent) toast(`单项搭子不足，已自动调为 ${n} 组`); }
    const res = E.assignGroups(S.pairs, 'autoN', { n });
    S.groups = res.groups; renderGroupResult(res.warnings);
    saveDraft();
  }

  function setManualFromAssignments() {
    // manual 模式下按当前 assignments 自动生成分组（未选的归「未分组」）
    const res = E.assignGroups(S.pairs, 'manual', {
      assignments: S.manualAssignments,
      groupNames: ['A', 'B', 'C', 'D', 'E', 'F']
    });
    S.groups = res.groups; renderGroupResult(res.warnings);
    saveDraft();
  }

  function renderManual() {
    const html = S.pairs.map(pr =>
      `<div class="pair-row"><div class="nm">${escapeHtml(pr.aNames.join(' + '))} <span class="pill">${pr.item}</span></div>
       <select onchange="RA.setManual('${pr.id}', this.value)" style="padding:6px;border-radius:8px;background:#0d1f1a;color:var(--txt);border:1px solid var(--line)">
         ${['A','B','C','D','E','F'].map(g => `<option value="${g}" ${S.manualAssignments[pr.id] === g ? 'selected' : ''}>${g} 组</option>`).join('')}
       </select>
       </div>`
    ).join('');
    $('manualRows').innerHTML = html || '<p class="muted">还没搭子</p>';
  }

  function setManual(prid, g) {
    S.manualAssignments[prid] = g;
    setManualFromAssignments();
  }

  function renderGroupResult(warnings) {
    warnings = warnings || [];
    const html = [];
    if (warnings.length) html.push(warnings.map(w => `<div class="warn">⚠ ${escapeHtml(w)}</div>`).join(''));
    if (!S.groups.length) {
      html.push('<p class="muted">还没有分组结果</p>');
    } else {
      S.groups.forEach(g => {
        const itemLines = {};
        g.pairIds.forEach(pid => {
          const pr = S.pairs.find(x => x.id === pid); if (!pr) return;
          itemLines[pr.item] = itemLines[pr.item] || [];
          itemLines[pr.item].push(pr.aNames.join('+'));
        });
        const lines = Object.keys(itemLines).map(item =>
          `<div class="item-line">· ${item}：${escapeHtml(itemLines[item].join(' / '))}</div>`
        ).join('');
        html.push(`<div class="group-card"><h4>${g.name} 组 · 共 ${g.pairIds.length} 对</h4>${lines}</div>`);
      });
    }
    $('groupResult').innerHTML = html.join('');
  }

  /* ---------------- ④ 单项+赛制 → ⑤ 对阵 ---------------- */
  function genMatches() {
    S.cfg.scoreMode = $('cfgScore').value;
    S.cfg.handicapOn = $('cfgHandi').value === 'on';

    // —— 纯淘汰赛：跳过循环，直接用搭子建单败树 ——
    if (S.cfg.format === 'ko') {
      if (!S.pairs.length) { toast('先配搭子'); return; }
      // 淘汰赛用全部搭子当种子（无循环排名时按报名顺序），取 2 的幂
      const size = currentKOConfigSize();
      // 构造 standings 形态（id/name 用 pair 表示）
      const seedList = S.pairs.map((p, i) => ({
        id: p.id, name: p.aNames.join(' + '), gender: p.item, wins: 0, losses: 0, net: 0, rank: i + 1
      }));
      const res = E.buildKnockout(seedList, size, {
        rule: S.cfg.scoreMode, handicapOn: S.cfg.handicapOn
      });
      if (res.error) { toast(res.error); return; }
      S.ko = { size: res.size, rounds: res.rounds, seedIsPair: true, seedList };
      S.matches = []; S.standings = [];
      renderKO();
      goStep(6); // 直接进入淘汰赛页
      return;
    }

    // —— 循环 / 循环+淘汰：先生成小组循环对阵 ——
    const items = Array.from(document.querySelectorAll('#itemChecks input:checked')).map(c => c.value);
    if (items.length === 0) { toast('至少勾一个单项'); return; }
    S.cfg.items = items;
    if (!S.groups.length) {
      regenGroups();
      if (!S.groups.length) return toast('请先在分组页确认分组');
    }
    const filteredPairs = S.pairs
      .map(p => S.cfg.items.includes(p.item) ? p : null)
      .filter(Boolean);
    const res = E.generateMatches(filteredPairs, S.groups, {
      rule: S.cfg.scoreMode,
      handicapOn: S.cfg.handicapOn
    });
    if (res.error) { toast(res.error); return; }
    S.matches = res.matches;
    $('warnBox').innerHTML = (res.warnings || []).map(w => `<div class="warn">⚠ ${escapeHtml(w)}</div>`).join('');
    renderMatches();
    goStep(4);
  }

  // 淘汰赛规模：取不超过种子数且最大的 2 的幂
  function currentKOConfigSize() {
    const seedCount = (S.cfg.format === 'ko') ? S.pairs.length : (S.standings.length || S.pairs.length);
    const sizes = [2, 4, 8, 16, 32];
    const picked = sizes.filter(s => s <= Math.max(2, seedCount)).pop();
    // 优先用 UI 选中的（若不超过种子数）
    const uiSize = parseInt($('koSizePick2') ? $('koSizePick2').dataset.size : 0, 10);
    if (uiSize && uiSize <= seedCount) return uiSize;
    return picked;
  }

  function nameOf(id) {
    const p = S.players.find(x => x.id === id);
    if (p) return p.name;
    for (const pr of S.pairs) if (pr.a.includes(id)) {
      return pr.aNames[pr.a.indexOf(id)];
    }
    return '?';
  }

  /* 对阵状态：未录分='pending'；录了分但未到封顶='live'；已到封顶或 winner 落定='done' */
  function matchStatus(m) {
    if (!m.result) return 'pending';
    const rule = E.RULES[S.cfg.scoreMode] || E.RULES['21x1'];
    const cap = rule.cap || 21;
    const a = m.result.aPoints, b = m.result.bPoints;
    const aWin = a >= cap && (a - b) >= 2;
    const bWin = b >= cap && (b - a) >= 2;
    return (aWin || bWin) ? 'done' : 'live';
  }

  function rowHtml(m, i) {
    const aNames = m.a.map(nameOf).join(' + ');
    const bNames = m.b.map(nameOf).join(' + ');
    const w = m.result ? m.result.winner : '';
    return `<div class="court-row">
      <span class="vs">台${m.court}<br>${escapeHtml(m.itemName)}<br><span style="color:var(--accent)">${escapeHtml(m.groupName)}组</span></span>
      <div class="pair"><b>${escapeHtml(aNames)}</b> <span class="handi">${m.aStart ? '+' + m.aStart : ''}</span></div>
      <input id="a${i}" type="number" value="${m.result ? m.result.aPoints : ''}" placeholder="分">
      <span class="vs">:</span>
      <input id="b${i}" type="number" value="${m.result ? m.result.bPoints : ''}" placeholder="分">
      <div class="pair"><b>${escapeHtml(bNames)}</b> <span class="handi">${m.bStart ? '+' + m.bStart : ''}</span></div>
      <button class="winbtn ${w === 'a' ? 'on' : ''}" onclick="RA.setWin(${i},'a')">A胜</button>
      <button class="winbtn ${w === 'b' ? 'on' : ''}" onclick="RA.setWin(${i},'b')">B胜</button>
    </div>`;
  }

  function courtPlanRow(m, i) {
    const aNames = m.a.map(nameOf).join(' + ');
    const bNames = m.b.map(nameOf).join(' + ');
    const st = matchStatus(m);
    const stCls = st === 'done' ? ' done' : st === 'live' ? ' live' : '';
    const score = m.result
      ? `<span class="cp-sc ${m.result.winner === 'a' ? 'aw' : ''}">${m.result.aPoints}</span> : <span class="cp-sc ${m.result.winner === 'b' ? 'aw' : ''}">${m.result.bPoints}</span>`
      : '<span class="cp-vs">VS</span>';
    const ha = m.aStart ? `<span class="cp-handi">+${m.aStart}</span>` : '';
    const hb = m.bStart ? `<span class="cp-handi">+${m.bStart}</span>` : '';
    return `<div class="cp-row${stCls}" onclick="document.getElementById('a${i}') && document.getElementById('a${i}').focus()">
      <span class="cp-court">台${m.court}</span>
      <span class="cp-meta">${escapeHtml(m.itemName)} · ${escapeHtml(m.groupName)}组</span>
      <span class="cp-team">${escapeHtml(aNames)}${ha}</span>
      <span class="cp-score">${score}</span>
      <span class="cp-team cp-right">${escapeHtml(bNames)}${hb}</span>
    </div>`;
  }

  function sectionHtml(title, count, rows, opts) {
    opts = opts || {};
    const folded = opts.folded ? ' folded' : '';
    return `<div class="match-section${folded}">
      <div class="match-section-head" onclick="this.parentNode.classList.toggle('folded')">
        <span class="title-dot" style="background:${opts.color || 'var(--accent)'}"></span>
        <b>${title}</b><span class="ct">${count} 场</span>
        <span class="chev">${opts.folded ? '▸' : '▾'}</span>
      </div>
      <div class="match-section-body">${rows.join('') || '<p class="muted" style="padding:10px">（无）</p>'}</div>
    </div>`;
  }

  function renderMatches() {
    if (!S.matches.length) { $('matchList').innerHTML = '<p class="muted">还没生成对阵</p>'; return; }

    // 重新计算全局索引（setWin 用到）— 用稳定 i 而不是分组后的 i
    const indexed = S.matches.map((m, i) => ({ m, i }));
    const pending = indexed.filter(x => matchStatus(x.m) === 'pending');
    const live    = indexed.filter(x => matchStatus(x.m) === 'live');
    const done    = indexed.filter(x => matchStatus(x.m) === 'done');

    // 📋 全场对阵 · 场地总览（一眼看清所有搭子+台号，便于排场地）
    const plan = `<div class="court-plan">
      <div class="cp-head">📋 全场对阵 · 场地安排 <span class="ct">共 ${indexed.length} 场</span></div>
      ${indexed.map(x => courtPlanRow(x.m, x.i)).join('')}
    </div>`;

    // ⏭ 下一场：取 pending 第一场（按台号/对阵自然顺序）
    let nextCard = '';
    if (pending.length) {
      const { m, i } = pending[0];
      const aNames = m.a.map(nameOf).join(' + ');
      const bNames = m.b.map(nameOf).join(' + ');
      nextCard = `<div class="next-card" onclick="document.getElementById('a${i}') && document.getElementById('a${i}').focus()">
        <div class="nx">⏭ 下一场</div>
        <div class="info">
          <span class="badge">台${m.court}</span>
          <span class="badge">${escapeHtml(m.itemName)}</span>
          <span class="badge grp">${escapeHtml(m.groupName)}组</span>
          <span class="vs2"><b>${escapeHtml(aNames)}</b> VS <b>${escapeHtml(bNames)}</b></span>
        </div>
        <div class="hint">点击直接录分 ↑</div>
      </div>`;
    }

    const parts = [];
    parts.push(plan);
    parts.push(nextCard);
    if (pending.length) parts.push(sectionHtml('待赛', pending.length, pending.map(x => rowHtml(x.m, x.i)), { color: 'var(--accent)' }));
    if (live.length)    parts.push(sectionHtml('进行中', live.length, live.map(x => rowHtml(x.m, x.i)),    { color: '#f5b342' }));
    if (done.length)    parts.push(sectionHtml('已结束', done.length, done.map(x => rowHtml(x.m, x.i)),    { color: '#5fb87a', folded: true }));

    $('matchList').innerHTML = parts.join('');
  }

  function setWin(i, who) {
    const aRaw = parseInt($('a' + i).value, 10);
    const bRaw = parseInt($('b' + i).value, 10);
    if (isNaN(aRaw) || isNaN(bRaw)) { toast('先填双方比分'); return; }
    const m = S.matches[i];
    const rule = E.RULES[S.cfg.scoreMode];
    const err = E.validateGame(aRaw, bRaw, m.aStart, m.bStart, rule);
    if (err) { toast(err); return; }
    m.result = { winner: who, aPoints: aRaw, bPoints: bRaw };
    renderMatches();
  }

  /* ---------------- ⑥ 名次+颁奖 ---------------- */
  function finish() {
    const unfinished = S.matches.filter(m => !m.result);
    if (unfinished.length) { toast(`还有 ${unfinished.length} 场没录分`); return; }
    S.standings = E.computeStandings(S.players, S.matches);
    renderRank();
    // 循环+淘汰：显示「进入淘汰赛」；纯循环：隐藏
    $('koBtn').style.display = (S.cfg.format === 'rrko') ? '' : 'none';
    goStep(5);
  }

  /* ---------------- ⑦ 淘汰赛（单败 KO） ---------------- */
  let koSize = 16;

  function enterKO() {
    if (!S.standings.length) { toast('先结算循环赛名次'); return; }
    const avail = S.standings.length;
    const sizes = [2, 4, 8, 16, 32];
    if (!sizes.includes(koSize) || koSize > avail) {
      koSize = sizes.filter(s => s <= avail).pop() || 2;
    }
    $('koSize').textContent = koSize;
    document.querySelectorAll('#koSizePick .np').forEach(x =>
      x.classList.toggle('on', +x.dataset.size === koSize));
    buildKO();
    goStep(6);
  }

  function buildKO() {
    const seedList = (S.ko && S.ko.seedIsPair) ? S.ko.seedList : S.standings;
    const res = E.buildKnockout(seedList, koSize, {
      rule: S.cfg.scoreMode,
      handicapOn: S.cfg.handicapOn
    });
    if (res.error) { toast(res.error); return; }
    S.ko = { size: res.size, rounds: res.rounds, seedIsPair: !!(S.ko && S.ko.seedIsPair), seedList };
    renderKO();
    saveDraft();
  }

  function pickKO(fromSize) {
    const avail = S.standings.length;
    const sizes = [2, 4, 8, 16, 32];
    let sz = +fromSize;
    if (sz > avail) { toast(`只有 ${avail} 人完成循环赛，最多 ${sizes.filter(s => s <= avail).pop()} 强`); return; }
    koSize = sz;
    document.querySelectorAll('#koSizePick .np').forEach(x =>
      x.classList.toggle('on', +x.dataset.size === koSize));
    $('koSize').textContent = koSize;
    buildKO();
  }

  function findKOMatch(id) {
    for (const r of S.ko.rounds) {
      const m = r.matches.find(x => x.id === id);
      if (m) return m;
    }
    return null;
  }

  function renderKO() {
    if (!S.ko) { $('koBracket').innerHTML = '<p class="muted">还没有淘汰赛</p>'; return; }
    const html = S.ko.rounds.map(r => {
      const rows = r.matches.map(m => koRowHtml(m)).join('');
      return `<div class="ko-round"><h3>${r.name}</h3>${rows}</div>`;
    }).join('');
    $('koBracket').innerHTML = html;
  }

  function koRowHtml(m) {
    const aWin = m.result && m.result.winner === 'a';
    const bWin = m.result && m.result.winner === 'b';
    const aTxt = m.a ? m.a.name : '待定';
    const bTxt = m.b ? m.b.name : '待定';
    const tbd = (!m.a || !m.b) ? ' tbd' : '';
    // 种子序号：纯淘汰用 seedList；循环+淘汰用 standings
    const seedArr = (S.ko && S.ko.seedIsPair) ? S.ko.seedList : S.standings;
    const aSeed = m.a ? (seedArr.findIndex(s => s.id === m.a.id) + 1) : '';
    const bSeed = m.b ? (seedArr.findIndex(s => s.id === m.b.id) + 1) : '';
    return `<div class="ko-match${tbd}">
      <span class="seed">${aSeed ? '#' + aSeed : ''}</span>
      <span class="who ${aWin ? 'win' : ''}">${escapeHtml(aTxt)}</span>
      <input id="koa_${m.id}" type="number" value="${m.result ? m.result.aPoints : ''}" placeholder="分">
      <span class="vs">:</span>
      <input id="kob_${m.id}" type="number" value="${m.result ? m.result.bPoints : ''}" placeholder="分">
      <span class="who ${bWin ? 'win' : ''}">${escapeHtml(bTxt)}</span>
      <span class="seed">${bSeed ? '#' + bSeed : ''}</span>
      <button class="ko-win ${aWin ? 'on' : ''}" onclick="RA.koSetWin('${m.id}','a')">A胜</button>
      <button class="ko-win ${bWin ? 'on' : ''}" onclick="RA.koSetWin('${m.id}','b')">B胜</button>
    </div>`;
  }

  function koSetWin(id, who) {
    const m = findKOMatch(id);
    if (!m) return;
    if (!m.a || !m.b) { toast('这场还没确定对手（上游比赛未出结果）'); return; }
    const aRaw = parseInt($('koa_' + id).value, 10);
    const bRaw = parseInt($('kob_' + id).value, 10);
    if (isNaN(aRaw) || isNaN(bRaw)) { toast('先填双方比分'); return; }
    const rule = E.RULES[S.cfg.scoreMode];
    const err = E.validateGame(aRaw, bRaw, m.aStart, m.bStart, rule);
    if (err) { toast(err); return; }
    m.result = { winner: who, aPoints: aRaw, bPoints: bRaw };
    // 晋级：胜者回填下游 match 的对应空位
    advanceKO(m, who);
    renderKO();
    saveDraft();
  }

  function advanceKO(m, who) {
    const winner = who === 'a' ? m.a : m.b;
    const loser = who === 'a' ? m.b : m.a;
    // 找下游 match（fromA 或 fromB === m.id）
    const next = S.ko.rounds.flatMap(r => r.matches).find(x => x.fromA === m.id || x.fromB === m.id);
    if (!next) return;
    if (next.fromA === m.id) next.a = winner;
    else next.b = winner;
    // 若下游对手还是 null，保持待定
    if (!next.a) next.a = null;
    if (!next.b) next.b = null;
  }

  function koFinish() {
    if (!S.ko) { toast('还没淘汰赛'); return; }
    const unfinished = S.ko.rounds.flatMap(r => r.matches).filter(m => !m.result);
    if (unfinished.length) { toast(`还有 ${unfinished.length} 场淘汰赛没录分`); return; }
    const finalMatch = S.ko.rounds[S.ko.rounds.length - 1].matches[0];
    const semiMatches = S.ko.rounds.length >= 2 ? S.ko.rounds[S.ko.rounds.length - 2].matches : [];
    const champ = finalMatch.result.winner === 'a' ? finalMatch.a : finalMatch.b;
    const runner = finalMatch.result.winner === 'a' ? finalMatch.b : finalMatch.a;
    const thirds = semiMatches.map(sm => sm.result.winner === 'a' ? sm.b : sm.a);

    if (S.ko.seedIsPair) {
      // 纯淘汰：种子即搭子，最终名次就是 KO 结果
      const top = [champ, runner, ...thirds];
      const topIds = top.map(t => t.id);
      const rest = (S.ko.seedList || []).filter(s => !topIds.includes(s.id));
      S.standings = [...top, ...rest].map((r, i) => Object.assign({ rank: i + 1, wins: 0, losses: 0, net: 0 }, r));
      renderRank();
      goStep(5);
      toast('淘汰赛完成，已生成最终名次');
      return;
    }
    // 循环+淘汰：KO 结果覆盖循环赛顶部名次
    const top = [champ, runner, ...thirds];
    const topIds = top.map(t => t.id);
    const rest = S.standings.filter(s => !topIds.includes(s.id));
    S.standings = [...top, ...rest].map((r, i) => Object.assign({ rank: i + 1 }, r));
    renderRank();
    goStep(5);
    toast('已按淘汰赛结果更新最终名次');
  }

  function renderRank() {
    $('rankList').innerHTML = S.standings.map(r => {
      const top = r.rank <= 3 ? 'top' : '';
      const medal = ['🥇', '🥈', '🥉'][r.rank - 1] || r.rank;
      return `<div class="rank-row ${top}">
        <div class="rk">${medal}</div>
        <div class="nm">${escapeHtml(r.name)} <span class="pill">${r.gender}</span></div>
        <div class="sc">胜 ${r.wins} · 负 ${r.losses} · 净胜 ${r.net}</div>
      </div>`;
    }).join('');
  }

  function showAward() {
    if (!S.standings.length) return;
    const top3 = S.standings.slice(0, 3).map(r => ({ name: r.name, gender: r.gender, wins: r.wins, net: r.net }));
    while (top3.length < 3) top3.push({ name: '—', gender: '', wins: 0, net: 0 });
    const svg = A.buildAwardSVG(top3, {
      title: '常规赛 · 女双/男双/混双',
      theme: THEME,
      date: new Date().toISOString().slice(0, 10),
      venue: '星羿羽毛球馆 · 九江开发区'
    });
    $('awardImg').innerHTML = svg;
    $('awardModal').style.display = 'block';
    window.__awardSVG = svg;
  }

  function downloadAward() {
    if (window.__awardSVG) A.downloadPNG(window.__awardSVG, '星羿常规赛颁奖图.png');
  }

  /* ---------------- 工具 ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 启动 ---------------- */
  window.RA = {
    removePlayer, toggleChip, removeOnePair, setManual, setWin, koSetWin, newMatchFlow
  };

  function bind() {
    $('addPlayer').onclick = addPlayer;
    $('pName').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
    $('goPair').onclick = () => { renderPairPage(); goStep(1); };
    $('backSignup2').onclick = () => goStep(0);

    $('autoPair').onclick = autoPair;
    $('clearPairs').onclick = clearPairs;
    $('goGroup').onclick = () => { switchGroupMode(S.groupMode); goStep(2); };

    document.querySelectorAll('.tab-row .tab').forEach(t =>
      t.addEventListener('click', () => switchGroupMode(t.dataset.mode)));
    document.querySelectorAll('#nPick .np').forEach(x =>
      x.addEventListener('click', () => pickN(+x.dataset.n)));
    $('doRandom').onclick = doRandom;
    $('doAutoN').onclick = doAutoN;
    $('backPair').onclick = () => goStep(1);

    $('goConfig').onclick = () => goStep(3);
    $('genBtn').onclick = genMatches;
    $('backGroup').onclick = () => goStep(3);
    $('finishBtn').onclick = finish;
    document.querySelectorAll('#fmtPick .np').forEach(x =>
      x.addEventListener('click', () => pickFmt(x.dataset.fmt)));
    document.querySelectorAll('#koSizePick2 .np').forEach(x =>
      x.addEventListener('click', () => {
        document.querySelectorAll('#koSizePick2 .np').forEach(y => y.classList.toggle('on', y === x));
        x.parentElement.dataset.size = x.dataset.size;
      }));
    $('backConfig').onclick = () => goStep(3);
    $('awardBtn').onclick = showAward;
    $('awardClose').onclick = () => $('awardModal').style.display = 'none';
    $('awardDownload').onclick = downloadAward;
    $('koBtn').onclick = enterKO;
    document.querySelectorAll('#koSizePick .np').forEach(x =>
      x.addEventListener('click', () => pickKO(+x.dataset.size)));
    $('koFinishBtn').onclick = koFinish;
    $('backRank').onclick = () => goStep(5);
    $('newMatch').onclick = newMatchFlow;
    $('awardNew').onclick = () => {
      $('awardModal').style.display = 'none';
      newMatchFlow();
    };
  }

  function newMatchFlow() {
    if (!confirm('清空整场记录，回到报名页重新办一场？')) return;
    S.players = []; S.pairs = []; S.groups = []; S.matches = []; S.standings = [];
    S.pairSelected = []; S.manualAssignments = {}; S.ko = null;
    renderPlayers();
    clearDraft();
    goStep(0);
  }

  function init() {
    loadDraft();
    bind();
    // 恢复 UI
    document.querySelectorAll('#itemChecks input').forEach(c => { c.checked = S.cfg.items.includes(c.value); });
    if ($('cfgScore')) $('cfgScore').value = S.cfg.scoreMode;
    if ($('cfgHandi')) $('cfgHandi').value = S.cfg.handicapOn ? 'on' : 'off';
    pickN(S.groupAutoN || 2);
    pickFmt(S.cfg.format || 'rr');
    renderPlayers();
    // 如果已有选手，恢复到合适的步骤（搭子页/分组页/...），否则回到报名
    const step = (() => {
      if (S.ko && S.ko.rounds) return 6;
      if (S.standings.length) return 5;
      if (S.matches.length) return 4;
      if (S.groups.length) return 2;
      if (S.pairs.length) return 1;
      return 0;
    })();
    goStep(step);
    if (step >= 1) renderPairPage();
    if (step >= 2) switchGroupMode(S.groupMode);
    if (step >= 3) {
      if (S.groupMode === 'manual') renderManual();
    }
    if (step >= 4) renderMatches();
    if (step >= 5) {
      if (!S.standings.length && S.matches.length) S.standings = E.computeStandings(S.players, S.matches);
      renderRank();
      $('koBtn').style.display = (S.cfg.format === 'rrko') ? '' : 'none';
    }
    if (step >= 6 && S.ko) {
      koSize = S.ko.size || 16;
      renderKO();
    }
  }

  init();
})();
