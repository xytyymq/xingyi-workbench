/* engine.js — 大乱斗 核心引擎（纯函数，浏览器/Node 双用）
 * 复用双瑞士的渐进式配对 + 性别让分 + 单局校验 + 个人名次，
 * 额外增加：跨周积分常驻榜（按选手姓名累积，支持周/月/年筛选）。
 *
 * 数据约定
 *  player = { id, name, gender:'男'|'女'|'' }
 *  match  = { round, court, a:[id,id], b:[id,id], aStart, bStart, result }
 *           result = { winner:'a'|'b', aPoints, bPoints }
 *  standings = { [id]: { played, wins, losses, net } }
 *
 * 常驻榜数据模型（持久层）
 *  board = {
 *    seasons: { [seasonKey]: { id, label, entries:{ [name]: { name, gender, played, wins, losses, net, events } } } },
 *  }
 *  mode: 'pure' (纯随机) | 'swiss' (按积分配对，默认)
 */
(function (global) {
  'use strict';

  // 单局赛制：21 分 / 31 分，一局定胜负
  const RULES = {
    '21x1': { bestOf: 1, target: 21, cap: 30, deuce: true, name: '21分一局制' },
    '31x1': { bestOf: 1, target: 31, cap: 31, deuce: false, name: '31分一局制' }
  };

  // 性别让分表（弱方起始分；强度 MD>XD>WD）
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
    if (STRENGTH[typeA] > STRENGTH[typeB]) {
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

  function pairingOrderFor(players, standings) {
    return players.slice().sort((a, b) => {
      const sa = standings[a.id] || { wins: 0, net: 0 };
      const sb = standings[b.id] || { wins: 0, net: 0 };
      return (sb.wins - sa.wins) || (sb.net - sa.net) || (Math.random() - 0.5);
    });
  }

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

  /* 生成某一轮
   * players     : 全部到场选手
   * standings   : computeStandings 的结果（首轮可传空）
   * partnerHist : { id:[partnerId,...] } 跨轮累计的搭档记录
   * byeCounts   : { id:次数 } 轮空计数
   * roundNo     : 第几轮（>=1）
   * courtCount  : 场地数（0 表示不分配台号）
   * handicapOn  : 是否启用性别让分
   * mode        : 'swiss'（默认，按积分配对）| 'pure'（纯随机，对应"随机大乱斗"招牌玩法）
   * 返回 { matches:[...], byes:[id...], error? }
   */
  function generateRound(players, standings, partnerHist, byeCounts, roundNo, courtCount, handicapOn, mode) {
    const N = players.length;
    if (N < 4) return { error: '到场人数不足 4 人，无法开赛' };
    const useSwiss = (mode !== 'pure');

    let active = players.slice();
    const byes = [];

    if (N % 2 === 1) {
      const byeP = active.slice().sort((a, b) =>
        ((byeCounts[a.id] || 0) - (byeCounts[b.id] || 0)) ||
        (Math.random() - 0.5))[0];
      byes.push(byeP.id);
      byeCounts[byeP.id] = (byeCounts[byeP.id] || 0) + 1;
      active = active.filter(p => p.id !== byeP.id);
    }

    let best = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      // 纯随机模式：每轮都纯洗牌；瑞士轮：仍按积分为基准但整轮洗牌避开重复搭档
      let ord;
      if (roundNo === 1 || !useSwiss) ord = shuffle(active);
      else ord = shuffle(pairingOrderFor(active, standings));
      const cand = tryPairing(ord, partnerHist);
      if (!best || cand.repeats < best.repeats) {
        best = cand;
        if (cand.repeats === 0) break;
      }
    }
    const teams = best.teams;
    teams.forEach(t => addPartnerHistory(partnerHist, t[0].id, t[1].id));

    // 组队后按组合实力降序重排相邻对阵（仅瑞士轮模式，保证强强对话）
    if (useSwiss) {
      function teamScore(pair) {
        return pair.reduce((s, p) => {
          const r = standings[p.id] || { wins: 0, net: 0 };
          return s + r.wins * 100 + r.net;
        }, 0);
      }
      teams.sort((x, y) => teamScore(y) - teamScore(x));
    }

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
    return { winner: winner, aNet: a - b, bNet: b - a, aEff: a, bEff: b };
  }

  function computeStandings(players, matches) {
    const rec = {};
    players.forEach(p => {
      rec[p.id] = { id: p.id, name: p.name, gender: p.gender, played: 0, wins: 0, losses: 0, net: 0 };
    });
    (matches || []).forEach(m => {
      if (!m.result) return;
      const j = judgeGame(m.result.aPoints, m.result.bPoints, m.aStart, m.bStart);
      const winner = m.result.winner;
      [['a', m.a], ['b', m.b]].forEach(([side, ids]) => {
        (ids || []).forEach(pid => {
          const r = rec[pid];
          if (!r) return;
          r.played++;
          if (winner === side) r.wins++; else r.losses++;
          r.net += (side === 'a' ? j.aNet : j.bNet);
        });
      });
    });
    return rec;
  }

  function ranking(players, matches) {
    const rec = computeStandings(players, matches);
    return Object.values(rec).sort(
      (x, y) => (y.wins - x.wins) || (y.net - x.net) || (x.name < y.name ? -1 : 1)
    ).map((r, i) => Object.assign({ rank: i + 1 }, r));
  }

  // ============ 跨周常驻榜（持久层） ============

  // 由一场赛事的 players/matches 计算单场名次（用于合并进榜）
  function eventStats(players, matches) {
    return ranking(players, matches).map(r => ({
      name: r.name, gender: r.gender, played: r.played, wins: r.wins,
      losses: r.losses, net: r.net
    }));
  }

  // 合并一场赛事结果到指定赛季榜
  // board: 持久对象；seasonKey: 'all' | '2026-W34' | '2026-08' | '2026'；stats: eventStats 结果
  function foldEvent(board, seasonKey, stats, seasonLabel) {
    if (!board.seasons) board.seasons = {};
    if (!board.seasons[seasonKey]) {
      board.seasons[seasonKey] = {
        id: seasonKey,
        label: seasonLabel || seasonKey,
        entries: {}
      };
    }
    const season = board.seasons[seasonKey];
    stats.forEach(s => {
      if (!season.entries[s.name]) {
        season.entries[s.name] = {
          name: s.name, gender: s.gender, played: 0, wins: 0,
          losses: 0, net: 0, events: 0
        };
      }
      const e = season.entries[s.name];
      e.gender = s.gender || e.gender;
      e.played += s.played;
      e.wins += s.wins;
      e.losses += s.losses;
      e.net += s.net;
      e.events += 1;
    });
    return board;
  }

  // 取某赛季榜排名数组
  function getBoard(board, seasonKey) {
    if (!board.seasons || !board.seasons[seasonKey]) return [];
    const entries = board.seasons[seasonKey].entries;
    return Object.values(entries).sort(
      (x, y) => (y.wins - x.wins) || (y.net - x.net) || (x.name < y.name ? -1 : 1)
    ).map((r, i) => Object.assign({ rank: i + 1 }, r));
  }

  // 生成赛季 key（周/月/年/总）
  function seasonKeyFor(date, scope) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    if (scope === 'year') return String(y);
    if (scope === 'month') return y + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (scope === 'all') return 'all';
    // week (ISO-ish，按周一所在周)
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return tmp.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }

  const API = {
    RULES, STRENGTH, teamType, handicapStart, valueFor,
    generateRound, computeStandings, ranking, validateGame, judgeGame,
    shuffle, addPartnerHistory,
    // 常驻榜
    eventStats, foldEvent, getBoard, seasonKeyFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.DaLuanDouEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
