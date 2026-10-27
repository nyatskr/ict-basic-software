/* 离线（飞行模式）回归：装好 Service Worker 后切断网络，站点必须照常启动与使用。
 *
 *   node tools/test-offline.mjs
 *   node tools/test-offline.mjs --keep-shots   # 把截图留在 .tmp-qa/
 *
 * 覆盖：
 * - Service Worker 安装并接管、预缓存条目数与版本号；
 * - 断网后重载：概览 / 小节 / 实验 / 飞行离线包都能渲染；
 * - 断网后做题、标记视频缓存，刷新后本机记录仍在；
 * - 断网点外部链接给出提示，而不是白屏。
 *
 * 需要 Node 18+ 与本机 Chrome；可用 CHROME_PATH 指定浏览器路径。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEBUG_PORT = 9436;
const SHOTS = path.join(ROOT, '.tmp-qa');
const KEEP = process.argv.includes('--keep-shots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function findChrome() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  const pw = path.join(homedir(), 'AppData', 'Local', 'ms-playwright');
  try {
    for (const d of readdirSync(pw)) {
      if (!d.startsWith('chromium')) continue;
      cands.push(path.join(pw, d, 'chrome-win', 'chrome.exe'));
      cands.push(path.join(pw, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
    }
  } catch { /* 没装 playwright 就跳过 */ }
  cands.push(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  );
  return cands.find((p) => p && existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let deployTick = 0; /* >0 时给 service-worker.js 追加一行注释，模拟重新部署 */

function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? '/index.html' : url;
    if (deployTick && rel === '/service-worker.js') {
      const body = (await readFile(path.join(ROOT, 'service-worker.js'), 'utf8')) + `\n/* deploy ${deployTick} */\n`;
      res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache' });
      res.end(body);
      return;
    }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        this.handlers.forEach((fn) => fn(msg));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('timeout ' + method));
        }
      }, 20000);
    });
  }

  on(fn) {
    this.handlers.push(fn);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result?.value;
  }
}

async function openTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('连不上 Chrome 调试端口');
}

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '}${name}${detail ? '  → ' + detail : ''}`);
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('找不到 Chrome。请设置环境变量 CHROME_PATH 指向 chrome 或 chrome-headless-shell。');
  process.exit(2);
}

/* 设 BASE_URL 可直接跑线上站点：BASE_URL=https://nyatskr.github.io/ict-basic-software/ */
const LIVE = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/?$/, '/') : '';
const server = LIVE ? null : await serve();
const base = LIVE || `http://127.0.0.1:${server.address().port}`;
if (LIVE) console.log('目标：' + base + '\n');

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const wsUrl = await openTarget();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
const cdp = new Cdp(ws);

const consoleErrors = [];
const exceptions = [];
const requests = [];

cdp.on((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
  }
  if (msg.method === 'Network.requestWillBeSent') {
    requests.push(msg.params.request.url);
  }
});

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');

async function waitFor(expr, ms = 8000, step = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cdp.eval(expr)) return true;
    await sleep(step);
  }
  return false;
}

async function ready() {
  return waitFor('!!(window.LP && window.LP.state && window.LP.state.bank)');
}

async function shot(name) {
  if (!KEEP) return;
  await mkdir(SHOTS, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(SHOTS, name), Buffer.from(data, 'base64'));
}

