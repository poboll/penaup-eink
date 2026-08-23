/* Penaup Runtime 前端公共层：登录守卫 / Toast / 顶栏状态 / 工具函数 */
(function (global) {
  const PAGES = [
    ['dashboard.html', '仪表盘'],
    ['devices.html', '设备管理'],
    ['templates.html', '模板库'],
    ['streams.html', '轮播流'],
    ['albums.html', '相册'],
    ['ai.html', 'AI 创作'],
    ['settings.html', '设置'],
  ];

  /* 登录守卫：后台页面统一入口调用 */
  function guard() {
    if (!API.isAuthed()) {
      location.href = 'login.html';
      return false;
    }
    return true;
  }

  /* 顶栏在线状态：拉一次设备列表汇总在线数与平均电量 */
  async function refreshStatus() {
    const el = document.querySelector('.topnav .status');
    if (!el) return;
    try {
      const result = await API.get('/devices');
      const devs = Array.isArray(result) ? result : (result.data || []);
      const online = devs.filter(d => d.online).length;
      const avg = devs.length
        ? Math.round(devs.reduce((s, d) => s + (d.battery_percent || 0), 0) / devs.length)
        : 100;
      el.innerHTML = '<span class="dot dot-pulse"></span>' + online + ' 台在线 · ' + avg + '%';
    } catch (e) { /* 忽略状态刷新失败 */ }
  }

  /* 全局 Toast（纸墨风格） */
  function toast(msg, type) {
    let box = document.getElementById('fh-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fh-toast';
      box.style.cssText =
        'position:fixed;top:18px;left:50%;transform:translateX(-50%) translateY(-16px);' +
        'z-index:999;opacity:0;transition:all .25s;display:flex;flex-direction:column;gap:8px;align-items:center;';
      document.body.appendChild(box);
    }
    const item = document.createElement('div');
    item.style.cssText =
      'background:var(--ink);color:var(--paper);font-size:13px;padding:9px 18px;' +
      'border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.25);white-space:nowrap;letter-spacing:.5px;';
    if (type === 'err') item.style.background = 'var(--red)';
    if (type === 'ok') item.style.background = '#14640a';
    item.textContent = msg;
    box.appendChild(item);
    requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity .3s';
      setTimeout(() => item.remove(), 320);
    }, 2600);
  }

  /*
   * Admin responses may contain paths that originated in a database or an
   * integration. Keep image fetches on the current runtime origin and on the
   * two namespaces that are intentionally allowed to serve image assets.
   * Escaping an attribute is not enough: `javascript:` and cross-origin URLs
   * still create an unsafe resource boundary.
   */
  function safeAssetUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    try {
      const origin = global.location && global.location.origin ? global.location.origin : 'http://penaup.local';
      const url = new URL(raw, origin);
      const sameOrigin = url.origin === origin && (url.protocol === 'http:' || url.protocol === 'https:');
      const allowedPath = url.pathname === '/api' || url.pathname.startsWith('/api/') ||
        url.pathname === '/assets' || url.pathname.startsWith('/assets/');
      return sameOrigin && allowedPath ? url.pathname + url.search + url.hash : '';
    } catch (error) {
      return '';
    }
  }

  /* 加载受鉴权保护的图片（如模板服务端预览），返回 objectURL */
  async function authImg(url) {
    const endpoint = safeAssetUrl(url);
    if (!endpoint) throw new Error('图片资源地址无效');
    const token = localStorage.getItem('fh_token') || '';
    const res = await fetch(endpoint, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) throw new Error('图片加载失败 (' + res.status + ')');
    return URL.createObjectURL(await res.blob());
  }

  /* 受保护的动态图片统一用 Bearer 拉取，避免把管理令牌放进 URL。 */
  function releaseAuthImages(root) {
    (root || document).querySelectorAll('img[data-object-url]').forEach(img => {
      const objectUrl = img.dataset.objectUrl;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      delete img.dataset.objectUrl;
    });
  }

  function loadAuthImages(root) {
    const scope = root || document;
    scope.querySelectorAll('img[data-auth-src]').forEach(async img => {
      const endpoint = safeAssetUrl(img.dataset.authSrc);
      if (!endpoint || img.dataset.loading === '1') return;
      img.dataset.loading = '1';
      try {
        const objectUrl = await authImg(endpoint);
        if (!img.isConnected) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        const previous = img.dataset.objectUrl;
        if (previous) URL.revokeObjectURL(previous);
        img.dataset.objectUrl = objectUrl;
        img.src = objectUrl;
      } catch (error) {
        // Trigger the page-provided fallback without exposing the protected
        // endpoint or leaving a broken-image icon in the admin console.
        img.dispatchEvent(new Event('error'));
      } finally {
        delete img.dataset.loading;
      }
    });
  }

  /* 格式化时间 */
  function fmtTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    const p = n => (n < 10 ? '0' + n : n);
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtClock(d) {
    const p = n => (n < 10 ? '0' + n : n);
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* 确认框（纸墨风格，返回 Promise<boolean>） */
  function confirmBox(msg) {
    return new Promise(resolve => {
      let mask = document.getElementById('fh-confirm');
      if (!mask) {
        mask = document.createElement('div');
        mask.id = 'fh-confirm';
        mask.style.cssText =
          'position:fixed;inset:0;background:rgba(26,26,26,.45);display:grid;place-items:center;z-index:998;';
        mask.innerHTML =
          '<div style="background:var(--paper);border:1px solid var(--ink);border-radius:12px;' +
          'width:340px;max-width:calc(100vw-40px);box-shadow:0 16px 30px rgba(0,0,0,.2)">' +
          '<div id="fh-confirm-msg" style="padding:22px 22px 6px;font-size:13.5px;line-height:1.7"></div>' +
          '<div style="padding:16px 22px;display:flex;justify-content:flex-end;gap:10px">' +
          '<button class="btn" id="fh-confirm-no">取消</button>' +
          '<button class="btn btn-danger" id="fh-confirm-yes">确认</button>' +
          '</div></div>';
        document.body.appendChild(mask);
      }
      mask.style.display = 'grid';
      document.getElementById('fh-confirm-msg').textContent = msg;
      const done = ok => { mask.style.display = 'none'; resolve(ok); };
      document.getElementById('fh-confirm-yes').onclick = () => done(true);
      document.getElementById('fh-confirm-no').onclick = () => done(false);
    });
  }

  /* e-ink 转场 + 导航跳转 */
  function setupNavRefresh() {
    const app = document.getElementById('app');
    if (!app) return;
    document.querySelectorAll('.nav a').forEach(a => {
      a.addEventListener('click', e => {
        const href = a.getAttribute('href');
        if (!href || href === location.pathname.split('/').pop()) return;
        e.preventDefault();
        app.classList.add('refresh');
        setTimeout(() => { location.href = href; }, 240);
      });
    });
  }

  global.FH = { guard, refreshStatus, toast, fmtTime, fmtClock, confirmBox, setupNavRefresh, authImg, safeAssetUrl, loadAuthImages, releaseAuthImages, PAGES };
})(window);
