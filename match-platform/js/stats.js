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

  /* 团体赛：各组循环赛积分榜（按胜场→局净胜→分净胜） */
  function teamStandings(disc) {
    if (!disc || disc.kind !== "team") return [];
    const entrants = disc.entrants || [];
    const eMap = {};
    entrants.forEach(e => { if (e.playerIds && e.playerIds[0]) eMap[e.id] = e.playerIds[0]; });
    const matches = (disc.matches || []).filter(m => m.stage === "group");
    return (disc.groups || []).map(g => {
      const rec = {};
      (g.playerIds || []).forEach(pid => {
        const e = entrants.find(x => x.playerIds && x.playerIds[0] === pid);
        rec[pid] = { pid: pid, label: e ? e.label : pid, wins: 0, losses: 0, gw: 0, gl: 0, pw: 0, pl: 0 };
      });
      matches.filter(m => m.groupName === g.name && m.result).forEach(m => {
        const aPid = eMap[m.a.entrantId], bPid = eMap[m.b.entrantId];
        const aR = aPid ? rec[aPid] : null, bR = bPid ? rec[bPid] : null;
        if (!aR || !bR) return;
        if (m.result.winner === "a") { aR.wins++; bR.losses++; }
        else if (m.result.winner === "b") { bR.wins++; aR.losses++; }
        aR.gw += m.result.aGames || 0; aR.gl += m.result.bGames || 0;
        aR.pw += m.result.aPoints || 0; aR.pl += m.result.bPoints || 0;
        bR.gw += m.result.bGames || 0; bR.gl += m.result.aGames || 0;
        bR.pw += m.result.bPoints || 0; bR.pl += m.result.aPoints || 0;
      });
      const rows = Object.values(rec).sort((x, y) =>
        (y.wins - x.wins) || ((y.gw - y.gl) - (x.gw - x.gl)) || ((y.pw - y.pl) - (x.pw - x.pl)));
      return { name: g.name, rows: rows };
    });
  }

  return { finalRanking, teamStandings };
})();
