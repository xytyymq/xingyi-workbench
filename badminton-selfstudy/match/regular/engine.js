/* engine.js — 常规赛 核心引擎（v2：搭子+分组+对阵）
 *
 * 数据约定
 *   player = { id, name, gender }
 *   pair   = { id, item:'MD'|'WD'|'XD', a:[playerId,playerId], aNames:[...] }
 *            item 仅作标识用，单项/分组用 player 的性别自动判定
 *            （亦即 a 两名选手的性别组合 = pairType）
 *   group  = { name, pairIds:[...] }
 *   match  = { groupName, itemName, court, a:[id,id], b:[id,id], aStart, bStart, result }
 *
 * 算法
 *   makePairs(players, configs)            — 根据手动搭子配置建搭子（校验性别、唯一性）
 *   assignGroups(pairs, mode, opts)        — 随机 / 自动 N 组 / 手动指定组别
 *   generateMatches(pairs, groups, event)  — 组内按单项 round-robin
 *
 * 仍保留原有 validateGame / computeStandings（个人积分榜）。
 */
(function (global) {
  'use strict';

  const RULES = {
    '21x1': { bestOf: 1, target: 21, cap: 30, deuce: true, name: '21分一局制' },
    '31x1': { bestOf: 1, target: 31, cap: 31, deuce: false, name: '31分一局制' }
  };

  const ITEM_DEFS = {
    MD: { name: '男双', need: ['男', '男'] },
    WD: { name: '女双', need: ['女', '女'] },
    XD: { name: '混双', need: ['男', '女'] }
  };
  const STRENGTH = { MD: 3, XD: 2, WD: 1 };
  function valueFor(weaker, stronger) {
    if (weaker === 'WD' && stronger === 'MD') return 8;
    if (weaker === 'XD' && stronger === 'MD') return 4;
    if (weaker === 'WD' && stronger === 'XD') return 6;
    return 0;
  }
  function pairType(genders) {
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

  /* 校验并构建搭子
   * configs: [{ aId, bId }]
   * 每个搭子必须有 2 名选手，性别组合必须合法（男双/女双/混双）
   * 同一选手不可在同一搭子池内重复（但搭子池跨 item 互不影响）
   * 返回 { pairs, errors }
   */
  function makePairs(players, configs) {
    const errors = [];
    const pmap = {};
    players.forEach(p => pmap[p.id] = p);
    const used = {}; // id -> true
    const pairs = [];
    configs.forEach((cfg, i) => {
      const pa = pmap[cfg.aId];
      const pb = pmap[cfg.bId];
      if (!pa || !pb) { errors.push(`第 ${i + 1} 对：选手不存在`); return; }
      if (pa.id === pb.id) { errors.push(`${pa.name} 不能和自己搭`); return; }
      if (used[pa.id] || used[pb.id]) {
        const who = used[pa.id] ? pa.name : pb.name;
        errors.push(`${who} 已搭过伙，请先在现有搭子里移除再重搭`);
        return;
      }
      const item = pairType([pa.gender, pb.gender]);
      used[pa.id] = used[pb.id] = true;
      pairs.push({
        id: 'pr' + (i + 1),
        item,
        a: [pa.id, pb.id],
        b: [],
        aNames: [pa.name, pb.name]
      });
    });
    return { pairs, errors };
  }

  /* 移除某搭子（释放两选手的占用） */
  function removePair(pairs, pairId) {
    return pairs.filter(p => p.id !== pairId);
  }

  /* 分组
   * mode: 'random' | 'autoN' | 'manual'
   * opts:
   *   random/autoN: { n }                — 期望分 N 组（N=2..6，会按单项搭子数自动收敛）
   *   manual: { assignments: { pairId: '组名' } }
   *          或 { groupNames: ['A','B','C'] } 自动顺序塞入
   * 返回 { groups: [{ name, pairIds }], warnings, n }
   *
   * 注意：单循环要求「每组内同一单项至少 2 对搭子」才成赛。
   * 因此分组按单项分桶、桶内均匀循环填入各小组，保证同单项在各组数量尽量均衡；
   * 且 n 不会超过 floor(minItemCount / 2)（由调用方 clamp，这里兜底）。
   */
  function assignGroups(pairs, mode, opts) {
    const warnings = [];
    if (!pairs.length) return { groups: [], warnings: ['还没有搭子'], n: 0 };
    const groupNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    if (mode === 'random' || mode === 'autoN') {
      let n = Math.max(1, Math.min(6, opts.n || 2));
      // 按单项分桶
      const byItem = { MD: [], WD: [], XD: [] };
      pairs.forEach(p => byItem[p.item].push(p));
      // 桶内洗牌（保持随机感）
      Object.keys(byItem).forEach(it => {
        const arr = byItem[it];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      });
      // 收敛 n：每组每单项至少 2 对才能成赛
      const counts = ['MD', 'WD', 'XD'].map(it => byItem[it].length);
      const minCount = Math.min(...counts.filter(c => c > 0));
      const maxN = minCount === Infinity ? 1 : Math.max(1, Math.floor(minCount / 2));
      if (n > maxN) {
        warnings.push(`单项搭子不足，已自动收敛为 ${maxN} 组（每组同单项需 ≥2 对才能循环赛）`);
        n = maxN;
      }
      const groups = [];
      for (let i = 0; i < n; i++) groups.push({ name: groupNames[i], pairIds: [] });
      ['MD', 'WD', 'XD'].forEach(it => {
        byItem[it].forEach((p, i) => groups[i % n].pairIds.push(p.id));
      });
      groups.forEach(g => { if (g.pairIds.length === 0) warnings.push(`「${g.name}组」无搭子`); });
      return { groups, warnings, n };
    }

    if (mode === 'manual') {
      const map = opts.assignments || {};
      const buckets = {};
      Object.values(map).forEach(name => { buckets[name] = buckets[name] || []; });
      pairs.forEach(p => {
        const name = map[p.id];
        if (!name) { warnings.push(`「${p.aNames.join('+')}」未指定组别`); return; }
        buckets[name].push(p.id);
      });
      const groups = Object.keys(buckets).map(name => ({ name, pairIds: buckets[name] }));
      const order = opts.groupNames || ['A', 'B', 'C', 'D', 'E', 'F'];
      groups.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
      return { groups, warnings, n: groups.length };
    }

    return { groups: [], warnings: ['未知分组模式'], n: 0 };
  }

  /* 生成对阵：每组内按单项搭子两两交手（round-robin）
   * event: { rule:'21x1'|'31x1', handicapOn:bool }
   * 返回 { matches, warnings }
   */
  function generateMatches(pairs, groups, event) {
    const rule = RULES[event.rule];
    if (!rule) return { error: '未知分制' };
    const pmap = {};
    pairs.forEach(p => pmap[p.id] = p);
    const matches = [];
    const warnings = [];
    let court = 1;

    groups.forEach(g => {
      const itemBuckets = {}; // item -> [pair]
      g.pairIds.forEach(pid => {
        const pr = pmap[pid];
        if (!pr) return;
        itemBuckets[pr.item] = itemBuckets[pr.item] || [];
        itemBuckets[pr.item].push(pr);
      });
      Object.keys(itemBuckets).forEach(item => {
        const arr = itemBuckets[item];
        if (arr.length < 2) {
          warnings.push(`「${g.name}组·${ITEM_DEFS[item].name}」仅 ${arr.length} 对搭子，不足以形成对阵`);
          return;
        }
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const pa = arr[i], pb = arr[j];
            let aStart = 0, bStart = 0;
            if (event.handicapOn) {
              // 搭子本身就是按性别定型的（pa.item / pb.item）
              const h = handicapStart(pa.item, pb.item);
              aStart = h.aStart; bStart = h.bStart;
            }
            matches.push({
              groupName: g.name,
              itemName: ITEM_DEFS[arr[i].item].name,
              court: court++,
              a: pa.a.slice(),
              b: pb.a.slice(),
              aStart, bStart,
              result: null
            });
          }
        }
      });
    });

    if (matches.length === 0) return { error: '无对阵生成', warnings };
    return { matches, warnings };
  }

  /* 个人积分榜（每场比赛每位选手都计入胜负与净胜分） */
  function computeStandings(players, matches) {
    const st = {};
    players.forEach(p => st[p.id] = { id: p.id, name: p.name, gender: p.gender, wins: 0, losses: 0, net: 0, played: 0 });
    matches.forEach(m => {
      if (!m.result) return;
      const w = m.result.winner === 'a' ? m.a : m.b;
      const l = m.result.winner === 'a' ? m.b : m.a;
      const net = m.result.aPoints - m.aStart - (m.result.bPoints - m.bStart);
      w.forEach(id => { if (st[id]) { st[id].wins++; st[id].played++; st[id].net += Math.abs(net); } });
      l.forEach(id => { if (st[id]) { st[id].losses++; st[id].played++; st[id].net -= Math.abs(net); } });
    });
    return Object.values(st).sort((x, y) =>
      (y.wins - x.wins) || (y.net - x.net) || (x.name < y.name ? -1 : 1)
    ).map((r, i) => Object.assign({ rank: i + 1 }, r));
  }

  /* 搭子汇总（按单项聚合，用于显示） */
  function summarizePairs(pairs, players) {
    const pmap = {};
    players.forEach(p => pmap[p.id] = p);
    const buckets = { MD: [], WD: [], XD: [] };
    pairs.forEach(pr => {
      const names = pr.a.map(id => pmap[id] ? pmap[id].name : '?');
      buckets[pr.item].push({ id: pr.id, names });
    });
    return buckets;
  }

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

  /* 单淘汰赛（标准 KO 树）
   * standings: computeStandings 的输出（已按 rank 排好）
   * size: 淘汰赛规模 16 / 8 / 4（不足则向下取到 2 的幂）
   * event: { rule, handicapOn, isPair:bool } — isPair=true 时按搭子性别让分
   * 注意：淘汰赛以「选手/搭子」为参赛单位，用 standings 的 name/gender/id 落位
   * 返回 { rounds:[{name, matches:[{id,round,a,b,aStart,bStart,result}]}], bracket:'1v16...' , error }
   */
  function buildKnockout(standings, size, event) {
    if (!standings || !standings.length) return { error: '先完成循环赛并生成名次' };
    // 取前 size 名（size 规整到 2 的幂）
    const sizes = [2, 4, 8, 16, 32];
    let n = sizes.filter(s => s <= size).pop() || 2;
    const seed = standings.slice(0, n).map(r => ({
      id: r.id, name: r.name, gender: r.gender
    }));
    if (seed.length < 2) return { error: '参赛人数不足，无法淘汰赛' };

    // 标准种子排位：1 vs n, 2 vs n-1, ...（填满 2 的幂）
    const slots = seed.length;
    const order = standardBracketOrder(slots); // 返回 seeds(1-based) 的落位序列
    const placed = order.map(s => seed[s - 1]); // 按落位放真实选手

    const rounds = [];
    let roundName, roundSize = slots;
    // 轮次名称：16→8 为「16强」，8→4「8强」，4→2「半决赛」，2→1「决赛」
    let matches = [];
    for (let i = 0; i < placed.length; i += 2) {
      const a = placed[i], b = placed[i + 1];
      matches.push(makeKO(rounds.length, a, b, event));
    }
    // 第一轮命名
    roundName = roundLabel(roundSize);
    rounds.push({ name: roundName, matches });

    // 生成后续轮（占位，胜者回填）
    let cur = matches;
    while (cur.length > 1) {
      const nextMatches = [];
      for (let i = 0; i < cur.length; i += 2) {
        nextMatches.push(makeKO(rounds.length, null, null, event, cur[i], cur[i + 1]));
      }
      roundSize = roundSize / 2;
      rounds.push({ name: roundLabel(roundSize), matches: nextMatches });
      cur = nextMatches;
    }

    return { rounds, bracket: order.join('-'), size: slots };
  }

  function roundLabel(sz) {
    if (sz >= 16) return '16强';
    if (sz >= 8) return '8强';
    if (sz >= 4) return '半决赛';
    return '决赛';
  }

  // 标准 KO 种子落位：返回 1-based seed 顺序（长度 = 2的幂）
  function standardBracketOrder(pow2) {
    // 递归生成：标准锦标赛种子排位
    if (pow2 <= 2) return [1, 2];
    const half = pow2 / 2;
    const top = standardBracketOrder(half);
    const bottom = standardBracketOrder(half).map(s => s + half);
    // 交织合并：1, n, 然后递归
    const res = [];
    for (let i = 0; i < half; i++) {
      res.push(top[i]);
      res.push(bottom[i]);
    }
    return res;
  }

  let __koSeq = 0;
  function makeKO(roundIdx, a, b, event, fromA, fromB) {
    const m = {
      id: 'ko' + (++__koSeq),
      round: roundIdx,
      a: a ? { id: a.id, name: a.name, gender: a.gender } : null,
      b: b ? { id: b.id, name: b.name, gender: b.gender } : null,
      aStart: 0, bStart: 0,
      result: null,
      fromA: fromA ? fromA.id : null, // 上游对阵 id，胜者回填
      fromB: fromB ? fromB.id : null
    };
    if (event && event.handicapOn && a && b) {
      // 按性别让分（搭子赛用 gender 组合；单人也用 gender）
      const ta = a.gender, tb = b.gender;
      const h = handicapStart(ta, tb);
      m.aStart = h.aStart; m.bStart = h.bStart;
    }
    return m;
  }

  const API = {
    RULES, ITEM_DEFS, pairType, handicapStart,
    makePairs, removePair, assignGroups, generateMatches,
    summarizePairs, validateGame, computeStandings, buildKnockout
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.RegularEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
