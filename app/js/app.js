// 家长端 SPA：路由 + 登录隔离 + 4 个核心页 + 馆端聚合页（Phase 2）
let selSlot = null;

function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}

function headerBar(child) {
  return '<div class="header"><h1>星羿试课</h1>' +
    '<div style="text-align:right"><div class="who">' + child.name + " 家长</div>" +
    '<button id="logoutBtn">退出</button></div></div>';
}

function tabBar(active) {
  const t = (h, ic, label) =>
    '<a href="#' + h + '" class="' + (active === h ? "active" : "") + '"><span class="ic">' + ic + "</span>" + label + "</a>";
  return '<div class="tabbar">' + t("/booking", "📅", "预约") + t("/report", "📊", "报告") +
    t("/growth", "🌱", "成长") + t("/message", "🔔", "消息") + "</div>";
}

function renderLogin() {
  return '<div class="hero"><h2>星羿试课 · 家长端</h2><p>给孩子预约一节羽毛球体验课</p></div>' +
    '<div class="card"><h3>登录查看专属内容</h3>' +
    '<input class="input" id="phone" placeholder="家长手机号" inputmode="numeric" />' +
    '<input class="input" id="child" placeholder="孩子姓名（如：小明）" />' +
    '<button class="btn" id="loginBtn">进入</button>' +
    '<p class="muted">登录后仅显示您孩子的试课与体测内容，数据隔离。</p></div>';
}

function renderBooking(child) {
  const slots = Data.TIME_SLOTS.map(t =>
    '<div class="time' + (selSlot === t ? " sel" : "") + '" data-slot="' + t + '">' + t + "</div>").join("");
  return '<div class="hero"><h2>预约试课</h2><p>' + child.name + " 的体验课安排</p></div>" +
    '<div class="card"><h3>选择时段</h3><div class="times">' + slots + "</div>" +
    '<button class="btn" id="bookBtn" style="margin-top:12px;">提交预约</button></div>' +
    '<div class="card"><h3>我的预约</h3><div id="myBookings"><p class="muted">加载中…</p></div></div>';
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
  return '<div class="hero"><h2>' + child.name + " 的体测报告</h2><p>静态 + 动态综合测评</p></div>" +
    '<div class="card" id="reportCard"><h3>测评结果</h3><p class="muted">加载中…</p></div>';
}

async function fillReport(child) {
  const box = document.getElementById("reportCard");
  if (!box) return;
  const r = await Store.getReport(child.childId);
  const entries = (r && r.entries) || [];
  if (!entries.length) {
    box.innerHTML = '<h3>测评结果</h3><p class="muted">教练测评中，试课后报告会自动出现在这里。</p>';
    return;
  }
  const e = entries[entries.length - 1];
  box.innerHTML = '<h3>测评结果 <span class="muted">' + esc2safe(e.date) + "</span></h3>" + reportRows(e) +
    (e.note ? '<div class="note">' + esc2safe(e.note) + "</div>" : "") +
    '<p class="muted">报告由教练试课中测评生成，仅您可见。共 ' + entries.length + ' 次测评记录。</p>';
}

