/* seeding.js — 分组/配对/种子 + 生成单淘对阵
 * 核心抽象 Entrant：单打=1人 / 双打=1对。四大引擎只认 Entrant。
 */
window.Seeding = (function () {
  const DISC_SIZE = { MS: 1, WS: 1, MD: 2, WD: 2, XD: 2 };

  // 某单项 code 对应的性别（XD 混双不限性别 → null）
  function codeGender(code) {
    if (code === "MS" || code === "MD") return "男";
    if (code === "WS" || code === "WD") return "女";
    return null;
  }

  // 选手是否可参加某项：填了报名项目按项目；没填则按性别自动认定
  // （男→男单/男双/混双，女→女单/女双/混双，性别未知则全部可参加）
  function playerEligible(p, code) {
    const ds = (p.disciplines || []);
    if (ds.length) return ds.includes(code);
    const g = codeGender(code);
    if (!g) return true;            // 混双：无项目时任何性别均可
    return p.gender === g;
  }

  function buildEntrants(disc) {
    const code = disc.code;
    const size = DISC_SIZE[code] || 1;
    const present = Store.allPlayers().filter(p => p.present && playerEligible(p, code));
    if (size === 1) {
      return present.map(p => ({
        id: Store.uid("E"), kind: "player", playerIds: [p.id],
        label: p.name, seed: 0, status: "active"
      }));
    }
    // 双打：从名单里选取搭档（partner 存的是选手 id），解析成真实选手对
    const pairs = [];
    const seen = new Set();
    for (const p of present) {
      const partner = resolvePartner(p);
      if (!partner) continue;
      const key = [p.id, partner.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        id: Store.uid("E"), kind: "pair", playerIds: [p.id, partner.id],
        label: p.name + "/" + partner.name, seed: 0, status: "active"
      });
    }
    return pairs;
  }

  // 把 partner 字段解析成真实选手：优先按 id，兼容旧数据存的是名字
  function resolvePartner(p) {
    if (!p.partner) return null;
    let pp = Store.getPlayer(p.partner);
    if (pp) return pp;
    pp = Store.allPlayers().find(x => x.name === p.partner);
    return pp || null;
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
    // 可参加该项（含按性别自动认定）但未从名单选取搭档的到场选手
    const code = disc.code;
    return Store.allPlayers().filter(p =>
      p.present && playerEligible(p, code) && !resolvePartner(p));
  }

  /* ---------- 团体赛：手选分组 + 多种赛制 ---------- */
  const TEAM_MAX_GROUPS = 8;
  const GROUP_LETTERS = "ABCDEFGH";

  // 团体赛赛制预设（discipline 模式 = 队间循环 + 每对阵拆成多个分项小场，分项计分、整队按分项胜场定胜负）
  // overall 模式保留原「整组整体记总比分」玩法。
  const TEAM_FORMATS = {
    overall:   { label: "整组整体赛（原）", mode: "overall", slots: function () { return []; } },
    thomas:    {
      label: "分项团体·汤尤杯式", mode: "discipline", genderBased: true,
      slots: function () {
        return [
          { key: "S1", kind: "S", name: "第一单打" },
          { key: "S2", kind: "S", name: "第二单打" },
          { key: "S3", kind: "S", name: "第三单打" },
          { key: "D1", kind: "D", name: "第一双打" },
          { key: "D2", kind: "D", name: "第二双打" }
        ];
      }
    },
    sudirman:  {
      label: "混合团体·苏迪曼杯式", mode: "discipline",
      slots: function () {
        return [
          { key: "XD", code: "XD", name: "混合双打" },
          { key: "MS", code: "MS", name: "男子单打" },
          { key: "WS", code: "WS", name: "女子单打" },
          { key: "MD", code: "MD", name: "男子双打" },
          { key: "WD", code: "WD", name: "女子双打" }
        ];
      }
    },
    amateur:   {
      label: "业余五场混合", mode: "discipline", slotsEditable: true,
      slots: function () {
        return [
          { key: "D1", code: "MD", name: "男子双打" },
          { key: "X1", code: "XD", name: "混合双打" },
          { key: "D2", code: "MD", name: "男子双打" },
          { key: "X2", code: "XD", name: "混合双打" },
          { key: "D3", code: "MD", name: "男子双打" }
        ];
      }
    }
  };

  // 取某 slot 对应的单项 code（thomas 的 S/D 按队伍性别派生 MS/WS/MD/WD）
  function slotCodeOf(disc, slot) {
    if (slot.code) return slot.code;
    const g = (disc.teamGender === "女") ? "W" : "M";
    return slot.kind === "D" ? g + "D" : g + "S";
  }

  // 取某赛制当前的 slot 列表（discipline 模式用 disc.teamSlots，否则用预设）
  function currentSlots(disc) {
    if (disc.teamFormat && disc.teamFormat !== "overall") {
      if (disc.teamSlots && disc.teamSlots.length) return disc.teamSlots;
      const fmt = TEAM_FORMATS[disc.teamFormat];
      return fmt ? fmt.slots() : [];
    }
    return [];
  }

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
  // entrants = 各组（团队单元）；match.stage = "team"
  //  - overall 模式：记录双方整组总比分
  //  - discipline 模式：每对阵拆成若干分项小场（subs），分项计分、整队按分项胜场定胜负
  function generateTeamMatches(disc) {
    if (disc.teamFormat && disc.teamFormat !== "overall") return generateDisciplineTeam(disc);
    return generateOverallTeam(disc);
  }

  function generateOverallTeam(disc) {
    const groups = (disc.groups || []).filter(g => (g.playerIds || []).length > 0);
    if (groups.length < 2) return { matches: [], groups: groups.length };

    // 各组作为一支队伍的参赛单元
    const entrants = groups.map(g => ({
      id: Store.uid("E"), kind: "team", groupName: g.name, label: g.name,
      playerIds: g.playerIds.slice(), seed: 0, status: "active"
    }));
    disc.entrants = entrants;

    const pairs = roundRobin(entrants); // [{a,b,round,slot}]，a/b 为 entrantId
    const matches = pairs.map(pm => ({
      id: Store.uid("M"), stage: "team", format: "overall", round: pm.round, slotIndex: pm.slot,
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

  // discipline 模式：队间循环，每对阵生成 teamSlots 个分项小场
  function generateDisciplineTeam(disc) {
    const teams = (disc.groups || []).filter(g => (g.playerIds || []).length > 0);
    if (teams.length < 2) return { matches: [], groups: teams.length };

    const entrants = teams.map(g => ({
      id: Store.uid("E"), kind: "team", groupName: g.name, label: g.name,
      playerIds: g.playerIds.slice(), seed: 0, status: "active"
    }));
    disc.entrants = entrants;

    const entByTeam = {};
    teams.forEach((g, i) => { entByTeam[entrants[i].id] = g; });

    const slots = currentSlots(disc);
    if (!slots.length) return { matches: [], groups: teams.length };

    const pairs = roundRobin(entrants); // [{a,b,round,slot}]
    const matches = pairs.map(pm => {
      const ag = entByTeam[pm.a], bg = entByTeam[pm.b];
      const subs = slots.map(s => ({
        slotKey: s.key, code: slotCodeOf(disc, s), name: s.name,
        a: { playerIds: ((ag.lineup && ag.lineup[s.key]) || []).slice() },
        b: { playerIds: ((bg.lineup && bg.lineup[s.key]) || []).slice() },
        result: null
      }));
      return {
        id: Store.uid("M"), stage: "team", format: "discipline", round: pm.round, slotIndex: pm.slot,
        roundLabel: "第" + pm.round + "轮",
        a: { entrantId: pm.a }, b: { entrantId: pm.b },
        subs: subs, result: null, status: "ready", court: ""
      };
    });

    disc.matches = matches;
    disc.totalRounds = pairs.length ? Math.max.apply(null, pairs.map(p => p.round)) : 0;
    disc.bracketSize = entrants.length;
    disc.byeCount = 0;
    disc.status = "drawn";
    Store.save();
    return { matches: matches, groups: teams.length };
  }

  return { buildEntrants, assignSeeds, makeBracket, missingPartner, DISC_SIZE,
    roundRobin, generateTeamMatches, TEAM_MAX_GROUPS, GROUP_LETTERS,
    TEAM_FORMATS, slotCodeOf, currentSlots };
})();
