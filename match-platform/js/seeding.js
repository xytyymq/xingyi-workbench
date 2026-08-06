/* seeding.js — 分组/配对/种子 + 生成单淘对阵
 * 核心抽象 Entrant：单打=1人 / 双打=1对。四大引擎只认 Entrant。
 */
window.Seeding = (function () {
  const DISC_SIZE = { MS: 1, WS: 1, MD: 2, WD: 2, XD: 2 };

  function buildEntrants(disc) {
    const code = disc.code;
    const size = DISC_SIZE[code] || 1;
    const present = Store.allPlayers().filter(p => p.present && p.disciplines.includes(code));
    if (size === 1) {
      return present.map(p => ({
        id: Store.uid("E"), kind: "player", playerIds: [p.id],
        label: p.name, seed: 0, status: "active"
      }));
    }
    // 双打：报名成对（选手 + 搭档）
    const pairs = [];
    const seen = new Set();
    for (const p of present) {
      if (!p.partner) continue;
      const key = [p.name, p.partner].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        id: Store.uid("E"), kind: "pair", playerIds: [p.id],
        label: p.name + "/" + p.partner, seed: 0, status: "active"
      });
    }
    return pairs;
  }

  function levelOf(e) {
    if (e.playerIds && e.playerIds[0]) {
      const p = Store.getPlayer(e.playerIds[0]);
      if (p && p.level) return p.level;
    }
    return 99;
  }

  function assignSeeds(entrants, n) {
    const sorted = entrants.slice().sort((a, b) => levelOf(a) - levelOf(b));
    sorted.forEach((e, i) => { e.seed = (i < n) ? i + 1 : 0; });
    return entrants;
  }

  function makeBracket(disc) {
    let entrants = buildEntrants(disc);
    if (disc.seedCount && disc.seedCount > 0) assignSeeds(entrants, disc.seedCount);
    const res = KO.generate(entrants, { thirdPlace: disc.thirdPlace !== false });
    disc.entrants = entrants;
    disc.matches = res.matches;
    disc.totalRounds = res.totalRounds;
    disc.bracketSize = res.size;
    disc.byeCount = res.byeCount;
    disc.status = "drawn";
    Scoring.propagateInitial(disc); // 轮空自动判胜
    Store.save();
    return res;
  }

  function missingPartner(disc) {
    // 报了双打项目但没填搭档的到场选手
    const code = disc.code;
    return Store.allPlayers().filter(p =>
      p.present && p.disciplines.includes(code) && !p.partner);
  }

  return { buildEntrants, assignSeeds, makeBracket, missingPartner, DISC_SIZE };
})();
