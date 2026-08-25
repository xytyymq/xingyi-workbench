/* engine.js — 双瑞士·两小时五轮 核心引擎（纯函数，浏览器/Node 双用）
 * 职责：渐进式瑞士轮配对 + 性别让分 + 单局校验 + 个人名次。
 * 不依赖任何 DOM / Store，方便 Node 单元测试与后续并入大平台。
 *
 * 数据约定
 *  player = { id, name, gender:'男'|'女'|'' }
 *  match  = { round, court, a:[id,id], b:[id,id], aStart, bStart, result }
 *           result = { winner:'a'|'b', aPoints, bPoints }
 *  standings = { [id]: { played, wins, losses, net } }
 */
(function (global) {
  'use strict';

  // 单局赛制：21 分 / 31 分，一局定胜负
  const RULES = {
    '21x1': { bestOf: 1, target: 21, cap: 30, deuce: true, name: '21分一局制' },
    '31x1': { bestOf: 1, target: 31, cap: 31, deuce: false, name: '31分一局制' }
  };

  // 性别让分表（弱方起始分；强度 MD>XD>WD）
  //  男双 vs 女双 → 女双 +8
  //  男双 vs 混双 → 混双 +4
  //  混双 vs 女双 → 女双 +6
  const STRENGTH = { MD: 3, XD: 2, WD: 1 };
  function valueFor(weaker, stronger) {
    if (weaker === 'WD' && stronger === 'MD') return 8;
    if (weaker === 'XD' && stronger === 'MD') return 4;
    if (weaker === 'WD' && stronger === 'XD') return 6;
    return 0;
  }

  // 一对选手（含性别）-> 组合类型
  function teamType(genders) {
    const m = genders.filter(g => g === '男').length;
    const w = genders.filter(g => g === '女').length;
    if (m === 2) return 'MD';
    if (w === 2) return 'WD';
    return 'XD';
  }

  // 两队类型 -> 各自的起始分 {aStart,bStart}
  function handicapStart(typeA, typeB) {
    if (typeA === typeB) return { aStart: 0, bStart: 0 };
    if (STRENGTH[typeA] > STRENGTH[typeB]) {
      // A 强，B 弱 -> B 拿起始分
      return { aStart: 0, bStart: valueFor(typeB, typeA) };
    }
    return { aStart: valueFor(typeA, typeB), bStart: 0 };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function addPartnerHistory(hist, id1, id2) {
    if (!hist[id1]) hist[id1] = [];
    if (!hist[id2]) hist[id2] = [];
    if (!hist[id1].includes(id2)) hist[id1].push(id2);
    if (!hist[id2].includes(id1)) hist[id2].push(id1);
  }
  function hasPartnered(hist, id1, id2) {
    return (hist[id1] || []).includes(id2);
  }

  /* 生成某一轮（渐进式：依赖上一轮后的实时名次）
   * players      : 全部到场选手
   * standings    : computeStandings 的结果（首轮可传空）
   * partnerHist  : { id:[partnerId,...] } 跨轮累计的搭档记录
   * byeCounts    : { id:次数 } 轮空计数（用于公平轮空）
   * roundNo      : 第几轮（>=1）
   * courtCount   : 场地数（0 表示不分配台号）
   * handicapOn   : 是否启用性别让分
   * 返回 { matches:[...], byes:[id...], error? }
   */
  function generateRound(players, standings, partnerHist, byeCounts, roundNo, courtCount, handicapOn) {
    const N = players.length;
    if (N < 4) return { error: '到场人数不足 4 人，无法开赛' };

    let active = players.slice();
    const byes = [];

    // 奇数人：本轮回合轮空 1 人（优先轮空次数最少者，保证公平）
    if (N % 2 === 1) {
      const byeP = active.slice().sort((a, b) =>
        ((byeCounts[a.id] || 0) - (byeCounts[b.id] || 0)) ||
        (Math.random() - 0.5))[0];
      byes.push(byeP.id);
      byeCounts[byeP.id] = (byeCounts[byeP.id] || 0) + 1;
      active = active.filter(p => p.id !== byeP.id);
    }

    // 排序：首轮随机；次轮起按 胜场 → 净胜分 → 随机
    // 组队逻辑见下方 tryPairing / shuffleEqualGroups（同分自动组队 + 不重复搭档）
  // 为避免贪心吃掉后续人需要的搭档导致被迫重复，先在"同分簇内"洗牌后多试几次取零重复解
  function tryPairing(order, hist) {
    const remaining = order.slice();
    const teams = [];
    let repeats = 0;
    while (remaining.length >= 2) {
      const p1 = remaining.shift();
      let bestIdx = -1;
      for (let k = 0; k < remaining.length; k++) {
        if (!hasPartnered(hist, p1.id, remaining[k].id)) { bestIdx = k; break; }
      }
      if (bestIdx === -1) { bestIdx = 0; repeats++; }
      const p2 = remaining.splice(bestIdx, 1)[0];
      teams.push([p1, p2]);
    }
    return { teams: teams, repeats: repeats };
  }
  // 按积分大序（胜场→净胜分）的基准排列，供洗牌使用
  function pairingOrderFor(players, standings) {
    return players.slice().sort((a, b) => {
      const sa = standings[a.id] || { wins: 0, net: 0 };
      const sb = standings[b.id] || { wins: 0, net: 0 };
      return (sb.wins - sa.wins) || (sb.net - sa.net) || (Math.random() - 0.5);
    });
  }
  // 同分簇内洗牌（保持积分大序，仅在 wins/net 完全相同者之间随机）
  function shuffleEqualGroups(order, standings) {
    const arr = order.slice();
    let i = 0;
    while (i < arr.length) {
      const sa = standings[arr[i].id] || { wins: 0, net: 0 };
      let j = i;
      while (j + 1 < arr.length) {
        const sb = standings[arr[j + 1].id] || { wins: 0, net: 0 };
        if (sb.wins === sa.wins && sb.net === sa.net) j++; else break;
      }
      if (j > i) {
        const grp = arr.slice(i, j + 1);
        for (let k = grp.length - 1; k > 0; k--) {
          const r = Math.floor(Math.random() * (k + 1));
          const t = grp[k]; grp[k] = grp[r]; grp[r] = t;
        }
        for (let k = 0; k <= j - i; k++) arr[i + k] = grp[k];
      }
      i = j + 1;
    }
    return arr;
  }

  let best = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    // 每轮整轮随机洗牌（首轮纯随机；次轮起仍按积分大序但借洗牌避开重复搭档）
    const ord = shuffle(active);
    const cand = tryPairing(ord, partnerHist);
    if (!best || cand.repeats < best.repeats) {
      best = cand;
      if (cand.repeats === 0) break;
    }
  }
  const teams = best.teams;
  teams.forEach(t => addPartnerHistory(partnerHist, t[0].id, t[1].id));

  // 组队后按"组合实力"（两人胜场+净胜分之和）降序重排，再相邻对阵 -> 强强对话、弱弱对话
  function teamScore(pair) {
    return pair.reduce((s, p) => {
      const r = standings[p.id] || { wins: 0, net: 0 };
      return s + r.wins * 100 + r.net;
    }, 0);
  }
  teams.sort((x, y) => teamScore(y) - teamScore(x));

    // 队伍数为奇数：末尾一对（按实力降序后最弱）本轮回合轮空，显式标记（修复 N≡2 mod4 静默丢人）
    if (teams.length % 2 === 1) {
      const restTeam = teams.pop();
      restTeam.forEach(p => {
        byes.push(p.id);
        byeCounts[p.id] = (byeCounts[p.id] || 0) + 1;
      });
    }

    const matches = [];
    let court = 0;
    for (let t = 0; t + 1 < teams.length; t += 2) {
      const A = teams[t], B = teams[t + 1];
      let aStart = 0, bStart = 0;
      if (handicapOn) {
        const h = handicapStart(
          teamType(A.map(p => p.gender)),
          teamType(B.map(p => p.gender))
        );
        aStart = h.aStart; bStart = h.bStart;
      }
      matches.push({
        round: roundNo,
        court: courtCount > 0 ? (((court % courtCount) + 1)) : '',
        a: A.map(p => p.id),
        b: B.map(p => p.id),
        aStart: aStart, bStart: bStart,
        result: null
      });
      court++;
    }
    return { matches: matches, byes: byes };
  }

  // 单局比分校验（含让分起分：effective = 录入分 - 起分）
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

  // 判定单局（含让分）：返回 { winner, aNet, bNet }
  function judgeGame(aRaw, bRaw, aStart, bStart) {
    const a = aRaw - (aStart || 0), b = bRaw - (bStart || 0);
    const winner = a > b ? 'a' : 'b';
    return { winner: winner, aNet: a - b, bNet: b - a, aEff: a, bEff: b };
  }

  /* 由全部已录分比赛计算个人名次
   * 返回 { [id]: { id,name,gender,played,wins,losses,net } }
   * 排名规则：胜场数 desc → 净胜分(原始分差) desc
   */
  function computeStandings(players, matches) {
    const rec = {};
    players.forEach(p => {
      rec[p.id] = { id: p.id, name: p.name, gender: p.gender, played: 0, wins: 0, losses: 0, net: 0 };
    });
    (matches || []).forEach(m => {
      if (!m.result) return;
      const j = judgeGame(m.result.aPoints, m.result.bPoints, m.aStart, m.bStart);
      const aNet = j.aNet, bNet = j.bNet;
      const winner = m.result.winner;
      [['a', m.a], ['b', m.b]].forEach(([side, ids]) => {
        (ids || []).forEach(pid => {
          const r = rec[pid];
          if (!r) return;
          r.played++;
          if (winner === side) r.wins++; else r.losses++;
          r.net += (side === 'a' ? aNet : bNet);
        });
      });
    });
    return rec;
  }

  // 把 standings 转成排名数组（含 rank）
  function ranking(players, matches) {
    const rec = computeStandings(players, matches);
    return Object.values(rec).sort(
      (x, y) => (y.wins - x.wins) || (y.net - x.net) || (x.name < y.name ? -1 : 1)
    ).map((r, i) => Object.assign({ rank: i + 1 }, r));
  }

  const API = {
    RULES, STRENGTH, teamType, handicapStart, valueFor,
    generateRound, computeStandings, ranking, validateGame, judgeGame,
    shuffle, addPartnerHistory
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.SwissEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
