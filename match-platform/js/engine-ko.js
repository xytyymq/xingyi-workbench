/* engine-ko.js — 单败淘汰对阵生成（D1 算法）
 * 满二叉树骨架 + 标准种子位序 + 轮空归种子 + nextMatchId/nextSlot 预连。
 */
window.KO = (function () {
  function nextPowerOfTwo(n) { let p = 1; while (p < n) p *= 2; return p; }

  function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
      const n = order.length * 2 + 1;
      const next = [];
      for (const s of order) { next.push(s); next.push(n - s); }
      order = next;
    }
    return order;
  }

  function labelOf(r, total) {
    const rem = total - r;
    if (rem === 0) return "决赛";
    if (rem === 1) return "半决赛";
    if (rem === 2) return "1/4决赛";
    if (rem === 3) return "1/8决赛";
    if (rem === 4) return "1/16决赛";
    return "第" + r + "轮";
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function orderEntrants(entrants) {
    const seeded = entrants.filter(e => e.seed > 0).sort((a, b) => a.seed - b.seed);
    const unseeded = shuffle(entrants.filter(e => e.seed === 0));
    return seeded.concat(unseeded);
  }

  function generate(entrants, opts) {
    opts = opts || {};
    const N = entrants.length;
    if (N < 2) return { matches: [], totalRounds: 0, size: N, byeCount: 0 };
    const size = nextPowerOfTwo(N);
    const byeCount = size - N;
    const totalRounds = Math.log2(size);
    const so = seedOrder(size);
    const ordered = orderEntrants(entrants);
    const slots = new Array(size);
    for (let i = 0; i < size; i++) {
      const seedNo = so[i];
      slots[i] = (seedNo <= N) ? ordered[seedNo - 1] : null;
    }

    const matches = [];
    const byRound = {};

    // 首轮
    const r1 = [];
    for (let k = 0; k < size / 2; k++) {
      const aId = slots[2 * k] ? slots[2 * k].id : null;
      const bId = slots[2 * k + 1] ? slots[2 * k + 1].id : null;
      r1.push({
        id: Store.uid("M"), stage: "ko", round: 1, slotIndex: k,
        roundLabel: labelOf(1, totalRounds),
        a: { entrantId: aId, source: { type: aId ? "seed" : "bye" } },
        b: { entrantId: bId, source: { type: bId ? "seed" : "bye" } },
        nextMatchId: null, nextSlot: null, loserNextMatchId: null, loserNextSlot: null,
        result: null, status: "pending", court: ""
      });
    }
    byRound[1] = r1; matches.push.apply(matches, r1);

    // 后续轮
    for (let r = 2; r <= totalRounds; r++) {
      const prev = byRound[r - 1];
      const cur = [];
      for (let k = 0; k < prev.length / 2; k++) {
        const m = {
          id: Store.uid("M"), stage: "ko", round: r, slotIndex: k,
          roundLabel: labelOf(r, totalRounds),
          a: { entrantId: null, source: { type: "winner", matchId: prev[2 * k].id } },
          b: { entrantId: null, source: { type: "winner", matchId: prev[2 * k + 1].id } },
          nextMatchId: null, nextSlot: null, loserNextMatchId: null, loserNextSlot: null,
          result: null, status: "pending", court: ""
        };
        prev[2 * k].nextMatchId = m.id; prev[2 * k].nextSlot = "a";
        prev[2 * k + 1].nextMatchId = m.id; prev[2 * k + 1].nextSlot = "b";
        cur.push(m);
      }
      byRound[r] = cur; matches.push.apply(matches, cur);
    }

    // 三四名决赛
    if (opts.thirdPlace && totalRounds >= 2) {
      const sf = byRound[totalRounds - 1];
      const third = {
        id: Store.uid("M"), stage: "third", round: totalRounds, slotIndex: 1,
        roundLabel: "三四名决赛",
        a: { entrantId: null, source: { type: "loser", matchId: sf[0].id } },
        b: { entrantId: null, source: { type: "loser", matchId: sf[1].id } },
        nextMatchId: null, nextSlot: null, loserNextMatchId: null, loserNextSlot: null,
        result: null, status: "pending", court: ""
      };
      sf[0].loserNextMatchId = third.id; sf[0].loserNextSlot = "a";
      sf[1].loserNextMatchId = third.id; sf[1].loserNextSlot = "b";
      matches.push(third);
    }

    return { matches, totalRounds, size, byeCount };
  }

  return { generate, nextPowerOfTwo, seedOrder, labelOf };
})();
