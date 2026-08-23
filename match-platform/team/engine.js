/* engine.js — 团体赛 核心引擎（纯函数，浏览器/Node 双用）
 * 模型：
 *  - 每队有选手池（含姓名+性别），可上场单打/双打。
 *  - 赛前勾选若干"单项"（男单 MS / 女单 WS / 男双 MD / 女双 WD / 混双 XD）。
 *  - 每项两队各派对应阵容，生成一场对阵（单局 21/31 分制）。
 *  - 团队计分：每项胜方得 1 团队分；可记大比分页。
 *  - 支持两队直接对抗；也支持多队联赛（每队一个积分 = 胜队数）。
 *
 * 数据约定
 *  player = { id, name, gender:'男'|'女' }
 *  team   = { id, name, players:[player...] }
 *  event  = { items:[ 'MS'|'WS'|'MD'|'WD'|'XD'... ], rule:'21x1'|'31x1', handicapOn }
 *  match  = { item, court, a:[playerId...], b:[playerId...], aStart, bStart, result }
 */
(function (global) {
  'use strict';

  const RULES = {
    '21x1': { bestOf: 1, target: 21, cap: 30, deuce: true, name: '21分一局制' },
    '31x1': { bestOf: 1, target: 31, cap: 31, deuce: false, name: '31分一局制' }
  };

  // 单项定义：需要的性别构成
  const ITEM_DEFS = {
    MS: { name: '男单', need: ['男'], needDoubles: false },
    WS: { name: '女单', need: ['女'], needDoubles: false },
    MD: { name: '男双', need: ['男', '男'], needDoubles: true },
    WD: { name: '女双', need: ['女', '女'], needDoubles: true },
    XD: { name: '混双', need: ['男', '女'], needDoubles: true }
  };

  const STRENGTH = { MD: 3, XD: 2, WD: 1 };
  function valueFor(weaker, stronger) {
    if (weaker === 'WD' && stronger === 'MD') return 8;
    if (weaker === 'XD' && stronger === 'MD') return 4;
    if (weaker === 'WD' && stronger === 'XD') return 6;
    return 0;
  }
  function teamType(genders) {
    const m = genders.filter(g => g === '男').length;
    const w = genders.filter(g => g === '女').length;
    if (m === 2) return 'MD';
    if (w === 2) return 'WD';
    return 'XD';
  }
  function handicapStart(typeA, typeB) {
    if (typeA === typeB) return { aStart: 0, bStart: 0 };
    if (STRENGTH[typeA] > STRENGTH[typeB]) return { aStart: 0, bStart: valueFor(typeB, typeA) };
    return { aStart: valueFor(typeA, typeB), bStart: 0 };
  }

  // 从某队选手池里挑出满足单项性别要求的阵容
  // team: { players:[...] }; item: 'MS'...
  // 返回 [playerId, playerId?] 或 null（人数不够）
  function pickLineup(team, item) {
    const def = ITEM_DEFS[item];
    const pool = team.players.slice();
    if (!def.needDoubles) {
      const p = pool.find(pl => pl.gender === def.need[0]);
      return p ? [p.id] : null;
    }
    if (item === 'XD') {
      const m = pool.find(pl => pl.gender === '男');
      const w = pool.find(pl => pl.gender === '女');
      return (m && w) ? [m.id, w.id] : null;
    }
    // 男双/女双：需要两个同性别
    const g = def.need[0];
    const two = pool.filter(pl => pl.gender === g);
    return two.length >= 2 ? [two[0].id, two[1].id] : null;
  }

  /* 生成两队的全部对阵
   * teamA, teamB: 队伍对象
   * event: { items:[...], rule, handicapOn }
   * 返回 { matches:[...], warnings:[...], error? }
   */
  function generateMatches(teamA, teamB, event) {
    const rule = RULES[event.rule];
    if (!rule) return { error: '未知分制' };
    const matches = [];
    const warnings = [];
    event.items.forEach((item, idx) => {
      const la = pickLineup(teamA, item);
      const lb = pickLineup(teamB, item);
      if (!la) { warnings.push(`${teamA.name} 缺少「${ITEM_DEFS[item].name}」阵容`); return; }
      if (!lb) { warnings.push(`${teamB.name} 缺少「${ITEM_DEFS[item].name}」阵容`); return; }
      let aStart = 0, bStart = 0;
      if (event.handicapOn) {
        const h = handicapStart(
          teamType(la.map(id => nameGender(teamA, id))),
          teamType(lb.map(id => nameGender(teamB, id)))
        );
        aStart = h.aStart; bStart = h.bStart;
      }
      matches.push({
        item: item, itemName: ITEM_DEFS[item].name,
        court: idx + 1,
        a: la, b: lb, aStart, bStart, result: null
      });
    });
    if (matches.length === 0) return { error: '无有效单项，请检查两队阵容' };
    return { matches: matches, warnings: warnings };
  }

  function nameGender(team, id) {
    const p = team.players.find(x => x.id === id);
    return p ? p.gender : '';
  }

  // 多队联赛：列出所有队两两对抗的赛程（不自动生成明细，仅给对阵组合）
  function leagueSchedule(teams) {
    const pairs = [];
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++)
        pairs.push([teams[i].id, teams[j].id]);
    return pairs;
  }

  // 单场比分校验（含让分）
  function validateGame(aRaw, bRaw, aStart, bStart, rule) {
    const a = aRaw - (aStart || 0), b = bRaw - (bStart || 0);
    if (a < 0 || b < 0) return '比分不能为负（已扣除让分起分）';
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (!rule.deuce) {
      if (hi !== rule.target) return '本局须打到 ' + rule.target + ' 分';
      if (lo >= rule.target) return '比分非法';
      return null;
    }
    if (hi < rule.target) return '本局未打满 ' + rule.target + ' 分';
    if (hi === rule.cap) {
      if (lo !== rule.cap - 1) return '封顶局必须是 ' + rule.cap + ':' + (rule.cap - 1);
      return null;
    }
    if (hi === rule.target) {
      if (lo > rule.target - 2) return rule.target + ' 分获胜时对手最多 ' + (rule.target - 2) + ' 分';
      return null;
    }
    if (hi > rule.target && hi < rule.cap) {
      if (hi - lo !== 2) return '加分阶段必须净胜 2 分';
      return null;
    }
    return '比分超出范围';
  }

  function judgeGame(aRaw, bRaw, aStart, bStart) {
    const a = aRaw - (aStart || 0), b = bRaw - (bStart || 0);
    const winner = a > b ? 'a' : 'b';
    return { winner, aNet: a - b, bNet: b - a };
  }

  /* 由一场两队的比赛计算团队结果
   * matches: generateMatches 的结果（含 result）
   * 返回 { teamAScore, teamBScore, detail:[{item, winner, aPoints, bPoints}] }
   */
  function scoreTeamMatch(teamA, teamB, matches) {
    let a = 0, b = 0;
    const detail = [];
    matches.forEach(m => {
      if (!m.result) return;
      const w = m.result.winner === 'a' ? 'A' : 'B';
      if (w === 'A') a++; else b++;
      detail.push({ item: m.itemName, winner: w, aPoints: m.result.aPoints, bPoints: m.result.bPoints });
    });
    return { teamAScore: a, teamBScore: b, winner: a === b ? 'draw' : (a > b ? 'A' : 'B'), detail };
  }

  // 多队联赛积分榜：results = [{aTeamId,bTeamId,aScore,bScore}]
  function leagueStandings(teams, results) {
    const rec = {};
    teams.forEach(t => rec[t.id] = { id: t.id, name: t.name, played: 0, wins: 0, draws: 0, losses: 0, pts: 0, gf: 0, ga: 0 });
    results.forEach(r => {
      const ra = rec[r.aTeamId], rb = rec[r.bTeamId];
      if (!ra || !rb) return;
      ra.played++; rb.played++;
      ra.gf += r.aScore; ra.ga += r.bScore;
      rb.gf += r.bScore; rb.ga += r.aScore;
      if (r.aScore > r.bScore) { ra.wins++; rb.losses++; ra.pts += 2; }
      else if (r.aScore < r.bScore) { rb.wins++; ra.losses++; rb.pts += 2; }
      else { ra.draws++; rb.draws++; ra.pts += 1; rb.pts += 1; }
    });
    return Object.values(rec).sort(
      (x, y) => (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf) || (x.name < y.name ? -1 : 1)
    ).map((r, i) => Object.assign({ rank: i + 1 }, r));
  }

  const API = {
    RULES, ITEM_DEFS, teamType, handicapStart,
    pickLineup, generateMatches, leagueSchedule,
    validateGame, judgeGame, scoreTeamMatch, leagueStandings
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.TeamEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
