// 家长端 SPA：路由 + 登录隔离 + 4 个核心页 + 馆端聚合页（Phase 2）
let selSlot = null;
// 老生标记（有上课记录/奖状的学员隐藏「预约试课」页），本会话缓存
window._xyOld = sessionStorage.getItem("xy_old") === "1";
function markOldStudent() {
  window._xyOld = true;
  try { sessionStorage.setItem("xy_old", "1"); } catch (e) {}
  const tb = document.querySelector(".tabbar a[href='#/booking']");
  if (tb) tb.remove();
}
// 登录后预拉成长数据：有上课记录/奖状的老生立刻隐藏「预约试课」
function prefetchOldFlag(child) {
  if (window._xyOld || !child || !child.childId) return;
  Store.getGrowth(child.childId, child.name).then(g => {
    if (g && ((g.classes || []).length || (g.awards || []).length)) {
      markOldStudent();
      if ((location.hash.slice(1) || "/booking") === "/booking") render();
    }
  }).catch(() => {});
}

function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}

// ===== 系统制作 / 技术支持联系方式（消息页底部「关于本系统」）=====
// 留空的项自动隐藏；只要有一项填了就显示整块。改这里即可上线，无需动页面代码。
const CONTACT = {
  techName: "星羿系统技术支持",
  techWechat: "",   // 例：xy_tech
  techPhone: "18970260066",
  coachWechat: "15107920066",  // 馆长/教练微信（预约页展示 + 复制）
  coachPhone: "15107920066",  // 与教练微信同号
  brand: "星羿羽毛球馆 出品",
  version: "v1.3.0",
  updated: "2026-10"
};

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    try {
      const i = document.createElement("textarea");
      i.value = t; i.style.position = "absolute"; i.style.left = "-9999px";
      document.body.appendChild(i); i.select(); document.execCommand("copy");
      document.body.removeChild(i); return true;
    } catch (e2) { return false; }
  }
}

// 预约页老师微信卡：coachWechat 留空时整块不显示，避免给家长看错信息
function coachWxBlock() {
  if (!CONTACT.coachWechat) return "";
  const wx = CONTACT.coachWechat;
  return '<div class="card bk-wx"><h3>💬 加老师微信</h3>' +
    '<p class="muted" style="margin:0 0 8px;">预约后加好友，备注「孩子姓名 + 手机号」，上课提醒、体测结果第一时间收到。</p>' +
    '<div class="ab-line"><span class="muted ab-lab">微信号</span><b class="ab-id">' + esc2safe(wx) + '</b>' +
    '<button class="ab-copy" data-copy="' + esc2safe(wx) + '" data-copy-label="微信号">复制</button></div>' +
    (CONTACT.coachPhone
      ? '<div class="ab-line"><span class="muted ab-lab">电话</span><b class="ab-id">' + esc2safe(CONTACT.coachPhone) + '</b>' +
        '<a class="ab-copy" href="tel:' + esc2safe(CONTACT.coachPhone) + '">拨号</a></div>'
      : "") +
    '</div>';
}

function contactRows(icon, title, desc, wechat, phone) {
  if (!wechat && !phone) return "";
  const line = (label, val, isPhone) =>
    '<div class="ab-line"><span class="muted ab-lab">' + label + '</span><b class="ab-id">' + esc2safe(val) + "</b>" +
    (isPhone ? '<a class="ab-copy" href="tel:' + esc2safe(val) + '">拨号</a>' : "") +
    '<button class="ab-copy" data-copy="' + esc2safe(val) + '" data-copy-label="' + label + '">复制</button></div>';
  return '<div class="ab-item"><div class="ab-head">' + icon + " " + title + "</div>" +
    (desc ? '<div class="muted ab-desc">' + desc + "</div>" : "") +
    (wechat ? line("微信", wechat, false) : "") +
    (phone ? line("电话", phone, true) : "") + "</div>";
}

// 「关于本系统」区块：无任何联系方式时整体不显示
// 若两个角色填的是同一个号码且都没有微信，则合并成一行，避免同一号码重复出现两次
function aboutBlock() {
  const onlyOneLine = !CONTACT.techWechat && !CONTACT.coachWechat &&
    CONTACT.techPhone && CONTACT.techPhone === CONTACT.coachPhone;
  let tech, coach;
  if (onlyOneLine) {
    tech = contactRows("🏸", "系统 / 课程问题 · 都可以联系", "打不开页面 / 收不到消息 / 约课调课 / 体测解读", "", CONTACT.techPhone);
    coach = "";
  } else {
    tech = contactRows("🛠", "系统问题 · 找技术支持", "打不开页面 / 收不到消息 / 图片生成失败", CONTACT.techWechat, CONTACT.techPhone);
    coach = contactRows("🏸", "课程问题 · 找教练 · 馆长", "约课调课 / 训练安排 / 体测解读", CONTACT.coachWechat, CONTACT.coachPhone);
  }
  if (!tech && !coach) return "";
  return '<div class="card"><h3>ℹ️ 关于本系统</h3>' +
    '<p class="muted" style="margin:0 0 4px;">这套系统由星羿羽毛球馆定制开发</p>' +
    tech + coach +
    '<p class="muted ab-foot">' + esc2safe(CONTACT.brand) + " · " + esc2safe(CONTACT.version) +
    " · 更新 " + esc2safe(CONTACT.updated) + "</p></div>";
}

function bindContactCopy() {
  document.querySelectorAll(".ab-copy[data-copy]").forEach(b => {
    b.onclick = async () => {
      const t = b.getAttribute("data-copy");
      const ok = await copyText(t);
      b.textContent = ok ? "已复制 ✓" : "复制";
      b.classList.toggle("done", ok);
      if (ok) toast("已复制 " + b.getAttribute("data-copy-label") + "：" + t + "，去微信粘贴搜索即可");
      setTimeout(() => { b.textContent = "复制"; b.classList.remove("done"); }, 1600);
    };
  });
}

function headerBar(child) {
  return '<div class="header"><h1>🏸 星羿家长端</h1>' +
    '<div style="text-align:right"><div class="who">' + child.name + " 家长</div>" +
    '<button id="logoutBtn">退出</button></div></div>';
}

function tabBar(active) {
  const t = (h, ic, label) =>
    '<a href="#' + h + '" class="' + (active === h ? "active" : "") + '"><span class="ic">' + ic + "</span>" + label + "</a>";
  const items = [];
  if (!window._xyOld) items.push(t("/booking", "📅", "预约"));
  items.push(t("/survey", "📋", "档案") + t("/growth", "🌱", "成长") + t("/message", "🔔", "消息"));
  return '<div class="tabbar">' + items.join("") + "</div>";
}

function renderLogin() {
  return '<div class="hero"><h2>星羿家长端</h2><p>约课 · 成长记录 · 荣誉墙 · 体测报告，一站式查看</p></div>' +
    '<div class="card"><h3>登录查看专属内容</h3>' +
    '<input class="input" id="phone" placeholder="家长手机号" inputmode="numeric" />' +
    '<input class="input" id="child" placeholder="孩子姓名（如：小明）" />' +
    '<button class="btn" id="loginBtn">进入</button>' +
    '<div id="pickList"></div>' +
    '<p class="muted">手机号和孩子姓名请与预约时填写的一致。记不清写法也没关系：点「进入」后系统会按手机号自动帮您找回孩子的记录。</p></div>';
}

function renderBooking(child) {
  // 老生（有上课记录/奖状）不显示预约试课
  if (window._xyOld) {
    return '<div class="hero"><h2>🏅 在读学员</h2><p>' + esc2safe(child.name) + " 已是星羿在读学员</p></div>" +
      '<div class="card"><h3>无需预约试课</h3>' +
      '<p class="muted">排课时间以教练通知为准；请假、调课请直接联系教练。</p>' +
      '<p class="muted">孩子的上课反馈、荣誉奖状、体测成长都在「🌱 成长」页查看。</p>' +
      '<a class="btn" href="#/growth">去看成长记录</a></div>';
  }
  const slots = Data.TIME_SLOTS.map(t =>
    '<div class="time' + (selSlot === t ? " sel" : "") + '" data-slot="' + t + '">' + t + "</div>").join("");
  const wxLi = CONTACT.coachWechat
    ? '<li>预约后建议<b>加老师微信</b>（下方微信号可复制），备注「孩子姓名 + 手机号」，上课提醒、体测解读都在微信沟通。</li>'
    : "";
  return '<div class="hero"><h2>预约试课</h2><p>' + child.name + " 的体验课安排</p></div>" +
    '<div class="card bk-tip"><h3>📌 试课前先看</h3>' +
      '<ul class="bk-tip-list">' +
        '<li>🌟 <b>试课免费 1 次</b>：选好时段点「提交预约」，到店报家长手机号即可，不用提前缴费。</li>' +
        '<li>🥤 请穿<b>运动鞋</b>、带<b>水壶和跳绳</b>。</li>' +
        '<li>🏸 <b>体验课球拍由场馆提供</b>，孩子也可自带。</li>' +
        wxLi +
      '</ul></div>' +
    '<div class="card"><h3>选择时段</h3><div class="times">' + slots + "</div>" +
    '<button class="btn" id="bookBtn" style="margin-top:12px;">提交预约</button></div>' +
    '<div class="card"><h3>我的预约</h3><div id="myBookings"><p class="muted">加载中…</p></div></div>' +
    coachWxBlock();
}

