/* 星羿工作台 · 云端写入授权（轻量）
 * ---------------------------------------------------------------
 * 只做一件事：在本机保存 GitHub 令牌，供页面把数据写回仓库 data/*.json。
 * 它不是访问门 —— 页面照常打开无需密码，只在点「保存」时才用到令牌。
 *
 * 令牌只存在你自己的浏览器 localStorage 里，不会上传任何地方。
 * 对外提供 XYGate 兼容接口，替换 2026-09-04 移除 gate.js 后残留的调用。
 */
(function () {
  var TK = 'xy_gh_token';
  var RL = 'xy_role';

  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { } }

  window.XYGate = {
    ghToken: function () { return get(TK); },
    role: function () { return get(RL) || 'boss'; },
    setToken: function (t) { set(TK, (t || '').trim()); },
    setRole: function (r) { set(RL, r || 'boss'); },
    hasToken: function () { return !!get(TK); },
    clearToken: function () { del(TK); }
  };

  function build() {
    if (document.getElementById('xyAuthFab')) return;

    var fab = document.createElement('button');
    fab.id = 'xyAuthFab';
    fab.setAttribute('style', [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:9000',
      'padding:7px 12px', 'border:none', 'border-radius:20px',
      'font-size:12px', 'font-weight:700', 'cursor:pointer',
      'box-shadow:0 3px 12px rgba(15,32,29,.22)', 'font-family:inherit'
    ].join(';'));

    var mask = document.createElement('div');
    mask.id = 'xyAuthMask';
    mask.setAttribute('style', [
      'display:none', 'position:fixed', 'inset:0', 'z-index:9100',
      'background:rgba(11,61,56,.42)', 'align-items:center', 'justify-content:center', 'padding:16px'
    ].join(';'));

    mask.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:18px 17px;max-width:360px;width:100%;' +
      'box-shadow:0 10px 34px rgba(15,32,29,.28);font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;">' +
      '<div style="font-size:15px;font-weight:800;color:#0f766e;margin-bottom:6px;">🔑 云同步授权</div>' +
      '<div style="font-size:12.5px;color:#5b6b67;line-height:1.75;margin-bottom:10px;">' +
      '粘贴一次 GitHub 令牌，之后在本机保存数据会自动写入云端，<b>手机和电脑就同步了</b>。<br>' +
      '令牌只存在这台设备上，不上传任何服务器。</div>' +
      '<input id="xyAuthInput" type="password" placeholder="ghp_ 开头的令牌" ' +
      'style="width:100%;padding:9px 10px;border:1px solid #cbd5db;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;">' +
      '<div style="display:flex;gap:8px;margin-top:11px;">' +
      '<button id="xyAuthSave" style="flex:1;padding:10px;border:none;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;">保存令牌</button>' +
      '<button id="xyAuthClear" style="padding:10px 14px;border:1px solid #cbd5db;border-radius:9px;background:#fff;color:#5b6b67;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;">清除</button>' +
      '<button id="xyAuthClose" style="padding:10px 14px;border:1px solid #cbd5db;border-radius:9px;background:#fff;color:#5b6b67;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit;">关闭</button>' +
      '</div>' +
      '<div id="xyAuthMsg" style="font-size:12px;margin-top:9px;color:#0f766e;"></div>' +
      '<details style="margin-top:10px;"><summary style="font-size:12px;color:#0f766e;cursor:pointer;font-weight:700;">令牌去哪里拿？（点开看步骤）</summary>' +
      '<div style="font-size:12px;color:#5b6b67;line-height:1.85;margin-top:7px;">' +
      '<b style="color:#0f766e;">【推荐】Fine-grained token（更安全，泄露损失小）</b><br>' +
      '1. github.com 登录 → 头像 → Settings → Developer settings<br>' +
      '2. 左侧 Personal access tokens → <b>Fine-grained tokens</b> → Generate new token<br>' +
      '3. Repository access 选 <b>Only select repositories</b> → 勾选 xingyi-workbench<br>' +
      '4. Permissions 里展开 Repository permissions → <b>Contents</b> 设为 <b>Read and write</b><br>' +
      '5. 生成后复制 <b>github_pat_</b> 开头那串<br><br>' +
      '<b>【备选】Classic token</b><br>' +
      '1. Settings → Developer settings → Personal access tokens → <b>Tokens (classic)</b><br>' +
      '2. Generate new token (classic) → 勾选 <b>repo</b><br>' +
      '3. 复制 <b>ghp_</b> 开头的完整 40 位字符串<br><br>' +
      '<span style="color:#b3261e;font-weight:700;">⚠️ 容易踩的坑</span><br>' +
      '· <b>必须完整复制</b>：ghp_ 是 40 位，少了就是被截断<br>' +
      '· 令牌<b>只在关闭页面前可见一次</b>，忘存就得重新生成<br>' +
      '· 别粘 QQ/微信后再复制，容易被换行截断</div></details>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(mask);

    function paint() {
      var has = XYGate.hasToken();
      fab.textContent = has ? '✅ 已授权' : '🔑 云授权';
      fab.style.background = has ? '#d6f3ec' : '#fdeee6';
      fab.style.color = has ? '#0f766e' : '#9a4a28';
      fab.style.border = has ? '1px solid #14b8a6' : '1px solid #f6d3c0';
      var inp = document.getElementById('xyAuthInput');
      if (inp) inp.value = has ? XYGate.ghToken() : '';
      var msg = document.getElementById('xyAuthMsg');
      if (msg) msg.textContent = has ? '当前状态：已授权，保存时会自动写入云端。' : '当前状态：未授权，保存的数据只存在本机。';
    }

    fab.onclick = function () {
      mask.style.display = 'flex';
      paint();
    };
    mask.onclick = function (e) { if (e.target === mask) mask.style.display = 'none'; };
    document.getElementById('xyAuthClose').onclick = function () { mask.style.display = 'none'; };
    var GH_TIMEOUT = 15000;

    // 令牌合法性与权限验证（前端直连 GitHub API，令牌不出本机）
    function validateToken(tk, cb) {
      var done = false;
      function finish(ok, info) { if (!done) { done = true; cb(ok, info); } }
      var timer = setTimeout(function () { finish(null, '验证超时，请检查网络后重试'); }, GH_TIMEOUT);

      function ping(ev) {
        var xhr = ev.target;
        clearTimeout(timer);
        try {
          if (xhr.status === 200) {
            var u = JSON.parse(xhr.responseText || '{}');
            finish(true, { login: u.login || '', name: u.name || '' });
          } else if (xhr.status === 401) {
            finish(false, '❌ 令牌无效或已过期（GitHub 返回 401）');
          } else if (xhr.status === 403) {
            finish(false, '⚠️ 令牌有效但被限流，请稍后再试');
          } else {
            finish(false, '❌ 验证失败（HTTP ' + xhr.status + '）');
          }
        } catch (e) {
          finish(false, '❌ 响应解析失败：' + e.message);
        }
      }

      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.github.com/user', true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + tk);
        xhr.setRequestHeader('Accept', 'application/vnd.github+json');
        xhr.onload = ping;
        xhr.onerror = function () { clearTimeout(timer); finish(null, '网络不通，无法验证（请检查网络）'); };
        xhr.send();
      } catch (e) {
        clearTimeout(timer); finish(false, '❌ 验证异常：' + e.message);
      }
    }

    // 写权限预检：令牌有效后，对 data/students.json 做一次幂等"原地重写"PUT，
    // 真实探测 fine-grained 令牌是否拥有 Repository→Contents→Read and write 权限。
    // 401/403 → 拦截并给修复指引；超时/网络/解析异常 → 降级放行（避免误杀），但提示留意。
    function verifyWritePermission(tk, cb) {
      var REPO = 'xytyymq/xingyi-workbench';
      var PATH = 'data/students.json';
      var base = 'https://api.github.com/repos/' + REPO + '/contents/' + PATH;
      var done = false;
      function finish(ok, msg) { if (!done) { done = true; cb(ok, msg); } }
      var timer = setTimeout(function () {
        finish(true, '写入权限联网校验超时，已放行；首次保存数据后请留意是否成功写入云端。');
      }, GH_TIMEOUT);

      function putBack(meta) {
        var xhr2 = new XMLHttpRequest();
        xhr2.open('PUT', base, true);
        xhr2.setRequestHeader('Authorization', 'Bearer ' + tk);
        xhr2.setRequestHeader('Accept', 'application/vnd.github+json');
        xhr2.setRequestHeader('Content-Type', 'application/json');
        xhr2.onload = function () {
          clearTimeout(timer);
          if (xhr2.status === 200 || xhr2.status === 201) {
            finish(true, '云端写入权限已确认');
          } else if (xhr2.status === 409) {
            finish(true, '云端写入权限正常（检测到并发更新，已放行）。');
          } else if (xhr2.status === 403) {
            finish(false, '⛔ 该令牌<b>没有云端写入权限（或触发限流）</b>。<br>请到 GitHub 给此令牌（fine-grained）授权 <b>Repository permissions → Contents → Read and write</b>，或改用带 repo 权限的 classic 令牌（ghp_ 开头）。<br>否则保存的数据写不进云端。');
          } else if (xhr2.status === 401) {
            finish(false, '⛔ 令牌已失效（401），请重新生成后再试。');
          } else {
            finish(true, '写入校验返回 HTTP ' + xhr2.status + '，已放行；首次保存后请留意写入结果。');
          }
        };
        xhr2.onerror = function () { clearTimeout(timer); finish(true, '写入校验网络异常，已放行；首次保存后留意写入结果。'); };
        xhr2.send(JSON.stringify({
          message: 'xy-auth write-permission probe (idempotent no-op rewrite)',
          content: meta.content,
          sha: meta.sha,
          branch: 'main'
        }));
      }

      var xhr1 = new XMLHttpRequest();
      xhr1.open('GET', base + '?ref=main', true);
      xhr1.setRequestHeader('Authorization', 'Bearer ' + tk);
      xhr1.setRequestHeader('Accept', 'application/vnd.github+json');
      xhr1.onload = function () {
        if (xhr1.status !== 200) {
          clearTimeout(timer);
          if (xhr1.status === 404) { finish(true, '未找到探测文件，已放行；首次保存后留意写入结果。'); return; }
          finish(true, '读取探测文件异常(HTTP ' + xhr1.status + ')，已放行；首次保存后留意写入结果。'); return;
        }
        var meta;
        try { meta = JSON.parse(xhr1.responseText); } catch (e) { clearTimeout(timer); finish(true, '探测文件解析异常，已放行；首次保存后留意写入结果。'); return; }
        if (!meta || !meta.sha || !meta.content) { clearTimeout(timer); finish(true, '探测文件结构异常，已放行；首次保存后留意写入结果。'); return; }
        putBack(meta);
      };
      xhr1.onerror = function () { clearTimeout(timer); finish(true, '写入校验网络异常，已放行；首次保存后留意写入结果。'); };
      xhr1.send();
    }

    // 格式预检：classic ghp_ 为 40 位，fine-grained github_pat_ 更长
    function preCheck(tk) {
      if (!/^ghp_[A-Za-z0-9]{36}$/.test(tk)) {
        if (/^ghp_[A-Za-z0-9]+$/.test(tk)) {
          return { ok: false, msg: '❌ 令牌长度不对：当前 ' + tk.length + ' 位，' +
            'GitHub classic 令牌应为 40 位（ghp_ + 36 位）。<br>多半是<b>复制时被截断</b>，请回 GitHub 重新完整复制。' };
        }
        if (/^github_pat_[A-Za-z0-9_]+$/.test(tk)) {
          return { ok: true, msg: '' };
        }
        return { ok: false, msg: '❌ 格式不对：应以 <b>ghp_</b> 或 <b>github_pat_</b> 开头。' };
      }
      return { ok: true, msg: '' };
    }

    var busy = false;

    document.getElementById('xyAuthSave').onclick = function () {
      if (busy) return;
      var v = (document.getElementById('xyAuthInput').value || '').trim();
      var msg = document.getElementById('xyAuthMsg');
      if (!v) { alert('请先粘贴令牌'); return; }

      var pc = preCheck(v);
      if (!pc.ok) {
        msg.innerHTML = pc.msg;
        msg.style.color = '#b3261e';
        return;
      }

      busy = true;
      var btn = document.getElementById('xyAuthSave');
      var old = btn.textContent;
      btn.textContent = '验证中…';
      btn.disabled = true;
      msg.style.color = '#5b6b67';
      msg.innerHTML = '正在连接 GitHub 验证令牌…';

      validateToken(v, function (ok, info) {
        busy = false;
        btn.textContent = old;
        btn.disabled = false;
        if (ok === true) {
          // 令牌有效，进一步校验云端写入权限（fine-grained 可能无 contents:write）
          msg.innerHTML = '令牌有效，正在校验云端写入权限…';
          verifyWritePermission(v, function (wok, wmsg) {
            if (!wok) { msg.style.color = '#b3261e'; msg.innerHTML = wmsg; return; }
            XYGate.setToken(v);
            paint();
          msg.style.color = '#0f766e';
          msg.innerHTML = '✅ 验证通过！账号 <b>' + (info.login || '') + '</b>，' +
            '现在保存数据会自动写入云端。';
          setTimeout(function () {
            mask.style.display = 'none';
            try { location.reload(); } catch (e) { }
          }, 900);
          });
        } else if (ok === null) {
          msg.style.color = '#9a4a28';
          msg.innerHTML = '⚠️ ' + info + '<br>可先点「保存令牌」跳过验证本机保存，但建议联网后再验一次。';
          // 网络不通时提供离线保存入口
          var wrap = document.getElementById('xyAuthOfflineWrap');
          if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'xyAuthOfflineWrap';
            wrap.style.cssText = 'margin-top:8px;';
            wrap.innerHTML = '<button id="xyAuthForceSave" style="width:100%;padding:9px;border:1px dashed #14b8a6;' +
              'border-radius:9px;background:#f2fffb;color:#0f766e;font-weight:700;font-size:13px;cursor:pointer;' +
              'font-family:inherit;">仍然保存到本机（离线可用）</button>';
            if (msg.parentNode) msg.parentNode.insertBefore(wrap, msg.nextSibling);
            document.getElementById('xyAuthForceSave').onclick = function () {
              XYGate.setToken(v); paint();
              alert('✅ 已保存到本机。联网后请重新验证一次，确保令牌有效。');
              mask.style.display = 'none';
            };
          }
        } else {
          msg.style.color = '#b3261e';
          msg.innerHTML = info;
        }
      });
    };
    document.getElementById('xyAuthClear').onclick = function () {
      XYGate.clearToken();
      paint();
      alert('已清除本机令牌。');
    };

    paint();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