async function setOffline(on) {
  await cdp.send('Network.emulateNetworkConditions', {
    offline: on,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

async function reload() {
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(600);
  const ok = await ready();
  await sleep(200);
  return ok;
}

async function goHash(hash) {
  await cdp.eval(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(500);
}

try {
  /* ---------- 1. 在线首次加载并安装 ---------- */
  await cdp.send('Page.navigate', { url: base + '/' });
  await sleep(900);
  check('首页能启动', await ready());

  const installed = await waitFor(
    "navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))",
    15000
  );
  check('Service Worker 安装成功', installed);

  const controlled = await waitFor('!!navigator.serviceWorker.controller', 8000);
  check('页面已被 Service Worker 接管', controlled);

  const sw = await cdp.eval(`(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const mine = keys.filter(k => k.indexOf('ict-basic-software-') === 0);
    let n = 0;
    if (mine.length) n = (await (await caches.open(mine[0])).keys()).length;
    return { keys, n, active: !!reg.active };
  })()`);
  check('预缓存条目齐全（≥ 20）', sw.n >= 20, `${sw.n} 条 · ${sw.keys.join(', ')}`);

  const version = await cdp.eval(`(async () => {
    const c = navigator.serviceWorker.controller;
    if (!c) return '';
    return await new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => resolve((e.data || {}).version || '');
      c.postMessage({ type: 'STATUS' }, [ch.port2]);
      setTimeout(() => resolve(''), 1500);
    });
  })()`);
  check('能读到缓存版本号', !!version, version);

  await goHash('#/offline');
  const onlineCount = await cdp.eval("document.querySelectorAll('.fp-group:not(.fp-extra) .fp-row').length");
  check('飞行离线包列出 32 条正式视频', onlineCount === 32, `${onlineCount} 条`);
  check(
    '总时长显示 4 小时 59 分',
    (await cdp.eval("document.querySelector('.fp-hero').innerText")).includes('4 小时 59 分')
  );
  await shot('offline-online.png');

  /* ---------- 2. 断网 ---------- */
  await setOffline(true);
  check('已切到断网状态', (await cdp.eval('navigator.onLine')) === false);

  await goHash('#/');
  check('断网后能重新加载页面', await reload());
  check(
    '断网重载后概览渲染出内容',
    await cdp.eval("document.querySelectorAll('#app .dom-card').length === 3")
  );
  check('题库 103 道全部可用', (await cdp.eval('LP.state.questions.length')) === 103);
  check('实验 10 个全部可用', (await cdp.eval('Object.keys(LP.state.labById).length')) === 10);

  await goHash('#/section/oe-02-01');
  check(
    '断网能打开小节，目标与文字补充都在',
    (await cdp.eval("document.querySelector('#app').innerText")).includes('权限位')
  );

  await goHash('#/lab/oe-lab-perm-01');
  check('断网能打开模拟实验', await cdp.eval("!!document.querySelector('#lab-state')"));
  check(
    '断网实验状态面板有内容',
    (await cdp.eval("(document.querySelector('#lab-state')||{innerText:''}).innerText.length")) > 20
  );
  await shot('offline-lab.png');

  /* ---------- 3. 断网做题 / 标记，刷新后仍在 ---------- */
  const answered = await cdp.eval(`(() => {
    const q = LP.state.questions.find(q => q.section_id === 'oe-02-01') || LP.state.questions[0];
    LP.applyAnswer(q.id, [q.answer[0]], true);
    return { id: q.id, n: Object.keys(LP.state.progress.records).length };
  })()`);
  check('断网能答题并写入本机', answered.n >= 1, answered.id);

  await cdp.eval("LP.flight.toggle('v-file-hardlink', 'cached')");
  await cdp.eval("LP.flight.toggle('v-file-find', 'fav')");

  check('断网后再次重载', await reload());
  check(
    '刷新后作答记录还在',
    await cdp.eval(`!!(LP.getRecord(${JSON.stringify(answered.id)}) || {}).attempts`)
  );
  check(
    '刷新后视频缓存标记还在',
    await cdp.eval("!!LP.flight.read().cached['v-file-hardlink']")
  );
  check(
    '刷新后视频收藏标记还在',
    await cdp.eval("!!LP.flight.read().fav['v-file-find']")
  );
  check(
    '「下一条未缓存」跳过已缓存的那条',
    (await cdp.eval("(LP.flight.nextUncached() || {}).rid")) === 'v-file-find',
    await cdp.eval("(LP.flight.nextUncached() || {}).rid")
  );
  check(
    '统计口径与标记一致（32 条 / 1 已缓存）',
    (await cdp.eval("JSON.stringify(LP.flight.stats())")).includes('"cached":1')
  );

  /* ---------- 4. 离线时外部链接的提示 ---------- */
  await goHash('#/offline');
  check('断网仍能打开飞行离线包', (await cdp.eval("document.querySelectorAll('.fp-group:not(.fp-extra) .fp-row').length")) === 32);
  const ui = await cdp.eval(`(() => {
    document.querySelector('.fp-filter[data-filter="todo"]').click();
    const todoRows = document.querySelectorAll('.fp-group:not(.fp-extra) .fp-row').length;
    document.querySelector('.fp-filter[data-filter="all"]').click();
    document.querySelector('.fp-chip[data-key="watched"]').click();
    return { todoRows, watched: LP.flight.stats().watched, allRows: document.querySelectorAll('.fp-group:not(.fp-extra) .fp-row').length };
  })()`);
  check('筛选「未处理」只剩 30 条（1 已缓存 + 1 已收藏）', ui.todoRows === 30, `${ui.todoRows} 条`);
  check('点「看完」按钮即时生效并回到全部', ui.allRows === 32 && ui.watched === 1, `看完 ${ui.watched}`);

  check(
    '离线时状态条已出现',
    (await cdp.eval("!!document.querySelector('.netbar') && document.querySelector('.netbar').classList.contains('show')"))
  );

  const toastText = await cdp.eval(`(() => {
    const a = document.querySelector('a[href^="https://www.bilibili.com"]');
    if (!a) return 'NO_LINK';
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const t = document.getElementById('toast');
    return t ? t.textContent : '';
  })()`);
  check('离线点外部链接给出提示', toastText.includes('离线'), toastText);

  check(
    '离线时外部链接被标灰',
    await waitFor("!!document.querySelector('a.ext-link')", 2500)
  );
  await shot('offline-pack.png');

  /* ---------- 5. 恢复网络 ---------- */
  await setOffline(false);
  await sleep(600);
  check('恢复网络后状态条收起', !(await cdp.eval("!!document.querySelector('.netbar:not(.ok):not(.update)')")));
  check('恢复网络后仍可用', await ready());

  /* ---------- 6. 更新流程：新版本不抢班，点刷新才换 ---------- */
  if (LIVE) {
    console.log('skip 更新流程（线上无法模拟重新部署）');
  } else {
  deployTick = 1;
  await reload();
  const updateShown = await waitFor("!!document.querySelector('.netbar.update')", 12000, 300);
  check('检测到新版本并提示刷新（不自动换掉当前页面）', updateShown);

  if (updateShown) {
    const label = await cdp.eval("document.querySelector('.netbar.update .nettxt').innerText");
    check('提示文案说清楚要刷新', label.includes('新版本'), label.slice(0, 40));

    await cdp.eval("document.querySelector('.netbar.update .netbtn').click()");
    await sleep(1800);
    const reloaded = await waitFor('!!(window.LP && window.LP.state && window.LP.state.bank)', 10000, 300);
    check('点刷新后新版本接管并正常启动', reloaded);
    check(
      '刷新后缓存版本换成新构建',
      (await cdp.eval(`(async () => {
        const c = navigator.serviceWorker.controller;
        if (!c) return '';
        return await new Promise((resolve) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = (e) => resolve((e.data || {}).version || '');
          c.postMessage({ type: 'STATUS' }, [ch.port2]);
          setTimeout(() => resolve(''), 1500);
        });
      })()`)) !== ''
    );
    check(
      '刷新后本机进度没丢',
      await cdp.eval(`!!(LP.getRecord(${JSON.stringify(answered.id)}) || {}).attempts`)
    );
  }
  }

  check('控制台零错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('无未捕获异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

  const external = requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:'));
  check('没有偷偷请求外部域名', external.length === 0, external.slice(0, 3).join(', '));
} finally {
  try { ws.close(); } catch { /* 忽略 */ }
  chrome.kill();
  if (server) server.close();
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
