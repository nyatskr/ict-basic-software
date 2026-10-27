/* offline.js — PWA 注册、网络状态、离线提示与外链拦截
 *
 * 三件事：
 * 1. 注册 service-worker.js，并在有新版本时提示刷新（不自动刷，避免答题中途被打断）；
 * 2. 断网时在页面底部挂一条明确的状态条，同时把外部链接标灰；
 * 3. 离线时点外部链接直接给出提示，而不是让用户对着错误页发呆。
 */
(function () {
  'use strict';

  const LP = (window.LP = window.LP || {});

  const state = (LP.offline = {
    supported: 'serviceWorker' in navigator,
    controlled: false,
    registered: false,
    version: '',
    precached: 0,
    cached: 0,
    updateReady: false,
    online: navigator.onLine !== false,
    standalone: false,
    lastCheckAt: 0,
  });

  let reg = null;
  let reloading = false;
  let stack = null;
  let netBar = null;
  let upBar = null;
  let onlineTimer = null;

  /* ---------------- 小工具 ---------------- */

  function make(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html) el.innerHTML = html;
    return el;
  }

  function ensureStack() {
    if (stack && document.body.contains(stack)) return stack;
    stack = make('div', 'netstack');
    stack.id = 'netstack';
    document.body.appendChild(stack);
    return stack;
  }

  /* 状态条出现时把 toast 顶上去，否则底部两条提示会叠在一起 */
  function syncStackState() {
    const has = !!(stack && stack.children.length);
    document.body.classList.toggle('has-net', has);
  }

  function detectStandalone() {
    return (
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches)
    );
  }

  /* ---------------- 状态条 ---------------- */

  function renderNetBar() {
    state.online = navigator.onLine !== false;
    document.documentElement.classList.toggle('is-offline', !state.online);

    if (state.online) {
      if (netBar) {
        netBar.classList.remove('show');
        const dead = netBar;
        setTimeout(() => {
          dead.remove();
          syncStackState();
        }, 260);
        netBar = null;
      }
      syncStackState();
      return;
    }

    if (!netBar) {
      ensureStack();
      netBar = make('div', 'netbar');
      netBar.setAttribute('role', 'status');
      netBar.innerHTML =
        '<span class="netdot"></span>' +
        '<span class="nettxt"><b>离线模式</b> 课程、题库、解析与实验都可用；B 站视频请从 App 的「离线缓存」进入。</span>';
      stack.appendChild(netBar);
      syncStackState();
      requestAnimationFrame(() => netBar.classList.add('show'));
    }
  }

  function flashOnline() {
    ensureStack();
    const bar = make('div', 'netbar ok');
    bar.innerHTML = '<span class="netdot"></span><span class="nettxt"><b>已恢复网络</b> 云同步会自动补上。</span>';
    stack.appendChild(bar);
    syncStackState();
    requestAnimationFrame(() => bar.classList.add('show'));
    setTimeout(() => {
      bar.classList.remove('show');
      setTimeout(() => {
        bar.remove();
        syncStackState();
      }, 300);
    }, 2600);
  }

  /* ---------------- 新版本提示 ---------------- */

  function renderUpdateBar() {
    if (!state.updateReady) {
      if (upBar) {
        upBar.remove();
        upBar = null;
        syncStackState();
      }
      return;
    }
    if (upBar) return;
    ensureStack();
    upBar = make('div', 'netbar update');
    upBar.innerHTML =
      '<span class="netdot"></span>' +
      '<span class="nettxt"><b>有新版本</b> 课程或题库已更新，刷新后生效（本机进度不受影响）。</span>' +
      '<button class="netbtn" type="button">刷新</button>';
    upBar.querySelector('button').addEventListener('click', applyUpdate);
    stack.appendChild(upBar);
    syncStackState();
    requestAnimationFrame(() => upBar.classList.add('show'));
  }

  function applyUpdate() {
    if (!reg || !reg.waiting) {
      reloading = true;
      location.reload();
      return;
    }
    reloading = true;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    /* 兜底：万一 controllerchange 没触发 */
    setTimeout(() => {
      if (reloading) location.reload();
    }, 2500);
  }

  function watchInstalling(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        if (navigator.serviceWorker.controller) {
          state.updateReady = true;
          renderUpdateBar();
        }
      } else if (worker.state === 'activated') {
        state.updateReady = false;
        renderUpdateBar();
      }
    });
  }

  /* ---------------- 注册 ---------------- */

  function register() {
    if (!state.supported) return;
    navigator.serviceWorker
      .register('service-worker.js', { scope: './' })
      .then((r) => {
        reg = r;
        state.registered = true;
        state.controlled = !!navigator.serviceWorker.controller;
        if (r.waiting && navigator.serviceWorker.controller) {
          state.updateReady = true;
          renderUpdateBar();
        }
        watchInstalling(r.installing);
        r.addEventListener('updatefound', () => watchInstalling(r.installing));
        refreshSwStatus();
      })
      .catch((err) => {
        console.warn('[offline] Service Worker 注册失败', err);
        state.registered = false;
      });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      state.controlled = true;
      if (reloading) location.reload();
    });
  }

  function refreshSwStatus() {
    const c = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!c) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      const d = e.data || {};
      state.version = d.version || '';
      state.precached = d.precached || 0;
      state.cached = d.cached || 0;
      state.lastCheckAt = Date.now();
      document.dispatchEvent(new CustomEvent('ict:offline-status'));
    };
    try {
      c.postMessage({ type: 'STATUS' }, [ch.port2]);
    } catch (e) {
      /* 忽略 */
    }
  }

  function checkUpdate(force) {
    if (!reg || !navigator.onLine) return;
    const now = Date.now();
    if (!force && now - state.lastCheckAt < 30 * 60 * 1000) return;
    state.lastCheckAt = now;
    reg.update().catch(() => {});
    refreshSwStatus();
  }

  /* ---------------- 外部链接 ---------------- */

  const isExternal = (a) => {
    const href = a.getAttribute('href') || '';
    if (!/^https?:/i.test(href)) return false;
    try {
      return new URL(href, location.href).origin !== location.origin;
    } catch (e) {
      return false;
    }
  };

  function markExternalLinks() {
    const list = document.querySelectorAll('a[href^="http"]');
    for (let i = 0; i < list.length; i++) {
      list[i].classList.toggle('ext-link', isExternal(list[i]));
    }
  }

  function guardExternalClick(e) {
    if (navigator.onLine) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !isExternal(a)) return;
    e.preventDefault();
    e.stopPropagation();
    LP.toast('当前离线：外部链接打不开。B 站视频请从 App 的「离线缓存」进入。', 'warn');
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    state.standalone = detectStandalone();
    state.online = navigator.onLine !== false;
    renderNetBar();

    window.addEventListener('offline', () => {
      renderNetBar();
    });
    window.addEventListener('online', () => {
      const wasOffline = !state.online;
      renderNetBar();
      if (wasOffline) flashOnline();
      markExternalLinks();
      checkUpdate(true);
    });

    document.addEventListener('click', guardExternalClick, true);

    /* 每次重渲染后补一次外链标记：离线时把它们标灰 */
    const app = document.getElementById('app');
    if (app && window.MutationObserver) {
      let t = null;
      new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(markExternalLinks, 60);
      }).observe(app, { childList: true });
    }
    markExternalLinks();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkUpdate(false);
        refreshSwStatus();
      }
    });

    document.addEventListener('ict:offline-status', () => {
      /* 供页面自行刷新展示 */
    });

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);
  }

  /* 供页面调用 */
  LP.offline.status = () => ({
    online: navigator.onLine !== false,
    supported: state.supported,
    registered: state.registered,
    controlled: !!navigator.serviceWorker && !!navigator.serviceWorker.controller,
    version: state.version,
    precached: state.precached,
    cached: state.cached,
    updateReady: state.updateReady,
    standalone: detectStandalone(),
  });
  LP.offline.refresh = refreshSwStatus;
  LP.offline.checkUpdate = checkUpdate;
  LP.offline.applyUpdate = applyUpdate;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
