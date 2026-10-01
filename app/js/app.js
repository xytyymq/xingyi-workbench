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
  return '<div class="header"><h1>🏸 星羿家长端</h1>' +
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
  return '<div class="hero"><h2>星羿家长端</h2><p>约课 · 成长记录 · 荣誉墙 · 体测报告，一站式查看</p></div>' +
    '<div class="card"><h3>登录查看专属内容</h3>' +
    '<input class="input" id="phone" placeholder="家长手机号" inputmode="numeric" />' +
    '<input class="input" id="child" placeholder="孩子姓名（如：小明）" />' +
    '<button class="btn" id="loginBtn">进入</button>' +
    '<div id="pickList"></div>' +
    '<p class="muted">手机号和孩子姓名请与预约时填写的一致。记不清写法也没关系：点「进入」后系统会按手机号自动帮您找回孩子的记录。</p></div>';
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
    '<div class="card"><h3>② 教练现场体测</h3><div id="coachCard"><p class="muted">加载中…</p></div>' +
    '<button class="btn ghost" id="dlReportBtn" style="margin-top:10px;">📥 生成报告图片（长按可保存）</button></div>';
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
        '<text x="290" y="672" font-size="20" font-weight="bold" fill="#F2F8F6" text-anchor="end" font-family="PingFang SC,Microsoft YaHei,sans-serif">' +
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
  const dl = document.getElementById("dlReportBtn");
  if (dl) dl.onclick = async () => {
    if (!entries.length) { toast("还没有体测数据，试课后教练填写即可生成"); return; }
    dl.disabled = true; const old = dl.textContent; dl.textContent = "生成中…";
    try { await openImgModal(reportCardSvg(child, parent, entries), 750, 980, child.name + " · 体测报告"); }
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
    '<div class="card"><h3>📊 体测历史</h3><div id="growthReports"><p class="muted">加载中…</p></div></div>';
}

// 上课反馈：家长话术呈现
function classCards(classes) {
  if (!classes.length)
    return '<p class="muted">还没有上课记录。孩子来上课后，教练当天的反馈会自动出现在这里。</p>';
  const fmtD = s => { const m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? (+m[2]) + "月" + (+m[3]) + "日" : s; };
  return classes.slice(0, 12).map(c => {
    const lines = [];
    if (c.progress) lines.push('<div class="fb-line">🌟 <b>今日进步</b>：' + esc2safe(c.progress) + "</div>");
    if (c.focus) lines.push('<div class="fb-line">💪 <b>下节课重点</b>：' + esc2safe(c.focus) + "</div>");
    return '<div class="fb-card">' +
      '<div class="fb-head"><b>' + esc2safe(fmtD(c.date)) + "</b>" +
      (c.className ? '<span class="tag">' + esc2safe(c.className) + "</span>" : "") +
      (c.coach ? '<span class="muted">教练 ' + esc2safe(c.coach) + "</span>" : "") + "</div>" +
      '<div class="fb-say">孩子今天的训练已完成 ✅</div>' +
      lines.join("") + "</div>";
  }).join("") + (classes.length > 12 ? '<p class="muted">仅显示最近 12 次上课反馈</p>' : "");
}

// 荣誉墙：已获得（彩色可点）+ 未获得（灰显锁定）
function awardWall(awards) {
  const got = {};
  (awards || []).forEach(a => { got[a.type] = got[a.type] || []; got[a.type].push(a); });
  const items = AWARD_TYPES.map(m => {
    const mine = got[m.type];
    if (mine && mine.length) {
      const last = mine[0];
      return '<div class="award-card got" onclick="showAwardImage(\'' + m.type + '\',\'' +
        esc2safe(last.name || "").replace(/'/g, "") + '\',\'' + esc2safe(last.date) + '\',\'' +
        esc2safe(last.note || "").replace(/'/g, "") + '\')" title="点击看奖状大图">' +
        '<span class="a-ic">' + m.icon + '</span><span class="a-name">' + m.name + "</span>" +
        '<span class="a-date">' + esc2safe(last.date || "") + '</span><span class="a-tip">查看</span></div>';
    }
    return '<div class="award-card lock"><span class="a-ic">' + m.icon + '</span><span class="a-name">' + m.name + "</span>" +
      '<span class="a-how">🔒 ' + esc2safe(m.how) + "</span></div>";
  }).join("");
  const extra = (awards || []).filter(a => !AWARD_TYPES.some(m => m.type === a.type));
  return '<div class="award-grid">' + items + "</div>" +
    (extra.length ? '<p class="muted">其他荣誉：' + extra.map(a => esc2safe(awardMeta(a.type).name)).join("、") + "</p>" : "");
}

// ===== 奖状大图（SVG 模板 → PNG，长按保存） =====
function awardSvg(type, name, date, note) {
  const m = awardMeta(type);
  const d = String(date || "").replace(/^(\d{4})-(\d{1,2})-(\d{1,2}).*$/, "$1 年 $2 月 $3 日");
  const noteTxt = note ? String(note).slice(0, 40) : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="530" viewBox="0 0 750 530">' +
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#0E5A4C"/><stop offset="1" stop-color="#0B3A32"/></linearGradient></defs>' +
    '<rect width="750" height="530" rx="18" fill="url(#bg)"/>' +
    '<rect x="14" y="14" width="722" height="502" rx="12" fill="none" stroke="#E0A93B" stroke-width="3"/>' +
    '<rect x="24" y="24" width="702" height="482" rx="8" fill="none" stroke="#E0A93B" stroke-width="1" opacity=".5"/>' +
    '<circle cx="375" cy="120" r="44" fill="#E0A93B" opacity=".15"/>' +
    '<text x="375" y="138" font-size="52" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">' + m.icon + "</text>" +
    '<text x="375" y="212" font-size="44" font-weight="bold" fill="#E0A93B" text-anchor="middle" letter-spacing="6" font-family="PingFang SC,Microsoft YaHei,sans-serif">' + m.name + "</text>" +
    '<text x="375" y="252" font-size="15" fill="#C6F94B" text-anchor="middle" letter-spacing="4">XINGYI BADMINTON · HONOR</text>' +
    '<text x="375" y="316" font-size="26" fill="#F2F8F6" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">授予 <tspan font-weight="bold" font-size="32" fill="#FFFFFF">' + esc2safe(name) + " 同学</tspan></text>" +
    '<text x="375" y="368" font-size="18" fill="#BFD8D2" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">表彰你在羽毛球训练中的出色表现，愿你挥拍向前，成长看得见！</text>' +
    (noteTxt ? '<text x="375" y="404" font-size="16" fill="#C6F94B" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">「' + esc2safe(noteTxt) + '」</text>' : "") +
    '<text x="375" y="462" font-size="16" fill="#8AA09A" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">' + d + "</text>" +
    '<text x="375" y="492" font-size="14" fill="#8AA09A" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif">星羿羽毛球馆 · 九江开发区杭州路</text></svg>';
}

window.showAwardImage = async function (type, name, date, note) {
  const svg = awardSvg(type, name, date, note);
  await openImgModal(svg, 750, 530, name + " · " + awardMeta(type).name);
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
    Store.getGrowth(child.childId, child.name).catch(() => ({ classes: [], awards: [] }))
  ]);
  if (gc) gc.innerHTML = classCards(growth.classes);
  if (aw) aw.innerHTML = awardWall(growth.awards);
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
