// 登录隔离：手机号 + 孩子姓名 -> 会话；30 天 token + localStorage 浏览器绑定
const Auth = {
  TOKEN_KEY: "trial_token",
  CHILD_KEY: "trial_child",
  _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return "c" + Math.abs(h);
  },
  login(phone, childName) {
    const name = (childName || "").trim();
    const ph = (phone || "").trim();
    if (!ph || !name) return null;
    const child = { phone: ph, name, childId: this._hash(ph + name) };
    const token = "t" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const exp = Date.now() + 30 * 24 * 3600 * 1000; // 30 天
    localStorage.setItem(this.TOKEN_KEY, JSON.stringify({ token, exp }));
    localStorage.setItem(this.CHILD_KEY, JSON.stringify(child));
    return child;
  },
  current() {
    try {
      const t = JSON.parse(localStorage.getItem(this.TOKEN_KEY));
      const c = JSON.parse(localStorage.getItem(this.CHILD_KEY));
      if (!t || !c) return null;
      if (t.exp < Date.now()) { this.logout(); return null; }
      return c;
    } catch (e) { return null; }
  },
  isAuthed() { return !!this.current(); },
  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.CHILD_KEY);
  }
};