async function fillBookings(child) {
  const box = document.getElementById("myBookings");
  if (!box) return;
  const list = await Store.getBookings(child.childId);
  box.innerHTML = list.length
    ? list.map(b => '<div class="row"><span class="k">' + b.time + '</span><span class="v">' + b.status + "</span></div>").join("")
    : '<p class="muted">还没有预约，选一个时段提交吧。</p>';
}

const fmtTime = s => s ? String(s).replace("T", " ").slice(5, 16) : "";

function reportRows(e) {
  const esc2 = s => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const grade = v => v === "优" ? "good" : (v === "待提升" ? "warn" : (v === "良" ? "" : null));
  const row = (k, v) => {
    if (!v) return "";
    const g = grade(v);
    return '<div class="row"><span class="k">' + k + '</span><span class="v">' +
      (g === null ? esc2(v) : esc2(v) + (g ? ' <span class="tag ' + g + '">' + esc2(v) + "</span>" : ' <span class="tag">' + esc2(v) + "</span>")) +
      "</span></div>";
  };
  return row("身高", e.height ? e.height + " cm" : "") +
    row("体重", e.weight ? e.weight + " kg" : "") +
    row("柔韧性", e.flexibility) +
    row("1分钟跳绳", e.rope ? e.rope + " 个" : "") +
    row("步法敏捷", e.footwork) +
    row("协调性球感", e.coord) +
    row("力量", e.strength);
}

function renderReport(child) {
  return '<div class="hero"><h2>' + child.name + " 的体测报告</h2><p>家长档案 + 教练现场体测</p></div>" +
    '<div class="card"><h3>① 您填写的孩子信息</h3><div id="parentCard"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>② 教练现场体测</h3><div id="coachCard"><p class="muted">加载中…</p></div>' +
    '<button class="btn ghost" id="dlReportBtn" style="margin-top:10px;">📥 生成体测成长卡图片（长按可保存）</button></div>';
}

// 体测报告卡 SVG（品牌墨绿+荧光绿，750x980）
function reportCardSvg(child, parent, entries) {
  const e = entries[entries.length - 1] || {};
  const item = (y, k, v) => {
    if (!v) return "";
    return '<text x="70" y="' + y + '" font-size="22" fill="#8AA09A" font-family="PingFang SC,Microsoft YaHei,sans-serif">' + k + '</text>' +
      '<text x="290" y="' + y + '" font-size="22" font-weight="bold" fill="#F2F8F6" text-anchor="end" font-family="PingFang SC,Microsoft YaHei,sans-serif">' + esc2safe(String(v)) + "</text>";
  };
  const d = String(e.date || "").replace(/^(\d{4})-(\d{1,2})-(\d{1,2}).*$/, "$1.$2.$3");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="980" viewBox="0 0 750 980">' +
    '<defs><linearGradient id="rbg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#0E5A4C"/><stop offset="1" stop-color="#0B3A32"/></linearGradient></defs>' +
    '<rect width="750" height="980" rx="18" fill="url(#rbg)"/>' +
    '<circle cx="640" cy="110" r="140" fill="#C6F94B" opacity=".06"/>' +
    '<text x="70" y="110" font-size="26" fill="#C6F94B" font-weight="bold" letter-spacing="3" font-family="PingFang SC,Microsoft YaHei,sans-serif">🏸 星羿羽毛球 · 体测报告</text>' +
    '<text x="70" y="190" font-size="52" font-weight="bold" fill="#FFFFFF" font-family="PingFang SC,Microsoft YaHei,sans-serif">' + esc2safe(child.name) + '</text>' +
    '<text x="70" y="232" font-size="22" fill="#8AA09A" font-family="PingFang SC,Microsoft YaHei,sans-serif">测评日期 ' + esc2safe(d) + (entries.length > 1 ? " · 第 " + entries.length + " 次测评" : "") + "</text>" +
    item(320, "身高", e.height ? e.height + " cm" : "") +
    item(365, "体重", e.weight ? e.weight + " kg" : "") +
    item(410, "柔韧性", e.flexibility) +
    item(455, "1 分钟跳绳", e.rope ? e.rope + " 个" : "") +
    item(500, "步法敏捷", e.footwork) +
    item(545, "协调性球感", e.coord) +
    item(590, "力量", e.strength) +
    '<rect x="56" y="620" width="638" height="1" fill="#2A5A50"/>' +
    (parent && parent.gender
      ? '<text x="70" y="672" font-size="20" fill="#8AA09A" font-family="PingFang SC,Microsoft YaHei,sans-serif">基础档案</text>' +
        '<text x="290" y="672" font-size="20" font-weight="bold" fill="#F2F8F6" font-family="PingFang SC,Microsoft YaHei,sans-serif">' +
        esc2safe([parent.gender, parent.grade, parent.prior].filter(Boolean).join(" · ")) + "</text>"
      : "") +
    (e.note
      ? '<rect x="56" y="716" width="638" height="150" rx="12" fill="#C6F94B" opacity=".12"/>' +
        '<text x="80" y="756" font-size="20" font-weight="bold" fill="#C6F94B" font-family="PingFang SC,Microsoft YaHei,sans-serif">💬 教练建议</text>' +
        '<text x="80" y="792" font-size="19" fill="#F2F8F6" font-family="PingFang SC,Microsoft YaHei,sans-serif">' +
        esc2safe(String(e.note).slice(0, 22)) + "</text>" +
        '<text x="80" y="822" font-size="19" fill="#F2F8F6" font-family="PingFang SC,Microsoft YaHei,sans-serif">' +
        esc2safe(String(e.note).slice(22, 44)) + "</text>" +
        '<text x="80" y="852" font-size="19" fill="#F2F8F6" font-family="PingFang SC,Microsoft YaHei,sans-serif">' +
        esc2safe(String(e.note).slice(44, 66)) + "</text>"
      : "") +
    '<text x="375" y="932" font-size="16" fill="#8AA09A" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">星羿羽毛球馆 · 江西省九江市开发区杭州路 · 15107920066</text>' +
    "</svg>";
}

