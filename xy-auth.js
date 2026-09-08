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
      '<div style="font-size:12px;color:#5b6b67;line-height:1.8;margin-top:7px;">' +
      '1. 电脑打开 github.com 登录<br>' +
      '2. 右上角头像 → Settings → Developer settings<br>' +
      '3. Personal access tokens → Tokens (classic) → Generate new token<br>' +
      '4. 勾选 <b>repo</b>（完整仓库权限），生成后复制 ghp_ 开头那串<br>' +
      '5. 粘到上面输入框保存即可，只需做一次</div></details>' +
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
    document.getElementById('xyAuthSave').onclick = function () {
      var v = (document.getElementById('xyAuthInput').value || '').trim();
      if (!v) { alert('请先粘贴令牌'); return; }
      XYGate.setToken(v);
      paint();
      alert('✅ 授权成功！现在保存数据会自动同步到云端。');
      mask.style.display = 'none';
      try { location.reload(); } catch (e) { }
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
