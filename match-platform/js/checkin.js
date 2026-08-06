/* checkin.js — 签到逻辑 */
window.Checkin = (function () {
  function presentPlayers(disc) {
    return Store.allPlayers().filter(p => p.present && p.disciplines.includes(disc.code));
  }
  function toggle(playerId) {
    const p = Store.getPlayer(playerId);
    if (p) {
      p.present = !p.present;
      p.checkinAt = p.present ? new Date().toISOString() : null;
      Store.save();
    }
  }
  function markAll(present) {
    Store.allPlayers().forEach(p => {
      p.present = present;
      p.checkinAt = present ? new Date().toISOString() : null;
    });
    Store.save();
  }
  function summary() {
    const players = Store.allPlayers();
    const total = players.length;
    const present = players.filter(p => p.present).length;
    const byDisc = {};
    players.forEach(p => p.disciplines.forEach(d => {
      byDisc[d] = (byDisc[d] || 0) + (p.present ? 1 : 0);
    }));
    return { total, present, absent: total - present, byDisc };
  }
  return { presentPlayers, toggle, markAll, summary };
})();
