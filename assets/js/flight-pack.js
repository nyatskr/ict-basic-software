/* flight-pack.js — 飞行离线包：B 站视频的学习顺序清单与本机准备状态
 *
 * 顺序不单独维护一份清单，而是从 catalog 现推：
 *   域 → 专题 → 小节 → 该小节 resources 里的 B 站视频
 * 这样改小节资料时清单自动跟着变，不会出现「网站顺序」和「离线包顺序」两套数据。
 *
 * 本机状态（收藏 / 已缓存 / 已看完）单独存 ict.flight.v1：
 * 它描述的是「这台设备准备到哪一步」，不属于学习进度，也不参与云同步。
 */
(function () {
  'use strict';

  const LP = window.LP;
  const V = (LP.views = LP.views || {});
  const esc = LP.esc;

  const KEY = 'ict.flight.v1';

  /* 建议的 B 站收藏夹划分：两个相邻专题一个夹，4 个夹够用又不至于太碎。
     顺序只作参考，真正的学习顺序以本页为准。 */
  const COLLECTIONS = [
    { id: 'ICT-01', name: '命令与权限', topics: ['oe-01', 'oe-02'] },
    { id: 'ICT-02', name: '软件服务与进程', topics: ['oe-03', 'oe-04'] },
    { id: 'ICT-03', name: '存储与网络', topics: ['oe-05', 'oe-06'] },
    { id: 'ICT-04', name: 'Shell 与容器', topics: ['oe-07', 'oe-08'] },
  ];

  const BILI = /bilibili\.com/i;

  /* ---------------- 本机状态 ---------------- */

  let store = null;

  function normalize(src) {
    const out = { schema: 1, fav: {}, cached: {}, watched: {}, at: 0 };
    if (src && typeof src === 'object') {
      ['fav', 'cached', 'watched'].forEach((k) => {
        const bag = src[k];
        if (!bag || typeof bag !== 'object') return;
        Object.keys(bag).forEach((id) => {
          if (bag[id]) out[k][id] = 1;
        });
      });
      out.at = Number(src.at) || 0;
    }
    return out;
  }

  function read() {
    if (store) return store;
    let raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      raw = null;
    }
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {
      parsed = null;
    }
    store = normalize(parsed);
    return store;
  }

  function persist() {
    const s = read();
    s.at = Date.now();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      if (LP.warnStorage) LP.warnStorage();
    }
    document.dispatchEvent(new CustomEvent('ict:flight-changed'));
  }

  /* ---------------- 清单 ---------------- */

  function bvOf(url) {
    const m = String(url || '').match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : '';
  }

  let cache = null;

  function data() {
    if (cache) return cache;
    const S = LP.state;
    const items = [];
    const seen = new Set();

    (S.catalog.domains || []).forEach((d) => {
      (S.topics || [])
        .filter((t) => t.domain === d.id)
        .forEach((t) => {
          const secs = (S.sectionsByTopic[t.id] || [])
            .slice()
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
          secs.forEach((sec) => {
            (sec.resources || []).forEach((rid) => {
              const r = S.resourceById[rid];
              if (!r || r.kind !== 'video' || !BILI.test(r.url || '')) return;
              if (seen.has(rid)) return; /* 同一条视频挂多个小节时只算一次 */
              seen.add(rid);
              items.push({
                rid,
                bv: bvOf(r.url),
                url: r.url,
                title: r.title,
                author: r.author || '',
                duration: r.duration || '',
                sec: sec.id,
                secTitle: sec.title,
                topic: t.id,
                topicTitle: t.title,
                domain: d.id,
                domainName: d.name,
                domainShort: d.short,
                role: r.role || 'main',
                status: r.status || 'candidate',
                secs: LP.durationSec(r.duration),
              });
            });
          });
        });
    });

    items.forEach((it, i) => (it.no = i + 1));

    const extras = Object.keys(S.resourceById)
      .map((id) => S.resourceById[id])
      .filter((r) => r.kind === 'video' && BILI.test(r.url || '') && !seen.has(r.id))
      .map((r) => ({
        rid: r.id,
        bv: bvOf(r.url),
        url: r.url,
        title: r.title,
        author: r.author || '',
        duration: r.duration || '',
        role: r.role || 'main',
        status: r.status || 'candidate',
        secs: LP.durationSec(r.duration),
      }));

    cache = { items, extras };
    return cache;
  }

  function fmtHM(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    if (h && m) return h + ' 小时 ' + m + ' 分';
    if (h) return h + ' 小时';
    return m + ' 分';
  }

  function stats() {
    const s = read();
    const items = data().items;
    let cached = 0;
    let cachedSec = 0;
    let watched = 0;
    let fav = 0;
    let todo = 0;
    items.forEach((it) => {
      const c = !!s.cached[it.rid];
      const f = !!s.fav[it.rid];
      const w = !!s.watched[it.rid];
      if (c) {
        cached++;
        cachedSec += it.secs;
      }
      if (w) watched++;
      if (f) fav++;
      if (!c && !f && !w) todo++;
    });
    const totalSec = items.reduce((a, b) => a + b.secs, 0);
    return {
      total: items.length,
      totalSec,
      cached,
      cachedSec,
      remainSec: totalSec - cachedSec,
      watched,
      fav,
      todo,
    };
  }

  function packOf(topicId) {
    const c = COLLECTIONS.find((x) => x.topics.indexOf(topicId) >= 0);
    if (c) return c;
    const t = LP.state.topicById[topicId];
    const d = t ? LP.state.domainById[t.domain] : null;
    return { id: (d ? d.short : 'OTHER') + '-' + String(topicId).slice(-2), name: t ? t.title : '其他' };
  }

  function toggle(rid, key) {
    if (['fav', 'cached', 'watched'].indexOf(key) < 0) return;
    const s = read();
    if (s[key][rid]) {
      delete s[key][rid];
      /* 取消「已缓存」时，把「已看完」一起撤掉，否则状态自相矛盾 */
      if (key === 'cached') delete s.watched[rid];
    } else {
      s[key][rid] = 1;
      /* 看完必然缓存过；标记看完时补上缓存，省一次点击 */
      if (key === 'watched') s.cached[rid] = 1;
    }
    persist();
  }

  function nextUncached() {
    const s = read();
    return data().items.find((it) => !s.cached[it.rid]) || null;
  }

  function reset() {
    store = normalize(null);
    persist();
  }

  function copyText() {
    const s = read();
    const items = data().items.filter((it) => !s.cached[it.rid]);
    const st = stats();
    const head =
      'ICT 飞行离线包 · 待缓存 ' +
      items.length +
      ' 条 / 约 ' +
      fmtHM(st.remainSec) +
      '（共 ' +
      st.total +
      ' 条 / ' +
      fmtHM(st.totalSec) +
      '）\n按此顺序在哔哩哔哩 iPad App 里收藏并缓存（720P 即可）：\n';
    const body = items
      .map(
        (it) =>
          String(it.no).padStart(2, '0') +
          ' [' +
          it.sec +
          '] ' +
          it.title +
          '  ' +
          it.duration +
          '  ' +
          it.url
      )
      .join('\n');
    return head + (body || '（全部已缓存）') + '\n';
  }

  function open(item) {
    if (!item) return;
    const scheme = 'bilibili://video/' + item.bv;
    let left = false;
    const onHide = () => {
      left = true;
    };
    document.addEventListener('visibilitychange', onHide, { once: true });

    const a = document.createElement('a');
    a.href = scheme;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 0);

    /* 1.4 秒后页面还留在前台，说明没唤起 App：退回网页版，至少能给个着落 */
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (left || document.hidden) return;
      if (!navigator.onLine) {
        LP.toast('没唤起 B 站 App，且当前离线。请在 App 内打开「离线缓存」播放。', 'warn');
        return;
      }
      /* 不用 window.open：Safari 会拦掉非用户手势的弹窗，直接跳转更可靠 */
      LP.toast('没唤起 B 站 App，改为打开网页版', 'warn');
      location.href = item.url;
    }, 1400);
  }

  LP.flight = {
    list: () => data().items,
    extras: () => data().extras,
    stats,
    read,
    toggle,
    reset,
    nextUncached,
    copyText,
    open,
    packOf,
    collections: () => COLLECTIONS,
    fmtHM,
  };

  /* ---------------- 页面 ---------------- */

  let filter = 'all';
  let armedReset = 0;

  const FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'todo', label: '未处理' },
    { id: 'fav', label: '已收藏' },
    { id: 'cached', label: '已缓存' },
    { id: 'watched', label: '已看完' },
  ];

  function filtered() {
    const s = read();
    const all = data().items;
    if (filter === 'todo') return all.filter((it) => !s.fav[it.rid] && !s.cached[it.rid] && !s.watched[it.rid]);
    if (filter === 'fav') return all.filter((it) => s.fav[it.rid]);
    if (filter === 'cached') return all.filter((it) => s.cached[it.rid]);
    if (filter === 'watched') return all.filter((it) => s.watched[it.rid]);
    return all;
  }

  function groupOf(list) {
    const groups = [];
    list.forEach((it) => {
      let g = groups.find((x) => x.topic === it.topic);
      if (!g) {
        g = { topic: it.topic, title: it.topicTitle, secs: 0, items: 0, sections: [] };
        groups.push(g);
      }
      let sg = g.sections.find((x) => x.id === it.sec);
      if (!sg) {
        sg = { id: it.sec, title: it.secTitle, secs: 0, items: [] };
        g.sections.push(sg);
      }
      sg.items.push(it);
      sg.secs += it.secs;
      g.secs += it.secs;
      g.items += 1;
    });
    return groups;
  }

  function rowHtml(it) {
    const s = read();
    const on = (k) => (s[k][it.rid] ? ' on' : '');
    const roleLabel = it.role === 'main' ? '主资料' : it.role === 'backup' ? '备用' : '补充';
    return (
      '<div class="fp-row" id="fp-row-' + esc(it.rid) + '">' +
        '<span class="fp-no">' + String(it.no).padStart(2, '0') + '</span>' +
        '<div class="fp-main">' +
          '<div class="fp-title">' + esc(it.title) + '</div>' +
          '<div class="fp-meta">' +
            '<span>' + esc(it.author || '未记录作者') + '</span>' +
            '<span class="fp-dot">·</span><span>' + esc(it.duration || '时长未记录') + '</span>' +
            '<span class="fp-dot">·</span><span class="fp-role ' + esc(it.role) + '">' + roleLabel + '</span>' +
            '<span class="fp-dot">·</span><span>' + esc(it.sec) + ' ' + esc(it.secTitle) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="fp-flags">' +
          '<button type="button" class="fp-chip' + on('fav') + '" data-act="fp-toggle" data-rid="' + esc(it.rid) + '" data-key="fav" aria-pressed="' + (s.fav[it.rid] ? 'true' : 'false') + '">收藏</button>' +
          '<button type="button" class="fp-chip' + on('cached') + '" data-act="fp-toggle" data-rid="' + esc(it.rid) + '" data-key="cached" aria-pressed="' + (s.cached[it.rid] ? 'true' : 'false') + '">已缓存</button>' +
          '<button type="button" class="fp-chip' + on('watched') + '" data-act="fp-toggle" data-rid="' + esc(it.rid) + '" data-key="watched" aria-pressed="' + (s.watched[it.rid] ? 'true' : 'false') + '">看完</button>' +
        '</div>' +
        '<div class="fp-acts">' +
          '<button type="button" class="btn ghost xs" data-act="fp-open" data-rid="' + esc(it.rid) + '" title="用哔哩哔哩 App 打开">B 站</button>' +
          '<a class="fp-weblink" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">网页</a>' +
        '</div>' +
      '</div>'
    );
  }

  function fold(title, sub, inner) {
    return (
      '<details class="fp-fold">' +
        '<summary><b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</summary>' +
        '<div class="fp-fold-body">' + inner + '</div>' +
      '</details>'
    );
  }

  V.flightPack = () => {
    const st = stats();
    const items = filtered();
    const groups = groupOf(items);
    const next = nextUncached();
    const off = LP.offline && LP.offline.status ? LP.offline.status() : null;
    const pct = st.total ? Math.round((st.cached / st.total) * 100) : 0;

    const filters = FILTERS.map((f) => {
      const n =
        f.id === 'all' ? st.total : f.id === 'todo' ? st.todo : f.id === 'fav' ? st.fav : f.id === 'cached' ? st.cached : st.watched;
      return (
        '<button type="button" class="fp-filter' + (filter === f.id ? ' on' : '') + '" data-act="fp-filter" data-filter="' + f.id + '">' +
          f.label + '<i>' + n + '</i>' +
        '</button>'
      );
    }).join('');

    const groupHtml = groups
      .map((g) => {
        const pack = packOf(g.topic);
        return (
          '<div class="fp-group">' +
            '<div class="fp-group-head">' +
              '<h3>' + esc(g.topic) + ' ' + esc(g.title) + '</h3>' +
              '<span>收藏夹建议：<b>' + esc(pack.id) + ' ' + esc(pack.name) + '</b> · ' + g.items + ' 条 · ' + esc(fmtHM(g.secs)) + '</span>' +
            '</div>' +
            g.sections
              .map(
                (sg) =>
                  '<div class="fp-sec">' +
                    '<div class="fp-sec-head"><a href="#/section/' + esc(sg.id) + '">' + esc(sg.id) + ' ' + esc(sg.title) + '</a>' +
                      '<span>' + sg.items.length + ' 条 · ' + esc(fmtHM(sg.secs)) + '</span></div>' +
                    sg.items.map(rowHtml).join('') +
                  '</div>'
              )
              .join('') +
          '</div>'
        );
      })
      .join('');

    const extras = data().extras;
    const extrasHtml = extras.length
      ? '<div class="fp-group fp-extra">' +
          '<div class="fp-group-head"><h3>可选补充 · 未挂进小节</h3><span>' + extras.length + ' 条 · 不要求缓存，想补看再处理</span></div>' +
          '<div class="fp-sec">' +
            extras
              .map((it) =>
                '<div class="fp-row fp-row-extra" id="fp-row-' + esc(it.rid) + '">' +
                  '<span class="fp-no">+</span>' +
                  '<div class="fp-main"><div class="fp-title">' + esc(it.title) + '</div>' +
                    '<div class="fp-meta"><span>' + esc(it.author || '未记录作者') + '</span><span class="fp-dot">·</span>' +
                    '<span>' + esc(it.duration || '时长未记录') + '</span><span class="fp-dot">·</span>' +
                    '<span>未归入小节</span></div></div>' +
                  '<div class="fp-acts"><button type="button" class="btn ghost xs" data-act="fp-open" data-rid="' + esc(it.rid) + '">B 站</button>' +
                    '<a class="fp-weblink" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">网页</a></div>' +
                '</div>'
              )
              .join('') +
          '</div>' +
        '</div>'
      : '';

    const swLine = off
      ? '<span class="fp-dot' + (off.controlled ? ' on' : '') + '"></span>' +
        (off.controlled
          ? '离线缓存已就绪 · 版本 ' + esc(off.version || '读取中') + ' · 预缓存 ' + (off.precached || '—') + ' 个文件'
          : off.registered
            ? '正在安装离线缓存，请保持联网并稍等几秒'
            : '离线缓存尚未启用（需要 https 或 localhost 打开）') +
        ' · ' + (off.online ? '当前在线' : '当前离线') +
        ' · ' + (off.standalone ? '独立窗口运行' : '浏览器标签页')
      : '';

    return (
      '<div class="crumb"><a href="#/">概览</a> / 飞行离线包</div>' +
      '<section class="hero fp-hero">' +
        '<div class="hero-main">' +
          '<div class="eyebrow">出发前准备 · 视频用官方 App 缓存</div>' +
          '<h1>飞行离线包</h1>' +
          '<p>本站已经是可离线启动的网页 App；这里的 ' + st.total + ' 条视频按学习顺序排好，负责告诉你「先缓存哪条、还差哪条」。视频文件本身由哔哩哔哩 iPad App 的离线缓存提供，本站不下载、不转载。</p>' +
          '<div class="hero-act">' +
            '<button class="btn primary" data-act="fp-next">' + (next ? '打开下一条未缓存 · 第 ' + String(next.no).padStart(2, '0') + ' 条' : '全部已缓存') + '</button>' +
            '<button class="btn ghost" data-act="fp-copy">复制待缓存清单</button>' +
            '<a class="btn ghost" href="#/section/oe-01-01">从第一节开始复习</a>' +
          '</div>' +
        '</div>' +
        '<div class="hero-stats">' +
          '<div class="hs"><span>正式视频</span><b>' + st.total + '<small>条</small></b></div>' +
          '<div class="hs"><span>预计总时长</span><b>' + esc(fmtHM(st.totalSec)) + '</b></div>' +
          '<div class="hs"><span>已缓存</span><b>' + st.cached + '<small>/' + st.total + '</small></b></div>' +
          '<div class="hs"><span>还剩</span><b>' + esc(fmtHM(st.remainSec)) + '</b></div>' +
        '</div>' +
      '</section>' +

      '<div class="fp-progress">' +
        '<div class="fp-progress-top"><b>缓存进度 ' + pct + '%</b>' +
          '<span>已缓存 ' + st.cached + ' 条 / 共 ' + st.total + ' 条 · 已看完 ' + st.watched + ' 条 · 已收藏 ' + st.fav + ' 条</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<p class="fp-sw" id="fp-sw">' + swLine + '</p>' +
      '</div>' +

      '<div class="fp-toolbar">' +
        '<div class="fp-filters">' + filters + '</div>' +
        '<div class="fp-toolbar-act">' +
          '<button class="btn ghost sm" data-act="fp-reset">重置标记</button>' +
        '</div>' +
      '</div>' +

      '<p class="fp-tip">收藏 ≠ 缓存。加入收藏夹只是归类，视频仍要逐条点「缓存」；飞机上请从 App 的「离线缓存 / 下载管理」进入播放，从收藏夹或详情页进会尝试联网。</p>' +

      (groups.length
        ? groupHtml
        : '<div class="empty">当前筛选下没有视频。<button class="btn ghost sm" data-act="fp-filter" data-filter="all">看全部</button></div>') +

      extrasHtml +

      '<div class="section-head"><h2>安装与验收</h2><span class="muted">出发前在 iPad 上照着做一遍</span></div>' +

      fold(
        '1 · 把网站装到 iPad 主屏幕',
        'Safari · 首次需要联网',
        '<ol class="fp-steps">' +
          '<li>用 Safari 打开 <code>https://nyatskr.github.io/ict-basic-software/</code>，等首页出现。</li>' +
          '<li>点地址栏右侧的「共享」→「添加到主屏幕」→ 确认名称为「基础软件」。</li>' +
          '<li>从主屏幕图标启动（不要留在 Safari 标签页里），确认底部没有地址栏。</li>' +
          '<li>在本页看「离线缓存已就绪」这一行：出现版本号与文件数，才说明资源已存到本机。</li>' +
          '<li>如果 Safari 里已有做题记录：先在「进度与数据」导出 JSON，装好后再导入一次——主屏幕 App 的存储与 Safari 是分开的。</li>' +
        '</ol>' +
        '<p class="fp-note">添加到主屏幕需要在非无痕窗口；无痕模式下 Safari 不提供该入口，Service Worker 也不工作。</p>'
      ) +

      fold(
        '2 · 飞行模式验收（8 项）',
        '全部打勾再出门',
        '<ol class="fp-check">' +
          '<li>从主屏幕图标启动网站。</li>' +
          '<li>打开飞行模式，并关闭 Wi-Fi 与蓝牙。</li>' +
          '<li>从后台彻底关掉 App，再重新启动：概览、课程、题库都能打开。</li>' +
          '<li>进入任一小节，确认文字、解析、题目都在；做一道题。</li>' +
          '<li>打开一个模拟实验，敲两条命令并判分；刷新后成绩仍在。</li>' +
          '<li>回到本页：视频顺序、收藏与缓存标记都还在。</li>' +
          '<li>在哔哩哔哩 App 的「离线缓存 / 下载管理」里播放至少两条视频。</li>' +
          '<li>关闭飞行模式联网，回到「进度与数据」确认云同步恢复（未登录可跳过）。</li>' +
        '</ol>' +
        '<p class="fp-note">全程不要用「文件」App 打开本地 HTML，也不要用第三方视频解析站——前者存储来源不可靠，后者要交出账号凭据。</p>'
      ) +

      fold(
        '3 · 视频怎么缓存最省事',
        '官方 App · 720P 足够',
        '<ol class="fp-steps">' +
          '<li>在本页点「B 站」按钮跳到 App；没跳过去就点旁边的「网页」。</li>' +
          '<li>按本页顺序加入对应收藏夹（ICT-01 ～ ICT-04）。</li>' +
          '<li>视频有「缓存」按钮时选 720P；课程板书在 720P 下已足够，也更省空间。</li>' +
          '<li>缓存完成后回到本页勾「已缓存」，进度就跟着走了。</li>' +
          '<li>出发前在飞行模式下实际播两条，确认缓存完整（能拖动进度条）。</li>' +
        '</ol>' +
        '<p class="fp-note">部分视频可能未开放缓存。这属于平台限制，不要用第三方解析工具绕过；这类视频在飞机上跳过，落地再看。</p>'
      ) +

      fold(
        '4 · 为什么不建议用豆包自动缓存',
        '评估结论',
        '<ul class="fp-list">' +
          '<li>豆包普通 iPad App 没有跨 App 驱动哔哩哔哩的能力；官方「豆包手机助手」是特定硬件的系统级能力，不是 iPadOS 的通用助手。</li>' +
          '<li>哔哩哔哩没有面向第三方的「加入收藏夹 / 启动缓存」公开接口；第三方自动化通常要账号 Cookie，风险明显。</li>' +
          '<li>能自动化的只有「排顺序、生成清单、唤起 App」；「点收藏、选清晰度、确认缓存」必须在官方 App 内由本人完成。</li>' +
          '<li>因此本页的方案是：网站负责顺序与检查清单，App 负责合法缓存。</li>' +
        '</ul>' +
        '<p class="fp-note">完整评估（含平台规则、风控与凭据风险）见仓库 <code>docs/automation.md</code>。</p>'
      )
    );
  };

  /* ---------------- 交互 ---------------- */

  function rerender() {
    if (LP.dev && LP.dev.render) LP.dev.render();
  }

  LP.flightActions = {
    'fp-filter': (el) => {
      filter = el.getAttribute('data-filter') || 'all';
      rerender();
    },
    'fp-toggle': (el) => {
      const rid = el.getAttribute('data-rid');
      const key = el.getAttribute('data-key');
      toggle(rid, key);
      rerender();
      const label = key === 'fav' ? '收藏' : key === 'cached' ? '已缓存' : '已看完';
      LP.toast(read()[key][rid] ? '已标记：' + label : '已取消：' + label);
    },
    'fp-open': (el) => {
      const rid = el.getAttribute('data-rid');
      const item =
        data().items.find((x) => x.rid === rid) || data().extras.find((x) => x.rid === rid);
      if (!item) return;
      open(item);
    },
    'fp-next': () => {
      const it = nextUncached();
      if (!it) {
        LP.toast('全部 ' + data().items.length + ' 条都已标记为已缓存');
        return;
      }
      filter = 'all';
      rerender();
      setTimeout(() => {
        const row = document.getElementById('fp-row-' + it.rid);
        if (row) {
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          row.classList.add('flash');
          setTimeout(() => row.classList.remove('flash'), 1600);
        }
        LP.toast('第 ' + String(it.no).padStart(2, '0') + ' 条 · ' + it.duration + ' · 正在唤起 B 站');
        open(it);
      }, 60);
    },
    'fp-copy': () => {
      const text = copyText();
      const done = () => LP.toast('待缓存清单已复制，可直接粘到备忘录里对照');
      const fail = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch (e) {
          ok = false;
        }
        ta.remove();
        if (ok) done();
        else LP.toast('复制失败，请手动选择文本', 'warn');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fail);
      } else {
        fail();
      }
    },
    'fp-reset': () => {
      const now = Date.now();
      if (now - armedReset > 4000) {
        armedReset = now;
        LP.toast('再点一次「重置标记」确认清空收藏 / 缓存 / 看完记录', 'warn');
        return;
      }
      armedReset = 0;
      reset();
      filter = 'all';
      rerender();
      LP.toast('已清空本页标记');
    },
  };

  /* Service Worker 状态是异步拿到的，回来后只更新那一行文字，不整页重绘 */
  document.addEventListener('ict:offline-status', () => {
    const el = document.getElementById('fp-sw');
    if (!el || !LP.offline) return;
    const off = LP.offline.status();
    el.innerHTML =
      '<span class="fp-dot' + (off.controlled ? ' on' : '') + '"></span>' +
      (off.controlled
        ? '离线缓存已就绪 · 版本 ' + esc(off.version || '读取中') + ' · 预缓存 ' + (off.precached || '—') + ' 个文件'
        : '正在安装离线缓存，请保持联网并稍等几秒') +
      ' · ' + (off.online ? '当前在线' : '当前离线') +
      ' · ' + (off.standalone ? '独立窗口运行' : '浏览器标签页');
  });

  document.addEventListener('ict:flight-changed', () => {
    /* 状态变化后如果本页在，重绘一次让统计跟着变（toggle 里已主动重绘，这里只兜底） */
  });
})();
