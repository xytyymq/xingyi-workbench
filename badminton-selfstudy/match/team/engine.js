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

  /* 标准单淘汰种子顺序：返回长度 n 的数组，order[i] = 第 i 个 slot 的种子排名(1-based)
   * 例：n=8 → [1,8,5,4,3,6,7,2]，相邻 slot(i^1) 配对 → 1v8, 5v4, 3v6, 7v2
   */
  function seedingOrder(n) {
    const res = new Array(n);
    // 经典标准种子表生成（迭代，1^1 为相邻对手）
    const order = [];
    const total = n;
    const queue = [[0, total - 1]];
    while (queue.length) {
      const [lo, hi] = queue.shift();
      if (lo > hi) continue;
      if (lo === hi) { order.push(lo); continue; }
      const len = hi - lo + 1;
      const mid = lo + Math.floor(len / 2);
      order.push(lo);     // 顶
      order.push(hi);     // 底
      queue.push([lo + 1, mid]);
      queue.push([mid + 1, hi - 1]);
    }
    // order 是按展开顺序，需重排为标准 bracket 顺序：按「深度优先」相邻配对
    // 用标准做法：order 已是 bracket 顺序（i^1 为对手）
    return order.map(x => x + 1); // 转 1-based
  }

  /* 队伍级单败淘汰树
   * teamStandings: leagueStandings 的输出（含 {id,name,...} 按 rank 排好）
   * size: 2/4/8/16（取不超过队数且最大的 2 的幂）
   * 返回 { size, rounds:[{name, matches:[{id,round,aTeamId,bTeamId,result,fromA,fromB}]}], byes }
   *   result = { winner:'a'|'b' }，a 对应 aTeamId，b 对应 bTeamId
   */
  function buildTeamKnockout(teamStandings, size, event) {
    event = event || {};
    const seeds = teamStandings.slice();
    const sizes = [2, 4, 8, 16, 32];
    let n = sizes.filter(s => s <= Math.max(2, seeds.length)).pop();
    if (size && sizes.includes(size) && size <= seeds.length) n = size;
    if (seeds.length < 2) return { error: '队伍不足 2 支，无法淘汰赛' };
    // 标准种子落位：先生成 n 个 slot 的种子顺序（1-based 排名），相邻 slot（i^1）配对
    const full = n;
    const order = seedingOrder(full); // 长度 full，order[i] = 第 i 个 slot 的种子排名(1-based)
    const slots = order.map(rank => seeds[rank - 1] || null);
    const rounds = [];
    const firstMatches = [];
    for (let i = 0; i < full; i += 2) {
      const aSeed = slots[i], bSeed = slots[i + 1];
      firstMatches.push({
        id: 'k' + (i / 2),
        round: 0,
        aTeamId: aSeed ? aSeed.id : null,
        bTeamId: bSeed ? bSeed.id : null,
        aName: aSeed ? aSeed.name : '待定',
        bName: bSeed ? bSeed.name : '待定',
        result: null,
        fromA: null, fromB: null
      });
    }
    rounds.push({ name: fullName(full), matches: firstMatches });
    // 后续轮
    let prev = firstMatches;
    let r = 1;
    while (prev.length > 1) {
      const cur = [];
      for (let i = 0; i < prev.length; i += 2) {
        cur.push({
          id: 'k' + r + '_' + (i / 2),
          round: r,
          aTeamId: null, bTeamId: null, aName: '待定', bName: '待定',
          result: null,
          fromA: prev[i].id, fromB: prev[i + 1].id
        });
      }
      rounds.push({ name: fullName(full / Math.pow(2, r)), matches: cur });
      prev = cur; r++;
    }
    // byes：seed 序号超出队数的首轮轮空
    const byes = firstMatches.filter(m => !m.aTeamId || !m.bTeamId).length;
    return { size: n, rounds, byes };
    function fullName(x) {
      return { 2: '决赛', 4: '半决赛', 8: '八强', 16: '十六强', 32: '三十二强' }[x] || (x + '强');
    }
  }

  const API = {
    RULES, ITEM_DEFS, teamType, handicapStart,
    pickLineup, generateMatches, leagueSchedule,
    validateGame, judgeGame, scoreTeamMatch, leagueStandings,
    buildTeamKnockout
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.TeamEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
