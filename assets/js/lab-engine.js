/* lab-engine.js — 模拟实操状态机
 *
 * 三类实验：
 *   linux  虚拟主机：用户/组/权限/服务/防火墙/LVM/挂载
 *   sql    openGauss 子集：角色、schema、表、授权、SET ROLE
 *   audit  只读证据 + 归类判定，不需要终端
 *
 * 判分只看最终状态，不看输入的命令字符串 —— 用不同命令达到同样状态都应得分。
 */
(function () {
  'use strict';

  const LP = window.LP;
  const E = (LP.labEngine = {});

  let cur = null; // { lab, st, log, history, hintsUsed, audit }

  /* ---------------- 通用工具 ---------------- */

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ok = (text) => ({ cls: '', text });
  const err = (text) => ({ cls: 'err', text });
  const dim = (text) => ({ cls: 'dim', text });

  function getPath(obj, path) {
    let v = obj;
    for (const k of path) {
      if (v == null) return undefined;
      v = v[k];
    }
    return v;
  }

  /* 简单词法：支持单/双引号，保留 >> 之类的重定向符号为独立 token */
  function tokenize(line) {
    const out = [];
    let buf = '';
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === q) q = null;
        else buf += ch;
      } else if (ch === '"' || ch === "'") {
        q = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (buf) { out.push(buf); buf = ''; }
      } else if (ch === '>' ) {
        if (buf) { out.push(buf); buf = ''; }
        if (line[i + 1] === '>') { out.push('>>'); i++; }
        else out.push('>');
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  }

  /* ---------------- 权限模型 ---------------- */

  function modeDigits(mode) {
    const s = String(mode || '644');
    const three = s.length > 3 ? s.slice(-3) : s.padStart(3, '0');
    return three;
  }

  function modeSpecial(mode) {
    const s = String(mode || '644');
    return s.length > 3 ? parseInt(s.slice(0, s.length - 3), 10) || 0 : 0;
  }

  function bits(mode, idx) {
    const d = modeDigits(mode);
    const n = parseInt(d[idx], 10) || 0;
    return (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-');
  }

  function groupList(st, uname) {
    const u = st.users[uname];
    return u && u.groups ? u.groups.slice() : [];
  }

  /* 有效权限：root 全通过；owner → 属主位；属组 → 属组位（受 ACL mask 约束）；其他 */
  function effPerm(st, f, uname) {
    if (!f) return '---';
    if (uname === 'root') return 'rwx';
    const u = st.users[uname];
    if (!u) return '---';
    if (f.owner === uname) return bits(f.mode, 0);
    const acl = f.acl || {};
    if (acl.users && acl.users[uname]) return applyMask(acl.users[uname], acl.mask);
    const gs = groupList(st, uname);
    if (gs.indexOf(f.group) >= 0) return applyMask(bits(f.mode, 1), acl.mask);
    if (acl.groups) {
      for (const g of gs) if (acl.groups[g]) return applyMask(acl.groups[g], acl.mask);
    }
    return bits(f.mode, 2);
  }

  function applyMask(perm, mask) {
    if (!mask) return perm;
    let out = '';
    for (let i = 0; i < 3; i++) out += mask[i] === '-' ? '-' : perm[i];
    return out;
  }

  function can(st, f, uname, need) {
    if (!f) return false;
    const p = effPerm(st, f, uname);
    for (const c of need) if (p.indexOf(c) < 0) return false;
    return true;
  }

  function normalize(p, cwd) {
    const raw = String(p || '').trim();
    let full = raw.startsWith('/') ? raw : (cwd === '/' ? '' : cwd) + '/' + raw;
    const parts = [];
    full.split('/').forEach((seg) => {
      if (!seg || seg === '.') return;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    });
    return '/' + parts.join('/');
  }

  function parentOf(p) {
    if (p === '/') return '/';
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  }

  function baseOf(p) {
    if (p === '/') return '/';
    return p.slice(p.lastIndexOf('/') + 1);
  }

  /* 目录穿越检查：每一级都要有 x */
  function canTraverse(st, path, uname) {
    if (uname === 'root') return true;
    const segs = path.split('/').filter(Boolean);
    let acc = '';
    for (const s of segs) {
      acc += '/' + s;
      const f = st.files[acc];
      if (!f) return false;
      if (f.type === 'dir' && !can(st, f, uname, 'x')) return false;
    }
    return true;
  }

  function fmtMode(st, f) {
    const t = f.type === 'dir' ? 'd' : f.type === 'link' ? 'l' : '-';
    let s = bits(f.mode, 0) + bits(f.mode, 1) + bits(f.mode, 2);
    const sp = modeSpecial(f.mode);
    const arr = s.split('');
    if (sp & 4) arr[2] = arr[2] === 'x' ? 's' : 'S';
    if (sp & 2) arr[5] = arr[5] === 'x' ? 's' : 'S';
    if (sp & 1) arr[8] = arr[8] === 'x' ? 't' : 'T';
    return t + arr.join('') + (f.acl && (Object.keys(f.acl.users || {}).length || Object.keys(f.acl.groups || {}).length) ? '+' : '');
  }

  /* ---------------- linux 模块 ---------------- */

  function mkdirs(st, path) {
    const segs = path.split('/').filter(Boolean);
    let acc = '';
    segs.forEach((s) => {
      acc += '/' + s;
      if (!st.files[acc]) {
        st.files[acc] = { type: 'dir', owner: 'root', group: 'root', mode: '755' };
      }
    });
  }

  function touchFile(st, path, owner) {
    const dir = parentOf(path);
    mkdirs(st, dir);
    if (!st.files[path]) {
      const d = st.files[dir] || {};
      const um = parseInt(st.umask || '022', 8);
      const base = 666 & ~um;
      st.files[path] = {
        type: 'file',
        owner: owner || st.user,
        group: modeSpecial(d.mode) & 2 ? d.group : (st.users[owner || st.user] || { groups: ['root'] }).groups[0],
        mode: String(base).padStart(3, '0'),
        content: '',
      };
    }
  }

  function syncFstab(st) {
    const f = st.files['/etc/fstab'];
    if (!f) { st.fstab = []; return; }
    st.fstab = String(f.content || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const c = l.split(/\s+/);
        return { spec: c[0], mount: c[1], type: c[2] || 'auto', options: c[3] || 'defaults', dump: c[4] || '0', pass: c[5] || '0' };
      });
  }

  const SYSCTL_UNITS = () => Object.keys(cur.st.services);

  function svcName(name) {
    if (!name) return '';
    return cur.st.services[name] ? name : cur.st.services[name + '.service'] ? name + '.service' : name;
  }

  function lvDev(name) {
    const n = String(name || '').replace(/^\/dev\//, '').replace(/^mapper\//, '');
    if (cur.st.lvs[n]) return n;
    const alt = n.replace('/', '-');
    if (cur.st.lvs[alt]) return alt;
    return n;
  }

  function sizeToMb(v) {
    const m = String(v || '').match(/^\+?(\d+)([MGmg])?$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return (m[2] || 'M').toUpperCase() === 'G' ? n * 1024 : n;
  }

  function fmtSize(mb) {
    if (mb % 1024 === 0) return mb / 1024 + 'G';
    return mb + 'M';
  }

  const linux = {
    prompt() {
      const st = cur.st;
      const u = st.user;
      const host = st.host;
      const cwd = u === 'root' ? st.cwd : st.cwd.replace(/^\/root/, '~');
      return `[${u}@${host} ${cwd}]${u === 'root' ? '#' : '$'}`;
    },

    run(argv, raw) {
      const st = cur.st;
      const cmd = argv[0];
      const args = argv.slice(1);
      const out = [];

      const needRoot = () => {
        if (st.user !== 'root') {
          out.push(err('bash: ' + cmd + ': 权限不够（当前身份 ' + st.user + '，请用 sudo 或切回 root）'));
          return false;
        }
        return true;
      };

      switch (cmd) {
        case 'help':
          out.push(ok('可用命令（模拟环境，不是真 bash）：'));
          out.push(dim('  身份    id / whoami / groups / su / sudo -u'));
          out.push(dim('  文件    ls [-l] / stat / cat / touch / mkdir -p / rm [-rf] / echo … > 文件'));
          out.push(dim('  权限    chmod / chown / chgrp / umask / getfacl / setfacl'));
          out.push(dim('  账户    groupadd / useradd / usermod -aG / userdel / passwd'));
          out.push(dim('  服务    systemctl start|stop|enable|disable|status|is-active|is-enabled'));
          out.push(dim('  防火墙  firewall-cmd [--permanent] --add-port / --remove-port / --list-all / --query-port / --reload'));
          out.push(dim('  存储    lsblk / pvcreate / vgcreate / lvcreate / lvextend / mkfs.xfs / mount / findmnt / df / blkid'));
          out.push(dim('  网络    ss -lntp'));
          return out;

        case 'pwd':
          out.push(ok(st.cwd));
          return out;

        case 'whoami':
          out.push(ok(st.user));
          return out;

        case 'id': {
          const name = args[0] || st.user;
          const u = st.users[name];
          if (!u) return [err('id: ' + name + ': no such user')];
          out.push(ok(`uid=${u.uid}(${name}) gid=${st.groups[u.groups[0]] ? st.groups[u.groups[0]].gid : 1000}(${u.groups[0]}) groups=${u.groups.map((g) => (st.groups[g] ? st.groups[g].gid : '?') + '(' + g + ')').join(',')}`));
          return out;
        }

        case 'groups': {
          const name = args[0] || st.user;
          const u = st.users[name];
          if (!u) return [err('groups: ' + name + ': no such user')];
          out.push(ok(name + ' : ' + u.groups.join(' ')));
          return out;
        }

        case 'su': {
          const name = args.filter((a) => a !== '-')[0];
          if (!name) return [err('su: 缺少用户名')];
          if (!st.users[name]) return [err('su: user ' + name + ' does not exist')];
          if (st.user !== 'root' && name !== st.user) return [err('su: 需要密码（模拟环境只支持 root 免密切换）')];
          st.user = name;
          st.cwd = st.users[name].home;
          out.push(dim('（已切换身份为 ' + name + '，用 exit 回到 root）'));
          return out;
        }

        case 'exit':
          if (st.user !== 'root') {
            st.user = 'root';
            st.cwd = '/root';
            out.push(dim('（已回到 root）'));
          } else out.push(ok('logout'));
          return out;

        case 'sudo': {
          const i = args.indexOf('-u');
          if (i < 0 || !args[i + 1]) return [err('sudo: 本模拟环境只支持 sudo -u <user> <命令>')];
          const target = args[i + 1];
          if (!st.users[target]) return [err('sudo: unknown user: ' + target)];
          if (st.user !== 'root') return [err('sudo: ' + st.user + ' is not in the sudoers file')];
          const rest = args.slice(i + 2);
          if (!rest.length) return [err('sudo: 缺少要执行的命令')];
          const prev = st.user;
          st.user = target;
          const r = linux.run(rest, rest.join(' '));
          st.user = prev;
          return r;
        }

        case 'ls': {
          const flags = args.filter((a) => a.startsWith('-')).join('');
          const target = args.filter((a) => !a.startsWith('-'))[0];
          const path = normalize(target || st.cwd, st.cwd);
          const f = st.files[path];
          if (!f) return [err('ls: cannot access \'' + (target || path) + '\': No such file or directory')];
          if (!canTraverse(st, parentOf(path) === path ? path : parentOf(path), st.user)) {
            return [err('ls: cannot open directory \'' + (target || path) + '\': Permission denied')];
          }
          if (f.type !== 'dir') {
            out.push(ok(flags.indexOf('l') >= 0 ? [fmtMode(st, f), '1', f.owner, f.group, '0', '10月 26 11:00', baseOf(path)].join(' ') : baseOf(path)));
            return out;
          }
          if (!can(st, f, st.user, 'r')) return [err('ls: cannot open directory \'' + (target || path) + '\': Permission denied')];
          const names = Object.keys(st.files)
            .filter((p) => parentOf(p) === path && p !== path)
            .sort();
          if (!names.length) return [ok('')];
          if (flags.indexOf('l') >= 0) {
            names.forEach((p) => {
              const c = st.files[p];
              out.push(ok([fmtMode(st, c), String(c.type === 'dir' ? 2 : 1), c.owner.padEnd(6), c.group.padEnd(6), c.type === 'dir' ? '4096' : '1024', '10月 26 11:00', baseOf(p)].join(' ')));
            });
          } else {
            out.push(ok(names.map(baseOf).join('  ')));
          }
          return out;
        }

        case 'stat': {
          const path = normalize(args[0], st.cwd);
          const f = st.files[path];
          if (!f) return [err('stat: cannot statx \'' + args[0] + '\': No such file or directory')];
          out.push(ok('  File: ' + path));
          out.push(ok('  Size: ' + String((f.content || '').length) + '        Blocks: 8          IO Block: 4096   ' + (f.type === 'dir' ? 'directory' : 'regular file')));
          out.push(ok('Access: (' + String(modeDigits(f.mode)) + '/' + fmtMode(st, f) + ')  Uid: (' + (st.users[f.owner] ? st.users[f.owner].uid : '?') + '/' + f.owner + ')   Gid: (' + (st.groups[f.group] ? st.groups[f.group].gid : '?') + '/' + f.group + ')'));
          return out;
        }

        case 'cat': {
          const path = normalize(args[0], st.cwd);
          const f = st.files[path];
          if (!f) return [err('cat: ' + args[0] + ': No such file or directory')];
          if (!canTraverse(st, parentOf(path), st.user)) return [err('cat: ' + args[0] + ': Permission denied')];
          if (!can(st, f, st.user, 'r')) return [err('cat: ' + args[0] + ': Permission denied')];
          out.push(ok(String(f.content || '').replace(/\n$/, '')));
          return out;
        }

        case 'getfacl': {
          const path = normalize(args[0], st.cwd);
          const f = st.files[path];
          if (!f) return [err('getfacl: ' + args[0] + ': No such file or directory')];
          const acl = f.acl || {};
          const p = effPerm(st, f, f.owner);
          out.push(ok('# file: ' + path));
          out.push(ok('# owner: ' + f.owner));
          out.push(ok('# group: ' + f.group));
          out.push(ok('user::' + bits(f.mode, 0)));
          Object.keys(acl.users || {}).forEach((u) => out.push(ok('user:' + u + ':' + acl.users[u])));
          out.push(ok('group::' + bits(f.mode, 1)));
          Object.keys(acl.groups || {}).forEach((g) => out.push(ok('group:' + g + ':' + acl.groups[g])));
          out.push(ok('mask::' + (acl.mask || 'rwx')));
          out.push(ok('other::' + bits(f.mode, 2)));
          if (acl.users && Object.keys(acl.users).length) {
            out.push(ok(''));
            Object.keys(acl.users).forEach((u) => {
              const e = applyMask(acl.users[u], acl.mask);
              if (e !== acl.users[u]) out.push(dim('user:' + u + ':rwx\t\t#effective:' + e));
            });
          }
          return out;
        }

        case 'chmod': {
          const mode = args[0];
          const target = args[1];
          if (!mode || !target) return [err('chmod: 缺少参数（用法 chmod 3770 /path 或 chmod g+s /path）')];
          const path = normalize(target, st.cwd);
          const f = st.files[path];
          if (!f) return [err('chmod: cannot access \'' + target + '\': No such file or directory')];
          if (st.user !== 'root' && f.owner !== st.user) return [err('chmod: changing permissions of \'' + target + '\': Operation not permitted')];
          if (/^[0-7]{3,4}$/.test(mode)) {
            f.mode = mode;
          } else {
            /* 符号模式：u+x、g+s、o-r、a=rwx，且支持逗号分隔多子句
               （chmod u=rwx,g=rwx,o= 与 chmod g+s,o+t 必须都能解析） */
            const d = modeDigits(f.mode).split('').map((x) => parseInt(x, 10));
            let spNew = modeSpecial(f.mode);
            const idx = { u: 0, g: 1, o: 2 };
            const has = (who, w) => who === 'a' || who.indexOf(w) >= 0;
            for (const clause of mode.split(',')) {
              const m = clause.match(/^([ugoa]*)([+\-=])([rwxst]*)$/);
              if (!m) return [err('chmod: invalid mode: \'' + mode + '\'')];
              const who = m[1] || 'a';
              const op = m[2];
              const perms = m[3];
              // 只有 = 允许空权限（表示清空），+/- 必须带权限字符
              if (!perms && op !== '=') return [err('chmod: invalid mode: \'' + mode + '\'')];
              if (op === '=') {
                ['u', 'g', 'o'].forEach((w) => {
                  if (has(who, w)) d[idx[w]] = 0;
                });
                if (has(who, 'u')) spNew &= ~4;
                if (has(who, 'g')) spNew &= ~2;
                if (has(who, 'o')) spNew &= ~1;
              }
              ['u', 'g', 'o'].forEach((w) => {
                if (!has(who, w)) return;
                const i = idx[w];
                for (const ch of perms) {
                  if (ch === 'r') d[i] = op === '-' ? d[i] & ~4 : d[i] | 4;
                  else if (ch === 'w') d[i] = op === '-' ? d[i] & ~2 : d[i] | 2;
                  else if (ch === 'x') d[i] = op === '-' ? d[i] & ~1 : d[i] | 1;
                  else if (ch === 's') {
                    if (i === 0) spNew = op === '-' ? spNew & ~4 : spNew | 4;
                    if (i === 1) spNew = op === '-' ? spNew & ~2 : spNew | 2;
                  } else if (ch === 't') spNew = op === '-' ? spNew & ~1 : spNew | 1;
                }
              });
            }
            f.mode = (spNew ? String(spNew) : '') + d.join('');
          }
          out.push(dim('（' + path + ' 现在是 ' + fmtMode(st, f) + '）'));
          return out;
        }

        case 'chown':
        case 'chgrp': {
          if (!needRoot()) return out;
          const spec = args[0];
          const target = args[1];
          if (!spec || !target) return [err(cmd + ': 缺少参数（用法 ' + cmd + ' 用户[:组] /path）')];
          const path = normalize(target, st.cwd);
          const f = st.files[path];
          if (!f) return [err(cmd + ': cannot access \'' + target + '\': No such file or directory')];
          if (cmd === 'chgrp') {
            if (!st.groups[spec]) return [err('chgrp: invalid group: \'' + spec + '\'')];
            f.group = spec;
          } else {
            const parts = spec.split(':');
            const owner = parts[0];
            const group = parts.length > 1 ? parts[1] : null;
            if (owner && !st.users[owner]) return [err('chown: invalid user: \'' + owner + '\'')];
            if (group && !st.groups[group]) return [err('chown: invalid group: \'' + group + '\'')];
            if (owner) f.owner = owner;
            if (group) f.group = group;
          }
          out.push(dim('（' + path + ' 现在是 ' + f.owner + ':' + f.group + ' ' + fmtMode(st, f) + '）'));
          return out;
        }

        case 'umask': {
          if (!args.length) {
            out.push(ok('0' + String(parseInt(st.umask, 8).toString(8)).padStart(3, '0')));
            return out;
          }
          if (!/^[0-7]{3,4}$/.test(args[0])) return [err('bash: umask: ' + args[0] + ': octal number out of range')];
          st.umask = args[0].slice(-3);
          out.push(dim('（umask 现在是 ' + st.umask + '，只影响之后新建的对象）'));
          return out;
        }

        case 'setfacl': {
          const path = normalize(args[args.length - 1], st.cwd);
          const f = st.files[path];
          if (!f) return [err('setfacl: ' + args[args.length - 1] + ': No such file or directory')];
          if (args.indexOf('-b') >= 0) {
            f.acl = null;
            out.push(dim('（已清空 ' + path + ' 的全部 ACL）'));
            return out;
          }
          if (args.indexOf('-k') >= 0) {
            if (f.acl) f.acl.def = null;
            out.push(dim('（已清空 ' + path + ' 的默认 ACL）'));
            return out;
          }
          const mi = args.indexOf('-m');
          if (mi < 0 || !args[mi + 1]) return [err('setfacl: 本环境支持 -m u:name:perms / -x u:name / -b / -k')];
          f.acl = f.acl || { users: {}, groups: {}, mask: null, def: null };
          const spec = args[mi + 1];
          const parts = spec.split(':');
          if (parts[0] === 'u' || parts[0] === 'user') {
            const name = parts[1];
            const perm = parts[2];
            if (!st.users[name]) return [err('setfacl: ' + name + ': 用户不存在')];
            f.acl.users[name] = perm;
          } else if (parts[0] === 'g' || parts[0] === 'group') {
            const name = parts[1];
            const perm = parts[2];
            if (!st.groups[name]) return [err('setfacl: ' + name + ': 组不存在')];
            f.acl.groups[name] = perm;
          } else if (parts[0] === 'm' && parts[1] === '') {
            f.acl.mask = parts[2];
          } else if (parts[0] === 'd') {
            f.acl.def = f.acl.def || { users: {}, groups: {} };
            const sub = parts.slice(1).join(':').split(':');
            if (sub[0] === 'u') f.acl.def.users[sub[1]] = sub[2];
          } else {
            return [err('setfacl: 无法解析条目 ' + spec)];
          }
          if (!f.acl.mask) {
            // 与真实 setfacl 一致：未显式设 mask 时按条目重算
            let best = bits(f.mode, 1);
            const up = (p) => {
              let r = '';
              for (let i = 0; i < 3; i++) r += (p[i] === 'r' || best[i] === 'r') ? 'r' : '-';
              return r;
            };
            const union = (a, b) => {
              const set = new Set((a + b).replace(/-/g, '').split(''));
              return (set.has('r') ? 'r' : '-') + (set.has('w') ? 'w' : '-') + (set.has('x') ? 'x' : '-');
            };
            let m = best;
            Object.keys(f.acl.users).forEach((k) => (m = union(m, f.acl.users[k])));
            Object.keys(f.acl.groups).forEach((k) => (m = union(m, f.acl.groups[k])));
            f.acl.mask = m;
            void up;
          }
          out.push(dim('（' + path + ' 的 ACL 已更新，用 getfacl 查看）'));
          return out;
        }

        case 'groupadd': {
          if (!needRoot()) return out;
          const name = args[0];
          if (!name) return [err('groupadd: 缺少组名')];
          if (st.groups[name]) return [err('groupadd: group \'' + name + '\' already exists')];
          const gids = Object.values(st.groups).map((g) => g.gid);
          st.groups[name] = { gid: Math.max(1000, ...gids) + 1 };
          out.push(dim('（组 ' + name + ' 已创建，gid=' + st.groups[name].gid + '）'));
          return out;
        }

        case 'groupdel': {
          if (!needRoot()) return out;
          const name = args[0];
          if (!st.groups[name]) return [err('groupdel: group \'' + name + '\' does not exist')];
          delete st.groups[name];
          out.push(dim('（组 ' + name + ' 已删除）'));
          return out;
        }

        case 'useradd': {
          if (!needRoot()) return out;
          const name = args.filter((a) => !a.startsWith('-'))[0];
          if (!name) return [err('useradd: 缺少用户名')];
          if (st.users[name]) return [err('useradd: user \'' + name + '\' already exists')];
          let extra = [];
          const gi = args.indexOf('-G');
          if (gi >= 0 && args[gi + 1]) extra = args[gi + 1].split(',');
          for (const g of extra) if (!st.groups[g]) return [err('useradd: group \'' + g + '\' does not exist')];
          if (!st.groups[name]) {
            const gids = Object.values(st.groups).map((g) => g.gid);
            st.groups[name] = { gid: Math.max(1000, ...gids) + 1 };
          }
          st.users[name] = {
            uid: Math.max(1000, ...Object.values(st.users).map((u) => u.uid)) + 1,
            groups: [name].concat(extra),
            home: '/home/' + name,
            shell: '/bin/bash',
          };
          if (args.indexOf('-m') >= 0) {
            st.files['/home/' + name] = { type: 'dir', owner: name, group: name, mode: '700' };
          }
          out.push(dim('（用户 ' + name + ' 已创建，附加组 ' + (extra.join(',') || '无') + '）'));
          return out;
        }

        case 'usermod': {
          if (!needRoot()) return out;
          const name = args[args.length - 1];
          if (!st.users[name]) return [err('usermod: user \'' + name + '\' does not exist')];
          const gi = args.indexOf('-G');
          const ai = args.indexOf('-aG');
          const idx = ai >= 0 ? ai : gi;
          if (idx >= 0 && args[idx + 1]) {
            const list = args[idx + 1].split(',').filter(Boolean);
            for (const g of list) if (!st.groups[g]) return [err('usermod: group \'' + g + '\' does not exist')];
            if (ai >= 0) {
              const set = new Set(st.users[name].groups.concat(list));
              st.users[name].groups = Array.from(set);
            } else {
              st.users[name].groups = [st.users[name].groups[0]].concat(list);
            }
            out.push(dim('（' + name + ' 的组现在是：' + st.users[name].groups.join(' ') + '）'));
            return out;
          }
          out.push(err('usermod: 本环境只支持 -aG / -G 组管理'));
          return out;
        }

        case 'userdel': {
          if (!needRoot()) return out;
          const name = args.filter((a) => !a.startsWith('-'))[0];
          if (!st.users[name]) return [err('userdel: user \'' + name + '\' does not exist')];
          delete st.users[name];
          if (args.indexOf('-r') >= 0) delete st.files['/home/' + name];
          out.push(dim('（用户 ' + name + ' 已删除）'));
          return out;
        }

        case 'passwd': {
          const name = args[0] || st.user;
          if (st.user !== 'root' && name !== st.user) return [err('passwd: 权限不够')];
          if (!st.users[name]) return [err('passwd: user \'' + name + '\' does not exist')];
          out.push(dim('（模拟环境不处理密码，' + name + ' 的口令已按输入更新）'));
          return out;
        }

        case 'mkdir': {
          const target = args.filter((a) => !a.startsWith('-'))[0];
          if (!target) return [err('mkdir: 缺少目录名')];
          const path = normalize(target, st.cwd);
          const parent = parentOf(path);
          if (!st.files[parent] && args.indexOf('-p') < 0) return [err('mkdir: cannot create directory \'' + target + '\': No such file or directory')];
          if (st.files[parent] && !can(st, st.files[parent], st.user, 'wx')) return [err('mkdir: cannot create directory \'' + target + '\': Permission denied')];
          if (args.indexOf('-p') >= 0) mkdirs(st, path);
          else if (!st.files[path]) st.files[path] = { type: 'dir', owner: st.user, group: st.users[st.user].groups[0], mode: '755' };
          out.push(dim('（目录 ' + path + ' 就绪）'));
          return out;
        }

        case 'touch': {
          const target = args[0];
          if (!target) return [err('touch: missing file operand')];
          const path = normalize(target, st.cwd);
          const parent = parentOf(path);
          if (!st.files[parent]) return [err('touch: cannot touch \'' + target + '\': No such file or directory')];
          if (!can(st, st.files[parent], st.user, 'wx')) return [err('touch: cannot touch \'' + target + '\': Permission denied')];
          touchFile(st, path, st.user);
          out.push(dim('（' + path + ' 已创建/更新，' + st.files[path].owner + ':' + st.files[path].group + ' ' + fmtMode(st, st.files[path]) + '）'));
          return out;
        }

        case 'rm': {
          const target = args.filter((a) => !a.startsWith('-'))[0];
          if (!target) return [err('rm: missing operand')];
          const path = normalize(target, st.cwd);
          const f = st.files[path];
          if (!f) return [err('rm: cannot remove \'' + target + '\': No such file or directory')];
          const parent = st.files[parentOf(path)];
          if (st.user !== 'root') {
            if (!can(st, parent, st.user, 'wx')) return [err('rm: cannot remove \'' + target + '\': Permission denied')];
            if (modeSpecial(parent.mode) & 1 && f.owner !== st.user && parent.owner !== st.user) {
              return [err('rm: cannot remove \'' + target + '\': Operation not permitted（sticky bit 保护）')];
            }
          }
          if (f.type === 'dir' && args.indexOf('-r') < 0 && args.indexOf('-rf') < 0) {
            return [err('rm: cannot remove \'' + target + '\': Is a directory')];
          }
          delete st.files[path];
          if (f.type === 'dir') {
            Object.keys(st.files).forEach((p) => {
              if (p.startsWith(path + '/')) delete st.files[p];
            });
          }
          out.push(dim('（已删除 ' + path + '）'));
          return out;
        }

        case 'echo': {
          const ri = args.findIndex((a) => a === '>' || a === '>>');
          if (ri < 0) {
            out.push(ok(args.join(' ')));
            return out;
          }
          const text = args.slice(0, ri).join(' ');
          const target = args[ri + 1];
          const append = args[ri] === '>>';
          if (!target) return [err('bash: syntax error near unexpected token `newline\'')];
          const parent = parentOf(path);
          if (st.files[parent] && !can(st, st.files[parent], st.user, 'wx')) return [err('bash: ' + target + ': Permission denied')];
          if (!st.files[path]) touchFile(st, path, st.user);
          const f = st.files[path];
          if (!can(st, f, st.user, 'w')) return [err('bash: ' + target + ': Permission denied')];
          f.content = append ? String(f.content || '') + text + '\n' : text + '\n';
          if (path === '/etc/fstab') {
            syncFstab(st);
            out.push(dim('（已写入 /etc/fstab，共 ' + st.fstab.length + ' 条挂载配置）'));
          } else {
            out.push(dim('（已写入 ' + path + '）'));
          }
          return out;
        }

        case 'systemctl': {
          const sub = args[0];
          const rest = args.slice(1);
          const now = rest.indexOf('--now') >= 0;
          const unitArgs = rest.filter((a) => !a.startsWith('-'));

          if (sub === 'daemon-reload') {
            out.push(dim('（已重新加载 unit 定义）'));
            return out;
          }
          if (sub === 'list-units') {
            SYSCTL_UNITS().forEach((u) => out.push(ok(u.padEnd(20) + (st.services[u].active ? 'active' : 'inactive'))));
            return out;
          }

          const unit = svcName(unitArgs[0] || '');
          if (!sub || !unit) return [err('systemctl: 用法 systemctl <start|stop|enable|disable|restart|status|is-active|is-enabled> <unit>')];
          const s = st.services[unit];
          if (!s) return [err('Failed to ' + sub + ' ' + (unitArgs[0] || '') + ': Unit ' + (unitArgs[0] || '') + ' not found.')];

          if (sub === 'start') s.active = true;
          else if (sub === 'stop') s.active = false;
          else if (sub === 'restart') s.active = true;
          else if (sub === 'enable') {
            s.enabled = true;
            if (now) s.active = true;
          } else if (sub === 'disable') {
            s.enabled = false;
            if (now) s.active = false;
          } else if (sub === 'reload') {
            return [err('Job for ' + unit + ' invalid. Unit ' + unit + ' does not support reload（该 unit 没有 ExecReload=）')];
          } else if (sub === 'status') {
            out.push(ok('● ' + unit + ' - ' + (s.desc || 'service')));
            out.push(ok('     Loaded: loaded (/etc/systemd/system/' + unit + '; ' + (s.enabled ? 'enabled' : 'disabled') + '; vendor preset: disabled)'));
            out.push(ok('     Active: ' + (s.active ? 'active (running)' : 'inactive (dead)')));
            if (s.active && s.port) out.push(dim('     Listening: 0.0.0.0:' + s.port));
            return out;
          } else if (sub === 'is-active') {
            out.push(ok(s.active ? 'active' : 'inactive'));
            return out;
          } else if (sub === 'is-enabled') {
            out.push(ok(s.enabled ? 'enabled' : 'disabled'));
            return out;
          } else {
            return [err('systemctl: 不支持的子命令 ' + sub)];
          }
          out.push(dim('（' + unit + ' → ' + (s.active ? 'active' : 'inactive') + ' / ' + (s.enabled ? 'enabled' : 'disabled') + '）'));
          return out;
        }

        case 'firewall-cmd': {
          const fw = st.firewall;
          const perm = args.indexOf('--permanent') >= 0;
          const view = perm ? fw.permanent : fw.runtime;
          const get = (k) => {
            const i = args.findIndex((a) => a.indexOf('--' + k + '=') === 0);
            return i >= 0 ? args[i].split('=')[1] : null;
          };
          const port = get('add-port') || get('remove-port') || get('query-port');
          if (args.indexOf('--reload') >= 0) {
            fw.runtime = clone(fw.permanent);
            out.push(ok('success'));
            out.push(dim('（已把持久配置刷新到运行时）'));
            return out;
          }
          if (args.indexOf('--runtime-to-permanent') >= 0) {
            fw.permanent = clone(fw.runtime);
            out.push(ok('success'));
            return out;
          }
          if (args.indexOf('--list-all') >= 0) {
            out.push(ok((perm ? 'public (permanent)' : 'public (active)')));
            out.push(ok('  target: default'));
            out.push(ok('  interfaces: eth0'));
            out.push(ok('  services: ' + (view.services || []).join(' ')));
            out.push(ok('  ports: ' + (view.ports || []).join(' ')));
            return out;
          }
          if (args.indexOf('--add-port') >= 0) {
            if (!port) return [err('Error: 缺少端口')];
            if (view.ports.indexOf(port) < 0) view.ports.push(port);
            out.push(ok('success'));
            if (!perm) out.push(dim('（只改了运行时，重启后失效；持久化要加 --permanent 再 --reload）'));
            return out;
          }
          if (args.indexOf('--remove-port') >= 0) {
            view.ports = (view.ports || []).filter((p) => p !== port);
            out.push(ok('success'));
            return out;
          }
          if (args.indexOf('--query-port') >= 0) {
            out.push(ok(view.ports.indexOf(port) >= 0 ? 'yes' : 'no'));
            return out;
          }
          if (args.indexOf('--add-service') >= 0) {
            const svc = get('add-service');
            if (svc && view.services.indexOf(svc) < 0) view.services.push(svc);
            out.push(ok('success'));
            return out;
          }
          return [err('firewall-cmd: 本环境支持 --add-port/--remove-port/--query-port/--list-all/--reload/--permanent')];
        }

        case 'ss': {
          const rows = [['State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Process']];
          rows.push(['LISTEN', '0', '128', '0.0.0.0:22', 'users:(("sshd",pid=901,fd=3))']);
          Object.keys(st.services).forEach((u) => {
            const s = st.services[u];
            if (s.active && s.port) rows.push(['LISTEN', '0', '128', '0.0.0.0:' + s.port, 'users:(("' + u.replace('.service', '') + '",pid=1201,fd=5))']);
          });
          const w = [5, 6, 6, 20];
          rows.forEach((r) => out.push(ok(r.map((c, i) => (i < 4 ? String(c).padEnd(w[i]) : c)).join(' '))));
          return out;
        }

        case 'lsblk': {
          out.push(ok('NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS'));
          out.push(ok('vda    252:0    0   40G  0 disk'));
          out.push(ok('└─vda1 252:1    0   40G  0 part /'));
          Object.keys(st.disks).forEach((d) => {
            const n = baseOf(d);
            if (n === 'vda') return;
            out.push(ok(n.padEnd(6) + ' 252:16   0 ' + String(st.disks[d].size).padStart(4) + '  0 disk'));
          });
          Object.keys(st.lvs).forEach((k) => {
            const lv = st.lvs[k];
            out.push(ok('  └─' + baseOf(k).padEnd(8) + ' 253:0   0 ' + String(fmtSize(lv.size_mb)).padStart(4) + '  0 lvm  ' + (lv.mount || '')));
          });
          return out;
        }

        case 'pvcreate': {
          if (!needRoot()) return out;
          const dev = args[0];
          if (!dev) return [err('pvcreate: 缺少设备')];
          if (!st.disks[dev]) return [err('  Device ' + dev + ' not found.')];
          st.pvs[dev] = { size: st.disks[dev].size, vg: st.pvs[dev] ? st.pvs[dev].vg : null };
          out.push(ok('  Physical volume "' + dev + '" successfully created.'));
          return out;
        }

        case 'vgcreate': {
          if (!needRoot()) return out;
          const vg = args[0];
          const devs = args.slice(1);
          if (!vg || !devs.length) return [err('vgcreate: 用法 vgcreate <vg> <dev>')];
          for (const d of devs) if (!st.pvs[d]) return [err('  Device ' + d + ' is not a PV（先 pvcreate）')];
          st.vgs[vg] = { pvs: devs.slice(), size: st.pvs[devs[0]].size };
          devs.forEach((d) => (st.pvs[d].vg = vg));
          out.push(ok('  Volume group "' + vg + '" successfully created'));
          return out;
        }

        case 'lvcreate': {
          if (!needRoot()) return out;
          const li = args.indexOf('-L');
          const ni = args.indexOf('-n');
          const size = li >= 0 ? args[li + 1] : null;
          const name = ni >= 0 ? args[ni + 1] : null;
          const vg = args[args.length - 1];
          if (!size || !name || !st.vgs[vg]) return [err('lvcreate: 用法 lvcreate -L 5G -n lv_app vg_data')];
          const mb = sizeToMb(size);
          if (!mb) return [err('lvcreate: 无法解析容量 ' + size)];
          const key = vg + '/' + name;
          if (st.lvs[key]) return [err('  Logical volume "' + name + '" already exists in volume group "' + vg + '"')];
          st.lvs[key] = {
            vg,
            size_mb: mb,
            fs: null,
            uuid: 'a1b2c3d4-' + Math.random().toString(16).slice(2, 6) + '-' + Math.random().toString(16).slice(2, 6),
            mount: null,
          };
          out.push(ok('  Logical volume "' + name + '" created.'));
          return out;
        }

        case 'lvextend': {
          if (!needRoot()) return out;
          const li = args.indexOf('-L');
          const grow = li >= 0 ? args[li + 1] : null;
          const dev = args[args.length - 1];
          const key = lvDev(dev);
          const lv = st.lvs[key];
          if (!lv) return [err('  Volume group "' + baseOf(dev) + '" not found（检查逻辑卷路径）')];
          const mb = sizeToMb(grow);
          if (!mb) return [err('lvextend: 用法 lvextend -L +5G [-r] /dev/vg/lv')];
          const add = String(grow).startsWith('+');
          lv.size_mb = add ? lv.size_mb + mb : mb;
          out.push(ok('  Size of logical volume ' + key + ' changed from ' + fmtSize(lv.size_mb - (add ? mb : 0)) + ' to ' + fmtSize(lv.size_mb) + '.'));
          out.push(ok('  Logical volume ' + key + ' successfully resized.'));
          if (args.indexOf('-r') >= 0 || args.indexOf('--resizefs') >= 0) {
            if (lv.fs) out.push(ok('  ' + lv.fs + ' filesystem on ' + key + ' resized.'));
            else out.push(err('  Filesystem not found on ' + key + '（先 mkfs）'));
          } else {
            out.push(dim('（只扩了 LV，没有扩文件系统；加 -r 可连带扩容）'));
          }
          return out;
        }

        case 'mkfs.xfs':
        case 'mkfs.ext4': {
          if (!needRoot()) return out;
          const dev = args[args.length - 1];
          const key = lvDev(dev);
          const lv = st.lvs[key];
          const fs = cmd === 'mkfs.xfs' ? 'xfs' : 'ext4';
          if (lv) {
            lv.fs = fs;
            out.push(ok('meta-data=' + key + '        isize=512    agcount=4, agsize=' + (lv.size_mb * 2) + ' blks'));
            out.push(ok('data     =                       bsize=4096   blocks=' + (lv.size_mb * 256) + ', imaxpct=25'));
            out.push(ok('realtime =none                   extsz=4096   blocks=0, rtextents=0'));
            return out;
          }
          if (st.disks[dev]) {
            st.disks[dev].fs = fs;
            out.push(ok('（' + dev + ' 已格式化为 ' + fs + '）'));
            return out;
          }
          return [err('mkfs.' + fs + ': ' + dev + ': No such device')];
        }

        case 'mount': {
          if (!needRoot()) return out;
          if (args.indexOf('-a') >= 0) {
            let n = 0;
            (st.fstab || []).forEach((e) => {
              if (e.mount === '/' || st.mounts[e.mount]) return;
              let dev = e.spec;
              if (dev.startsWith('UUID=')) {
                const uuid = dev.slice(5);
                const hit = Object.keys(st.lvs).find((k) => st.lvs[k].uuid === uuid);
                if (!hit) return;
                dev = '/dev/' + hit;
              }
              if (!st.files[e.mount]) {
                out.push(err('mount: ' + e.mount + ': mount point does not exist.'));
                return;
              }
              st.mounts[e.mount] = { dev, type: e.type };
              const key = lvDev(dev);
              if (st.lvs[key]) st.lvs[key].mount = e.mount;
              n++;
            });
            out.push(dim('（mount -a 完成，新增 ' + n + ' 个挂载）'));
            return out;
          }
          const dev = args[0];
          const mp = args[1];
          if (!dev || !mp) return [err('mount: 用法 mount <设备> <挂载点>')];
          const key = lvDev(dev);
          const lv = st.lvs[key];
          if (!lv) return [err('mount: ' + dev + ': can\'t find in /etc/fstab.')];
          if (!lv.fs) return [err('mount: ' + dev + ': wrong fs type, bad option, bad superblock（先 mkfs）')];
          const mpath = normalize(mp, st.cwd);
          if (!st.files[mpath]) return [err('mount: ' + mp + ': mount point does not exist.')];
          st.mounts[mpath] = { dev: '/dev/' + key, type: lv.fs };
          lv.mount = mpath;
          out.push(dim('（已挂载 /dev/' + key + ' → ' + mpath + '）'));
          return out;
        }

        case 'umount': {
          if (!needRoot()) return out;
          const mp = normalize(args[0], st.cwd);
          if (!st.mounts[mp]) return [err('umount: ' + args[0] + ': not mounted.')];
          delete st.mounts[mp];
          out.push(dim('（已卸载 ' + mp + '）'));
          return out;
        }

        case 'findmnt': {
          const target = args[0] ? normalize(args[0], st.cwd) : null;
          out.push(ok('TARGET  SOURCE              FSTYPE OPTIONS'));
          Object.keys(st.mounts).forEach((mp) => {
            if (target && mp !== target) return;
            const m = st.mounts[mp];
            out.push(ok(mp.padEnd(8) + m.dev.padEnd(20) + String(m.type).padEnd(7) + 'rw,relatime'));
          });
          return out;
        }

        case 'df': {
          out.push(ok('Filesystem        Type      Size  Used Avail Use% Mounted on'));
          out.push(ok('/dev/vda1         xfs        40G  6.2G   34G  16% /'));
          Object.keys(st.mounts).forEach((mp) => {
            if (mp === '/') return;
            const m = st.mounts[mp];
            const key = lvDev(m.dev);
            const lv = st.lvs[key];
            const size = lv ? fmtSize(lv.size_mb) : '—';
            out.push(ok(m.dev.padEnd(18) + String(m.type).padEnd(9) + size.padStart(4) + '  512M  ' + size + '   1% ' + mp));
          });
          return out;
        }

        case 'blkid': {
          const dev = args[0];
          if (dev) {
            const key = lvDev(dev);
            const lv = st.lvs[key];
            if (!lv) return [err('blkid: ' + dev + ': 未找到该设备')];
            out.push(ok('/dev/' + key + ': UUID="' + lv.uuid + '" TYPE="' + (lv.fs || '') + '"'));
            return out;
          }
          Object.keys(st.lvs).forEach((k) => out.push(ok('/dev/' + k + ': UUID="' + st.lvs[k].uuid + '" TYPE="' + (st.lvs[k].fs || '') + '"')));
          return out;
        }

        default:
          return [err('bash: ' + cmd + ': command not found（输入 help 看本模拟环境支持的命令）')];
      }
    },
  };

  /* ---------------- sql 模块 ---------------- */

  function hasPriv(st, role, priv, object) {
    const r = st.roles[role];
    if (r && r.super) return true;
    return (st.grants || []).some((g) => {
      if (g.role !== role) return false;
      if (g.object !== object && g.object !== '*') return false;
      return g.priv === priv || g.priv === 'ALL';
    });
  }

  const sql = {
    prompt() {
      const st = cur.st;
      return st.session.role + '@appdb=>';
    },

    run(raw) {
      const st = cur.st;
      const line = raw.trim().replace(/;$/, '').trim();
      const out = [];

      if (line.startsWith('\\')) {
        const cmd = line.split(/\s+/)[0];
        const arg = line.split(/\s+/)[1];
        if (cmd === '\\du') {
          out.push(ok('                                    List of roles'));
          out.push(ok(' Role name |                         Attributes'));
          out.push(ok('-----------+------------------------------------------------------------'));
          Object.keys(st.roles).forEach((r) => {
            const a = [st.roles[r].super ? 'Superuser' : '', st.roles[r].login ? 'Cannot login'.replace('Cannot login', '') : ''].filter(Boolean).join(', ');
            out.push(ok(' ' + r.padEnd(9) + ' | ' + (a || '')));
          });
          return out;
        }
        if (cmd === '\\dn') {
          out.push(ok('  Name  |  Owner'));
          out.push(ok('--------+---------'));
          Object.keys(st.schemas).forEach((s) => out.push(ok(' ' + s.padEnd(6) + ' | ' + st.schemas[s].owner)));
          return out;
        }
        if (cmd === '\\dt') {
          out.push(ok('        List of relations'));
          out.push(ok(' Schema |   Name    | Type  |  Owner'));
          out.push(ok('--------+-----------+-------+----------'));
          Object.keys(st.tables).forEach((t) => {
            const [sc, tb] = t.split('.');
            out.push(ok(' ' + sc.padEnd(6) + ' | ' + tb.padEnd(9) + ' | table | ' + st.tables[t].owner));
          });
          return out;
        }
        if (cmd === '\\l') {
          Object.keys(st.databases).forEach((d) => out.push(ok(' ' + d.padEnd(12) + ' | ' + st.databases[d].owner)));
          return out;
        }
        if (cmd === '\\c') {
          if (arg && st.databases[arg]) {
            st.database = arg;
            out.push(ok('You are now connected to database "' + arg + '".'));
          } else out.push(err('FATAL:  database "' + (arg || '') + '" does not exist'));
          return out;
        }
        if (cmd === '\\q') {
          out.push(dim('（实验环境不退出，继续当前会话）'));
          return out;
        }
        out.push(err('\\' + cmd.replace(/^\\/, '') + ': 本环境未实现该元命令'));
        return out;
      }

      const up = line.toUpperCase();

      if (/^CREATE\s+ROLE\s+/i.test(line)) {
        const m = line.match(/^CREATE\s+ROLE\s+([A-Za-z_][\w$]*)/i);
        if (!m) return [err('语法错误：CREATE ROLE <name>')];
        const name = m[1];
        if (st.roles[name]) return [err('ERROR:  role "' + name + '" already exists')];
        st.roles[name] = { super: false, login: /LOGIN/i.test(line) };
        out.push(ok('CREATE ROLE'));
        return out;
      }

      if (/^CREATE\s+SCHEMA\s+/i.test(line)) {
        const m = line.match(/^CREATE\s+SCHEMA\s+([A-Za-z_][\w$]*)(?:\s+AUTHORIZATION\s+([A-Za-z_][\w$]*))?/i);
        if (!m) return [err('语法错误：CREATE SCHEMA <name> [AUTHORIZATION <role>]')];
        st.schemas[m[1]] = { owner: m[2] || st.session.role };
        out.push(ok('CREATE SCHEMA'));
        return out;
      }

      if (/^GRANT\s+/i.test(line)) {
        const m = line.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+([A-Za-z_][\w$]*)/i);
        if (!m) return [err('语法错误：GRANT <priv> ON <object> TO <role>')];
        const privs = splitPrivs(m[1]);
        const objRaw = m[2].trim();
        const role = m[3];
        if (!st.roles[role]) return [err('ERROR:  role "' + role + '" does not exist')];
        const object = normalizeObject(st, objRaw);
        if (!object) return [err('ERROR:  对象不存在：' + objRaw)];
        for (const priv of privs) {
          // 同一条授权重复执行不叠加
          if (!st.grants.some((g) => g.priv === priv && g.object === object && g.role === role)) {
            st.grants.push({ priv, object, role });
          }
        }
        out.push(ok('GRANT'));
        return out;
      }

      if (/^REVOKE\s+/i.test(line)) {
        const m = line.match(/^REVOKE\s+(.+?)\s+ON\s+(.+?)\s+FROM\s+([A-Za-z_][\w$]*)/i);
        if (!m) return [err('语法错误：REVOKE <priv> ON <object> FROM <role>')];
        const privs = splitPrivs(m[1]);
        const object = normalizeObject(st, m[2].trim());
        const before = st.grants.length;
        st.grants = st.grants.filter(
          (g) => !(g.role === m[3] && g.object === object && privs.indexOf(g.priv) >= 0),
        );
        out.push(ok(st.grants.length === before ? 'REVOKE 0' : 'REVOKE'));
        return out;
      }

      if (/^SET\s+ROLE\s+/i.test(line)) {
        const m = line.match(/^SET\s+ROLE\s+([A-Za-z_][\w$]*)/i);
        if (!m || !st.roles[m[1]]) return [err('ERROR:  role "' + (m ? m[1] : '') + '" does not exist')];
        st.session.role = m[1];
        out.push(ok('SET'));
        return out;
      }

      if (/^RESET\s+ROLE/i.test(line)) {
        st.session.role = st.user;
        out.push(ok('RESET'));
        return out;
      }

      if (/^(BEGIN|START\s+TRANSACTION)/i.test(line)) {
        st.session.in_tx = true;
        out.push(ok('BEGIN'));
        return out;
      }
      if (/^COMMIT/i.test(line)) {
        st.session.in_tx = false;
        st.session.savepoints = [];
        out.push(ok('COMMIT'));
        return out;
      }
      if (/^ROLLBACK/i.test(line)) {
        st.session.in_tx = false;
        st.session.savepoints = [];
        out.push(ok('ROLLBACK'));
        return out;
      }

      if (/^SELECT\s+/i.test(line)) {
        const tm = line.match(/FROM\s+([A-Za-z_][\w$]*\.[A-Za-z_][\w$]*|[A-Za-z_][\w$]*)/i);
        if (!tm) return [err('本模拟环境只支持 SELECT … FROM <表> 形式的验证查询')];
        const t = resolveTable(st, tm[1]);
        if (!t) return [err('ERROR:  relation "' + tm[1] + '" does not exist')];
        if (!hasPriv(st, st.session.role, 'SELECT', 'table:' + t)) {
          return [err('ERROR:  permission denied for table ' + t.split('.')[1])];
        }
        const info = st.tables[t];
        out.push(ok(' ' + info.columns.join(' | ')));
        out.push(ok('-' + info.columns.map((c) => '-'.repeat(c.length + 1)).join('+-')));
        for (let i = 1; i <= Math.min(info.rowCount, 3); i++) {
          out.push(ok(' ' + info.columns.map((c, j) => (j === 0 ? String(i) : 'v' + i + '_' + c)).join(' | ')));
        }
        out.push(dim('(' + info.rowCount + ' rows)'));
        return out;
      }

      if (/^(DELETE|UPDATE|INSERT)/i.test(line)) {
        const tm = line.match(/(?:FROM|INTO)\s+([A-Za-z_][\w$]*\.[A-Za-z_][\w$]*|[A-Za-z_][\w$]*)/i);
        if (!tm) return [err('语法错误')];
        const t = resolveTable(st, tm[1]);
        if (!t) return [err('ERROR:  relation "' + tm[1] + '" does not exist')];
        const priv = up.startsWith('DELETE') ? 'DELETE' : up.startsWith('UPDATE') ? 'UPDATE' : 'INSERT';
        if (!hasPriv(st, st.session.role, priv, 'table:' + t)) {
          return [err('ERROR:  permission denied for table ' + t.split('.')[1] + '（当前角色 ' + st.session.role + ' 没有 ' + priv + ' 权限）')];
        }
        out.push(ok(priv + ' ' + st.tables[t].rowCount));
        return out;
      }

      if (/^(EXPLAIN|ANALYZE)/i.test(line)) {
        out.push(ok('Seq Scan on ' + (line.split(/\s+/).pop() || 'table') + '  (cost=0.00..12.10 rows=210 width=64)'));
        return out;
      }

      if (/^(SHOW|\\d)/i.test(line)) {
        out.push(dim('（本模拟环境不实现该语句）'));
        return out;
      }

      return [err('ERROR:  语法错误（本模拟环境只实现 CREATE ROLE / CREATE SCHEMA / GRANT / REVOKE / SET ROLE / SELECT / DELETE 等）')];
    },
  };

  /* 把 GRANT 里的对象描述归一成 "类型:名字"，找不到返回 null。
     注意：字典的键是原始大小写，不能把整个字符串转大写再去查（那样永远查不到）。 */
  function normalizeObject(st, raw) {
    const s = raw.trim();
    const pick = (dict, name) => {
      const low = name.toLowerCase();
      return Object.keys(dict).find((k) => k.toLowerCase() === low) || null;
    };
    let m;

    if (/^all\s+tables\s+in\s+schema\s+/i.test(s)) {
      const sc = pick(st.schemas, s.split(/\s+/).pop());
      return sc ? 'schema-tables:' + sc : null;
    }
    if ((m = s.match(/^database\s+([A-Za-z_][\w$]*)$/i))) {
      const db = pick(st.databases, m[1]);
      return db ? 'database:' + db : null;
    }
    if ((m = s.match(/^schema\s+([A-Za-z_][\w$]*)$/i))) {
      const sc = pick(st.schemas, m[1]);
      return sc ? 'schema:' + sc : null;
    }
    if ((m = s.match(/^(?:table\s+)?([A-Za-z_][\w$]*\.[A-Za-z_][\w$]*|[A-Za-z_][\w$]*)$/i))) {
      const t = resolveTable(st, m[1]);
      return t ? 'table:' + t : null;
    }
    return null;
  }

  function resolveTable(st, name) {
    if (st.tables[name]) return name;
    const low = name.toLowerCase();
    return Object.keys(st.tables).find((k) => k.toLowerCase() === low) || null;
  }

  /* "SELECT, DELETE" → ["SELECT","DELETE"]；"ALL PRIVILEGES" 原样返回 */
  function splitPrivs(raw) {
    return String(raw)
      .split(',')
      .map((x) => x.trim().toUpperCase().replace(/\s+/g, ' '))
      .filter(Boolean);
  }

  /* ---------------- 判分 ---------------- */

  function evalValidator(v) {
    const st = cur.st;
    const val = getPath(st, v.path);
    switch (v.op) {
      case 'exists':
        return val !== undefined && val !== null;
      case 'eq':
        return String(val) === String(v.value);
      case 'contains':
        return Array.isArray(val) && val.indexOf(v.value) >= 0;
      case 'gte':
        return Number(val) >= Number(v.value);
      case 'grant': {
        const list = st.grants || [];
        const hit = list.some(
          (g) =>
            g.role === v.value.role &&
            (!v.value.priv || g.priv === v.value.priv) &&
            (!v.value.object || g.object === v.value.object)
        );
        return v.value.absent ? !hit : hit;
      }
      case 'fstab_has':
        return (st.fstab || []).some(
          (e) => e.mount === v.value.mount && String(e.spec || '').indexOf(v.value.specPrefix || '') === 0
        );
      default:
        return false;
    }
  }

  E.check = () => {
    if (!cur) return null;
    const lab = cur.lab;

    if (lab.kind === 'audit') {
      const items = lab.items.map((it) => ({
        id: it.id,
        label: it.name,
        weight: Math.round(100 / lab.items.length),
        pass: cur.audit[it.id] === it.answer,
        answer: it.answer,
        chosen: cur.audit[it.id] || null,
        why: it.why,
      }));
      const right = items.filter((i) => i.pass).length;
      const score = Math.round((right / items.length) * 100);
      return { score, items, passed: score >= 80, right, total: items.length };
    }

    const items = (lab.validators || []).map((v) => ({
      id: v.id,
      label: v.label,
      weight: v.weight,
      pass: evalValidator(v),
    }));
    const score = items.reduce((acc, i) => acc + (i.pass ? i.weight : 0), 0);
    return { score, items, passed: score >= 80 };
  };

  /* ---------------- 状态面板 ---------------- */

  E.stateView = () => {
    if (!cur) return [];
    const lab = cur.lab;
    const st = cur.st;
    const groups = [];

    if (lab.kind === 'sql') {
      groups.push({
        title: '会话',
        rows: [
          { k: '当前角色', v: st.session.role, cls: st.session.role === 'omm' ? '' : 'ok' },
          { k: '数据库', v: st.database },
        ],
      });
      groups.push({
        title: '角色',
        rows: Object.keys(st.roles).map((r) => ({ k: r, v: st.roles[r].super ? 'superuser' : st.roles[r].login ? 'login' : '-', cls: '' })),
      });
      const target = st.roles.app_ro ? 'app_ro' : null;
      if (target) {
        const gs = (st.grants || []).filter((g) => g.role === target);
        groups.push({
          title: target + ' 的授权',
          rows: gs.length ? gs.map((g) => ({ k: g.priv, v: g.object.replace(/^\w+:/, ''), cls: 'ok' })) : [{ k: '（无）', v: '', cls: 'bad' }],
        });
      }
      return groups;
    }

    if (lab.kind === 'audit') {
      groups.push({
        title: '判定进度',
        rows: lab.items.map((it) => ({
          k: it.name,
          v: cur.audit[it.id] || '未选',
          cls: cur.audit[it.id] ? '' : 'bad',
        })),
      });
      return groups;
    }

    // linux
    groups.push({
      title: '身份',
      rows: [
        { k: '当前用户', v: st.user },
        { k: '工作目录', v: st.cwd },
      ],
    });
    groups.push({
      title: '用户 / 组',
      rows: Object.keys(st.users).map((u) => ({ k: u, v: st.users[u].groups.join(','), cls: '' })),
    });
    const fileKeys = Object.keys(st.files).filter((p) => p !== '/');
    groups.push({
      title: '关键文件',
      rows: fileKeys.slice(0, 14).map((p) => ({ k: p, v: fmtMode(st, st.files[p]) + ' ' + st.files[p].owner + ':' + st.files[p].group, cls: '' })),
    });
    if (Object.keys(st.services).length) {
      groups.push({
        title: '服务',
        rows: Object.keys(st.services).map((u) => ({
          k: u,
          v: (st.services[u].active ? 'active' : 'inactive') + ' / ' + (st.services[u].enabled ? 'enabled' : 'disabled'),
          cls: st.services[u].active && st.services[u].enabled ? 'ok' : '',
        })),
      });
    }
    if (st.firewall) {
      groups.push({
        title: '防火墙',
        rows: [
          { k: 'runtime 端口', v: (st.firewall.runtime.ports || []).join(' ') || '无', cls: (st.firewall.runtime.ports || []).length ? 'ok' : '' },
          { k: 'permanent 端口', v: (st.firewall.permanent.ports || []).join(' ') || '无', cls: (st.firewall.permanent.ports || []).length ? 'ok' : '' },
        ],
      });
    }
    if (Object.keys(st.pvs).length || Object.keys(st.disks).length) {
      const rows = [];
      Object.keys(st.pvs).forEach((d) => rows.push({ k: 'PV ' + d, v: st.pvs[d].vg || '未分配', cls: st.pvs[d].vg ? 'ok' : '' }));
      Object.keys(st.vgs).forEach((g) => rows.push({ k: 'VG ' + g, v: st.vgs[g].pvs.join(','), cls: 'ok' }));
      Object.keys(st.lvs).forEach((k) => rows.push({ k: 'LV ' + k, v: fmtSize(st.lvs[k].size_mb) + ' ' + (st.lvs[k].fs || '无 fs'), cls: st.lvs[k].fs ? 'ok' : '' }));
      Object.keys(st.mounts).forEach((mp) => {
        if (mp === '/') return;
        rows.push({ k: '挂载 ' + mp, v: st.mounts[mp].dev, cls: 'ok' });
      });
      groups.push({ title: '存储', rows });
    }
    return groups;
  };

  /* ---------------- 生命周期 ---------------- */

  E.open = (labId) => {
    const lab = LP.state.labById[labId];
    if (!lab) return null;
    if (cur && cur.lab.id === labId) return cur;
    cur = {
      lab,
      st: lab.initial_state ? clone(lab.initial_state) : {},
      log: [],
      history: [],
      histIdx: -1,
      hintsUsed: 0,
      audit: {},
      lastCheck: null,
    };
    if (lab.kind === 'linux') {
      syncFstab(cur.st);
      cur.log.push(dim('openEuler 24.03-LTS-SP2 模拟终端 · 输入 help 查看可用命令'));
      cur.log.push(dim('提示：这是状态模拟环境，不连接真实系统；判分只看最终状态。'));
    } else if (lab.kind === 'sql') {
      cur.log.push(dim('gsql (openGauss 7.0) 模拟控制台 · 输入 \\? 之外的标准 SQL，或用 \\du \\dn \\dt 查看对象'));
    }
    return cur;
  };

  E.cur = () => cur;

  E.exec = (line) => {
    if (!cur) return [];
    const raw = String(line || '').trim();
    if (!raw) return [];
    const lab = cur.lab;
    const out = [{ cls: 'cmd', text: (lab.kind === 'sql' ? '' : E.prompt() + ' ') + raw }];
    cur.history.push(raw);
    cur.histIdx = cur.history.length;

    if (lab.kind === 'sql') {
      sql.run(raw).forEach((r) => out.push(r));
    } else if (lab.kind === 'linux') {
      const argv = tokenize(raw);
      // 支持 sudo 之外的简单命令
      linux.run(argv, raw).forEach((r) => out.push(r));
    }
    cur.log = cur.log.concat(out);
    return out;
  };

  E.prompt = () => {
    if (!cur) return '$';
    return cur.lab.kind === 'sql' ? sql.prompt() : linux.prompt();
  };

  E.reset = () => {
    if (!cur) return null;
    const id = cur.lab.id;
    cur = null; // 丢掉当前状态，E.open 会按 initial_state 重建
    return E.open(id);
  };

  E.setAudit = (itemId, optId) => {
    if (!cur) return;
    cur.audit[itemId] = optId;
  };

  E.auditAnswer = (itemId) => (cur ? cur.audit[itemId] : null);

  E.hint = (index) => {
    if (!cur) return null;
    const list = cur.lab.hints || [];
    if (index >= list.length) return null;
    if (index >= cur.hintsUsed) cur.hintsUsed = index + 1;
    return list[index];
  };

  E.hintsUsed = () => (cur ? cur.hintsUsed : 0);
  E.log = () => (cur ? cur.log : []);
  E.historyUp = () => {
    if (!cur || !cur.history.length) return null;
    cur.histIdx = Math.max(0, cur.histIdx - 1);
    return cur.history[cur.histIdx] || '';
  };
  E.historyDown = () => {
    if (!cur) return null;
    cur.histIdx = Math.min(cur.history.length, cur.histIdx + 1);
    return cur.history[cur.histIdx] || '';
  };
})();
