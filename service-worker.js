/* 由 tools/build-offline.py 生成，不要手改。
 *
 * 离线策略（为什么这么选）：
 * - 导航请求只从预缓存取 index.html：保证「外壳 + 脚本 + 数据」永远是同一版，
 *   不会出现新 index.html 配旧 bank.js 这种混用。更新走「提示 → 用户刷新」。
 * - 同源静态资源缓存优先：飞机上取不到网络，必须一次命中。
 * - 跨域请求（B 站、外部文档）完全不接管：失败就让浏览器报错，
 *   由页面层给出「当前离线」提示，不影响站内功能。
 */
const VERSION = '686114246ca9';
const CACHE = 'ict-basic-software-' + VERSION;
const INDEX = './index.html';
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icons/apple-touch-icon-180.png",
  "./assets/css/base.css",
  "./assets/css/app.css",
  "./assets/js/data/bank.js",
  "./assets/js/data/catalog.js",
  "./assets/js/data/labs.js",
  "./assets/js/core.js",
  "./assets/js/lab-engine.js",
  "./assets/js/views.js",
  "./assets/js/flight-pack.js",
  "./assets/js/offline.js",
  "./assets/vendor/supabase-js-2.118.0.js",
  "./assets/js/cloud-config.js",
  "./assets/js/cloud.js",
  "./assets/js/app.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
];
const NAV_TIMEOUT = 2500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(PRECACHE);
      } catch (err) {
        /* 单个文件 404 不该让整站失去离线能力：逐个重试，能缓多少缓多少 */
        console.warn('[sw] 预缓存整批失败，改为逐个缓存', err);
        await Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch((e) => console.warn('[sw] 缓存失败', url, e && e.message))
          )
        );
      }
      /* 不自动 skipWaiting：等页面提示用户刷新，避免答题中途被换掉 */
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.indexOf('ict-basic-software-') === 0 && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'STATUS') {
    const port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      caches
        .open(CACHE)
        .then((c) => c.keys())
        .then((keys) =>
          port.postMessage({
            version: VERSION,
            cache: CACHE,
            precached: PRECACHE.length,
            cached: keys.length,
            controlled: !!self.clients,
          })
        )
        .catch(() => port.postMessage({ version: VERSION, cache: CACHE, precached: PRECACHE.length, cached: 0 }))
    );
  }
});

/* 导航：只给缓存里的 index.html。首次访问没有缓存时才走网络。 */
async function navigate(req) {
  const cache = await caches.open(CACHE);
  const hit = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(INDEX));
  if (hit) return hit;

  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT);
    if (res && res.ok) return res;
  } catch (e) {
    /* 首次访问就断网：没有可用的外壳，只能如实失败 */
  }
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font-family:-apple-system,sans-serif;padding:32px;line-height:1.7">' +
      '<h1 style="font-size:18px">离线缓存还没有准备好</h1>' +
      '<p style="color:#555">这个网页 App 需要在有网络时先成功打开一次，才能把课程、题库和实验存到本机。</p>' +
      '<p style="color:#555">请连上网络，打开 <code>https://nyatskr.github.io/ict-basic-software/</code>，等首页出现后关闭再重试。</p>' +
      '</body>',
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

async function asset(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: false });
  if (hit) return hit;

  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone());
    }
    return res;
  } catch (e) {
    const loose = await cache.match(req, { ignoreSearch: true });
    if (loose) return loose;
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  /* 跨域一律不接管：B 站、Supabase、外部文档保持原生行为 */
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(navigate(req));
    return;
  }
  event.respondWith(asset(req));
});
