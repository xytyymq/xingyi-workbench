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
  },
  // 手机号找回孩子（老生换设备/写法不一致）：只返回 [{childId, name}]，不含手机号
  async lookupPhone(phone) {
    const j = await api("/api/lookup?phone=" + encodeURIComponent(phone));
    return j.children || [];
  },
  // 成长数据：上课记录（按姓名匹配）+ 奖状
  // 优先后端接口；后端不可用（平台网关异常等）时回退 Pages 静态快照 data/growth.json
  async getGrowth(childId, name) {
    const q = "childId=" + encodeURIComponent(childId || "") + "&name=" + encodeURIComponent(name || "");
    const j = await api("/api/growth?" + q);
    if (!j.error) return { classes: j.classes || [], awards: j.awards || [], source: "live" };
    try {
      const r = await fetch("../../data/growth.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) {
        const s = await r.json();
        const key = String(name || "").replace(/\s/g, "");
        const pick = obj => {
          if (!obj) return [];
          const hit = Object.keys(obj).find(k => k.replace(/\s/g, "") === key);
          return hit ? obj[hit] : [];
        };
        const classes = pick(s.classes).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
        return { classes, awards: pick(s.awards), source: "static", updated: s.updated || "" };
      }
    } catch (e) { /* 静态也取不到 */ }
    throw new Error(j.error);
  },
  // 家长反馈：提交 + 查自己的反馈
  async addFeedback(childId, name, text) {
    const j = await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ childId, name, text })
    });
    if (j.error) throw new Error(j.error);
    return j.feedback || null;
  },
  async getMyFeedback(childId) {
    const j = await api("/api/feedback?childId=" + encodeURIComponent(childId));
    if (j.error) throw new Error(j.error);
    return j.feedback || [];
  }
};
