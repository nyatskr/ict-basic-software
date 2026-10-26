/* 实验引擎回归测试：用 CDP 驱动 headless Chrome 跑真命令，检查状态机结果。
 *
 *   node tools/test-lab.mjs            # 跑全部
 *   node tools/test-lab.mjs chmod      # 只跑 chmod 符号模式用例
 *   node tools/test-lab.mjs lab        # 只跑实验判分
 *   node tools/test-lab.mjs files      # 只跑文件、链接与归档用例
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

/* oe-lab-files-01：跑完命令后用 probe 读状态。
 * probe 是一段函数体（在浏览器里执行，能拿到 LP），返回值与 want 比对。
 * 这样测的是"状态对不对"，而不是"有没有敲过某条命令"。
 */
const FILE_LAB = 'oe-lab-files-01';
const FILE_CASES = [
  {
    name: '硬链接：同 inode、链接数 2',
    cmds: ['ln /srv/source/app.log /srv/keep/app.log'],
    probe: `
      const st = E.cur().st;
      const a = st.files['/srv/keep/app.log'];
      if (!a) return '未创建';
      const b = st.files['/srv/source/app.log'];
      const same = a.inode === b.inode ? 'same' : 'diff';
      const n = Object.keys(st.files).filter((p) => st.files[p].type !== 'link' && st.files[p].inode === a.inode).length;
      return same + '/' + n + '/' + a.inode;`,
    want: 'same/2/2001',
  },
  {
    name: '硬链接：目录被拒绝',
    cmds: [],
    probe: `
      const out = E.exec('ln /srv/source /srv/keep/src');
      const st = E.cur().st;
      return (st.files['/srv/keep/src'] ? 'created' : 'rejected') + '|'
        + (out.some((o) => o.cls === 'err' && /hard link not allowed/.test(o.text)) ? 'msg' : 'nomsg');`,
    want: 'rejected|msg',
  },
  {
    name: '软链接：绝对目标可读',
    cmds: ['ln -s /srv/source/old.log /srv/backup/current'],
    probe: `
      const st = E.cur().st;
      const f = st.files['/srv/backup/current'];
      if (!f) return '未创建';
      const out = E.exec('cat /srv/backup/current');
      return f.type + '|' + f.target + '|' + (out.some((o) => o.cls === 'err') ? 'dangling' : 'readable');`,
    want: 'link|/srv/source/old.log|readable',
  },
  {
    // 最容易错的一条：相对目标按"链接所在目录"解析，不是按当前目录
    name: '软链接：相对目标按链接目录解析',
    cmds: ['ln -s old.log /srv/backup/current'],
    probe: `
      const st = E.cur().st;
      const f = st.files['/srv/backup/current'];
      if (!f) return '未创建';
      const out = E.exec('cat /srv/backup/current');
      return f.target + '|' + (out.some((o) => o.cls === 'err') ? 'dangling' : 'readable');`,
    want: '/srv/backup/old.log|dangling',
  },
  {
    name: '删除原名后：硬链接可读、软链悬空',
    cmds: [
      'ln /srv/source/app.log /srv/keep/app.log',
      'ln -s /srv/source/old.log /srv/backup/current',
      'rm /srv/source/old.log',
    ],
    probe: `
      const st = E.cur().st;
      const hard = E.exec('cat /srv/keep/app.log');
      const soft = E.exec('cat /srv/backup/current');
      return [
        st.files['/srv/source/old.log'] ? 'old在' : 'old删',
        hard.some((o) => !o.cls && /disk quota exceeded/.test(o.text)) ? '硬链接可读' : '硬链接坏了',
        soft.some((o) => o.cls === 'err') ? '软链悬空' : '软链仍可读',
      ].join('|');`,
    want: 'old删|硬链接可读|软链悬空',
  },
  {
    name: 'find -type f -size +100M',
    cmds: [],
    probe: `
      return E.exec('find /srv/source -type f -size +100M')
        .filter((o) => !o.cls && o.text.trim()).map((o) => o.text).join(',');`,
    want: '/srv/source/app.log',
  },
  {
    name: 'find -name 通配符',
    cmds: [],
    probe: `
      return E.exec("find /srv/source -name '*.log'")
        .filter((o) => !o.cls && o.text.trim()).map((o) => o.text).join(',');`,
    want: '/srv/source/access.log,/srv/source/app.log,/srv/source/old.log',
  },
  {
    name: 'find -type d / -type f -size -10M',
    cmds: [],
    probe: `
      const d = E.exec('find /srv/source -type d').filter((o) => !o.cls && o.text.trim()).map((o) => o.text).join(',');
      const s = E.exec('find /srv/source -type f -size -10M').filter((o) => !o.cls && o.text.trim()).map((o) => o.text).join(',');
      return d + '|' + s;`,
    want: '/srv/source|/srv/source/old.log',
  },
  {
    name: 'tar -czf 创建：条目与格式',
    cmds: ['tar -czf /srv/backup/source.tar.gz /srv/source'],
    probe: `
      const a = E.cur().st.files['/srv/backup/source.tar.gz'];
      if (!a) return '未创建';
      return a.type + '|' + a.format + '|' + a.entries.join(',');`,
    want: 'archive|tar.gz|source/,source/access.log,source/app.log,source/old.log',
  },
  {
    name: 'tar -tzf 查看：4 条且含 old.log',
    cmds: ['tar -czf /srv/backup/source.tar.gz /srv/source'],
    probe: `
      const out = E.exec('tar -tzf /srv/backup/source.tar.gz').filter((o) => !o.cls && o.text.trim());
      return out.length + '|' + (out.some((o) => /old\\.log$/.test(o.text)) ? 'hasOld' : 'noOld');`,
    want: '4|hasOld',
  },
  {
    name: 'tar -xzf 解包到 -C 目录',
    cmds: [
      'tar -czf /srv/backup/source.tar.gz /srv/source',
      'mkdir -p /tmp/restore',
      'tar -xzf /srv/backup/source.tar.gz -C /tmp/restore',
    ],
    probe: `
      const st = E.cur().st;
      const has = (p) => (st.files[p] ? '有' : '无');
      const f = st.files['/tmp/restore/source/app.log'];
      return has('/tmp/restore/source/app.log') + has('/tmp/restore/source/old.log') + '|' + (f ? f.size_mb : 0);`,
    want: '有有|120',
  },
  {
    name: '错误路径与不存在的文件都报错',
    cmds: [],
    probe: `
      const bad = [
        'ln /srv/source/nope.log /srv/keep/x',
        'find /srv/nope',
        'tar -czf /srv/backup/x.tar.gz /srv/nope',
        'tar -tzf /srv/backup/none.tar.gz',
        'find /srv/source -bogus',
      ];
      return bad.map((c) => (E.exec(c).some((o) => o.cls === 'err') ? 'E' : 'ok')).join('');`,
    want: 'EEEEE',
  },
  {
    name: '目标已存在时不覆盖',
    cmds: ['ln /srv/source/app.log /srv/keep/app.log'],
    probe: `
      const out = E.exec('ln /srv/source/access.log /srv/keep/app.log');
      const st = E.cur().st;
      return (out.some((o) => o.cls === 'err') ? 'refused' : 'overwrote') + '|'
        + (st.files['/srv/keep/app.log'].inode === st.files['/srv/source/app.log'].inode ? 'keep' : 'changed');`,
    want: 'refused|keep',
  },
  {
    name: 'echo > 与 >> 重定向',
    cmds: [],
    probe: `
      const a = E.exec("echo first > /srv/keep/note.txt");
      const b = E.exec("echo second >> /srv/keep/note.txt");
      const f = E.cur().st.files['/srv/keep/note.txt'];
      const bad = a.concat(b).some((o) => o.cls === 'err');
      return (f ? f.content.trim().split('\\n').join('/') : '无') + '|' + (bad ? 'err' : 'ok');`,
    want: 'first/second|ok',
  },
  {
    name: '重置后回到初始状态',
    cmds: [
      'ln /srv/source/app.log /srv/keep/app.log',
      'ln -s /srv/source/old.log /srv/backup/current',
      'tar -czf /srv/backup/source.tar.gz /srv/source',
      'rm /srv/source/old.log',
    ],
    probe: `
      E.reset(); E.open('${FILE_LAB}');
      const st = E.cur().st;
      const keep = Object.keys(st.files).filter((p) => p.indexOf('/srv/keep/') === 0).length;
      const backup = Object.keys(st.files).filter((p) => p.indexOf('/srv/backup/') === 0).length;
      return keep + '|' + backup + '|' + (st.files['/srv/source/old.log'] ? 'old在' : 'old没了');`,
    want: '0|0|old在',
  },
  {
    name: '满分：标准六步',
    cmds: [
      'ln /srv/source/app.log /srv/keep/app.log',
      'ln -s /srv/source/old.log /srv/backup/current',
      'tar -czf /srv/backup/source.tar.gz /srv/source',
      'rm /srv/source/old.log',
    ],
    score: 100,
  },
  {
    name: '顺序错：先删再打包，扣归档分',
    cmds: [
      'ln /srv/source/app.log /srv/keep/app.log',
      'ln -s /srv/source/old.log /srv/backup/current',
      'rm /srv/source/old.log',
      'tar -czf /srv/backup/source.tar.gz /srv/source',
    ],
    score: 80, // v3「归档里有 old.log」拿不到那 20 分
  },
  {
    name: '软链接冒充硬链接，扣 25+15',
    cmds: [
      'ln -s /srv/source/app.log /srv/keep/app.log',
      'ln -s /srv/source/old.log /srv/backup/current',
      'tar -czf /srv/backup/source.tar.gz /srv/source',
      'rm /srv/source/old.log',
    ],
    score: 60, // v1 同 inode 失败、v5 硬链接内容失败
  },
  {
    name: '忘了删 old.log，扣 20',
    cmds: [
      'ln /srv/source/app.log /srv/keep/app.log',
      'ln -s /srv/source/old.log /srv/backup/current',
      'tar -czf /srv/backup/source.tar.gz /srv/source',
    ],
    score: 80,
  },
];