function esc2safe(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function renderGrowth(child) {
  return '<div class="hero"><h2>成长记录</h2><p>' + child.name + " 的试课轨迹</p></div>" +
    '<div class="card"><h3>预约记录</h3><div id="growthBookings"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>体测历史</h3><div id="growthReports"><p class="muted">加载中…</p></div></div>';
}

async function fillGrowth(child) {
  const gb = document.getElementById("growthBookings");
  const gr = document.getElementById("growthReports");
  if (!gb || !gr) return;
  const list = await Store.getBookings(child.childId);
  gb.innerHTML = list.length
    ? list.map(b => '<div class="row"><span class="k">' + esc2safe(b.time) +
        '</span><span class="v">' + esc2safe(b.status) +
        ' <span class="muted">' + fmtTime(b.createdAt) + "</span></span></div>").join("")
    : '<p class="muted">还没有预约记录。</p>';
  const r = await Store.getReport(child.childId);
  const entries = ((r && r.entries) || []).slice().reverse();
  gr.innerHTML = entries.length
    ? entries.map(e =>
        '<div class="row" style="display:block"><span class="k">📊 ' + esc2safe(e.date) + "</span>" +
        '<div class="muted">身高 ' + esc2safe(e.height || "—") + ' · 跳绳 ' + esc2safe(e.rope || "—") +
        ' · 协调 ' + esc2safe(e.coord || "—") + (e.note ? "<br>" + esc2safe(e.note) : "") + "</div></div>").join("")
    : '<p class="muted">还没有体测记录，完成首次测评后这里会记录孩子的成长轨迹。</p>';
}

function renderMessage(child) {
  const m = Data.messagesFor(child);
  const items = m.map(it =>
    '<div class="row"><span class="k">' + it.title + '</span><span class="v">' +
    (it.unread ? '<span class="tag">未读</span>' : '<span class="muted">已读</span>') +
    "<br><span class=\"muted\">" + it.desc + "</span></span></div>").join("");
  return '<div class="hero"><h2>消息</h2><p>报告与跟进提醒</p></div>' +
    '<div class="card"><h3>通知</h3>' + items + "</div>";
}

function renderAdmin() {
  return '<div class="hero"><h2>馆长视图</h2><p>试课预约聚合看板</p></div>' +
    '<div class="card"><h3>所有预约</h3><div id="adminBookings"><p class="muted">加载中…</p></div></div>';
}

async function fillAdmin() {
  const box = document.getElementById("adminBookings");
  if (!box) return;
  const key = (window.TRIAL_CONFIG && window.TRIAL_CONFIG.ADMIN_KEY) || "xingyi2026"; // 生产改 config.js 注入
  const j = await Store.adminBookings(key);
  if (j.error) { box.innerHTML = '<p class="muted">鉴权失败或后端未启动</p>'; return; }
  const rows = (j.bookings || []).map(b =>
    '<div class="row"><span class="k">' + b.childId + '</span><span class="v">' + b.time +
    ' <span class="tag">' + b.status + "</span></span></div>").join("");
  box.innerHTML = j.count
    ? rows
    : '<p class="muted">暂无预约数据</p>';
}

const routes = {
  "/login": renderLogin, "/booking": renderBooking, "/report": renderReport,
  "/growth": renderGrowth, "/message": renderMessage, "/admin": renderAdmin
};

function bindEvents(h, child) {
  if (h === "/login") {
    const btn = document.getElementById("loginBtn");
    if (btn) btn.onclick = () => {
      const ph = document.getElementById("phone").value;
      const nm = document.getElementById("child").value;
      if (!ph || !nm) { toast("请填写手机号和孩子姓名"); return; }
      const c = Auth.login(ph, nm);
      if (c) location.hash = "/booking";
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
      toast("预约成功，到店报手机号即可");
      selSlot = null; render();
    };
  }
}

async function postRender(h, child) {
  if (h === "/booking" && child) await fillBookings(child);
  if (h === "/report" && child) await fillReport(child);
  if (h === "/growth" && child) await fillGrowth(child);
  if (h === "/admin") await fillAdmin();
}

function render() {
  const child = Auth.current();
  let h = location.hash.slice(1) || (child ? "/booking" : "/login");
  if (h !== "/login" && h !== "/admin" && !child) h = "/login";
  const view = routes[h] || renderLogin;
  const app = document.getElementById("app");
  let html = "";
  if (child && h !== "/login" && h !== "/admin") html += headerBar(child);
  html += '<main class="page">' + view(child) + "</main>";
  if (child && h !== "/login" && h !== "/admin") html += tabBar(h);
  app.innerHTML = html;
  bindEvents(h, child);
  postRender(h, child);
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
