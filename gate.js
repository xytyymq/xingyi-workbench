// 星羿工作台 · 访问门（纯静态 · 非对称签名版）
// 设计：老板持私钥(本机)签发授权令牌，前端持公钥验签。
// 令牌绑定设备 + 有过期时间，转发他人/换设备均无效。
// 无需任何后端，GitHub Pages 静态托管即可运行。
(function () {
  const XYGate = (function () {
    const LS_T = 'xy_token', LS_D = 'xy_dev';
    // 内联公钥 (SPKI PEM, ECDSA P-256)。公钥公开无害，无法用于伪造签名。
    const PUB_PEM = [
      '-----BEGIN PUBLIC KEY-----',
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkC+xJcswBCxt+9Qz0n+ZCdbD2s0y',
      'SqBEyO8b1Jw9OyonHtDgQwAv/03r8+93mZAiPjuYbU+ihkkay9Lkm/LayQ==',
      '-----END PUBLIC KEY-----'
    ].join('\n');

    function b64urlEncodeBytes(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function b64urlDecodeBytes(s) {
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    function pemToBuf(pem) {
      const b64 = pem.replace(/-----BEGIN[A-Z ]+-----/, '')
                     .replace(/-----END[A-Z ]+-----/, '')
                     .replace(/\s+/g, '');
      return b64urlDecodeBytes(b64);
    }
    function devId() {
      let d = localStorage.getItem(LS_D);
      if (!d) {
        d = (crypto.randomUUID ? crypto.randomUUID()
          : ('' + Math.random()).slice(2) + Date.now().toString(36));
        localStorage.setItem(LS_D, d);
      }
      return d;
    }
    function token() { return localStorage.getItem(LS_T) || ''; }
    function authed() { return !!token(); }
    function logout() { localStorage.removeItem(LS_T); }

    // 验证令牌：签名有效 + 未过期 + 设备匹配
    function verify(tokenStr) {
      return new Promise(function (resolve) {
        try {
          const parts = (tokenStr || '').split('.');
          if (parts.length !== 2) return resolve(false);
          const dataBytes = b64urlDecodeBytes(parts[0]);
          const sigBytes = b64urlDecodeBytes(parts[1]);
          let payload;
          try { payload = JSON.parse(new TextDecoder().decode(dataBytes)); }
          catch (e) { return resolve(false); }
          if (!payload.e || payload.e < Date.now()) return resolve(false); // 过期
          if (payload.d !== devId()) return resolve(false); // 设备不匹配
          const keyBuf = pemToBuf(PUB_PEM);
          crypto.subtle.importKey('spki', keyBuf,
            { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
            .then(function (key) {
              return crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, dataBytes);
            })
            .then(function (ok) { resolve(!!ok); })
            .catch(function () { resolve(false); });
        } catch (e) { resolve(false); }
      });
    }
    function consume(t) {
      return verify(t).then(function (ok) {
        if (ok) localStorage.setItem(LS_T, t);
        return ok;
      });
    }
    return { devId: devId, token: token, authed: authed, logout: logout,
             verify: verify, consume: consume };
  })();
  window.XYGate = XYGate;

  // 推导根目录 gate.html 绝对地址（兼容 GitHub Pages 项目站子目录）
  var gateUrl = (function () {
    var sc = document.querySelectorAll('script[src*="gate.js"]');
    var src = sc.length ? sc[0].src : location.href;
    return src.substring(0, src.lastIndexOf('/') + 1) + 'gate.html';
  })();
  var idxUrl = gateUrl.replace(/gate\.html$/, 'index.html');

  const params = new URLSearchParams(location.search);
  const path = location.pathname;
  const here = path.split('/').pop();

  if (here === 'gate.html') {
    const t = params.get('token');
    if (t) {
      XYGate.consume(t).then(function (ok) {
        if (ok) location.replace(params.get('from') || idxUrl);
      });
    }
    return; // gate 页本身不强制跳
  }
  if (params.get('token')) {
    XYGate.consume(params.get('token')).then(function () {});
    return;
  }
  // 已存令牌则异步复核（过期/换设备会被拦），无令牌直接跳授权页
  if (XYGate.authed()) {
    XYGate.verify(XYGate.token()).then(function (ok) {
      if (!ok) { XYGate.logout(); location.replace(gateUrl + '?from=' + encodeURIComponent(path)); }
    });
  } else {
    location.replace(gateUrl + '?from=' + encodeURIComponent(path));
  }
})();
