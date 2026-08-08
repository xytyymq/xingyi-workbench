/* 星羿工作台 · 访问门 (gate)
 * 纯静态授权：未授权访问任意页面会被拦截到 gate.html 要求输入授权码。
 * 授权码由管理员(老板)逐人微信发放，转发链接者无码无法进入。
 * 授权状态按本设备记忆(localStorage)，可随时退出。
 */
(function () {
  // 有效授权码的 SHA-256 哈希列表（明文码由管理员保管，不入库）
  var VALID = ["62bfbf8a9b315a47c4c7788dc0cd2235a359554b8ab0f1f61676e8fc9b524047", "9a44693c1b2c150b07af73f5f20d5f7b388bb704008d798e4977c48555258998", "4cdd124518fe4a2f13292d9567a9cd59ce7ee0c6fc6ba3341f4e01e3a181e298", "fe781b5bef026b946f49280fce3299f0aad50b931428afe521f250ef97f6c703", "1a19227892926ce6657e436ab993cc02797f56ae7ea806ddd37a152b6e714e1d", "faa316dec91ae74e9ec0adfebf794d6f341d972da7e510276090872bc4bd7152", "4126c4a22634840d00ae03c1864131bb5f86a36c687f35e654d6883b90c36149", "0e6506c5f5aba1255eddb94b32a407e1797c8f4067b6f1b6003a2441caedd33b", "0a87895e9d1fc838060f1d42cf076e8a2141056e606210af6c0501cabb8681b1", "af7f53c76e29aa89520ef9b1d94c0ab21adf1782e1879fda263ceb07b986d8a3", "6ea2b8fd174e469154f4a8ec26f42ca2f0b62546a97edf2e6bbd88e4275e77e4", "656ff5232c0cefd3097dc2274a8bcd0f837a0ca30a68d45739e7d22fa25084de"];
  // 已失效/已撤销的授权码哈希
  var REVOKED = [];

  function getDevice() {
    var d = localStorage.getItem('xy_did');
    if (!d) {
      d = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('xy_did', d);
    }
    return d;
  }
  function getAuth() {
    try { return JSON.parse(localStorage.getItem('xy_auth') || 'null'); } catch (e) { return null; }
  }
  function isAuthed() {
    var a = getAuth();
    if (!a) return false;
    if (REVOKED.indexOf(a.h) >= 0) return false;
    if (VALID.indexOf(a.h) < 0) return false;
    if (a.d !== getDevice()) return false; // 设备变更需重新授权
    return true;
  }
  function gateUrl() {
    return /match-platform/.test(location.pathname) ? '../gate.html' : 'gate.html';
  }
  function redirect() {
    var from = location.pathname + location.search;
    location.replace(gateUrl() + '?from=' + encodeURIComponent(from));
  }
  function sha256hex(str) {
    if (window.crypto && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
      });
    }
    return Promise.reject(new Error('crypto-unavailable'));
  }

  var page = location.pathname.split('/').pop();
  if (page !== 'gate.html') {
    if (!isAuthed()) { redirect(); return; }
  }

  window.XYGate = {
    authed: isAuthed,
    logout: function () { localStorage.removeItem('xy_auth'); },
    check: function (code) {
      return sha256hex(code).then(function (h) {
        if (VALID.indexOf(h) < 0) return { ok: false, msg: '授权码无效，请向管理员获取' };
        if (REVOKED.indexOf(h) >= 0) return { ok: false, msg: '该授权码已失效，请联系管理员重新获取' };
        localStorage.setItem('xy_auth', JSON.stringify({ h: h, d: getDevice(), ts: Date.now() }));
        return { ok: true, h: h };
      });
    }
  };
})();
