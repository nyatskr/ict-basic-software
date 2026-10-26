/* 实验引擎回归测试：用 CDP 驱动 headless Chrome 跑真命令，检查状态机结果。
 *
 *   node tools/test-lab.mjs            # 跑全部
 *   node tools/test-lab.mjs chmod      # 只跑 chmod 符号模式用例
 *
 * Chrome 探测顺序：环境变量 CHROME_PATH → Playwright 缓存 → 系统安装路径。
 * 之所以要在浏览器里跑，是因为 lab-engine.js 依赖 window.LP，不是纯 Node 模块。
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '#/lab/oe-lab-perm-01';
const PORT = 9411;

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

const CHROME = findChrome();
if (!CHROME) {
  console.error('找不到 Chrome。请设置环境变量 CHROME_PATH 指向 chrome 或 chrome-headless-shell。');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); }
    }, 20000);
  });
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}

/* 每条用例都从 initial_state 重新开始；初始 /srv/share 是 755 root:root */
const CHMOD_CASES = [
  ['chmod 3770 /srv/share', '3770'],
  ['chmod u=rwx,g=rwx,o= /srv/share', '770'],
  ['chmod g+s,o+t /srv/share', '3755'],
  ['chmod g+s /srv/share', '2755'],
  ['chmod o+t /srv/share', '1755'],
  ['chmod a+rwx /srv/share', '777'],
  ['chmod u-x,g-w /srv/share', '655'],
  ['chmod o-rwx /srv/share', '750'],
  ['chmod a=rwx /srv/share', '777'],
  ['chmod u+s /srv/share', '4755'],
  ['chmod u-s,g-s,o-t /srv/share', '755'],
  ['chmod g+s,o+t,o-rwx /srv/share', '3750'],
  ['chmod 7777 /srv/share', '7777'],
  ['chmod u+r,g+w,o+x /srv/share', '775'],
  ['chmod u=rwx,g=rwxs,o= /srv/share', '2770'],
  ['chmod 3x70 /srv/share', '755'], // 非法模式：报错且不改状态
  ['chmod g+t /srv/share', '1755'],
  ['chmod +x /srv/share', '755'],
];

/* 实验判分：命令写法不同，最终状态相同，分数必须一样 */
const LAB_CASES = [
  {
    name: 'oe-lab-perm-01 数字写法',
    lab: 'oe-lab-perm-01',
    cmds: [
      'groupadd dev', 'usermod -aG dev alice', 'usermod -aG dev bob',
      'chgrp dev /srv/share', 'chmod 3770 /srv/share',
      'sudo -u alice touch /srv/share/notes.md',
    ],
    want: 100,
  },
  {
    name: 'oe-lab-perm-01 符号写法（等价）',
    lab: 'oe-lab-perm-01',
    cmds: [
      'groupadd dev', 'usermod -aG dev alice', 'usermod -aG dev bob',
      'chgrp dev /srv/share', 'chmod u=rwx,g=rwx,o= /srv/share',
      'chmod g+s,o+t /srv/share', 'sudo -u alice touch /srv/share/notes.md',
    ],
    want: 100,
  },
  {
    name: 'og-lab-grant-01 三层授权',
    lab: 'og-lab-grant-01',
    cmds: [
      "CREATE ROLE app_ro LOGIN PASSWORD 'ChangeMe_2026';",
      'GRANT CONNECT ON DATABASE appdb TO app_ro;',
      'GRANT USAGE ON SCHEMA app TO app_ro;',
      'GRANT SELECT ON app.orders TO app_ro;',
    ],
    want: 100,
  },
  {
    name: 'og-lab-grant-01 多给 DELETE 扣分',
    lab: 'og-lab-grant-01',
    cmds: [
      "CREATE ROLE app_ro LOGIN PASSWORD 'ChangeMe_2026';",
      'GRANT CONNECT ON DATABASE appdb TO app_ro;',
      'GRANT USAGE ON SCHEMA app TO app_ro;',
      'GRANT SELECT, DELETE ON app.orders TO app_ro;',
    ],
    want: 80, // 15+20+20+25 都拿到，但多给 DELETE 扣掉那 20 分
  },
];

async function main() {
  const only = process.argv[2];
  await sleep(800);
  // Chrome 启动有快有慢，轮询等 devtools 端口就绪
  let list = null;
  for (let i = 0; i < 40; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.length) break;
    } catch { /* 端口还没起来 */ }
    await sleep(250);
  }
  if (!list || !list.length) throw new Error('devtools 端口未就绪（' + PORT + '），可能 Chrome 启动失败');
  ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: PAGE });
  await sleep(2200);

  let bad = 0;

  if (!only || only === 'chmod') {
    console.log('== chmod 符号模式');
    for (const [cmd, want] of CHMOD_CASES) {
      const got = await evalJs(`(() => {
        const E = LP.labEngine;
        E.reset();
        E.open('oe-lab-perm-01');
        const before = E.cur().st.files['/srv/share'].mode;
        const out = E.exec(${JSON.stringify(cmd)});
        const after = E.cur().st.files['/srv/share'].mode;
        return before + ' -> ' + after + (out.some((o) => o.cls === 'err') ? ' err' : '');
      })()`);
      const after = got.split(' -> ')[1].split(' ')[0];
      const ok = after === want;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${cmd.padEnd(34)} ${got}  期望 ${want}`);
    }
  }

  if (!only || only === 'lab') {
    console.log('\n== 实验判分');
    for (const c of LAB_CASES) {
      const got = await evalJs(`(() => {
        const E = LP.labEngine;
        E.reset();
        E.open(${JSON.stringify(c.lab)});
        for (const cmd of ${JSON.stringify(c.cmds)}) E.exec(cmd);
        const r = E.check();
        return r.score;
      })()`);
      const ok = got === c.want;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(30)} ${got} 分  期望 ${c.want}`);
    }
  }

  console.log(bad ? `\n${bad} 项不符合预期` : '\n全部通过');
  ws.close();
  proc.kill();
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.log('FAILED: ' + e.message);
  try { proc.kill(); } catch {}
  process.exit(1);
});
