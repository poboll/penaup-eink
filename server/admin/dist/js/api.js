/* Penaup Runtime 前端 API 层：Bearer 令牌封装 + 统一错误处理 */
(function (global) {
  const BASE = '/api/v1/admin';
  const TOKEN_KEY = 'fh_token';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }
  function isAuthed() { return !!getToken(); }

  async function request(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      clearToken();
      if (!location.pathname.endsWith('login.html')) {
        location.href = 'login.html';
      }
      throw new Error('未登录或登录已过期');
    }
    if (!res.ok) {
      let msg = '请求失败 (' + res.status + ')';
      try {
        const j = await res.json();
        msg = (j.detail && typeof j.detail === 'string' ? j.detail : null) ||
          (j.error && typeof j.error === 'string' ? j.error : null) ||
          (j.message && typeof j.message === 'string' ? j.message : null) ||
          (j.msg && typeof j.msg === 'string' ? j.msg : null) || msg;
      } catch (e) { /* 非 JSON 响应 */ }
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) {
      const payload = await res.json();
      return payload && payload.ok && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
    }
    return res;
  }

  global.API = {
    get: (p) => request(p),
    post: (p, body) => request(p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }),
    put: (p, body) => request(p, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }),
    del: (p) => request(p, { method: 'DELETE' }),
    upload: (p, formData) => request(p, { method: 'POST', body: formData }),
    /* 新运行时没有内置账号密码：令牌由 PENAUP_ADMIN_TOKEN 提供。 */
    login: async (username, password) => {
      const headers = password ? { Authorization: 'Bearer ' + password } : {};
      const res = await fetch('/api/v1/admin/devices', { headers });
      if (!res.ok) throw new Error(res.status === 401 ? '管理令牌不正确' : '运行时暂不可用');
      return { access_token: password || 'local-runtime' };
    },
    setToken, clearToken, isAuthed,
  };
})(window);
