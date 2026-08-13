/* stats.js — 统计汇总：最终名次（淘汰赛 + 三四名） */
window.Stats = (function () {
  function finalRanking(disc) {
    const matches = disc.matches || [];
    const entrants = disc.entrants || [];
    if (!matches.length || !entrants.length) return [];

    const koMatches = matches.filter(m => m.stage === "ko");
    if (!koMatches.length) return [];
    const totalRounds = Math.max.apply(null, koMatches.map(m => m.round));
    const finalM = koMatches.find(m => m.round === totalRounds && m.slotIndex === 0);
    const thirdM = matches.find(m => m.stage === "third");

    const rankMap = {};
    if (finalM && finalM.result) {
      rankMap[finalM.result.winner === "a" ? finalM.a.entrantId : finalM.b.entrantId] = 1;
      rankMap[finalM.result.winner === "a" ? finalM.b.entrantId : finalM.a.entrantId] = 2;
    }
    if (thirdM && thirdM.result) {
      rankMap[thirdM.result.winner === "a" ? thirdM.a.entrantId : thirdM.b.entrantId] = 3;
      rankMap[thirdM.result.winner === "a" ? thirdM.b.entrantId : thirdM.a.entrantId] = 4;
    }

    // 每名选手被淘汰的轮次（越靠后名次越高）
    const elimRound = {};
    for (const m of matches) {
      if (m.result && m.result.winner) {
        const loserId = m.result.winner === "a" ? m.b.entrantId : m.a.entrantId;
        if (loserId && !(loserId in elimRound)) elimRound[loserId] = m.round;
      }
    }

    const result = [];
    [1, 2, 3, 4].forEach(r => {
      const id = Object.keys(rankMap).find(k => rankMap[k] === r);
      if (id) {
        const e = Store.getEntrant(disc, id);
        result.push({ rank: r, entrantId: id, label: e ? e.label : id, kind: e ? e.kind : "" });
      }
    });

    const rest = entrants
      .filter(e => !(e.id in rankMap))
      .sort((x, y) => (elimRound[y.id] || 0) - (elimRound[x.id] || 0));

    rest.forEach(e => {
      result.push({ rank: result.length + 1, entrantId: e.id, label: e.label, kind: e.kind });
    });

    return result;
  }

  /* 团体赛积分榜
   * - overall 模式：整组整体记总比分，按 胜/平/负 + 总比分 排名
   * - discipline 模式：整队按「分项胜场」定团队胜负，按 团队胜场→分项胜场→总得分净胜 排名
   */
  function teamStandings(disc) {
    if (!disc || disc.kind !== "team") return [];
    const entrants = disc.entrants || [];
    if (!entrants.length) return [];
    if (disc.teamFormat === "league") return leagueStandings(disc);
    if (disc.teamFormat && disc.teamFormat !== "overall") return disciplineStandings(disc, entrants);
    return overallStandings(disc, entrants);
  }

  // 全员项目联赛：按"实际得分累计"排 1-4 名
  function leagueStandings(disc) {
    const groups = (disc.groups || []).filter(g => (g.playerIds || []).length > 0);
    const matches = (disc.matches || []).filter(m => m.stage === "league" && m.result);
    const rec = {};
    groups.forEach(g => { rec[g.name] = { id: g.name, name: g.name, label: g.name, total: 0, wins: 0, played: 0, gf: 0, ga: 0 }; });
    matches.forEach(m => {
      const ag = rec[m.a.groupId], bg = rec[m.b.groupId];
      if (!ag || !bg) return;
      const ga = m.result.aPoints || 0, gb = m.result.bPoints || 0;
      ag.played++; bg.played++;
      ag.total += ga; bg.total += gb;
      ag.gf += ga; ag.ga += gb; bg.gf += gb; bg.ga += ga;
      if (m.result.winner === "a") ag.wins++; else if (m.result.winner === "b") bg.wins++;
    });
    return Object.values(rec).sort((x, y) =>
      (y.total - x.total) || (y.wins - x.wins) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf));
  }

  function overallStandings(disc, entrants) {
    const matches = (disc.matches || []).filter(m => m.stage === "team" && m.result);
    const rec = {};
    entrants.forEach(e => {
      rec[e.id] = {
        id: e.id, name: e.groupName || e.label, label: e.label,
        played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0
      };
    });
    matches.forEach(m => {
      const a = rec[m.a.entrantId], b = rec[m.b.entrantId];
      if (!a || !b) return;
      const aT = m.result.aTeam || 0, bT = m.result.bTeam || 0;
      a.played++; b.played++;
      a.gf += aT; a.ga += bT; b.gf += bT; b.ga += aT;
      if (aT > bT) { a.win++; b.loss++; a.pts += 1; }
      else if (bT > aT) { b.win++; a.loss++; b.pts += 1; }
      else { a.draw++; b.draw++; a.pts += 0.5; b.pts += 0.5; }
    });
    return Object.values(rec).sort((x, y) =>
      (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf));
  }

  function disciplineStandings(disc, entrants) {
    const matches = (disc.matches || []).filter(m => m.stage === "team" && m.result && m.result.winner);
    const rec = {};
    entrants.forEach(e => {
      rec[e.id] = {
        id: e.id, name: e.groupName || e.label, label: e.label,
        played: 0, twins: 0, tlosses: 0, dwins: 0, dlosses: 0, gf: 0, ga: 0, pts: 0
      };
    });
    matches.forEach(m => {
      const a = rec[m.a.entrantId], b = rec[m.b.entrantId];
      if (!a || !b) return;
      a.played++; b.played++;
      if (m.result.winner === "a") { a.twins++; b.tlosses++; }
      else if (m.result.winner === "b") { b.twins++; a.tlosses++; }
      (m.subs || []).forEach(s => {
        if (!s.result || !s.result.winner) return;
        const w = s.result.winner === "a" ? a : b;
        const l = s.result.winner === "a" ? b : a;
        w.dwins++; l.dlosses++;
        w.gf += (s.result.aPoints || 0); w.ga += (s.result.bPoints || 0);
        l.gf += (s.result.bPoints || 0); l.ga += (s.result.aPoints || 0);
      });
    });
    Object.values(rec).forEach(r => { r.pts = r.twins; });
    return Object.values(rec).sort((x, y) =>
      (y.pts - x.pts)
      || (y.dwins - x.dwins)
      || ((y.gf - y.ga) - (x.gf - x.ga))
      || (y.gf - x.gf));
  }

  /* 双打轮转赛名次
   * - eight / super8 / mixed：按个人积分排名（胜 2:0/1:0 得 2 分、2:1 得 1 分、负 0 分），同分比净胜分；mixed 男女分别排名
   * - fixed：按组合（成对）积分排名
   * 计分与图片规则一致：大比分 2:0 或 1:0 胜 → 2 分，2:1 胜 → 1 分，负 → 0 分。
   */
  function rotationStandings(disc) {
    if (!disc || disc.kind !== "rotation") return [];
    const matches = (disc.matches || []).filter(m => m.result);
    const is31 = (disc.scoringMode === "31x1");
    const ptsFor = (result, side) => {
      if (!result || result.winner !== side) return 0;
      if (is31) return 2;                         // 31 分制：胜即 2 分
      const g = side === "a" ? result.aGames : result.bGames;
      return g === 2 ? 2 : 1;                    // 21 分制：2:0/2:1 分别得 2/1 分
    };
    const rec = {}; // id -> {id,name,pts,net,played,wins}
    const pairRec = {}; // 固搭转：key -> {key,label,pts,net,played,wins}
    // 预填所有参赛单元（含未开赛的），保证名次完整
    (disc.entrants || []).forEach(e => {
      const ids = e.playerIds || [];
      if (disc.rotationMode === "fixed") {
        const key = ids.slice().sort().join("|");
        if (!pairRec[key]) pairRec[key] = { key: key, label: ids.map(id => (Store.getPlayer(id) || {}).name || id).join("/"), pts: 0, net: 0, played: 0, wins: 0 };
      } else {
        ids.forEach(id => { if (!rec[id]) { const p = Store.getPlayer(id); rec[id] = { id: id, name: p ? p.name : id, gender: p ? (p.gender || "") : "", pts: 0, net: 0, played: 0, wins: 0 }; } });
      }
    });
    function touch(id) {
      if (!rec[id]) { const p = Store.getPlayer(id); rec[id] = { id: id, name: p ? p.name : id, gender: p ? (p.gender || "") : "", pts: 0, net: 0, played: 0, wins: 0 }; }
      return rec[id];
    }
    matches.forEach(m => {
      const aIds = m.a.playerIds || [], bIds = (m.b && m.b.playerIds) || [];
      const aP = ptsFor(m.result, "a"), bP = ptsFor(m.result, "b");
      const aNet = (m.result.aPoints || 0) - (m.result.bPoints || 0);
      const bNet = (m.result.bPoints || 0) - (m.result.aPoints || 0);
      if (disc.rotationMode === "fixed") {
        const ka = aIds.slice().sort().join("|"), kb = bIds.slice().sort().join("|");
        [ka, kb].forEach((k, idx) => {
          if (!pairRec[k]) pairRec[k] = { key: k, label: ka === k ? aIds.map(id => (Store.getPlayer(id) || {}).name || id).join("/") : bIds.map(id => (Store.getPlayer(id) || {}).name || id).join("/"), pts: 0, net: 0, played: 0, wins: 0 };
          const r = pairRec[k];
          r.played++; r.pts += (idx === 0 ? aP : bP); r.net += (idx === 0 ? aNet : bNet);
          if ((idx === 0 && m.result.winner === "a") || (idx === 1 && m.result.winner === "b")) r.wins++;
        });
      } else {
        aIds.forEach(id => { const r = touch(id); r.played++; r.pts += aP; r.net += aNet; if (m.result.winner === "a") r.wins++; });
        bIds.forEach(id => { const r = touch(id); r.played++; r.pts += bP; r.net += bNet; if (m.result.winner === "b") r.wins++; });
      }
    });
    if (disc.rotationMode === "fixed") {
      return Object.values(pairRec).sort((x, y) => (y.pts - x.pts) || ((y.net) - (x.net)) || (y.wins - x.wins));
    }
    if (disc.rotationMode === "mixed") {
      const men = Object.values(rec).filter(r => r.gender === "男").sort(cmpRot);
      const women = Object.values(rec).filter(r => r.gender === "女").sort(cmpRot);
      return { men: men, women: women };
    }
    return Object.values(rec).sort(cmpRot);
  }
  function cmpRot(x, y) { return (y.pts - x.pts) || ((y.net) - (x.net)) || (y.wins - x.wins) || (x.name < y.name ? -1 : 1); }

  return { finalRanking, teamStandings, overallStandings, disciplineStandings, leagueStandings, rotationStandings };
})();
