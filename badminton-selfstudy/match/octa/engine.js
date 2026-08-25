/* engine.js — 八人转（Octa-Rotation）核心引擎（纯函数，浏览器/Node 双用）
 * 玩法：5-8 人/组双打轮转，每人恰好与其他每人搭档一次（1-因子分解 / 圆桌法）。
 * 单局金球制（15 或 21 分），性别让分。排名按 胜场 → 净胜分。
 *
 * 数据约定
 *  player = { id, name, gender:'男'|'女'|'' }
 *  match  = { round, court, a:[id,id], b:[id,id], aStart, bStart, bye?, result }
 *           result = { winner:'a'|'b', aPoints, bPoints }
 */
(function (global) {
  'use strict';

  // 单局赛制（金球制：先到 target 即胜，无 deuce）。统一为 21 分 / 31 分可选。
  const RULES = {
    '21x1': { target: 21, name: '21分一局制' },
    '31x1': { target: 31, name: '31分一局制' }
  };

  // 性别组合强度：MD(男双) > XD(混双) > WD(女双)
  const STRENGTH = { MD: 3, XD: 2, WD: 1 };
  // 弱方起始分（中羽联八人转让分表，按分制放大）。21 分制 / 31 分制。
  function handiValue(weaker, stronger, target) {
    const big = target >= 31;
    if (weaker === 'WD' && stronger === 'MD') return big ? 10 : 7; // 男双让女双
    if (weaker === 'XD' && stronger === 'MD') return big ? 6 : 4;  // 男双让混双
    if (weaker === 'WD' && stronger === 'XD') return big ? 8 : 6;  // 混双让女双
    return 0;
  }

  function teamType(genders) {
    const m = genders.filter(g => g === '男').length;
    const w = genders.filter(g => g === '女').length;
    if (m === 2) return 'MD';
    if (w === 2) return 'WD';
    return 'XD';
  }

  function handicapStart(typeA, typeB, target) {
    if (typeA === typeB) return { aStart: 0, bStart: 0 };
    if (STRENGTH[typeA] > STRENGTH[typeB]) return { aStart: 0, bStart: handiValue(typeB, typeA, target) };
    return { aStart: handiValue(typeA, typeB, target), bStart: 0 };
  }

  // 圆桌法：返回 rounds 个"本轮搭档对"列表，保证每对恰好出现一次
  function circleFactor(ids) {
    const fixed = ids[0];
    const ring = ids.slice(1);
    const rounds = [];
    for (let r = 0; r < ids.length - 1; r++) {
      const order = [fixed].concat(ring);
      const teams = [[order[0], order[1]]];
      for (let i = 2, j = order.length - 1; i < j; i++, j--) teams.push([order[i], order[j]]);
      rounds.push(teams);
      ring.push(ring.shift()); // 旋转
    }
    return rounds;
  }

  // 生成完整赛程
  function generateSchedule(players, opts) {
    opts = opts || {};
    const scoreMode = opts.scoreMode || '15x1';
    const handicapOn = !!opts.handicapOn;
    if (!RULES[scoreMode]) return { error: '未知分制' };
    const rule = RULES[scoreMode];
    if (players.length < 4) return { error: '八人转至少 4 人（建议 5-8 人）' };

    let ids = players.map(p => p.id);
    let byeId = null;
    if (ids.length % 2 === 1) { byeId = '__bye__'; ids.push(byeId); }

    const roundsTeams = circleFactor(ids);
    const totalRounds = roundsTeams.length;
    const matches = [];
    const byeByRound = {}; // round -> bye player id

    for (let r = 0; r < totalRounds; r++) {
      let teams = roundsTeams[r].slice();
      // 旋转队伍顺序，使对手每轮变化，增加多样性
      const rot = r % teams.length;
      teams = teams.slice(rot).concat(teams.slice(0, rot));

      let byeTeam = null;
      if (byeId) {
        byeTeam = teams.find(t => t.includes(byeId));
        teams = teams.filter(t => !t.includes(byeId));
        if (byeTeam) byeByRound[r + 1] = byeTeam.find(id => id !== byeId);
      }
      for (let i = 0; i + 1 < teams.length; i += 2) {
        const A = teams[i], B = teams[i + 1];
        const gA = A.map(id => (id === byeId ? '' : (players.find(p => p.id === id) || {}).gender));
        const gB = B.map(id => (id === byeId ? '' : (players.find(p => p.id === id) || {}).gender));
        const tA = teamType(gA), tB = teamType(gB);
        const h = handicapOn ? handicapStart(tA, tB, rule.target) : { aStart: 0, bStart: 0 };
        const court = (i / 2) + 1;
        matches.push({
          round: r + 1, court: court,
          a: A.slice(), b: B.slice(),
          aType: tA, bType: tB,
          aStart: h.aStart, bStart: h.bStart,
          result: null
        });
      }
    }

    // 搭档去重校验（理论应全不重复）
    const partnerSet = {};
    let dup = 0;
    matches.forEach(m => {
      const key = m.a.slice().sort().join('|') + '#' + m.b.slice().sort().join('|');
      if (partnerSet[key]) dup++; partnerSet[key] = true;
    });

    return {
      matches, totalRounds,
      byeByRound, duplicatePairings: dup,
      scoreMode, target: rule.target, handicapOn
    };
  }

  // 单局校验（金球制：胜方到 target，败方不到）
  function validateGame(aRaw, bRaw, aStart, bStart, scoreMode) {
    const rule = RULES[scoreMode]; if (!rule) return '未知分制';
    const a = aRaw, b = bRaw;
    if (a === b) return '金球制不能有平局';
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi < rule.target) return '最高分须达到 ' + rule.target + ' 分';
    if (lo >= rule.target) return '胜方到 ' + rule.target + ' 分即结束，败方不能也到 ' + rule.target;
    if (a < (aStart || 0) || b < (bStart || 0)) return '分数不能低于起分';
    return null;
  }

  // 个人战绩累计
  function computeStandings(players, matches) {
    const st = {};
    players.forEach(p => st[p.id] = { played: 0, wins: 0, losses: 0, net: 0 });
    matches.forEach(m => {
      if (!m.result) return;
      const aw = m.result.winner === 'a';
      const wp = aw ? m.a : m.b, lp = aw ? m.b : m.a;
      const wPts = aw ? m.result.aPoints : m.result.bPoints;
      const lPts = aw ? m.result.bPoints : m.result.aPoints;
      wp.forEach(id => { if (st[id]) { st[id].played++; st[id].wins++; st[id].net += (wPts - lPts); } });
      lp.forEach(id => { if (st[id]) { st[id].played++; st[id].losses++; st[id].net += (lPts - wPts); } });
    });
    return st;
  }

  // 名次：胜场 → 净胜分 → 姓名
  function ranking(players, matches) {
    const st = computeStandings(players, matches);
    const list = players.map(p => {
      const s = st[p.id] || { played: 0, wins: 0, losses: 0, net: 0 };
      return { id: p.id, name: p.name, gender: p.gender, wins: s.wins, losses: s.losses, net: s.net, played: s.played };
    });
    list.sort((a, b) => (b.wins - a.wins) || (b.net - a.net) || (a.name > b.name ? 1 : -1));
    list.forEach((r, i) => r.rank = i + 1);
    return list;
  }

  const API = { RULES, generateSchedule, validateGame, computeStandings, ranking, teamType, handicapStart };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.OctaEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
