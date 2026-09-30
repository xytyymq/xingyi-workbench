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
  return '<div class="tabbar">' + t("/booking", "📅", "预约") + t("/survey", "📋", "档案") +
    t("/report", "📊", "报告") + t("/growth", "🌱", "成长") + t("/message", "🔔", "消息") + "</div>";
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
  return '<div class="hero"><h2>' + child.name + " 的体测报告</h2><p>家长档案 + 教练现场体测</p></div>" +
    '<div class="card"><h3>① 您填写的孩子信息</h3><div id="parentCard"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>② 教练现场体测</h3><div id="coachCard"><p class="muted">加载中…</p></div></div>';
}

function surveyRows(p, exp) {
  const row = (k, v) => v ? '<div class="row"><span class="k">' + k + '</span><span class="v">' + esc2safe(v) + "</span></div>" : "";
  return row("性别", p.gender) + row("出生年月", p.birth) + row("就读年级", p.grade) +
    row("羽毛球基础", p.prior) + row("运动基础", p.base) + row("性格", p.pers) +
    row("每周训练", p.weekly) + row("家长期望", exp) +
    row("健康注意", p.health) + row("孩子最想要", p.want);
}

async function fillReport(child) {
  const pc = document.getElementById("parentCard");
  const cc = document.getElementById("coachCard");
  if (!pc || !cc) return;
  const r = await Store.getReport(child.childId);
  const parent = (r && r.parent) || null;
  const entries = (r && r.entries) || [];
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

function renderGrowth(child) {
  return '<div class="hero"><h2>成长记录</h2><p>' + child.name + " 的试课轨迹</p></div>" +
    '<div class="card"><h3>档案填写状态</h3><div id="growthSurvey"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>预约记录</h3><div id="growthBookings"><p class="muted">加载中…</p></div></div>' +
    '<div class="card"><h3>体测历史</h3><div id="growthReports"><p class="muted">加载中…</p></div></div>';
}

async function fillGrowth(child) {
  const gs = document.getElementById("growthSurvey");
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
  const p = (r && r.parent) || null;
  if (gs) gs.innerHTML = (p && p.gender)
    ? '<div class="row"><span class="k">📋 孩子档案</span><span class="v"><span class="tag good">已填</span> <span class="muted">' +
        (p.filledAt ? fmtTime(p.filledAt) : "") + '</span></span></div>'
    : '<div class="row"><span class="k">📋 孩子档案</span><span class="v"><span class="tag warn">未填</span></span></div>' +
      '<a class="btn" href="#/survey">去填写</a>';
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



const routes = {
  "/login": renderLogin, "/booking": renderBooking, "/survey": renderSurvey,
  "/report": renderReport, "/growth": renderGrowth, "/message": renderMessage
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
