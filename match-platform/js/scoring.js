/* scoring.js — 计分规则 + 胜负判定 + 自动晋级（全平台最关键的 30 行） */
window.Scoring = (function () {
  const RULES = {
    "21x3": { bestOf: 3, target: 21, cap: 30, deuce: true, changeAt: 11, name: "21分三局两胜" },
    "31x1": { bestOf: 1, target: 31, cap: 31, deuce: false, changeAt: 16, name: "31分一局制" }
  };

  function validateGame(a, b, rule) {
    if (a < 0 || b < 0) return "比分不能为负";
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (!rule.deuce) {
      if (hi !== rule.target) return "本局须打到" + rule.target + "分";
      if (lo >= rule.target) return "比分非法";
      return null;
    }
    if (hi < rule.target) return "本局未打满" + rule.target + "分";
    if (hi === rule.cap) {
      if (lo !== rule.cap - 1) return "封顶局必须是" + rule.cap + ":" + (rule.cap - 1);
      return null;
    }
    if (hi === rule.target) {
      if (lo > rule.target - 2) return rule.target + "分获胜时对手最多" + (rule.target - 2) + "分";
      return null;
    }
    if (hi > rule.target && hi < rule.cap) {
      if (hi - lo !== 2) return "加分阶段必须净胜2分";
      return null;
    }
    return "比分超出范围";
  }

  function judgeMatch(games, rule) {
    const real = [];
    for (const g of games) {
      if (g == null) continue;
      const x = Number(g[0]), y = Number(g[1]);
      if (isNaN(x) || isNaN(y)) continue;
      const err = validateGame(x, y, rule);
      if (err) return { valid: false, msg: err };
      real.push([x, y]);
    }
    let aWin = 0, bWin = 0, aPts = 0, bPts = 0;
    for (const [x, y] of real) {
      if (x > y) aWin++; else if (y > x) bWin++;
      aPts += x; bPts += y;
    }
    const needWin = Math.ceil(rule.bestOf / 2);
    if (aWin < needWin && bWin < needWin) return { valid: false, msg: "比赛尚未分出胜负（需胜" + needWin + "局）" };
    if (real.length > rule.bestOf) return { valid: false, msg: "局数超过赛制上限" };
    return { valid: true, winner: aWin > bWin ? "a" : "b", aGames: aWin, bGames: bWin, aPoints: aPts, bPoints: bPts };
  }

  function refreshReady(m) {
    m.status = (m.a.entrantId && m.b.entrantId) ? "ready" : "pending";
  }

  function isByeSlot(m) {
    const aEmpty = !m.a.entrantId, bEmpty = !m.b.entrantId;
    return aEmpty !== bEmpty;
  }

  function propagate(disc, m) {
    const winnerId = m.result.winner === "a" ? m.a.entrantId : m.b.entrantId;
    const loserId = m.result.winner === "a" ? m.b.entrantId : m.a.entrantId;
    // 胜者晋级：写入下一轮的对应槽位。下一轮此时可能只有 1 个槽位被填，
    // 那只是“另一场尚未录入”，并非轮空——绝不可在此 autoWinBye（真正的轮空只在第 1 轮，由 propagateInitial 处理）。
    if (m.nextMatchId && winnerId) {
      const nm = Store.getMatch(disc, m.nextMatchId);
      if (nm) {
        nm[m.nextSlot].entrantId = winnerId;
        refreshReady(nm);
      }
    }
    // 败者去向（三四名决赛等）
    if (m.loserNextMatchId && loserId) {
      const lm = Store.getMatch(disc, m.loserNextMatchId);
      if (lm) {
        lm[m.loserNextSlot].entrantId = loserId;
        refreshReady(lm);
      }
    }
  }

  function autoWinBye(disc, m) {
    const aEmpty = !m.a.entrantId, bEmpty = !m.b.entrantId;
    if (aEmpty !== bEmpty) {
      const ws = aEmpty ? "b" : "a";
      m.result = {
        games: [], winner: ws, reason: "bye",
        aGames: 0, bGames: 0, aPoints: 0, bPoints: 0, finishedAt: new Date().toISOString()
      };
      m.status = "done";
      propagate(disc, m);
    }
  }

  function propagateInitial(disc) {
    const r1 = (disc.matches || []).filter(m => m.round === 1);
    for (const m of r1) {
      if (isByeSlot(m)) autoWinBye(disc, m);
      else refreshReady(m);
    }
  }

  function clearDownstream(disc, m) {
    const q = [m];
    while (q.length) {
      const cur = q.shift();
      const links = [[cur.nextMatchId, cur.nextSlot], [cur.loserNextMatchId, cur.loserNextSlot]];
      for (const [nid, slot] of links) {
        if (!nid) continue;
        const nx = Store.getMatch(disc, nid);
        if (!nx) continue;
        nx[slot].entrantId = null;
        if (nx.result) { nx.result = null; q.push(nx); }
        nx.status = "pending";
      }
    }
  }

  function submitResult(disc, matchId, games, reason, side) {
    const m = Store.getMatch(disc, matchId);
    if (!m) return { ok: false, msg: "找不到该场" };
    const rule = RULES[disc.scoringMode] || RULES["31x1"];
    let judged;
    if (reason === "walkover" || reason === "retire") {
      if (!side) return { ok: false, msg: "请指定弃权方" };
      judged = { winner: side, aGames: 0, bGames: 0, aPoints: 0, bPoints: 0, valid: true };
    } else {
      judged = judgeMatch(games, rule);
      if (!judged.valid) return { ok: false, msg: judged.msg };
    }
    // 改判：若胜者变了，先级联清空下游
    if (m.result && m.result.winner !== judged.winner) {
      clearDownstream(disc, m);
    }
    m.result = {
      games: games || [],
      winner: judged.winner, reason: reason || "normal",
      aGames: judged.aGames, bGames: judged.bGames,
      aPoints: judged.aPoints, bPoints: judged.bPoints,
      finishedAt: new Date().toISOString()
    };
    m.status = "done";
    propagate(disc, m);
    Store.save();
    return { ok: true };
  }

  function clearResult(disc, matchId) {
    const m = Store.getMatch(disc, matchId);
    if (!m) return;
    clearDownstream(disc, m);
    m.result = null;
    m.status = (m.a.entrantId && m.b.entrantId) ? "ready" : "pending";
    Store.save();
  }

  return {
    RULES, validateGame, judgeMatch, propagate, autoWinBye,
    propagateInitial, clearDownstream, submitResult, clearResult
  };
})();