// ===== 学员体测成长卡（与工作台体测档案页完全同源 · 移植自 archive.html） =====
const GC_FF = 'font-family="PingFang SC, Microsoft YaHei, sans-serif"';
function gcAge(age) { const a = parseInt(age); if (isNaN(a) || a <= 0) return 1; if (a <= 6) return 0; if (a <= 9) return 1; return 2; }
const GC_AGE_LABEL = ["5-6岁", "7-9岁", "10-12岁"];
const GC_METRICS = [
  { key: "height", name: "身高", unit: "cm", group: "static", better: "high" },
  { key: "weight", name: "体重", unit: "kg", group: "static", better: "high" },
  { key: "bmi", name: "BMI", unit: "", group: "static", type: "bmi" },
  { key: "sitReach", name: "坐位体前屈", unit: "cm", group: "static", better: "high" },
  { key: "singleStand", name: "单脚闭眼站立", unit: "秒", group: "static", better: "high" },
  { key: "wallSquat", name: "靠墙静蹲", unit: "秒", group: "static", better: "high" },
  { key: "posture", name: "姿态评估", unit: "", group: "static", type: "posture", postureItems: ["高低肩", "足弓", "脊柱"] },
  { key: "run50", name: "50米跑", unit: "秒", group: "dynamic", better: "low", ref: [[13, 11], [11, 9.5], [10, 8.5]] },
  { key: "standingJump", name: "立定跳远", unit: "cm", group: "dynamic", better: "high", ref: [[90, 110], [120, 145], [150, 175]] },
  { key: "verticalJump", name: "纵跳摸高", unit: "cm", group: "dynamic", better: "high", ref: [[15, 22], [22, 30], [30, 38]] },
  { key: "rope", name: "跳绳(1分钟)", unit: "个", group: "dynamic", better: "high", ref: [[40, 60], [80, 110], [110, 140]] },
  { key: "swing15", name: "15秒挥拍", unit: "次", group: "dynamic", better: "high", ref: [[15, 22], [22, 30], [30, 38]] },
  { key: "footwork", name: "米字步计时", unit: "秒", group: "dynamic", better: "low", ref: [[25, 20], [20, 16], [16, 13]] },
  { key: "reaction", name: "反应启动", unit: "m", group: "dynamic", better: "low", ref: [[1.2, 0.9], [1.0, 0.7], [0.8, 0.6]] },
  { key: "serve", name: "发球进区", unit: "个/10", group: "tech", better: "high", target: 8 },
  { key: "rally", name: "连续颠球", unit: "个", group: "tech", better: "high", target: 10 },
  { key: "clear", name: "正手高远球击球过网", unit: "个", group: "tech", better: "high", target: 5 }
];
function gcVal(st, key) {
  if (key === "bmi") return st.tests.filter(t => t.m.height && t.m.weight).map(t => ({ date: t.date, v: +(t.m.weight / (t.m.height / 100 * t.m.height / 100)).toFixed(1) }));
  return st.tests.map(t => ({ date: t.date, v: t.m[key] })).filter(x => x.v != null);
}
function gcStatus(m, st, last) {
  if (m.group === "dynamic" && m.ref) {
    const [tg, ex] = m.ref[gcAge(st.age)];
    if (m.better === "high") { if (last >= ex) return "优秀"; if (last >= tg) return "达标"; return "未达标"; }
    if (last <= ex) return "优秀"; if (last <= tg) return "达标"; return "未达标";
  }
  if (m.group === "tech" && m.target != null) {
    const reach = m.better === "high" ? last >= m.target : last <= m.target;
    return reach ? "达标" : "未达标";
  }
  return null;
}
function gcBadge(stt, x, y) {
  const c = stt === "优秀" ? "#16a34a" : stt === "达标" ? "#0d9488" : "#94a3b8";
  const w = stt.length * 16 + 22, h = 26;
  return '<rect x="' + (x - w / 2).toFixed(1) + '" y="' + (y - h / 2).toFixed(1) + '" width="' + w + '" height="' + h + '" rx="13" fill="' + c + '"/>' +
    '<text x="' + x.toFixed(1) + '" y="' + (y + 5).toFixed(1) + '" font-size="14" fill="#fff" text-anchor="middle" font-weight="600" ' + GC_FF + ">" + stt + "</text>";
}
function gcScore(val, m, g) {
  if (val == null || val === "") return null;
  const v = +val; if (isNaN(v)) return null;
  if (m.group === "dynamic" && m.ref) {
    const [lo, hi] = m.ref[g];
    if (lo === hi) return v >= lo ? 100 : 0;
    if (m.better === "high") {
      if (v >= hi) return 100;
      if (v <= lo) return Math.max(0, 60 - (lo - v) / (lo * 0.6) * 40);
      return 60 + (v - lo) / (hi - lo) * 40;
    }
    if (v <= hi) return 100;
    if (v >= lo) return Math.max(0, 60 - (v - lo) / (lo * 0.6) * 40);
    return 60 + (lo - v) / (lo - hi) * 40;
  }
  if (m.group === "tech" && m.target != null) {
    const lo = m.target, hi = 60 + 40; // tech 无分龄优秀线，用 target*1.5
    const hiV = m.excellent != null ? m.excellent : lo * 1.5;
    if (v >= hiV) return 100;
    if (v >= lo) return 60 + (v - lo) / (hiV - lo) * 40;
    return Math.max(0, v / lo * 60);
  }
  return null;
}
function gcSeries(st) {
  const g = gcAge(st.age), out = [];
  st.tests.forEach((t, idx) => {
    let sum = 0, n = 0;
    GC_METRICS.forEach(m => {
      if (m.group !== "dynamic" && m.group !== "tech") return;
      const s = gcScore(t.m[m.key], m, g);
      if (s != null) { sum += s; n++; }
    });
    if (n) out.push({ i: idx, score: +(sum / n).toFixed(1) });
  });
  return out;
}
function gcSummary(st) {
  let total = 0, imp = 0;
  GC_METRICS.forEach(m => {
    if (m.type === "posture") return;
    const arr = gcVal(st, m.key); if (!arr.length) return; total++;
    const f = arr[0].v, l = arr[arr.length - 1].v;
    if (m.better === "high" ? l > f : l < f) imp++;
  });
  return { total, imp };
}
function gcEscape(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function gcOverallSVG(st, oy) {
  const series = gcSeries(st);
  if (series.length < 1) return "";
  const W = 702, H = 172, padL = 40, padR = 14, padT = 16, padB = 28;
  const cw = W - padL - padR, ch = H - padT - padB, n = series.length;
  const xs = i => padL + (n === 1 ? cw / 2 : cw * i / (n - 1));
  const yOf = v => padT + ch * (1 - v / 100);
  const pts = series.map((o, i) => [xs(i), yOf(o.score)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = "M" + pts[0][0].toFixed(1) + " " + (padT + ch).toFixed(1) + " " + pts.map(p => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + " L" + pts[n - 1][0].toFixed(1) + " " + (padT + ch).toFixed(1) + " Z";
  let s = '<g transform="translate(24,' + oy + ')">';
  s += '<defs><linearGradient id="og' + oy + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14b8a6" stop-opacity=".35"/><stop offset="1" stop-color="#14b8a6" stop-opacity="0"/></linearGradient></defs>';
  [["100", "#16a34a", "优秀"], ["60", "#0d9488", "达标"]].forEach(([vv, c, lab]) => {
    const yy = yOf(+vv);
    s += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '" stroke="' + c + '" stroke-width="1" stroke-dasharray="5 4" opacity=".55"/>';
    s += '<text x="' + (W - padR) + '" y="' + (yy - 4).toFixed(1) + '" font-size="10" fill="' + c + '" text-anchor="end" ' + GC_FF + ">" + lab + "线</text>";
  });
  s += '<line x1="' + padL + '" y1="' + (padT + ch).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + (padT + ch).toFixed(1) + '" stroke="#e2e8f0" stroke-width="1"/>';
  s += '<path d="' + area + '" fill="url(#og' + oy + ')"/>';
  s += '<path d="' + line + '" fill="none" stroke="#0f766e" stroke-width="2.5" stroke-linejoin="round"/>';
  pts.forEach((p, i) => {
    const sc = series[i].score;
    const col = sc >= 100 ? "#16a34a" : sc >= 60 ? "#0f766e" : "#94a3b8";
    s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="#fff" stroke="' + col + '" stroke-width="2.5"/>';
    s += '<text x="' + p[0].toFixed(1) + '" y="' + (padT + ch + 16).toFixed(1) + '" font-size="10" fill="#64748b" text-anchor="middle" ' + GC_FF + ">" + gcEscape(st.tests[series[i].i].date.slice(5)) + "</text>";
    s += '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 9).toFixed(1) + '" font-size="11" fill="' + col + '" text-anchor="middle" font-weight="700" ' + GC_FF + ">" + sc + "</text>";
  });
  return s + "</g>";
}
function gcMiniTrend(arr, m, st, cx, cy, w, h) {
  if (!arr.length) return "";
  const W = w, H = h, pl = 8, pr = 8, pt = 8, pb = 14;
  const reflines = [];
  if (m.group === "dynamic" && m.ref) { const [tg, ex] = m.ref[gcAge(st.age)]; reflines.push({ v: tg, c: "#0d9488" }); if (ex != null) reflines.push({ v: ex, c: "#16a34a" }); }
  else if (m.group === "tech" && m.target != null) reflines.push({ v: m.target, c: "#16a34a" });
  const xs2 = arr.map(a => a.v).slice(); reflines.forEach(r => xs2.push(r.v));
  let lo = Math.min.apply(null, xs2), hi = Math.max.apply(null, xs2);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const n = arr.length;
  const X = i => pl + (W - pl - pr) * (n === 1 ? 0.5 : i / (n - 1));
  const Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const dc = v => {
    if (m.group === "dynamic" && m.ref) {
      const [tg, ex] = m.ref[gcAge(st.age)];
      if (m.better === "high") { if (v >= ex) return "#16a34a"; if (v >= tg) return "#0d9488"; return "#f59e0b"; }
      if (v <= ex) return "#16a34a"; if (v <= tg) return "#0d9488"; return "#f59e0b";
    }
    if (m.group === "tech" && m.target != null) return (m.better === "high" ? v >= m.target : v <= m.target) ? "#16a34a" : "#f59e0b";
    return "#0d9488";
  };
  const refs = reflines.map(r => { const ty = Y(r.v).toFixed(1); return '<line x1="' + pl + '" y1="' + ty + '" x2="' + (W - pr) + '" y2="' + ty + '" stroke="' + r.c + '" stroke-width="1" stroke-dasharray="4 3"/>'; }).join("");
  const pts = arr.map((a, i) => X(i).toFixed(1) + "," + Y(a.v).toFixed(1)).join(" ");
  const dots = arr.map((a, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(a.v).toFixed(1) + '" r="3.5" fill="' + dc(a.v) + '"/>').join("");
  return '<svg x="' + cx + '" y="' + cy + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="6" fill="#f8fafc"/>' + refs +
    '<polyline points="' + pts + '" fill="none" stroke="#0d9488" stroke-width="1.5"/>' + dots +
    '<text x="' + W / 2 + '" y="' + (H - 2) + '" font-size="9" fill="#64748b" text-anchor="middle" ' + GC_FF + ">" + gcEscape(m.name) + "</text></svg>";
}
// 与工作台 archive.html 的 buildCardSVG 同源
function growthCardSvg(st) {
  const W = 750, parts = [];
  const grpLabel = GC_AGE_LABEL[gcAge(st.age)];
  const last = st.tests[st.tests.length - 1];
  parts.push('<defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs>');
  parts.push('<rect x="0" y="0" width="' + W + '" height="104" fill="url(#hg)"/>');
  parts.push('<text x="' + W / 2 + '" y="52" font-size="34" fill="#ffffff" text-anchor="middle" font-weight="700" ' + GC_FF + ">星羿羽毛球馆</text>");
  parts.push('<text x="' + W / 2 + '" y="84" font-size="16" fill="#e6fffb" text-anchor="middle" ' + GC_FF + ">学员体测成长卡</text>");
  parts.push('<rect x="24" y="120" width="' + (W - 48) + '" height="64" rx="12" fill="#f0fdfa" stroke="#99f6e4" stroke-width="1"/>');
  parts.push('<text x="44" y="156" font-size="28" fill="#0f766e" font-weight="700" ' + GC_FF + ">" + gcEscape(st.name) + "</text>");
  parts.push('<text x="44" y="176" font-size="13" fill="#475569" ' + GC_FF + ">" + gcEscape(st.cls || "") + " · " + grpLabel + "</text>");
  parts.push('<text x="' + (W - 44) + '" y="158" font-size="13" fill="#64748b" text-anchor="end" ' + GC_FF + ">测试日期</text>");
  parts.push('<text x="' + (W - 44) + '" y="178" font-size="16" fill="#0f766e" text-anchor="end" font-weight="600" ' + GC_FF + ">" + gcEscape(last.date) + "</text>");
  let y = 212;
  [{ title: "一、静态体测", g: "static" }, { title: "二、动态体测", g: "dynamic" }, { title: "三、羽毛球技术专项", g: "tech" }].forEach(grp => {
    y += 34;
    parts.push('<rect x="24" y="' + (y - 18) + '" width="4" height="16" rx="2" fill="#14b8a6"/>');
    parts.push('<text x="38" y="' + (y - 3) + '" font-size="16" fill="#0f766e" font-weight="700" ' + GC_FF + ">" + grp.title + "</text>");
    GC_METRICS.filter(m => m.group === grp.g).forEach(m => {
      if (m.type === "posture") {
        const arr = gcVal(st, m.key); if (!arr.length) return;
        y += 34;
        parts.push('<text x="40" y="' + y + '" font-size="13" fill="#64748b" ' + GC_FF + ">" + gcEscape(m.name) + "：" + gcEscape(arr[arr.length - 1].v) + "</text>");
        return;
      }
      const arr = gcVal(st, m.key); if (!arr.length) return;
      const first = arr[0].v, lastv = arr[arr.length - 1].v, d2 = +(lastv - first).toFixed(1);
      const improved = m.better === "high" ? lastv > first : lastv < first;
      y += 42; const cy = y - 14;
      parts.push('<text x="40" y="' + (cy + 4) + '" font-size="15" fill="#334155" ' + GC_FF + ">" + gcEscape(m.name) + "</text>");
      let midTxt = first + m.unit + " → " + lastv + m.unit, acolor = "#64748b";
      if (m.type !== "bmi" && arr.length > 1 && d2 !== 0) {
        if (improved) { midTxt += " (" + (d2 > 0 ? "+" : "") + d2 + m.unit + " ↑)"; acolor = "#16a34a"; }
        else { midTxt += " (" + d2 + m.unit + " ↓)"; acolor = "#dc2626"; }
      }
      parts.push('<text x="232" y="' + (cy + 4) + '" font-size="15" fill="' + acolor + '" ' + GC_FF + ">" + gcEscape(midTxt) + "</text>");
      const stt = gcStatus(m, st, lastv);
      if (stt) parts.push(gcBadge(stt, W - 70, cy + 2));
      else if (m.type === "bmi") parts.push('<text x="' + (W - 44) + '" y="' + (cy + 4) + '" font-size="13" fill="#94a3b8" text-anchor="end" ' + GC_FF + ">趋势参考</text>");
    });
  });
  y += 42;
  parts.push('<rect x="24" y="' + (y - 18) + '" width="4" height="16" rx="2" fill="#14b8a6"/>');
  parts.push('<text x="38" y="' + (y - 3) + '" font-size="16" fill="#0f766e" font-weight="700" ' + GC_FF + ">综合成长曲线</text>");
  const osAll = gcSeries(st);
  if (osAll.length) {
    const fS = osAll[0].score, lS = osAll[osAll.length - 1].score, dS = +(lS - fS).toFixed(1);
    parts.push('<text x="' + (W - 44) + '" y="' + (y - 3) + '" font-size="13" fill="#16a34a" text-anchor="end" font-weight="700" ' + GC_FF + ">" + fS + " → " + lS + " 分（" + (dS > 0 ? "+" : "") + dS + "）</text>");
  }
  y += 8;
  parts.push(gcOverallSVG(st, y + 4));
  y = y + 4 + 172 + 18;
  y += 44;
  parts.push('<rect x="24" y="' + (y - 18) + '" width="4" height="16" rx="2" fill="#14b8a6"/>');
  parts.push('<text x="38" y="' + (y - 3) + '" font-size="16" fill="#0f766e" font-weight="700" ' + GC_FF + ">进步趋势</text>");
  const miniY = y, miniW = 210, miniH = 120, gap = 12;
  [["rope", "跳绳"], ["footwork", "米字步"], ["serve", "发球进区"]].forEach((kv, i) => {
    const k = kv[0], m = GC_METRICS.find(x => x.key === k), arr = gcVal(st, k);
    const cx = 24 + i * (miniW + gap);
    if (arr.length) parts.push(gcMiniTrend(arr, m, st, cx, miniY, miniW, miniH));
    else parts.push('<rect x="' + cx + '" y="' + miniY + '" width="' + miniW + '" height="' + miniH + '" rx="6" fill="#f8fafc"/><text x="' + (cx + miniW / 2) + '" y="' + (miniY + miniH / 2) + '" font-size="12" fill="#94a3b8" text-anchor="middle" ' + GC_FF + ">" + kv[1] + "暂无数据</text>");
  });
  y = miniY + miniH + 24;
  const sum = gcSummary(st);
  const msg = "本次共记录 " + sum.total + " 项指标，其中 " + sum.imp + " 项明显进步。汗水不会辜负每一个认真的小孩，继续保持，下个级别就在眼前！" +
    (last.note ? " 教练说：" + last.note : "");
  parts.push('<rect x="0" y="' + y + '" width="' + W + '" height="130" fill="#f0fdfa"/>');
  parts.push('<text x="40" y="' + (y + 28) + '" font-size="15" fill="#0f766e" font-weight="700" ' + GC_FF + ">教练寄语</text>");
  const lines = svgWrap(msg, 34).slice(0, 3);
  lines.forEach((ln, i) => parts.push('<text x="40" y="' + (y + 54 + i * 22) + '" font-size="13.5" fill="#475569" ' + GC_FF + ">" + gcEscape(ln) + "</text>"));
  const sx = W - 92, sy = y + 62, r = 34;
  parts.push('<circle cx="' + sx + '" cy="' + sy + '" r="' + r + '" fill="none" stroke="#dc2626" stroke-width="3"/>');
  parts.push('<circle cx="' + sx + '" cy="' + sy + '" r="' + (r - 5) + '" fill="none" stroke="#dc2626" stroke-width="1"/>');
  parts.push('<text x="' + sx + '" y="' + (sy - 2) + '" font-size="15" fill="#dc2626" text-anchor="middle" font-weight="700" ' + GC_FF + ">星羿</text>");
  parts.push('<text x="' + sx + '" y="' + (sy + 16) + '" font-size="11" fill="#dc2626" text-anchor="middle" ' + GC_FF + ">体育</text>");
  const H = y + 130;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '"><rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>' + parts.join("") + "</svg>";
}
// 云端主档（与工作台体测档案同一份 JSON，同源展示）
let _profilesCache = null;
async function fetchProfiles() {
  if (_profilesCache) return _profilesCache;
  try {
    const r = await fetch("../data/profiles.json?t=" + Date.now(), { cache: "no-store" });
    _profilesCache = await r.json();
  } catch (e) { _profilesCache = []; }
  return _profilesCache;
}
function matchStudent(profiles, childName) {
  const norm = s => String(s || "").replace(/\s/g, "");
  const nm = norm(childName);
  return profiles.find(s => norm(s.name) === nm) ||
    profiles.find(s => norm(s.name).includes(nm) || nm.includes(norm(s.name))) || null;
}
// 同名多档案合并（重复建档兜底）：tests 按日期去重合并，保证体测历史一条不少
function mergeStudent(profiles, childName) {
  const norm = s => String(s || "").replace(/\s/g, "");
  const nm = norm(childName);
  if (!nm) return null;
  const hits = profiles.filter(s => s && norm(s.name) &&
    (norm(s.name) === nm || norm(s.name).includes(nm) || nm.includes(norm(s.name))));
  if (!hits.length) return null;
  const merged = Object.assign({}, hits[0]);
  const seen = new Set(); const tests = [];
  hits.forEach(h => (h.tests || []).forEach(t => {
    const d = String((t && t.date) || "");
    if (d && seen.has(d)) return;
    if (d) seen.add(d);
    tests.push(t);
  }));
  tests.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  merged.tests = tests;
  return merged;
}

function surveyRows(p, exp) {
  const row = (k, v) => v ? '<div class="row"><span class="k">' + k + '</span><span class="v">' + esc2safe(v) + "</span></div>" : "";
  return row("性别", p.gender) + row("出生年月", p.birth) + row("就读年级", p.grade) +
    row("羽毛球基础", p.prior) + row("运动基础", p.base) + row("性格", p.pers) +
    row("每周训练", p.weekly) + row("家长期望", exp) +
    row("健康注意", p.health) + row("孩子最想要", p.want);
}

// 生成体测成长卡图片（报告页与成长页「体测历史」共用）：有数据返回 true
async function makeGrowthCardImage(child) {
  const st = mergeStudent(await fetchProfiles(), child.name);
  if (st && st.tests && st.tests.length) {
    const svg = growthCardSvg(st);
    await openImgModal(svg, 750, +(svg.match(/height="(\d+)"/) || [0, 980])[1], st.name + " · 学员体测成长卡");
    return true;
  }
  return false;
}

async function fillReport(child) {
  const pc = document.getElementById("parentCard");
  const cc = document.getElementById("coachCard");
  if (!pc || !cc) return;
  const r = await Store.getReport(child.childId);
  const parent = (r && r.parent) || null;
  const entries = (r && r.entries) || [];
  const dl = document.getElementById("dlReportBtn");
  if (dl) dl.onclick = async () => {
    dl.disabled = true; const old = dl.textContent; dl.textContent = "生成中…";
    try {
      // 优先：工作台体测档案的完整成长卡（静态+动态+技术专项+成长曲线，与教练看到的完全一致）
      const ok = await makeGrowthCardImage(child);
      if (!ok) {
        if (!entries.length) { toast("还没有体测数据，试课后教练填写即可生成"); dl.disabled = false; dl.textContent = old; return; }
        await openImgModal(reportCardSvg(child, parent, entries), 750, 980, child.name + " · 体测报告");
      }
    }
    catch (e) { toast("生成失败，请重试"); }
    dl.disabled = false; dl.textContent = old;
  };
  // ① 家长问卷
  if (!parent || !parent.gender) {
    pc.innerHTML = '<p class="muted">还没填孩子基础档案，预约后花 1 分钟填一下，帮教练更懂 ' + child.name + '。</p>' +
      '<a class="btn" href="#/survey">去「📋 档案」填写</a>';
  } else {
    const exp = (parent.expect && parent.expect.length) ? parent.expect.join("、") : "—";
    pc.innerHTML = surveyRows(parent, exp) +
      '<p class="muted">提交时间 ' + (parent.filledAt ? fmtTime(parent.filledAt) : "—") + ' · <a href="#/survey">修改</a></p>';
  }
  // ② 教练体测
  if (!entries.length) {
    cc.innerHTML = '<p class="muted">教练测评中，试课后结果会自动出现在这里。</p>';
  } else {
    const e = entries[entries.length - 1];
    cc.innerHTML = '<p class="muted">' + esc2safe(e.date) + " 测评</p>" + reportRows(e) +
      (e.note ? '<div class="note">' + esc2safe(e.note) + "</div>" : "") +
      '<p class="muted">共 ' + entries.length + ' 次测评记录。</p>';
  }
}

function renderSurvey(child) {
  return '<div class="hero"><h2>孩子基础档案</h2><p>花 1 分钟填写，帮教练更了解 ' + child.name + '</p></div>' +
    '<div class="card"><h3>① 基础信息</h3><div class="f-grid">' +
      '<div class="f-item"><label>孩子性别</label><select id="sGender"><option value="">请选择</option><option>男</option><option>女</option></select></div>' +
      '<div class="f-item"><label>出生年月</label><input id="sBirth" placeholder="如 2019-03"></div>' +
      '<div class="f-item"><label>就读年级</label><select id="sGrade"><option value="">请选择</option><option>幼儿园</option><option>一年级</option><option>二年级</option><option>三年级</option><option>四年级</option><option>五年级</option><option>六年级</option></select></div>' +
      '<div class="f-item"><label>是否接触过羽毛球</label><select id="sPrior"><option value="">请选择</option><option>没接触过</option><option>上过几节</option><option>正在学</option></select></div>' +
      '<div class="f-item"><label>平时运动基础</label><select id="sBase"><option value="">请选择</option><option>很少运动</option><option>偶尔锻炼</option><option>经常锻炼</option></select></div>' +
      '<div class="f-item"><label>孩子性格</label><select id="sPers"><option value="">请选择</option><option>文静</option><option>好动活泼</option><option>专注</option></select></div>' +
      '<div class="f-item"><label>每周能来几次</label><select id="sWeekly"><option value="">请选择</option><option>1 次</option><option>2 次</option><option>3 次以上</option><option>还不确定</option></select></div>' +
    '</div></div>' +
    '<div class="card"><h3>② 家长期望与健康</h3><div class="f-grid">' +
      '<div class="f-item f-full"><label>您最希望孩子从羽毛球得到（可多选）</label><div class="checks">' +
        '<label><input type="checkbox" class="sExp" value="增强体质"> 增强体质</label>' +
        '<label><input type="checkbox" class="sExp" value="培养兴趣"> 培养兴趣</label>' +
        '<label><input type="checkbox" class="sExp" value="走专业路线"> 走专业路线</label>' +
        '<label><input type="checkbox" class="sExp" value="交朋友"> 交朋友/社交</label></div></div>' +
      '<div class="f-item f-full"><label>健康注意（过敏/哮喘/先心病等，教练需知晓，可空）</label><textarea id="sHealth" rows="2" placeholder="无特殊情况的填「无」即可"></textarea></div>' +
      '<div class="f-item f-full"><label>最想让孩子从羽毛球得到什么（开放，可空）</label><textarea id="sWant" rows="2" placeholder="如：希望他更自信、能坚持一件事"></textarea></div>' +
    '</div><button class="btn" id="surveyBtn" style="margin-top:12px;">💾 保存档案</button>' +
    '<p class="muted">提交后教练端立刻能看到，试课时更懂怎么带 ' + child.name + '。</p></div>';
}

async function fillSurvey(child) {
  const r = await Store.getReport(child.childId);
  const p = (r && r.parent) || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
  set("sGender", p.gender); set("sBirth", p.birth); set("sGrade", p.grade);
  set("sPrior", p.prior); set("sBase", p.base); set("sPers", p.pers);
  set("sWeekly", p.weekly); set("sHealth", p.health); set("sWant", p.want);
  if (p.expect && Array.isArray(p.expect)) {
    document.querySelectorAll(".sExp").forEach(c => { c.checked = p.expect.includes(c.value); });
  }
}

async function submitSurvey(child) {
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  const exp = Array.from(document.querySelectorAll(".sExp")).filter(c => c.checked).map(c => c.value);
  const parent = {
    gender: v("sGender"), birth: v("sBirth"), grade: v("sGrade"), prior: v("sPrior"),
    base: v("sBase"), pers: v("sPers"), weekly: v("sWeekly"),
    expect: exp, health: v("sHealth"), want: v("sWant"), filledAt: new Date().toISOString()
  };
  await Store.saveParentSurvey(child.childId, parent);
  toast("已保存，教练马上能看到 ✅");
}

function esc2safe(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// 手机号下有多个孩子且名字对不上时：列出选择
function showPickList(phone, children, typedName) {
  const box = document.getElementById("pickList");
  if (!box) return;
  window.__pickChild = (cid, nm) => {
    Auth.loginWithChild(phone, { childId: cid, name: nm });
    location.hash = "/booking";
    prefetchOldFlag(Auth.current());
  };
  box.innerHTML =
    '<p class="muted" style="margin:10px 0 6px;">用手机号 <b>' + esc2safe(phone.slice(0,3)+"****"+phone.slice(-4)) +
    '</b> 找到以下孩子，请点选（输入的「' + esc2safe(typedName) + '」没对上）：</p>' +
    children.map(c =>
      '<button class="btn ghost pick-child" style="margin-bottom:8px;" onclick="__pickChild(\'' +
      esc2safe(c.childId) + '\',\'' + esc2safe(c.name) + '\')">🧒 ' + esc2safe(c.name) + "（点此进入）</button>"
    ).join("");
}

// ===== 荣誉墙：奖状类型与获取条件（8 种） =====
const AWARD_TYPES = [
  { type: "monthly_star", name: "月度之星", icon: "🌟", how: "每月由教练组综合评选 1 名" },
  { type: "progress",     name: "进步之星", icon: "🚀", how: "体测成绩较上次明显提升" },
  { type: "full_attend",  name: "全勤小将", icon: "🎯", how: "当月课程全部到课" },
  { type: "best_new",     name: "最佳新人", icon: "🌱", how: "新学员首月表现突出" },
  { type: "discipline",   name: "纪律之星", icon: "🎖️", how: "课堂纪律与礼仪标兵" },
  { type: "match_gold",   name: "积分赛冠军", icon: "🥇", how: "馆内积分赛第一名" },
  { type: "match_silver", name: "积分赛亚军", icon: "🥈", how: "馆内积分赛第二名" },
  { type: "match_bronze", name: "积分赛季军", icon: "🥉", how: "馆内积分赛第三名" }
];
const awardMeta = t => AWARD_TYPES.find(a => a.type === t) || { type: t, name: t, icon: "🏅", how: "" };

function renderGrowth(child) {
  return '<div class="hero"><h2>成长记录</h2><p>' + child.name + " 的训练轨迹与荣誉</p></div>" +
    '<div class="card"><h3>📖 上课反馈</h3><p class="muted" style="margin:0 0 8px;">教练每节课后的专属反馈，像老师留言一样</p><div id="growthClasses"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>🏅 荣誉墙</h3><p class="muted" style="margin:0 0 8px;">点已获得的奖状可看大图、长按保存</p><div id="awardWall"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>📋 档案填写状态</h3><div id="growthSurvey"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>📅 预约记录</h3><div id="growthBookings"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>📊 体测历史</h3><div id="growthReports"><p class="muted">加载中…</p></div>' +
    '<button class="btn ghost" id="growthCardBtn" style="margin-top:10px;">📥 生成体测成长卡图片（长按保存）</button></div>';
}

// 上课反馈：家长话术呈现（默认展开最近 2 次，更早的折叠）
function fbCard(c) {
  const lines = [];
  if (c.progress) lines.push('<div class="fb-line">🌟 <b>今日进步</b>：' + esc2safe(c.progress) + "</div>");
  if (c.focus) lines.push('<div class="fb-line">💪 <b>下节课重点</b>：' + esc2safe(c.focus) + "</div>");
  const fmtD = s => { const m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? (+m[2]) + "月" + (+m[3]) + "日" : s; };
  return '<div class="fb-card">' +
    '<div class="fb-head"><b>' + esc2safe(fmtD(c.date)) + "</b>" +
    (c.className ? '<span class="tag">' + esc2safe(c.className) + "</span>" : "") +
    (c.coach ? '<span class="muted">教练 ' + esc2safe(c.coach) + "</span>" : "") + "</div>" +
    '<div class="fb-say">孩子今天的训练已完成 ✅</div>' +
    lines.join("") + "</div>";
}
function classCards(classes) {
  if (!classes.length)
    return '<p class="muted">还没有上课记录。孩子来上课后，教练当天的反馈会自动出现在这里。</p>';
  const recent = classes.slice(0, 2).map(fbCard).join("");
  const older = classes.slice(2);
  const olderHtml = older.length
    ? '<details class="fb-fold"><summary>📒 展开更早的 ' + older.length + " 次反馈</summary>" +
      older.map(fbCard).join("") + "</details>"
    : "";
  return recent + olderHtml;
}

// 荣誉墙：已获得（证书卡可点开大图）+ 未获得（灰显锁定）
function awardWall(awards) {
  const list = (awards || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  window._awards = list;
  const gotTypes = {};
  list.forEach(a => { gotTypes[a.type] = 1; });
  const gotHtml = list.length
    ? list.map((a, i) => {
        const meta = awardMeta(a.type);
        return '<div class="cert-mini" onclick="showAwardImage(' + i + ')">' +
          '<div class="cm-type">' + esc2safe(a.type || "荣誉") + "</div>" +
          (a.award ? '<div class="cm-award">🏆 ' + esc2safe(a.award) + "</div>" : '<div class="cm-award">🏆 ' + esc2safe(meta.name) + "</div>") +
          '<div class="cm-date">' + esc2safe(a.date || "") + '<span class="cm-view">查看证书</span></div></div>';
      }).join("")
    : '<p class="muted">还没有荣誉记录。教练授奖或证书存档后会自动出现在这里。</p>';
  const lockHtml = AWARD_TYPES.filter(m => !gotTypes[m.type]).map(m =>
    '<div class="award-card lock"><span class="a-ic">' + m.icon + '</span><span class="a-name">' + m.name + "</span>" +
    '<span class="a-how">🔒 ' + esc2safe(m.how) + "</span></div>").join("");
  return '<div class="aw-sec">🏆 已获得的荣誉（点击看证书大图，长按保存）</div>' +
    '<div class="cert-grid">' + gotHtml + "</div>" +
    (lockHtml ? '<div class="aw-sec" style="margin-top:14px;">🎯 荣誉还可争取</div><div class="award-grid">' + lockHtml + "</div>" : "") +
    '<details class="fb-fold" style="margin-top:12px;"><summary>🏸 技能挑战徽章 · 已集 ' + skillGotCount(list) +
    " / 40 枚（点开展开）</summary><div style=\"margin-top:8px;\">" + skillWall(list) + "</div></details>";
}
// 已集徽章数（折叠摘要用）
function skillGotCount(awards) {
  let n = 0;
  (awards || []).forEach(a => {
    const s = String(a.award || "");
    if (!s || s.indexOf("·") < 0) return;
    const cat = Object.keys(SKILL_CATS).find(c => s.split("·")[0].trim() === c);
    if (!cat) return;
    const title = (s.split("·")[1] || "").replace(/[（(].*$/, "").trim();
    const numM = s.match(/[（(]\s*(\d+)\s*个/);
    const num = numM ? +numM[1] : 0;
    SKILL_CATS[cat].forEach(([name, need]) => {
      if ((title && title.indexOf(name) >= 0) || (need && num && num === need)) n++;
    });
  });
  return n;
}

// ===== 技能挑战徽章：八项 × 五级 = 40 枚（与证书编辑器「快捷奖项」同源） =====
const SKILL_CATS = {
  "定点高远球": [["高远启萌小能手", 5], ["精准击球小达人", 10], ["高远落点小先锋", 20], ["稳定高远小健将", 30], ["高远精准小精英", 50]],
  "颠球":       [["羽球触感小萌芽", 20], ["拍随球动小骑士", 30], ["稳球小魔法师", 50], ["不间断控球小飞侠", 100], ["百炼控球小王者", 200]],
  "前后场接球": [["跑位接球小能手", 5], ["移动防守小达人", 10], ["前后场穿梭小先锋", 20], ["灵活接杀小健将", 30], ["全场跑动小精英", 50]],
  "一分钟跳绳": [["活力跳绳小能手", 80], ["敏捷跳跃小达人", 100], ["体能飞跃小先锋", 130], ["极速跳绳小健将", 180], ["体能巅峰小精英", 200]],
  "手抛接球":   [["手抛接球小能手", 10], ["手抛接球进步之星", 20], ["手抛接球优秀学员", 30], ["手抛接球活力小将", 40], ["手抛接球潜力之星", 50]],
  "反应能力":   [["闪电捕球小能手", 5], ["机灵接羽小侠", 10], ["追风接球小将", 20], ["速接小机灵", 30], ["飞羽捕捉小卫士", 50]],
  "单打发球":   [["初鸣发球", 0, "刚掌握，能稳定把球发过网"], ["稳落发球", 0, "成功率过半，落点基本到位"], ["准星发球", 0, "成功率不错，经常落到目标区域"], ["灵耀发球", 0, "发球成功率高，长短可以变化"], ["金冠发球", 0, "发球成功率顶尖，很少失误"]],
  "双打发球":   [["启跃发球", 0, "可以完成双打发球，少出界"], ["平顺发球", 0, "过半成功率，安全过网不失误"], ["网捷发球", 0, "成功率良好，网前小球质量稳定"], ["锐捷发球", 0, "高成功率，能控制边线落点"], ["星耀发球", 0, "满分级发球，失误极少，威胁十足"]]
};
function skillWall(awards) {
  // 解析已获得：证书 award 字段格式「项 · 称号（N 个）」
  const got = {};
  (awards || []).forEach(a => {
    const s = String(a.award || "");
    if (!s || s.indexOf("·") < 0) return;
    const cat = Object.keys(SKILL_CATS).find(c => s.split("·")[0].trim() === c);
    if (!cat) return;
    const title = (s.split("·")[1] || "").replace(/[（(].*$/, "").trim();
    const numM = s.match(/[（(]\s*(\d+)\s*个/);
    got[cat] = (got[cat] || []).concat({ title, num: numM ? +numM[1] : 0 });
  });
  let gotCount = 0;
  let html = "";
  Object.entries(SKILL_CATS).forEach(([cat, levels]) => {
    const mine = got[cat] || [];
    const cells = levels.map(([name, need, desc]) => {
      const hit = mine.find(x =>
        (x.title && x.title.indexOf(name) >= 0) || (need && x.num && x.num === need));
      if (hit) { gotCount++; return '<div class="skill-cell got"><span class="sc-name">' + esc2safe(name) + '</span><span class="sc-need">✅ 已获得</span></div>'; }
      return '<div class="skill-cell lock"><span class="sc-name">🔒 ' + esc2safe(name) + '</span><span class="sc-need">' +
        (need ? "🎯 目标 " + need + " 个" : esc2safe(desc || "")) + "</span></div>";
    }).join("");
    html += '<div class="skill-cat">' + esc2safe(cat) +
      (mine.length ? '<span class="sc-got">已获 ' + mine.length + " 枚</span>" : "") +
      '</div><div class="skill-grid">' + cells + "</div>";
  });
  return '<div class="aw-sec">🏸 技能挑战徽章 · 八项五级（已集 ' + gotCount + " / 40 枚，教练考核达标即颁发）</div>" + html;
}

// ===== 荣誉证书大图（cert.html 同款版式 · 纯 SVG 1080x1440） =====
function svgStar(cx, cy, r, fill, op) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.42 : r;
    p.push((cx + rad * Math.cos(ang)).toFixed(1) + "," + (cy + rad * Math.sin(ang)).toFixed(1));
  }
  return '<polygon points="' + p.join(" ") + '" fill="' + fill + '" opacity="' + (op || 1) + '"/>';
}
function svgShuttle(cx, cy, s, fill) {
  return '<g transform="translate(' + cx + "," + cy + ") scale(" + s + ')">' +
    '<path d="M0 -34 L-22 -6 M0 -34 L0 -2 M0 -34 L22 -6 M0 -34 L-12 -4 M0 -34 L12 -4" stroke="' + fill + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<path d="M-22 -6 L22 -6 L15 12 L-15 12 Z" fill="#fff" stroke="' + fill + '" stroke-width="2"/>' +
    '<circle cx="0" cy="22" r="13" fill="#fff" stroke="' + fill + '" stroke-width="3"/></g>';
}
const XY_FONT = "PingFang SC,Microsoft YaHei,sans-serif";
function svgWrap(t, n) { const o = []; t = String(t || ""); for (let i = 0; i < t.length; i += n) o.push(t.slice(i, i + n)); return o; }

function certSvg(a) {
  const name = a.name || "学员";
  const type = a.type || "荣誉证书";
  const RANK = { "羽芽段位": "🌱 羽芽段位", "羽翼段位": "🪶 羽翼段位", "羽翔段位": "🕊️ 羽翔段位", "羽跃段位": "🚀 羽跃段位", "羽冠段位": "👑 羽冠段位" };
  const C = { p: "#185FA5", p2: "#2E7FC4", ac: "#FFB703", ink: "#1A3A5C", grey: "#5a6b7c" };
  const d = String(a.date || "").replace(/^(\d{4})-(\d{1,2})-(\d{1,2}).*$/, "$1 年 $2 月 $3 日");
  const sign = a.sign || "星羿教练";
  const comment = a.note || a.comment || "";
  const rankHtml = RANK[type];
  const awardTxt = a.award || "";

  // 奖项行（最多 2 行折行）
  const awardFull = rankHtml ? "经星羿段位考核评定，正式晋升为 " + RANK[type]
    : (awardTxt ? "在 " + awardTxt + " 中表现优异" : "在羽毛球训练中表现优异");
  const awardLines = svgWrap(awardFull, 22).slice(0, 2);

  // 评语框（26 字/行）；奖项行折两行时整体下移避让
  const cLines = comment ? svgWrap(comment, 26).slice(0, 4) : [];
  const cbY = 830 + (awardLines.length - 1) * 48;
  const cbH = cLines.length ? cLines.length * 44 + 44 : 0;

  // 装饰：上下边框星 + 四角
  let deco = "";
  for (let x = 60; x < 1020; x += 90) deco += svgStar(x, 60, 9, C.ac, .9) + svgStar(x, 1380, 9, C.ac, .9);
  for (let y = 120; y < 1320; y += 90) deco += svgStar(58, y, 8, "#8ECA3F", .85) + svgStar(1022, y, 8, "#8ECA3F", .85);
  deco += svgStar(180, 300, 20, C.ac, .9) + svgStar(920, 300, 16, "#FF8FA3", .85) + svgStar(950, 500, 12, "#8ECA3F", .8) + svgStar(140, 540, 14, "#FF8FA3", .8);

  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">' +
    '<defs>' +
    '<linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EAF4FF"/><stop offset="1" stop-color="#F7FBFF"/></linearGradient>' +
    '<radialGradient id="cglow" cx="50%" cy="30%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="crib" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFB703"/><stop offset="1" stop-color="#ffd166"/></linearGradient>' +
    "</defs>" +
    '<rect width="1080" height="1440" fill="url(#cbg)"/>' +
    '<rect width="1080" height="1440" fill="url(#cglow)"/>' +
    '<g opacity=".12">' + svgShuttle(540, 1210, 5.2, "#c8ddf2") + "</g>" +
    '<rect x="34" y="34" width="1012" height="1372" rx="26" fill="none" stroke="' + C.p + '" stroke-width="5"/>' +
    '<rect x="46" y="46" width="988" height="1348" rx="20" fill="none" stroke="' + C.ac + '" stroke-width="2" stroke-dasharray="10 7"/>' +
    deco +
    // 顶部徽章：羽毛球圆章
    '<circle cx="540" cy="170" r="92" fill="#EAF4FF" stroke="' + C.p + '" stroke-width="7"/>' +
    '<circle cx="540" cy="170" r="76" fill="#fff" opacity=".6"/>' +
    svgShuttle(540, 170, 1.35, C.p) +
    '<text x="540" y="330" font-size="24" letter-spacing="8" fill="' + C.p + '" font-weight="bold" opacity=".9" text-anchor="middle" font-family="' + XY_FONT + '">星 羿 羽 毛 球 馆</text>' +
    '<text x="540" y="424" font-size="84" font-weight="900" fill="' + C.p + '" letter-spacing="10" text-anchor="middle" font-family="' + XY_FONT + '">荣誉证书</text>' +
    '<text x="540" y="458" font-size="20" letter-spacing="5" fill="#9bb" text-anchor="middle" font-family="Arial,sans-serif">CERTIFICATE OF ACHIEVEMENT</text>' +
    // 缎带
    (() => {
      const tw = Math.max(4, type.length) * 34 + 90, x0 = 540 - tw / 2;
      return '<rect x="' + x0 + '" y="492" width="' + tw + '" height="58" rx="29" fill="url(#crib)"/>' +
        '<text x="540" y="532" font-size="30" font-weight="800" fill="#5a3b00" text-anchor="middle" font-family="' + XY_FONT + '">' + esc2safe(type) + "</text>";
    })() +
    '<text x="540" y="622" font-size="30" fill="#5a6b7c" text-anchor="middle" font-family="' + XY_FONT + '">兹证明</text>' +
    '<text x="540" y="706" font-size="72" font-weight="900" fill="' + C.p2 + '" text-anchor="middle" font-family="' + XY_FONT + '">' + esc2safe(name) + "</text>" +
    '<rect x="280" y="722" width="520" height="5" rx="3" fill="' + C.p + '" opacity=".5"/>' +
    awardLines.map((ln, i) =>
      '<text x="540" y="' + (796 + i * 48) + '" font-size="34" font-weight="700" fill="' + C.ink + '" text-anchor="middle" font-family="' + XY_FONT + '">' +
      esc2safe(ln) + "</text>").join("") +
    (cLines.length
      ? '<rect x="160" y="' + cbY + '" width="760" height="' + cbH + '" rx="22" fill="#f4f9ff" stroke="#dcebfb" stroke-width="2"/>' +
        '<text x="190" y="' + (cbY + 34) + '" font-size="44" fill="' + C.ac + '" opacity=".5" font-family="serif">“</text>' +
        cLines.map((ln, i) =>
          '<text x="540" y="' + (cbY + 74 + i * 44) + '" font-size="26" fill="#33506b" text-anchor="middle" font-family="' + XY_FONT + '">' + esc2safe(ln) + "</text>").join("")
      : "") +
    '<text x="120" y="1272" font-size="26" fill="#5a6b7c" font-family="' + XY_FONT + '">' + esc2safe(d) + "</text>" +
    '<text x="700" y="1266" font-size="24" fill="#5a6b7c" font-family="' + XY_FONT + '">' + esc2safe(sign) + "</text>" +
    '<line x1="700" y1="1280" x2="920" y2="1280" stroke="#b9cfe6" stroke-width="2"/>' +
    '<text x="810" y="1308" font-size="17" fill="#9bb" text-anchor="middle" font-family="' + XY_FONT + '">教练签字</text>' +
    // 印章
    '<circle cx="880" cy="1150" r="78" fill="none" stroke="' + C.ac + '" stroke-width="6"/>' +
    '<circle cx="880" cy="1150" r="62" fill="' + C.ac + '" opacity=".12"/>' +
    '<text x="880" y="1136" font-size="22" font-weight="800" fill="' + C.p + '" text-anchor="middle" font-family="' + XY_FONT + '">星羿认证</text>' +
    svgStar(880, 1166, 24, C.p, .9) +
    '<text x="880" y="1206" font-size="15" fill="' + C.p + '" text-anchor="middle" font-family="Arial,sans-serif">XINGYI</text>' +
    '<text x="540" y="1382" font-size="22" fill="' + C.p + '" font-weight="bold" letter-spacing="3" text-anchor="middle" font-family="' + XY_FONT + '">星羿体育 · 见证每一次成长</text>' +
    "</svg>";
}

window.showAwardImage = async function (i) {
  const a = (window._awards || [])[i];
  if (!a) return;
  await openImgModal(certSvg(a), 1080, 1440, (a.name || "") + " · 荣誉证书");
};

// SVG → PNG（canvas 2x 渲染），弹层展示提示长按保存
async function openImgModal(svg, w, h, title) {
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const png = await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w * 2; c.height = h * 2;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      try { res(c.toDataURL("image/png")); } catch (e) { rej(e); }
    };
    img.onerror = rej;
    img.src = url;
  }).catch(() => null);
  let el = document.getElementById("imgModal");
  if (!el) {
    el = document.createElement("div");
    el.id = "imgModal";
    el.className = "img-modal";
    el.onclick = () => el.classList.remove("open");
    document.body.appendChild(el);
  }
  el.innerHTML = '<div class="img-modal-box">' +
    '<div class="img-modal-title">🖼 ' + esc2safe(title || "图片") + '</div>' +
    (png
      ? '<img src="' + png + '" alt="奖状图片" />'
      : '<img src="' + url + '" alt="奖状图片" style="width:100%">') +
    '<p class="img-modal-tip">📱 长按图片保存到相册 · 点空白处关闭</p></div>';
  el.classList.add("open");
}

// 数据来源提示：后端网关异常时数据来自 Pages 快照，用家长友好的说法轻提示
function offlineHint(g) {
  if (!g || g.source !== "static") return "";
  const d = g.updated ? String(g.updated).slice(0, 10) : "";
  return '<p class="muted" style="margin:0 0 8px;">📌 以下为 ' + (d ? d + " " : "") + '同步的最新成长记录</p>';
}

async function fillGrowth(child) {
  const gs = document.getElementById("growthSurvey");
  const gb = document.getElementById("growthBookings");
  const gr = document.getElementById("growthReports");
  const gc = document.getElementById("growthClasses");
  const aw = document.getElementById("awardWall");
  if (!gb || !gr) return;
  // 成长数据（上课记录 + 奖状）与预约/报告并行拉
  const [list, growth] = await Promise.all([
    Store.getBookings(child.childId),
    Store.getGrowth(child.childId, child.name).catch(() => null)
  ]);
  if (!growth) {
    if (gc) gc.innerHTML = '<p class="muted">📖 成长数据暂时加载不了（网络开小差了），稍后再进来看看。</p>';
    if (aw) aw.innerHTML = '<p class="muted">🏅 荣誉墙暂时加载不了（网络开小差了），稍后再进来看看。</p>';
  }
  const g = growth || { classes: [], awards: [] };
  // 有上课记录或奖状 → 老生：隐藏「预约试课」
  if ((g.classes || []).length || (g.awards || []).length) markOldStudent();
  if (gc) gc.innerHTML = offlineHint(g) + classCards(g.classes);
  if (aw) aw.innerHTML = awardWall(g.awards);
  gb.innerHTML = list.length
    ? list.map(b => '<div class="row"><span class="k">' + esc2safe(b.time) +
        '</span><span class="v">' + esc2safe(b.status) +
        ' <span class="muted">' + fmtTime(b.createdAt) + "</span></span></div>").join("")
    : '<p class="muted">还没有预约记录。</p>';
  // 体测历史：双源合并 = 试课体测(reports) + 工作台云端主档(profiles.json，同名档案自动合并去重)
  const [r, st] = await Promise.all([
    Store.getReport(child.childId).catch(() => null),
    fetchProfiles().then(ps => mergeStudent(ps, child.name)).catch(() => null)
  ]);
  const p = (r && r.parent) || null;
  if (gs) gs.innerHTML = (p && p.gender)
    ? '<div class="row"><span class="k">📋 孩子档案</span><span class="v"><span class="tag good">已填</span> <span class="muted">' +
        (p.filledAt ? fmtTime(p.filledAt) : "") + '</span></span></div>'
    : '<div class="row"><span class="k">📋 孩子档案</span><span class="v"><span class="tag warn">未填</span></span></div>' +
      '<a class="btn" href="#/survey">去填写</a>';
  const seenD = new Set();
  const rows = [];
  ((st && st.tests) || []).forEach(t => {
    const d = String(t.date || ""); if (!d) return;
    const m = t.m || {};
    seenD.add(d);
    rows.push({ date: d,
      txt: "身高 " + (m.height || "—") + " · 跳绳 " + (m.rope || "—") + " · 步法 " + (m.footwork || "—") +
        (m.standingJump ? " · 立定跳远 " + m.standingJump + " cm" : ""),
      note: t.note || "" });
  });
  (((r && r.entries) || [])).forEach(e => {
    const d = String(e.date || ""); if (!d || seenD.has(d)) return;
    seenD.add(d);
    rows.push({ date: d, txt: "身高 " + (e.height || "—") + " · 跳绳 " + (e.rope || "—") + " · 协调 " + (e.coord || "—"), note: e.note || "" });
  });
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  gr.innerHTML = rows.length
    ? rows.map(e =>
        '<div class="row" style="display:block"><span class="k">📊 ' + esc2safe(e.date) + "</span>" +
        '<div class="muted">' + esc2safe(e.txt) + (e.note ? "<br>" + esc2safe(e.note) : "") + "</div></div>").join("") +
      '<p class="muted">共 ' + rows.length + " 次体测记录 · 点下方按钮生成体测成长卡图片</p>"
    : '<p class="muted">还没有体测记录，完成首次测评后这里会记录孩子的成长轨迹。</p>';
  const gcb = document.getElementById("growthCardBtn");
  if (gcb) gcb.onclick = async () => {
    gcb.disabled = true; const old = gcb.textContent; gcb.textContent = "生成中…";
    try {
      const ok = await makeGrowthCardImage(child);
      if (!ok) toast("还没有体测数据，试课后教练填写即可生成");
    } catch (e) { toast("生成失败，请重试"); }
    gcb.disabled = false; gcb.textContent = old;
  };
}

function renderMessage(child) {
  return '<div class="hero"><h2>消息</h2><p>训练反馈与跟进提醒</p></div>' +
    '<div class="card"><h3>📨 训练反馈</h3><div id="msgList"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>💬 家长反馈</h3><p class="muted" style="margin:0 0 8px;">想对教练说的话、建议或问题，提交后直达馆长工作台</p>' +
    '<textarea id="fbText" class="input" rows="4" style="width:100%;box-sizing:border-box;" placeholder="如：希望多练一下步伐 / 想调整上课时间 / 对课程的疑问…"></textarea>' +
    '<button class="btn" id="fbBtn" style="margin-top:10px;">📤 提交反馈</button>' +
    '<div id="fbList" style="margin-top:12px;"><p class="muted">加载中…</p></div></div>' +
    aboutBlock();
}

async function fillMessage(child) {
  // 训练反馈：拉真实 parent-msg.json，按孩子名过滤
  const ml = document.getElementById("msgList");
  if (ml) {
    try {
      const list = await Data.parentMessagesFor(child);
      ml.innerHTML = list.length
        ? list.map(e =>
            '<div class="pm-msg"><div class="pm-date">📅 ' + esc2safe(e.date) + '</div>' +
            '<div class="pm-body">' + esc2safe(e.msg) + '</div></div>'
          ).join("")
        : '<p class="muted">暂时还没有孩子的训练反馈消息～</p>';
    } catch (e) {
      ml.innerHTML = '<p class="muted">消息暂时加载不了（网络开小差了），稍后再来看看。</p>';
    }
  }
  const box = document.getElementById("fbList");
  const btn = document.getElementById("fbBtn");
  if (!box || !btn) return;
  const render = list => {
    box.innerHTML = list.length
      ? list.map(f => '<div class="row" style="display:block"><span class="k">💬 ' +
          esc2safe(String(f.createdAt || "").replace("T", " ").slice(0, 16)) +
          '</span><div class="muted">' + esc2safe(f.text) +
          '<br><span class="tag">' + esc2safe(f.status || "已收到") + "</span></div></div>").join("")
      : '<p class="muted">还没有提交过反馈。</p>';
  };
  try { render(await Store.getMyFeedback(child.childId)); }
  catch (e) { box.innerHTML = '<p class="muted">反馈记录暂时加载不了（网络开小差了）。</p>'; }
  btn.onclick = async () => {
    const ta = document.getElementById("fbText");
    const text = ((ta && ta.value) || "").trim();
    if (!text) { toast("写点什么再提交吧"); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = "提交中…";
    try {
      await Store.addFeedback(child.childId, child.name, text);
      if (ta) ta.value = "";
      toast("已提交，馆长在工作台能看到 ✅");
      render(await Store.getMyFeedback(child.childId));
    } catch (e) { toast("提交失败：" + e.message); }
    btn.disabled = false; btn.textContent = old;
  };
  bindContactCopy();
}



const routes = {
  "/login": renderLogin, "/booking": renderBooking, "/survey": renderSurvey,
  "/report": renderReport, "/growth": renderGrowth, "/message": renderMessage
};

function bindEvents(h, child) {
  if (h === "/login") {
    const btn = document.getElementById("loginBtn");
    if (btn) btn.onclick = async () => {
      const ph = document.getElementById("phone").value.trim();
      const nm = document.getElementById("child").value.trim();
      if (!ph || !nm) { toast("请填写手机号和孩子姓名"); return; }
      btn.disabled = true; const old = btn.textContent; btn.textContent = "查找中…";
      try {
        // 先按手机号找回（老生换设备 / 姓名写法不一致时依然能对上）
        const children = await Store.lookupPhone(ph);
        if (children.length) {
          const norm = s => String(s || "").replace(/\s/g, "");
          const partial = children.filter(c =>
            norm(c.name).includes(norm(nm)) || norm(nm).includes(norm(c.name)));
          const exact = partial.find(c => norm(c.name) === norm(nm));
          const match = exact || partial[0];
          if (match) {
            Auth.loginWithChild(ph, match);
            location.hash = "/booking";
            prefetchOldFlag(Auth.current());
            return;
          }
          // 名字对不上该手机号下的孩子 → 列出让家长选
          showPickList(ph, children, nm);
          btn.disabled = false; btn.textContent = old;
          return;
        }
      } catch (e) { /* 找回接口不可用 → 走本地登录兜底 */ }
      const c = Auth.login(ph, nm);
      btn.disabled = false; btn.textContent = old;
      if (c) { location.hash = "/booking"; prefetchOldFlag(c); }
    };
    return;
  }
  const lo = document.getElementById("logoutBtn");
  if (lo) lo.onclick = () => { Auth.logout(); location.hash = "/login"; };

  if (h === "/booking") {
    document.querySelectorAll(".time").forEach(el => {
      el.onclick = () => { selSlot = el.dataset.slot; render(); };
    });
    const bb = document.getElementById("bookBtn");
    if (bb) bb.onclick = async () => {
      if (!selSlot) { toast("请先选一个时段"); return; }
      const c = Auth.current();
      await Store.addBooking(c.childId, { time: selSlot, phone: c.phone, name: c.name });
      toast("预约成功 ✅ " + (CONTACT.coachWechat
        ? "加微信备注「" + c.name + "+" + c.phone + "」"
        : "到店报手机号即可"));
      selSlot = null; render();
    };
    bindContactCopy(); // 绑定预约页老师微信的「复制」按钮
  }

  if (h === "/survey") {
    const sb = document.getElementById("surveyBtn");
    if (sb) sb.onclick = async () => {
      sb.disabled = true;
      const oldText = sb.textContent;
      sb.textContent = "保存中…";
      try { await submitSurvey(child); }
      finally { sb.disabled = false; sb.textContent = oldText; }
    };
  }
}

async function postRender(h, child) {
  if (h === "/booking" && child) await fillBookings(child);
  if (h === "/survey" && child) await fillSurvey(child);
  if (h === "/report" && child) await fillReport(child);
  if (h === "/growth" && child) await fillGrowth(child);
  if (h === "/message" && child) await fillMessage(child);
}

function render() {
  const child = Auth.current();
  let h = location.hash.slice(1) || (child ? "/booking" : "/login");
  if (h !== "/login" && !child) h = "/login";
  const view = routes[h] || renderLogin;
  const app = document.getElementById("app");
  let html = "";
  if (child && h !== "/login") html += headerBar(child);
  html += '<main class="page">' + view(child) + "</main>";
  if (child && h !== "/login") html += tabBar(h);
  app.innerHTML = html;
  bindEvents(h, child);
  postRender(h, child);
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
