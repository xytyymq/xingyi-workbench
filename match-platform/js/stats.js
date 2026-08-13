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

  /* 团体赛：组间循环赛积分榜（整组当整体，按积分→总比分净胜→总比分 排名） */
  function teamStandings(disc) {
    if (!disc || disc.kind !== "team") return [];
    const entrants = disc.entrants || [];
    if (!entrants.length) return [];
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

  return { finalRanking, teamStandings };
})();
