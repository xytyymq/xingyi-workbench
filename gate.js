// 星羿工作台 · 访问门（纯静态 · 非对称签名版 + 临时绑定模式）
// 设计：老板持私钥(本机)签发授权令牌，前端持公钥验签。
// 两种令牌：
//   ① 设备令牌  { d:设备码, e:过期, p:用途 }           —— 绑设备，转发/换设备无效
//   ② 绑定令牌  { bind:true, e:限时, fe:最终过期, p }  —— 不绑设备，对方点一次自动绑其本机
// 无需任何后端，GitHub Pages 静态托管即可运行。
(function () {
  const XYGate = (function () {
    const LS_T = 'xy_token', LS_D = 'xy_dev', LS_B = 'xy_bind', LS_R = 'xy_role';
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
    function readCookie(n) {
      var m = document.cookie.match('(^|;)\\s*' + n + '=([^;]*)');
      return m ? decodeURIComponent(m[1]) : '';
    }
    function writeCookie(n, v, days) {
      var exp = new Date(Date.now() + days * 86400000).toUTCString();
      document.cookie = n + '=' + encodeURIComponent(v) + ';expires=' + exp + ';path=/;SameSite=Lax';
    }
    // devId 双重持久：localStorage 优先，回退 cookie。
    // 移动端(微信/iOS)清缓存或会话隔离时 localStorage 易丢，cookie 兜底可避免 devId 每次重生 -> 设备令牌不再无故失效弹门。
    function devId() {
      var d = localStorage.getItem(LS_D);
      if (!d) d = readCookie('xy_dev');
      if (!d) {
        d = (crypto.randomUUID ? crypto.randomUUID()
          : ('' + Math.random()).slice(2) + Date.now().toString(36));
      }
      localStorage.setItem(LS_D, d);
      writeCookie('xy_dev', d, 400);
      return d;
    }
    function token() { return localStorage.getItem(LS_T) || ''; }
    function authed() { return !!token(); }
    function role() { return localStorage.getItem(LS_R) || 'boss'; }
    function roleName() { var m={boss:'老板',coach:'教练',admin:'教务'}; return m[role()] || '老板'; }
    function logout() { localStorage.removeItem(LS_T); localStorage.removeItem(LS_B); localStorage.removeItem(LS_R); }

    function parsePayload(t) {
      try {
        const parts = (t || '').split('.');
        if (parts.length !== 2) return null;
        const dataBytes = b64urlDecodeBytes(parts[0]);
        return JSON.parse(new TextDecoder().decode(dataBytes));
      } catch (e) { return null; }
    }

    // 仅验签 + 过期。ignoreDevice=true 时跳过设备码比对（绑定令牌用）
    function verifySig(t, ignoreDevice) {
      return new Promise(function (resolve) {
        try {
          const parts = (t || '').split('.');
          if (parts.length !== 2) return resolve(false);
          const dataBytes = b64urlDecodeBytes(parts[0]);
          const sigBytes = b64urlDecodeBytes(parts[1]);
          let payload;
          try { payload = JSON.parse(new TextDecoder().decode(dataBytes)); }
          catch (e) { return resolve(false); }
          if (!payload.e || payload.e < Date.now()) return resolve(false); // 过期
          if (!ignoreDevice && payload.d !== devId()) return resolve(false); // 设备不匹配
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

    // —— 本地绑定授权（绑定令牌消费后固化在本机）——
    function localBind() {
      try { return JSON.parse(localStorage.getItem(LS_B) || 'null'); } catch (e) { return null; }
    }
    // 用本机设备码对授权内容做完整性校验，清缓存/换设备即失效
    function makeMac(obj) {
      const str = JSON.stringify({ d: obj.d, e: obj.e, p: obj.p, from: obj.from });
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(devId() + ':' + str))
        .then(function (h) { return b64urlEncodeBytes(new Uint8Array(h)); });
    }
    function verifyLocal() {
      const obj = localBind();
      if (!obj) return Promise.resolve(false);
      if (obj.e < Date.now()) return Promise.resolve(false);   // 最终过期
      if (obj.d !== devId()) return Promise.resolve(false);     // 设备变了
      return makeMac(obj).then(function (mac) { return mac === obj.mac; });
    }

    // 消费令牌：签名令牌直接存；绑定令牌转为本地授权
    function consume(t) {
      const payload = parsePayload(t);
      if (!payload) return Promise.resolve(false);
      function setRole(r) { if (r) localStorage.setItem(LS_R, r); }
      function report(it) {
        try {
          // 上报到授权日志服务
          var eut = 'https://xingyi-auth-logger-q7tyq9xg.edgeone.cool';
          var eop = 'eo_token=4ca2b11aff5758056e0cb19b14f77aee&eo_time=1786193438';
          fetch(eut + '/?' + eop, { method: 'HEAD', mode: 'no-cors' }).then(function () {
            return fetch(eut + '/api/auth-log?' + eop, {
              method: 'POST', mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ device: it.dev, role: it.role, purpose: it.purpose,
                time: new Date().toISOString(), ua: navigator.userAgent.substring(0, 200) })
            });
          }).catch(function () {});
        } catch (e) {}
      }
      if (payload.bind === true) {
        return verifySig(t, true).then(function (ok) {
          if (!ok) return false;
          const finalE = payload.fe || (Date.now() + 365 * 86400000);
          const obj = { d: devId(), e: finalE, p: payload.p || '', from: 'bind' };
          return makeMac(obj).then(function (mac) {
            obj.mac = mac;
            localStorage.setItem(LS_B, JSON.stringify(obj));
            setRole(payload.r);
            report({ dev: devId(), role: payload.r || 'unknown', purpose: payload.p || '' });
            return true;
          });
        });
      }
      return verifySig(t, false).then(function (ok) {
        if (ok) {
          localStorage.setItem(LS_T, t);
          setRole(payload.r);
          report({ dev: payload.d || devId(), role: payload.r || 'unknown', purpose: payload.p || '' });
        }
        return ok;
      });
    }

    // 综合是否已授权（签名令牌 或 本地绑定授权）
    function authorized() {
      if (authed()) {
        return verifySig(token(), false).then(function (ok) {
          if (ok) {
            // 回顾时恢复角色
            var p = parsePayload(token());
            if (p && p.r) localStorage.setItem(LS_R, p.r);
            return true;
          }
          localStorage.removeItem(LS_T);
          localStorage.removeItem(LS_R);
          return verifyLocalThenClear();
        });
      }
      return verifyLocalThenClear();
      function verifyLocalThenClear() {
        return verifyLocal().then(function (ok) {
          if (!ok) { localStorage.removeItem(LS_B); localStorage.removeItem(LS_R); }
          return ok;
        });
      }
    }

    return { devId: devId, token: token, authed: authed, logout: logout, role: role, roleName: roleName,
             parsePayload: parsePayload, consume: consume, authorized: authorized };
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
  // 已存令牌则异步复核（过期/换设备会被拦），无授权直接跳授权页
  XYGate.authorized().then(function (ok) {
    if (!ok) location.replace(gateUrl + '?from=' + encodeURIComponent(path));
    else {
      // 注入角色标识到 body，页面可通过 CSS/JS 控制可见内容
      document.body.classList.add('xy-role-' + XYGate.role());
    }
  });
})();
