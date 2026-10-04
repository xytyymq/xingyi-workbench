// Phase 1 mock 数据（按孩子姓名匹配示例；真实数据 Phase 2 由馆端回流）
const Data = {
  // 体测报告（静态+动态，含跳绳）：按孩子姓名返回；未知返回默认待评
  reportFor(child) {
    const samples = {
      "小明": {
        age: 7,
        items: [
          { k: "身高", v: "122cm", r: "超过同龄 60%" },
          { k: "协调性", v: "良好", r: "球感不错", tag: "ok" },
          { k: "力量", v: "待提升", r: "建议每天跳绳 100 个", tag: "warn" },
          { k: "敏捷", v: "中等", r: "步法需多练", tag: "warn" }
        ],
        note: "小明协调性很好，只要把力量和步法补上，进步会很快。建议先报启蒙班打基础。"
      },
      "朵朵": {
        age: 6,
        items: [
          { k: "身高", v: "115cm", r: "同龄平均" },
          { k: "协调性", v: "优秀", r: "天赋型", tag: "ok" },
          { k: "力量", v: "中等", r: "日常可练" },
          { k: "敏捷", v: "良好", r: "反应快", tag: "ok" }
        ],
        note: "朵朵是天赋型，协调性和敏捷都很好，适合早点系统训练，别错过窗口期。"
      }
    };
    return samples[child.name] || {
      age: "—",
      items: [
        { k: "协调性", v: "待评估", r: "试课中由教练测评" },
        { k: "力量", v: "待评估", r: "试课中由教练测评" },
        { k: "敏捷", v: "待评估", r: "试课中由教练测评" },
        { k: "跳绳", v: "待评估", r: "动态项，试课中测评" }
      ],
      note: "孩子刚预约试课，到店后由教练做体测初评，报告会自动显示在这里。"
    };
  },
  growthFor(child) {
    return [
      { date: "试课后", title: "试课完成", desc: "教练点评孩子的协调性、力量、敏捷", done: false },
      { date: "第 1 周", title: "体测初评", desc: "生成专属体测报告（本页）", done: false },
      { date: "第 2 周", title: "正式开课", desc: "按推荐班型排课", done: false }
    ];
  },
  messagesFor(child) {
    return [
      { date: "待发送", title: "体测报告", desc: "试课后由系统自动推送", unread: true },
      { date: "待发送", title: "3 天跟进", desc: "顾问跟进报名优惠", unread: false }
    ];
  },
  // 真实家长消息：拉 Pages 上的 parent-msg.json，按孩子名过滤出自己的训练反馈
  async parentMessagesFor(child) {
    const name = (child && child.name || "").trim();
    const dateKey = s => { const p = String(s).split("."); return (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0); };
    try {
      const r = await fetch("../../data/parent-msg.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return [];
      const data = await r.json();
      const msgs = data.messages || {};
      const out = [];
      for (const dk of Object.keys(msgs)) {
        for (const e of (msgs[dk] || [])) {
          const names = e.names || [];
          const hit = names.some(n => {
            n = (n || "").trim();
            return n && (n === name || n.includes(name) || name.includes(n));
          });
          if (hit) out.push({ date: dk, msg: e.msg || "" });
        }
      }
      out.sort((a, b) => dateKey(b.date) - dateKey(a.date));
      return out;
    } catch (e) { return []; }
  },
  TIME_SLOTS: ["周二 18:00", "周四 18:00", "周五 18:00", "周六 18:00", "周日 18:00", "周六 10:00", "周六 16:00", "周日 10:00", "周日 16:00"]
};
