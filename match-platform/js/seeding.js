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

  /* ---------- 团体赛：手选分组 + 组内循环赛 ---------- */
  const TEAM_MAX_GROUPS = 8;
  const GROUP_LETTERS = "ABCDEFGH";

  // 圆桌法生成单组循环赛对阵（返回 [{a,b,round,slot}]，entrantId）
  function roundRobin(list) {
    const res = [];
    const n = list.length;
    if (n < 2) return res;
    let arr = list.slice();
    if (n % 2) arr.push(null); // 奇数人：每轮一人轮空
    const m = arr.length;
    const rounds = m - 1;
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < m / 2; i++) {
        const a = arr[i], b = arr[m - 1 - i];
        if (a && b) res.push({ a: a.id, b: b.id, round: r + 1, slot: i });
      }
      // 固定首位，其余轮转
      const fixed = arr[0];
      const rest = arr.slice(1);
      rest.push(rest.shift());
      arr = [fixed].concat(rest);
    }
    return res;
  }

  // 把选手分配到各组的 entrants（单人单元，带 groupName 标记）
  function buildTeamEntrants(disc) {
    const entrants = [];
    (disc.groups || []).forEach(g => {
      (g.playerIds || []).forEach(pid => {
        const p = Store.getPlayer(pid);
        entrants.push({
          id: Store.uid("E"), kind: "player", playerIds: [pid],
          label: p ? p.name : "?", seed: 0, status: "active", groupName: g.name
        });
      });
    });
    return entrants;
  }

  function generateTeamMatches(disc) {
    const entrants = buildTeamEntrants(disc);
    disc.entrants = entrants;
    const eByPid = {};
    entrants.forEach(e => { if (e.playerIds && e.playerIds[0]) eByPid[e.playerIds[0]] = e; });

    const matches = [];
    let maxRounds = 0;
    (disc.groups || []).forEach(g => {
      const gEntrants = g.playerIds
        .map(pid => eByPid[pid])
        .filter(Boolean);
      const pairs = roundRobin(gEntrants);
      pairs.forEach(pm => {
        matches.push({
          id: Store.uid("M"), stage: "group", groupId: g.name, groupName: g.name,
          round: pm.round, slotIndex: pm.slot, roundLabel: "第" + pm.round + "轮",
          a: { entrantId: pm.a, source: { type: "seed" } },
          b: { entrantId: pm.b, source: { type: "seed" } },
          nextMatchId: null, nextSlot: null, loserNextMatchId: null, loserNextSlot: null,
          result: null, status: "ready", court: ""
        });
      });
      const r = pairs.length ? Math.max.apply(null, pairs.map(p => p.round)) : 0;
      if (r > maxRounds) maxRounds = r;
    });

    disc.matches = matches;
    disc.totalRounds = maxRounds;
    disc.bracketSize = entrants.length;
    disc.byeCount = 0;
    disc.status = "drawn";
    Scoring.propagateInitial(disc); // 组内无轮空，仅置 ready
    Store.save();
    return { matches: matches, groups: (disc.groups || []).length };
  }

  return { buildEntrants, assignSeeds, makeBracket, missingPartner, DISC_SIZE,
    roundRobin, buildTeamEntrants, generateTeamMatches, TEAM_MAX_GROUPS, GROUP_LETTERS };
})();
