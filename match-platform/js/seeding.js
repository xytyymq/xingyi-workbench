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
    },
    league:    { label: "全员项目联赛（新）", mode: "league" }
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
    if (disc.teamFormat === "league") return generateLeagueTeam(disc);
    if (disc.teamFormat && disc.teamFormat !== "overall") return generateDisciplineTeam(disc);
    return generateOverallTeam(disc);
  }

  /* 全员项目联赛：
   * 每个项目（男单/女单/男双/女双/混双）各自做"跨组循环"——
   * 把各组同名组合放进同一项目池，每组每个组合与其他各组同名组合各打一次。
   * 团队总分 = 该队所有组合在所有比赛中的"实际得分累计"，按总分排 1-4 名。
   * 出场：单打人人上；双打组内自动两两配对（XD 男女配对），保证全员有上场。
   */
  function leagueCombosForEvent(disc, group, code) {
    const elig = (group.playerIds || []).map(id => Store.getPlayer(id))
      .filter(p => p && playerEligible(p, code));
    if (!elig.length) return [];
    const size = DISC_SIZE[code] || 1;
    if (size === 1) return elig.map(p => ({ playerIds: [p.id], label: p.name }));
    if (code === "XD") {
      const men = elig.filter(p => p.gender === "男");
      const women = elig.filter(p => p.gender === "女");
      const n = Math.min(men.length, women.length);
      const out = [];
      for (let i = 0; i < n; i++) out.push({ playerIds: [men[i].id, women[i].id], label: men[i].name + "/" + women[i].name });
      return out; // 多余的男/女未能配对（不参赛该项）
    }
    const sorted = elig.slice();
    const out = [];
    for (let i = 0; i + 1 < sorted.length; i += 2)
      out.push({ playerIds: [sorted[i].id, sorted[i + 1].id], label: sorted[i].name + "/" + sorted[i + 1].name });
    return out; // 奇数时最后 1 人未能配对（不参赛该项）
  }

  function generateLeagueTeam(disc) {
    const events = (disc.teamEvents && disc.teamEvents.length) ? disc.teamEvents : ["MS", "WS", "MD", "WD", "XD"];
    const groups = (disc.groups || []).filter(g => (g.playerIds || []).length > 0);
    if (groups.length < 2) return { matches: [], groups: groups.length };

    const groupCombos = {}; // groupName -> { event -> [combo] }
    groups.forEach(g => {
      groupCombos[g.name] = {};
      events.forEach(code => { groupCombos[g.name][code] = leagueCombosForEvent(disc, g, code); });
    });

    const matches = [];
    events.forEach((code, ei) => {
      const withCombos = groups.filter(g => (groupCombos[g.name][code] || []).length > 0);
      for (let x = 0; x < withCombos.length; x++) {
        for (let y = x + 1; y < withCombos.length; y++) {
          const gx = withCombos[x], gy = withCombos[y];
          (groupCombos[gx.name][code] || []).forEach(cx => {
            (groupCombos[gy.name][code] || []).forEach(cy => {
              matches.push({
                id: Store.uid("M"), stage: "league", event: code,
                round: ei + 1, roundLabel: CSVUtil.DISC_BY_CODE[code] || code,
                a: { comboId: Store.uid("C"), groupId: gx.name, playerIds: cx.playerIds.slice() },
                b: { comboId: Store.uid("C"), groupId: gy.name, playerIds: cy.playerIds.slice() },
                result: null, status: "ready", court: ""
              });
            });
          });
        }
      }
    });

    disc.entrants = groups.map(g => ({
      id: g.name, kind: "team", groupName: g.name, label: g.name,
      playerIds: g.playerIds.slice(), seed: 0, status: "active"
    }));
    disc.matches = matches;
    disc.totalRounds = events.length;
    disc.bracketSize = groups.length;
    disc.byeCount = 0;
    disc.status = "drawn";
    Store.save();
    return { matches: matches, groups: groups.length };
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

  /* ============================================================
   *  双打轮转赛（俱乐部活动 / 打水赛）
   *  - eight  八人转：每人与其余人各搭档 1 次（全搭档），按个人积分排名
   *  - super8 超八转：每人与随机 8 人各搭档 1 次（10~50 人），按个人积分排名
   *  - mixed  混双转：每男与每女各搭档 1 次（需男女相等），男女分别排名
   *  - fixed  固搭转：报名固定搭档，组合间循环赛，按组合积分排名
   *  统一产出 match：a/b 各含 playerIds:[2人]，stage:"rotation"，无晋级链。
   * ========================================================== */
  const ROTATION_MODES = {
    eight:  { label: "八人转（4~13人·全搭档）", partners: 0 },
    super8: { label: "超八转（10~50人·随机8搭档）", partners: 8 },
    mixed:  { label: "混双转（男=女·男女各搭档）", partners: -1 },
    fixed:  { label: "固搭转（固定搭档·组合循环）", partners: -2 }
  };

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 取轮转赛参赛选手（到场即可，不要求报名项目；混双按性别分）
  function rotationPlayers(disc) {
    const list = Store.allPlayers().filter(p => p.present).map(p => ({ id: p.id, gender: p.gender || "" }));
    if (disc.rotationMode === "mixed") {
      const men = list.filter(p => p.gender === "男");
      const women = list.filter(p => p.gender === "女");
      return { men, women, all: list };
    }
    return { men: [], women: [], all: list };
  }

  // 构造搭档关系（边）：返回 [{a,b}]（a,b 为 playerId，可能含 "DUMMY" 表示轮空）
  function buildRotationEdges(mode, players) {
    const edges = [];
    if (mode === "eight") {
      let ps = players.all.slice();
      if (ps.length % 2) ps = ps.concat([{ id: "DUMMY", gender: "" }]); // 奇数人：每轮 1 人轮空
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) edges.push({ a: ps[i].id, b: ps[j].id });
    } else if (mode === "super8") {
      // 每人恰好与 8 名不同选手搭档：用环形构造（前后各 4 人）保证 8-正则且完全对称，
      // 先随机打乱顺序以增加变化，再按环上距离 1..4 双向连边。n>=9 时每人恰 8 个搭档。
      const ids = shuffle(players.all.map(p => p.id));
      const n = ids.length, half = Math.min(4, Math.floor((n - 1) / 2));
      for (let i = 0; i < n; i++) {
        for (let k = 1; k <= half; k++) {
          const j1 = (i + k) % n, j2 = (i - k + n) % n;
          if (j1 !== j2) { edges.push({ a: ids[i], b: ids[j1] }); edges.push({ a: ids[i], b: ids[j2] }); }
          else edges.push({ a: ids[i], b: ids[j1] });
        }
      }
      // 去重（环形构造会让每条边被两端各加一次）
      const seen = new Set();
      const dedup = [];
      edges.forEach(e => { const key = [e.a, e.b].sort().join("|"); if (!seen.has(key)) { seen.add(key); dedup.push(e); } });
      return dedup;
    } else if (mode === "mixed") {
      const men = players.men.map(p => p.id), women = players.women.map(p => p.id);
      men.forEach(m => women.forEach(w => edges.push({ a: m, b: w })));
    }
    return edges;
  }

  // 边着色：把边拆成若干轮，每轮内任意两边不共享顶点（每轮可同时开，无冲突）
  function colorEdges(edges) {
    const rounds = []; // [{used:Set, list:[edge]}]
    for (const e of edges) {
      let placed = false;
      for (const r of rounds) {
        if (!r.used.has(e.a) && !r.used.has(e.b)) { r.used.add(e.a); r.used.add(e.b); r.list.push(e); placed = true; break; }
      }
      if (!placed) rounds.push({ used: new Set([e.a, e.b]), list: [e] });
    }
    return rounds.map(r => r.list);
  }

  // 全局把边两两配成一场：每条边找一个不共享顶点的搭档边（2 条边=4 人=双打对阵）
  // 用「按顶点度数降序、优先与相邻边配对」的贪心，保证全部边都被使用（不丢场次）
  // 把搭档边两两配对成一场双打（每条边=一对搭档，一场=两条不相交边=4人）。
  // 8-正则图的边集一定能完美匹配，但固定顺序贪心偶发失败，故加随机重试。
  function pairEdges(edges) {
    const n = edges.length;
    if (!n) return [];
    const conflict = (e, f) => !(f.a !== e.a && f.a !== e.b && f.b !== e.a && f.b !== e.b);
    // 确定性兜底：按端点度数降序的贪心（多数小图能一次成功）
    function attempt(order) {
      const used = new Set();
      const matched = [];
      for (const ei of order) {
        if (used.has(ei)) continue;
        const e = edges[ei];
        let best = -1;
        for (const fi of order) {
          if (used.has(fi) || fi === ei) continue;
          if (!conflict(e, edges[fi])) { best = fi; break; }
        }
        if (best < 0) return null;        // 该顺序无法完美匹配
        used.add(ei); used.add(best);
        matched.push([e, edges[best]]);
      }
      return matched;
    }
    // 先试确定性顺序，再随机重试若干次，确保拿到完美匹配
    const deg = {};
    edges.forEach(e => { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    const base = edges.map((_, i) => i).sort((x, y) => (deg[edges[y].a] + deg[edges[y].b]) - (deg[edges[x].a] + deg[edges[x].b]));
    let r = attempt(base);
    if (r) return r;
    for (let t = 0; t < 200; t++) {
      const o = shuffle(edges.map((_, i) => i));
      r = attempt(o);
      if (r) return r;
    }
    return r || []; // 理论上不会走到这里
  }

  // 把配对好的场贪心着色成轮次（每轮内任意两场不共享选手），并标注台号
  function scheduleMatches(matched, mode, courtCount) {
    const rounds = []; // [{used:Set, list:[match]}]
    matched.forEach(pair => {
      const verts = [pair[0].a, pair[0].b, pair[1].a, pair[1].b];
      let placed = false;
      for (const r of rounds) {
        if (verts.every(v => !r.used.has(v))) { verts.forEach(v => r.used.add(v)); r.list.push(pair); placed = true; break; }
      }
      if (!placed) rounds.push({ used: new Set(verts), list: [pair] });
    });
    const matches = [];
    rounds.forEach((r, ri) => {
      const roundNo = ri + 1;
      r.list.forEach((pair, ci) => {
        const e1 = pair[0], e2 = pair[1];
        matches.push({
          id: Store.uid("M"), stage: "rotation", rotationMode: mode,
          round: roundNo, roundLabel: "第" + roundNo + "轮",
          court: courtCount > 0 ? ((ci % courtCount) + 1) : "",
          a: { playerIds: [e1.a, e1.b] }, b: { playerIds: [e2.a, e2.b] },
          result: null, status: "ready"
        });
      });
    });
    return matches;
  }

  // 固搭转：先固定组合（按名单 partner 或顺序配对），再组合间循环赛
  function buildFixedPairs(players) {
    const all = players.all;
    const pairs = [], used = new Set();
    all.forEach(p => {
      if (used.has(p.id)) return;
      const pp = Store.getPlayer(p.id);
      const partner = resolvePartner(pp);
      if (partner && !used.has(partner.id)) { pairs.push([p.id, partner.id]); used.add(p.id); used.add(partner.id); }
    });
    const rest = all.filter(p => !used.has(p.id));
    for (let i = 0; i + 1 < rest.length; i += 2) pairs.push([rest[i].id, rest[i + 1].id]);
    return pairs;
  }

  function generateRotation(disc) {
    const mode = disc.rotationMode || "eight";
    const players = rotationPlayers(disc);
    if (mode === "fixed") {
      const pairs = buildFixedPairs(players);
      if (pairs.length < 2) return { matches: [], count: 0, msg: "固定搭档不足 2 对" };
      const entrants = pairs.map((pr, i) => ({
        id: Store.uid("E"), kind: "pair", label: pr.map(id => { const p = Store.getPlayer(id); return p ? p.name : "?"; }).join("/"),
        playerIds: pr.slice(), seed: 0, status: "active"
      }));
      disc.entrants = entrants;
      const rr = roundRobin(entrants);
      const cc = disc.courtCount || 0;
      const matches = rr.map((pm, i) => ({
        id: Store.uid("M"), stage: "rotation", rotationMode: "fixed",
        round: pm.round, roundLabel: "第" + pm.round + "轮",
        court: cc > 0 ? ((i % cc) + 1) : "",
        a: { playerIds: (entrants.find(e => e.id === pm.a) || {}).playerIds || [] },
        b: { playerIds: (entrants.find(e => e.id === pm.b) || {}).playerIds || [] },
        result: null, status: "ready"
      }));
      disc.matches = matches;
      disc.totalRounds = rr.length ? Math.max.apply(null, rr.map(p => p.round)) : 0;
      disc.bracketSize = entrants.length; disc.byeCount = 0; disc.status = "drawn";
      Store.save();
      return { matches: matches, count: matches.length, pairs: pairs.length };
    }

    // eight / super8 / mixed
    if (mode === "mixed" && (players.men.length === 0 || players.women.length === 0 || players.men.length !== players.women.length))
      return { matches: [], count: 0, msg: "混双转要求男女数量相等且均>0（当前 男" + players.men.length + " 女" + players.women.length + "）" };
    const realCount = players.all.length;
    if (realCount < 4) return { matches: [], count: 0, msg: "到场人数不足 4 人" };

    const edges = buildRotationEdges(mode, players);
    const realEdges = edges.filter(e => e.a !== "DUMMY" && e.b !== "DUMMY");
    const matched = pairEdges(realEdges);
    const cc = disc.courtCount || 0;
    const matches = scheduleMatches(matched, mode, cc);
    disc.entrants = players.all.filter(p => p.id !== "DUMMY").map(p => ({ id: p.id, kind: "player", label: (Store.getPlayer(p.id) || {}).name || p.id, playerIds: [p.id], seed: 0, status: "active" }));
    disc.matches = matches;
    disc.totalRounds = matches.length ? Math.max.apply(null, matches.map(m => m.round)) : 0;
    disc.bracketSize = realCount; disc.byeCount = 0; disc.status = "drawn";
    Store.save();
    return { matches: matches, count: matches.length, players: realCount, rounds: disc.totalRounds };
  }

  return { buildEntrants, assignSeeds, makeBracket, missingPartner, DISC_SIZE,
    roundRobin, generateTeamMatches, TEAM_MAX_GROUPS, GROUP_LETTERS,
    TEAM_FORMATS, slotCodeOf, currentSlots,
    generateLeagueTeam, leagueCombosForEvent,
    generateRotation, ROTATION_MODES };
})();