/* oe-lab-net-01：网络这块要同时看两套视图——连接里的配置、内核里的地址。
 * 所以用例既测命令输出，也测这两套状态是否被分别改到。
 */
const NET_LAB = 'oe-lab-net-01';
const MODIFY = 'nmcli connection modify eth0 ipv4.method manual ipv4.addresses 192.168.10.80/24 ipv4.gateway 192.168.10.1';
const NET_CASES = [
  {
    name: '初始：配置是 auto、内核是 .50',
    cmds: [],
    probe: `
      const st = E.cur().st;
      return st.network.connections.eth0.ipv4.method + '|'
        + (st.network.kernel.eth0 || []).join(',') + '|'
        + st.network.devices.eth0.state;`,
    want: 'auto|192.168.10.50/24|connected',
  },
  {
    name: 'modify 只改配置，不动内核',
    cmds: [MODIFY],
    probe: `
      const st = E.cur().st;
      const c = st.network.connections.eth0.ipv4;
      return c.method + '|' + c.addresses.join(',') + '|' + c.gateway + '|'
        + (st.network.kernel.eth0 || []).join(',');`,
    want: 'manual|192.168.10.80/24|192.168.10.1|192.168.10.50/24',
  },
  {
    name: 'up 之后内核按配置重建',
    cmds: [MODIFY, 'nmcli connection up eth0'],
    probe: `
      const st = E.cur().st;
      return (st.network.kernel.eth0 || []).join(',');`,
    want: '192.168.10.80/24',
  },
  {
    name: 'ip addr add 只改内核，不写配置',
    cmds: ['ip addr add 192.168.10.80/24 dev eth0'],
    probe: `
      const st = E.cur().st;
      return st.network.connections.eth0.ipv4.method + '|'
        + (st.network.kernel.eth0 || []).join(',');`,
    want: 'auto|192.168.10.50/24,192.168.10.80/24',
  },
  {
    name: 'down 会清空内核地址',
    cmds: [MODIFY, 'nmcli connection up eth0', 'nmcli connection down eth0'],
    probe: `
      const st = E.cur().st;
      return st.network.devices.eth0.state + '|'
        + ((st.network.kernel.eth0 || []).length || 0) + '|'
        + (st.network.connections.eth0.active ? 'active' : 'inactive');`,
    want: 'disconnected|0|inactive',
  },
  {
    name: 'ss 初始只有 sshd 的 22',
    cmds: [],
    probe: `
      const rows = E.exec('ss -lntp').filter((o) => !o.cls).map((o) => o.text);
      return rows.filter((r) => /LISTEN/.test(r)).map((r) => r.trim().split(/\\s+/)[3]).join(',');`,
    want: '0.0.0.0:22',
  },
  {
    name: 'nginx 起来后 ss 多一条 80',
    cmds: ['systemctl start nginx'],
    probe: `
      const rows = E.exec('ss -lntp').filter((o) => !o.cls).map((o) => o.text);
      const listen = rows.filter((r) => r.indexOf('LISTEN') >= 0);
      const has80 = listen.some((r) => r.indexOf(':80') >= 0 && r.indexOf('nginx') >= 0);
      return listen.length + '|' + (has80 ? 'nginx' : 'no');`,
    want: '2|nginx',
  },
  {
    name: '错误连接名与不存在的设备都报错',
    cmds: [],
    probe: `
      const bad = ['nmcli connection up nosuch', 'nmcli connection show nosuch', 'ip addr add 10.0.0.1/24 dev eth9'];
      return bad.map((c) => (E.exec(c).some((o) => o.cls === 'err') ? 'E' : 'ok')).join('');`,
    want: 'EEE',
  },
  {
    name: 'nmcli 不认识的子命令报错',
    cmds: [],
    probe: `
      return E.exec('nmcli connection dance eth0').some((o) => o.cls === 'err') ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: '满分：modify + up + 起 nginx',
    cmds: [MODIFY, 'nmcli connection up eth0', 'systemctl start nginx'],
    score: 100,
  },
  {
    name: '只用 ip addr add：配置没改，扣 70',
    cmds: ['ip addr add 192.168.10.80/24 dev eth0', 'systemctl start nginx'],
    score: 30, // 只拿到 v4 10 分 + v6 20 分
  },
  {
    name: '只 modify 不 up：配置改了，内核没变',
    cmds: [MODIFY],
    score: 60, // v1+v2+v3 拿到 60，v4/v5（内核）与 v6（nginx）都挂
  },
  {
    name: '配置和内核都对，忘了起 nginx，扣 20',
    cmds: [MODIFY, 'nmcli connection up eth0'],
    score: 80,
  },
];

/* oe-lab-pkg-01：装包要真的把文件落进文件系统，rpm -qf 才能查得到归属 */
const PKG_LAB = 'oe-lab-pkg-01';
const PKG_CASES = [
  {
    name: '初始装了 4 个包',
    cmds: [],
    probe: `return Object.keys(E.cur().st.packages.installed).sort().join(',');`,
    want: 'bash,coreutils,httpd-tools,systemd',
  },
  {
    name: 'repolist 只列启用的仓库',
    cmds: [],
    probe: `
      const rows = E.exec('dnf repolist').filter((o) => !o.cls).map((o) => o.text);
      return rows.slice(1).map((r) => r.trim().split(/\\s+/)[0]).join(',');`,
    want: 'openEuler-everything',
  },
  {
    name: '装 nginx 自动带上 nginx-core',
    cmds: ['dnf install -y nginx'],
    probe: `
      const st = E.cur().st;
      return Object.keys(st.packages.installed).filter((n) => n.indexOf('nginx') === 0).sort().join(',');`,
    want: 'nginx,nginx-core',
  },
  {
    name: '装包后文件真的落盘',
    cmds: ['dnf install -y nginx'],
    probe: `
      const st = E.cur().st;
      const f = st.files['/etc/nginx/nginx.conf'];
      return (f ? f.pkg + '/' + f.mode : '缺失') + '|'
        + (st.files['/usr/sbin/nginx'] ? st.files['/usr/sbin/nginx'].mode : '缺失');`,
    want: 'nginx-core/644|755',
  },
  {
    name: 'rpm -qf 反查文件归属',
    cmds: ['dnf install -y nginx'],
    probe: `
      const rows = E.exec('rpm -qf /etc/nginx/nginx.conf').filter((o) => !o.cls).map((o) => o.text);
      return rows[rows.length - 1];`,
    want: 'nginx-core-1.24.0-1.aarch64',
  },
  {
    name: 'rpm -qf 查没有归属的文件报错',
    cmds: [],
    probe: `
      const out = E.exec('rpm -qf /etc/fstab');
      return out.some((o) => o.cls === 'err' && /not owned by any package/.test(o.text)) ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: 'rpm -ql 列出包内文件',
    cmds: ['dnf install -y nginx'],
    probe: `
      const rows = E.exec('rpm -ql nginx-core').filter((o) => !o.cls).map((o) => o.text);
      return rows.length + '|' + (rows.indexOf('/etc/nginx/nginx.conf') >= 0 ? 'hasConf' : 'noConf');`,
    want: '3|hasConf',
  },
  {
    name: '删包时文件一起删掉',
    cmds: ['dnf remove httpd-tools'],
    probe: `
      const st = E.cur().st;
      return (st.packages.installed['httpd-tools'] ? '包还在' : '包没了') + '|'
        + (st.files['/usr/bin/ab'] ? '文件还在' : '文件没了') + '|'
        + (st.files['/usr/bin/bash'] ? 'bash 在' : 'bash 没了');`,
    want: '包没了|文件没了|bash 在',
  },
  {
    name: '装不存在的包报错',
    cmds: [],
    probe: `return E.exec('dnf install -y nosuchpkg').some((o) => o.cls === 'err') ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: '重复安装不改变状态',
    cmds: ['dnf install -y nginx', 'dnf install -y nginx'],
    probe: `
      const st = E.cur().st;
      const h = st.packages.history || [];
      return h.length + '|' + (E.exec('dnf install -y nginx').some((o) => /already installed/.test(o.text)) ? 'said' : 'silent');`,
    want: '1|said',
  },
  {
    name: 'dnf history 记下事务',
    cmds: ['dnf install -y nginx', 'dnf remove httpd-tools'],
    probe: `
      const rows = E.exec('dnf history').filter((o) => !o.cls).map((o) => o.text.trim());
      return rows.filter((r) => /^[0-9]+\\s*\\|/.test(r)).length + '|' + (rows.join(' ').indexOf('remove httpd-tools') >= 0 ? 'hasRemove' : 'noRemove');`,
    want: '2|hasRemove',
  },
  {
    name: '满分：装 nginx + 删 httpd-tools',
    cmds: ['dnf install -y nginx', 'dnf remove httpd-tools'],
    score: 100,
  },
  {
    name: '忘了删 httpd-tools，扣 20',
    cmds: ['dnf install -y nginx'],
    score: 80,
  },
  {
    name: '装错包：装成 vim-enhanced，扣 65',
    cmds: ['dnf install -y vim-enhanced', 'dnf remove httpd-tools'],
    score: 35, // v3 20 + v4 15
  },
  {
    name: '顺手把 bash 删了，扣 15',
    cmds: ['dnf install -y nginx', 'dnf remove httpd-tools', 'dnf remove bash'],
    score: 85,
  },
];

/* oe-lab-cron-01：crontab 是整份覆盖，/etc/cron.d 的行比用户 crontab 多一个用户字段 */
const CRON_LAB = 'oe-lab-cron-01';
const CRON_JOB = "echo '*/5 * * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1' > /root/c.txt";
const CRON_HEALTH = "echo '*/30 * * * * /usr/local/bin/health.sh' >> /root/c.txt";
const CRON_INSTALL = 'crontab /root/c.txt';
const CRON_FIX_D = "echo '*/10 * * * * root /opt/app/clean.sh' > /etc/cron.d/app";
const CRON_ON = 'systemctl enable --now crond.service';
const CRON_CASES = [
  {
    name: '初始 crontab 有 2 条任务',
    cmds: [],
    probe: `return E.cur().st.cron.spool.root.filter((l) => l && l.indexOf('=') < 0).length;`,
    want: 2,
  },
  {
    name: '初始 crond 没在跑',
    cmds: [],
    probe: `return E.exec('systemctl is-active crond').filter((o) => !o.cls).map((o) => o.text).join('');`,
    want: 'inactive',
  },
  {
    name: 'enable --now 同时 active + enabled',
    cmds: [CRON_ON],
    probe: `
      const s = E.cur().st.services['crond.service'];
      return (s.active ? 'active' : 'inactive') + '/' + (s.enabled ? 'enabled' : 'disabled');`,
    want: 'active/enabled',
  },
  {
    name: '/var/log/cron 里有 ORPHAN 线索',
    cmds: [],
    probe: `return E.exec('cat /var/log/cron').some((o) => o.text.indexOf('ORPHAN') >= 0) ? 'yes' : 'no';`,
    want: 'yes',
  },
  {
    name: 'cron.d 的五字段行解析不出用户',
    cmds: [],
    probe: `return E.check().items.filter((i) => i.id === 'v6')[0].pass ? 'pass' : 'fail';`,
    want: 'fail',
  },
  {
    name: 'crontab <文件> 是整份覆盖',
    cmds: [CRON_JOB, CRON_INSTALL],
    probe: `return E.cur().st.cron.spool.root.length;`,
    want: 1,
  },
  {
    name: '五字段的行装不进 crontab',
    cmds: ["echo '*/5 * * * *' > /root/bad.txt"],
    probe: `
      const out = E.exec('crontab /root/bad.txt');
      const bad = out.some((o) => o.cls === 'err' && o.text.indexOf("can't install") >= 0);
      return (bad ? 'rejected' : 'accepted') + '/' + E.cur().st.cron.spool.root.length;`,
    want: 'rejected/4',
  },
  {
    name: 'crontab -r 清空后再 -l 报 no crontab',
    cmds: ['crontab -r'],
    probe: `return E.exec('crontab -l').some((o) => o.text.indexOf('no crontab') >= 0) ? 'empty' : 'has';`,
    want: 'empty',
  },
  {
    name: 'crontab -e 明确拒绝',
    cmds: [],
    probe: `return E.exec('crontab -e').some((o) => o.cls === 'err' && o.text.indexOf('不支持交互编辑器') >= 0) ? 'rejected' : 'opened';`,
    want: 'rejected',
  },
  {
    name: '满分：起 crond + 覆盖 crontab + 修 cron.d',
    cmds: [CRON_ON, CRON_JOB, CRON_HEALTH, CRON_INSTALL, CRON_FIX_D],
    score: 100,
  },
  {
    name: '忘了起 crond，扣 30',
    cmds: [CRON_JOB, CRON_HEALTH, CRON_INSTALL, CRON_FIX_D],
    score: 70,
  },
  {
    name: '覆盖时把 health.sh 冲掉，扣 10',
    cmds: [CRON_ON, CRON_JOB, CRON_INSTALL, CRON_FIX_D],
    score: 90,
  },
  {
    name: 'cron.d 没修，扣 20',
    cmds: [CRON_ON, CRON_JOB, CRON_HEALTH, CRON_INSTALL],
    score: 80,
  },
  {
    name: '忘了删 purge.sh，扣 15',
    cmds: [CRON_ON, CRON_JOB, CRON_HEALTH, "echo '0 3 * * * /opt/old/purge.sh' >> /root/c.txt", CRON_INSTALL, CRON_FIX_D],
    score: 85,
  },
];

/* oe-lab-part-01：裸分区。教学点是「先分区再格式化、fstab 用 UUID 而不是设备名」。
 * 整盘 mkfs 与直接挂整盘都被引擎拒绝；fstab 的 UUID 必须能被 mount -a 解析。
 */
const PART_LAB = 'oe-lab-part-01';
const PART_CASES = [
  {
    name: '初始：vdb 无分区表、无分区',
    cmds: [],
    probe: `
      const st = E.cur().st;
      return (st.disks['/dev/vdb'].label || 'none') + '|'
        + Object.keys(st.parts || {}).length;`,
    want: 'none|0',
  },
  {
    name: 'mklabel 后 parted print 显示 gpt',
    cmds: ['parted /dev/vdb mklabel gpt'],
    probe: `
      const out = E.exec('parted /dev/vdb print').filter((o) => !o.cls).map((o) => o.text);
      return (E.cur().st.disks['/dev/vdb'].label || '') + '|'
        + (out.some((l) => l.indexOf('gpt') >= 0) ? 'shown' : 'missing');`,
    want: 'gpt|shown',
  },
  {
    name: '没 mklabel 直接 mkpart 报 unrecognised disk label',
    cmds: [],
    probe: `
      const out = E.exec('parted /dev/vdb mkpart primary 1MiB 9GiB');
      return out.some((o) => o.cls === 'err' && o.text.indexOf('unrecognised disk label') >= 0) ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: 'mkpart 1MiB 9GiB 划出 8G+ 分区',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB'],
    probe: `
      const p = E.cur().st.parts['/dev/vdb1'];
      return (p ? p.size_mb + '/' + p.disk : '无');`,
    want: '9215//dev/vdb',
  },
  {
    name: 'GPT 常见写法 mkpart primary ext4 1MiB 100%',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary ext4 1MiB 100%'],
    probe: `
      const p = E.cur().st.parts['/dev/vdb1'];
      return (p ? p.size_mb : '无');`,
    want: 20479,
  },
  {
    name: '重叠分区被拒绝',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB'],
    probe: `
      const out = E.exec('parted /dev/vdb mkpart primary 8GiB 10GiB');
      return out.some((o) => o.cls === 'err' && o.text.indexOf('overlap') >= 0) ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: '有分区后 mklabel 重建被拒绝',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB'],
    probe: `
      const out = E.exec('parted /dev/vdb mklabel msdos');
      return out.some((o) => o.cls === 'err') ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: '整盘带分区表时 mkfs 被拒',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB'],
    probe: `
      const out = E.exec('mkfs.ext4 /dev/vdb');
      return out.some((o) => o.cls === 'err' && o.text.indexOf('partition table') >= 0) ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: 'mkfs 分区后 blkid 能取 UUID',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1'],
    probe: `
      const rows = E.exec('blkid /dev/vdb1').filter((o) => !o.cls).map((o) => o.text);
      const p = E.cur().st.parts['/dev/vdb1'];
      return (p ? p.fs : '无') + '|' + (rows.some((r) => r.indexOf('UUID="') >= 0 && r.indexOf('TYPE="ext4"') >= 0) ? 'uuid' : 'no');`,
    want: 'ext4|uuid',
  },
  {
    name: '直接 mount 整盘被拒',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1', 'mkdir -p /data'],
    probe: `
      const out = E.exec('mount /dev/vdb /data');
      return out.some((o) => o.cls === 'err') ? 'E' : 'ok';`,
    want: 'E',
  },
  {
    name: 'mount 分区成功，dev 是 /dev/vdb1',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1', 'mkdir -p /data', 'mount /dev/vdb1 /data'],
    probe: `
      const m = E.cur().st.mounts['/data'];
      return (m ? m.dev + '/' + m.type : '未挂载');`,
    want: '/dev/vdb1/ext4',
  },
  {
    name: 'mount -a 按 fstab 的 UUID 挂载',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1', 'mkdir -p /data'],
    probe: `
      const st = E.cur().st;
      const uuid = st.parts['/dev/vdb1'].uuid;
      E.exec('echo "UUID=' + uuid + ' /data ext4 defaults 0 0" >> /etc/fstab');
      const out = E.exec('mount -a');
      const m = st.mounts['/data'];
      return (m ? m.dev + '/' + m.type : '未挂载') + '|'
        + (out.some((o) => /新增 1/.test(o.text)) ? 'added' : 'no');`,
    want: '/dev/vdb1/ext4|added',
  },
  {
    name: '满分：建表→分区→mkfs→挂载→UUID 写 fstab→mount -a',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1', 'mkdir -p /data'],
    probe: `
      const st = E.cur().st;
      const uuid = st.parts['/dev/vdb1'].uuid;
      E.exec('mount /dev/vdb1 /data');
      E.exec('echo "UUID=' + uuid + ' /data ext4 defaults 0 0" >> /etc/fstab');
      E.exec('mount -a');
      return E.check().score;`,
    want: 100,
  },
  {
    name: '分区 + mkfs 但不挂载，扣 50',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1'],
    score: 50, // 只拿到 v1+v2+v3+v4
  },
  {
    name: '挂载了但 fstab 用设备名（没有 UUID），扣 20',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1', 'mkdir -p /data', 'mount /dev/vdb1 /data'],
    score: 80, // v6 fstab UUID 拿不到
  },
  {
    name: '写了 UUID fstab 但没挂载，扣 30',
    cmds: ['parted /dev/vdb mklabel gpt', 'parted /dev/vdb mkpart primary 1MiB 9GiB', 'mkfs.ext4 /dev/vdb1', 'mkdir -p /data'],
    probe: `
      const st = E.cur().st;
      const uuid = st.parts['/dev/vdb1'].uuid;
      E.exec('echo "UUID=' + uuid + ' /data ext4 defaults 0 0" >> /etc/fstab');
      return E.check().score;`,
    want: 70, // v5 + v7 拿不到
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

  if (!only || only === 'files') {
    console.log('\n== 文件、链接与归档（' + FILE_LAB + '）');
    for (const c of FILE_CASES) {
      const got = await evalJs(`(() => {
        const E = LP.labEngine;
        E.reset();
        E.open(${JSON.stringify(FILE_LAB)});
        for (const cmd of ${JSON.stringify(c.cmds)}) E.exec(cmd);
        ${c.score !== undefined ? 'return E.check().score;' : c.probe}
      })()`);
      const want = c.score !== undefined ? c.score : c.want;
      const ok = got === want;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(26)} ${String(got)}  期望 ${String(want)}`);
    }
  }

  if (!only || only === 'net') {
    console.log('\n== 网络（' + NET_LAB + '）');
    for (const c of NET_CASES) {
      const got = await evalJs(`(() => {
        const E = LP.labEngine;
        E.reset();
        E.open(${JSON.stringify(NET_LAB)});
        for (const cmd of ${JSON.stringify(c.cmds)}) E.exec(cmd);
        ${c.score !== undefined ? 'return E.check().score;' : c.probe}
      })()`);
      const want = c.score !== undefined ? c.score : c.want;
      const ok = got === want;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(30)} ${String(got)}  期望 ${String(want)}`);
    }
  }

  if (!only || only === 'pkg') {
    console.log('\n== 软件包（' + PKG_LAB + '）');
    for (const c of PKG_CASES) {
      const got = await evalJs(`(() => {
        const E = LP.labEngine;
        E.reset();
        E.open(${JSON.stringify(PKG_LAB)});
        for (const cmd of ${JSON.stringify(c.cmds)}) E.exec(cmd);
        ${c.score !== undefined ? 'return E.check().score;' : c.probe}
      })()`);
      const want = c.score !== undefined ? c.score : c.want;
      const ok = got === want;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(30)} ${String(got)}  期望 ${String(want)}`);
    }
  }

  if (!only || only === 'cron') {
    console.log('\n== 计划任务（' + CRON_LAB + '）');
    for (const c of CRON_CASES) {
      const got = await evalJs(`(() => {
        const E = LP.labEngine;
        E.reset();
        E.open(${JSON.stringify(CRON_LAB)});
        for (const cmd of ${JSON.stringify(c.cmds)}) E.exec(cmd);
        ${c.score !== undefined ? 'return E.check().score;' : c.probe}
      })()`);
      const want = c.score !== undefined ? c.score : c.want;
      const ok = got === want;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(30)} ${String(got)}  期望 ${String(want)}`);
    }
  }

  if (!only || only === 'part') {
    console.log('\n== 裸分区（' + PART_LAB + '）');
    for (const c of PART_CASES) {
      const got = await evalJs(`(() => {
        const E = LP.labEngine;
        E.reset();
        E.open(${JSON.stringify(PART_LAB)});
        for (const cmd of ${JSON.stringify(c.cmds)}) E.exec(cmd);
        ${c.score !== undefined ? 'return E.check().score;' : c.probe}
      })()`);
      const want = c.score !== undefined ? c.score : c.want;
      const ok = got === want;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(30)} ${String(got)}  期望 ${String(want)}`);
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
