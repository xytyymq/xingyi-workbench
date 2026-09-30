// Phase 2/3 数据访问层：前端 → 后端 KV 服务
// API_BASE 来自 js/config.js：空字符串 "" = 同源（前端与后端同一端口部署），
// 其他值 = 后端公网地址。注意：空串是 falsy，必须显式判断 undefined，不能用 ||。
const cfgBase = window.TRIAL_CONFIG && window.TRIAL_CONFIG.API_BASE;
const API_BASE = (cfgBase !== undefined && cfgBase !== null) ? cfgBase : "http://192.168.1.27:8089";

async function api(path, opts = {}) {
  const url = API_BASE + path;
  try {
    const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (!r.ok) return { error: "http " + r.status };
    return await r.json();
  } catch (e) { return { error: String(e) }; }
}

const Store = {
  // 预约
  async getBookings(childId) {
    const j = await api("/api/bookings?childId=" + encodeURIComponent(childId));
    return j.bookings || [];
  },
  async addBooking(childId, b) {
    const j = await api("/api/booking", {
      method: "POST",
      body: JSON.stringify({ childId, time: b.time, phone: b.phone || "", name: b.name || "" })
    });
    return j.booking || b;
  },
  // 体测报告（Phase 2 起真实存储；无数据时馆端可用 mock 兜底）
  async getReport(childId) {
    const j = await api("/api/report?childId=" + encodeURIComponent(childId));
    return j.report;
  },
  async saveReport(childId, report) {
    return await api("/api/report", { method: "POST", body: JSON.stringify({ childId, report }) });
  },
  // 家长问卷：GET 旧报告 → 合并 parent（保留教练 entries）→ POST
  async saveParentSurvey(childId, parent) {
    let old = null;
    try { const j = await this.getReport(childId); old = j || null; } catch { /* 忽略 */ }
    const merged = { ...(old || {}), parent, updatedAt: new Date().toISOString() };
    return await api("/api/report", { method: "POST", body: JSON.stringify({ childId, report: merged }) });
  },
  // 教练体测：GET 旧报告 → 追加 entry（保留家长 parent）→ POST
  async saveCoachEntry(childId, entry) {
    let old = null;
    try { const j = await this.getReport(childId); old = j || null; } catch { /* 忽略 */ }
    const entries = (old && old.entries ? old.entries : []).concat(entry);
    const merged = { ...(old || {}), entries, updatedAt: new Date().toISOString() };
    return await api("/api/report", { method: "POST", body: JSON.stringify({ childId, report: merged }) });
  },
  // 馆长聚合接口
  async adminBookings(key) {
    const j = await api("/api/admin/bookings?key=" + encodeURIComponent(key));
    return j;
  }
};
