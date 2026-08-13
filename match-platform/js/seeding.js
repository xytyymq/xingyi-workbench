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

  /* ---------- 团体赛：手选分组 + 组间循环赛（整组当整体记总比分） ---------- */
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

  // 组间循环赛：每个"组"当作一支队伍，组与组之间两两循环
  // entrants = 各组（团队单元）；match.stage = "team"，记录双方整组总比分
  function generateTeamMatches(disc) {
    const groups = (disc.groups || []).filter(g => (g.playerIds || []).length > 0);
    if (groups.length < 2) return { matches: [], groups: groups.length };

    // 各组作为一支队伍的参赛单元
    const entrants = groups.map(g => ({
      id: Store.uid("E"), kind: "team", groupName: g.name, label: g.name,
      playerIds: g.playerIds.slice(), seed: 0, status: "active"
    }));
    disc.entrants = entrants;

    // 在"组"之间做循环赛（roundRobin 作用于组 entrant 列表）
    const pairs = roundRobin(entrants); // [{a,b,round,slot}]，a/b 为 entrantId
    const matches = pairs.map(pm => ({
      id: Store.uid("M"), stage: "team", round: pm.round, slotIndex: pm.slot,
      roundLabel: "第" + pm.round + "轮",
      a: { entrantId: pm.a }, b: { entrantId: pm.b },
      nextMatchId: null, nextSlot: null, loserNextMatchId: null, loserNextSlot: null,
      result: null, status: "ready", court: ""
    }));

    disc.matches = matches;
    disc.totalRounds = pairs.length ? Math.max.apply(null, pairs.map(p => p.round)) : 0;
    disc.bracketSize = entrants.length;
    disc.byeCount = 0;
    disc.status = "drawn";
    Store.save();
    return { matches: matches, groups: groups.length };
  }

  return { buildEntrants, assignSeeds, makeBracket, missingPartner, DISC_SIZE,
    roundRobin, generateTeamMatches, TEAM_MAX_GROUPS, GROUP_LETTERS };
})();
