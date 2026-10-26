/* 断 CDN 启动回归：屏蔽 cdn.jsdelivr.net 后，站点必须照常启动，云同步 SDK 仍可用。
 *
 *   node tools/test-boot-without-cdn.mjs
 *
 * 为什么要有这条测试：
 * 云同步是可选的，但 supabase-js 曾经以阻塞脚本从 CDN 引入，CDN 一慢整个应用就不启动。
 * SDK 现在自托管在 assets/vendor/，这条测试会拦住「有人又把它改回 CDN」的改动。
 *
 * 需要 Node 18+ 与本机 Chrome；可用 CHROME_PATH 指定浏览器路径。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CDN_HOST = 'cdn.jsdelivr.net';
const DEBUG_PORT = 9434;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
      cands.push(path.join(pw, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
      cands.push(path.join(pw, d, 'chrome-win', 'chrome.exe'));
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

/* ---------- 静态服务（file:// 下 localStorage 不可用，必须走 http） ---------- */

function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? '/index.html' : url;
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ---------- CDP ---------- */

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

/* ---------- 断言 ---------- */

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '}${name}${detail ? '  → ' + detail : ''}`);
}

/* ---------- 主流程 ---------- */

const CHROME = findChrome();
if (!CHROME) {
  console.error('找不到 Chrome。请设置环境变量 CHROME_PATH 指向 chrome 或 chrome-headless-shell。');
  process.exit(2);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;

const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

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
/* 关键：把 CDN 整个屏蔽掉，模拟断网/被墙 */
await cdp.send('Network.setBlockedURLs', { urls: [`*${CDN_HOST}*`] });

async function goto(hash) {
  await cdp.send('Page.navigate', { url: base + '/' + hash });
  await sleep(1200);
  /* 等应用初始化完成 */
  for (let i = 0; i < 40; i++) {
    const ready = await cdp.eval('!!(window.LP && window.LP.state && window.LP.state.bank)');
    if (ready) break;
    await sleep(250);
  }
}

try {
  await goto('#/');
  check(
    '首页渲染出内容',
    await cdp.eval("!!document.querySelector('#app') && document.querySelector('#app').children.length > 0"),
  );
  check('题库已加载', await cdp.eval('!!(window.ICT_BANK && window.LP.state.bank)'));
  check(
    '题目索引可用',
    await cdp.eval('Array.isArray(window.LP.state.questions) && window.LP.state.questions.length > 0'),
    (await cdp.eval('String((window.LP.state.questions || []).length)')) + ' 题',
  );
  check(
    '目录与实验数据已加载',
    await cdp.eval('!!(window.LP.state.catalog && window.LP.state.labById)'),
    (await cdp.eval('String(Object.keys(window.LP.state.labById || {}).length)')) + ' 个实验',
  );
  check(
    '新实验 oe-lab-part-01 在索引里',
    await cdp.eval("!!(window.LP.state.labById && window.LP.state.labById['oe-lab-part-01'])"),
  );

  await goto('#/data');
  check('数据页渲染出云同步卡片', await cdp.eval("!!document.querySelector('.cloud-card')"));
  check(
    '本地 SDK 已生效（createClient 存在）',
    await cdp.eval("typeof (window.supabase && window.supabase.createClient) === 'function'"),
  );
  check(
    '云状态是 signed-out 而不是 off',
    (await cdp.eval('window.LP.cloud ? window.LP.cloud.status().state : "no-cloud"')) === 'signed-out',
    await cdp.eval('window.LP.cloud ? window.LP.cloud.status().state : "no-cloud"'),
  );

  await goto('#/lab/oe-lab-part-01');
  check(
    '实验页渲染出状态面板',
    await cdp.eval("!!document.querySelector('#lab-state')"),
  );
  check(
    '状态面板渲染出内容',
    (await cdp.eval("(document.querySelector('#lab-state')||{}).innerText ? document.querySelector('#lab-state').innerText.length : 0")) > 20,
  );

  const cdnHits = requests.filter((u) => u.includes(CDN_HOST));
  check('没有向 CDN 发起任何请求', cdnHits.length === 0, cdnHits.join(', '));
  check('控制台零错误', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('无未捕获异常', exceptions.length === 0, exceptions.join(' | '));
} finally {
  try { ws.close(); } catch { /* 忽略 */ }
  chrome.kill();
  server.close();
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
