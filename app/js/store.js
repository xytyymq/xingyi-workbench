// 星羿家长端 · 数据访问层（纯静态版）
// ============================================================
// 原后端 b74f149…app.workbuddy.host 已被 WorkBuddy 平台回收（返回 403「链接不完整」），
// 故家长端改为纯静态：不再发起任何后端请求。所有「写」操作降级为本地 no-op，
// 所有「读」操作返回安全默认值或走 GitHub Pages 静态 JSON（data/growth.json 等），
// 任何情况下都不抛错 —— 这是根除「后端 403 导致白屏/报错」的关键。
// 核心价值（看体测报告 / 成长 / 积分 / 消息）全部由静态数据支撑，不受后端影响。
// ============================================================

window.TRIAL_CONFIG = window.TRIAL_CONFIG || {};
// 纯静态模式：强制禁用后端
window.TRIAL_CONFIG.API_BASE = "";

const API_BASE = "";

// 纯静态：不发起任何网络请求，直接返回错误标记（调用方均按 error 安全处理）
async function api(path, opts = {}) {
  return { error: "static-mode" };
}

const Store = {
  // 预约：不再写后端，返回传入对象即可（UI 已改为引导加微信）
  async getBookings(childId) { return []; },
  async addBooking(childId, b) { return b || {}; },

  // 体测报告：改为读静态 profiles.json（见 app.js fetchProfiles），此处返回 null 安全兜底
  async getReport(childId) { return null; },
  async saveReport(childId, report) { return {}; },
  async saveParentSurvey(childId, parent) { return {}; },
  async saveCoachEntry(childId, entry) { return {}; },
  async adminBookings(key) { return {}; },

  // 手机号找回：降级为本地登录（app.js 登录流程已有本地兜底）
  async lookupPhone(phone) { return []; },

  // 成长数据：优先静态 data/growth.json（保留原兜底逻辑，确保不白屏）
  async getGrowth(childId, name) {
    try {
      const r = await fetch("../data/growth.json?t=" + Date.now(), { cache: "no-store" });
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
    return { classes: [], awards: [], source: "static" };
  },

  // 反馈：不再写后端
  async addFeedback(childId, name, text) { return null; },
  async getMyFeedback(childId) { return []; }
};
