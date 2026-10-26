/* views.js — 各页面渲染
 *
 * 页面清单：
 *   概览 / 域页 / 专题页 / 小节页（学习闭环）/ 实验列表 / 实验运行 / 综合模拟
 *   答题页 / 结果页 / 错题与收藏 / 题库浏览 / 进度与数据
 */
(function () {
  'use strict';

  const LP = window.LP;
  const E = LP.labEngine; // lab-engine.js 先于本文件加载
  const V = (LP.views = {});
  const esc = LP.esc;
  const rich = LP.rich;

  /* ---------------- 文案表 ---------------- */

  const MODE_LABEL = {
    section: '小节测验',
    topic: '专题练习',
    quiz: '小节测验',
    exam: '综合模拟',
    wrong: '错题练习',
    review: '待复习',
    fav: '收藏练习',
    single: '单题练习',
  };
  V.MODE_LABEL = MODE_LABEL;

  const PLATFORM = {
    bilibili: 'B 站',
    douyin: '抖音',
    xiaohongshu: '小红书',
    aliyun: '阿里云开发者社区',
    'php.cn': 'php.cn',
    web: '网页',
    blog: '博客',
    doc: '官方文档',
    site: '本站',
  };

  const ROLE = { main: '主资料', supplement: '补充', backup: '备用' };
  const RSTATUS = { candidate: '待验收', verified: '已验收', dead: '已失效' };
  const LEVEL = { L1: 'L1 引导模拟', L2: 'L2 状态实验', L3: 'L3 真实沙箱' };
  const KIND = { linux: '终端', sql: 'SQL 控制台', audit: '证据审查' };

  /* ---------------- 小组件 ---------------- */

  /* 题干与选项里用反引号标命令；单行展示时去掉反引号，避免出现裸字符 */
  const plain = (s) => String(s == null ? '' : s).replace(/`/g, '');

  function tag(text, cls) {
    return '<span class="tag ' + (cls || '') + '">' + esc(text) + '</span>';
  }

  function typeTag(q) {
    const map = { single: ['单选', 'type-single'], multiple: ['多选', 'type-multi'], judge: ['判断', 'type-single'] };
    const [label, cls] = map[q.type] || ['题目', ''];
    return '<span class="tag ' + cls + '">' + label + '</span>';
  }

  function statusDot(qid) {
    const st = LP.statusOf(qid);
    return '<i class="dot ' + st + '" title="' + LP.STATUS_LABEL[st] + '"></i>';
  }

  function statusTag(qid) {
    const st = LP.statusOf(qid);
    return '<span class="tag st-' + st + '">' + LP.STATUS_LABEL[st] + '</span>';
  }

  function bar(ratio, cls) {
    const w = LP.clamp(Math.round((ratio || 0) * 100), 0, 100);
    return '<div class="bar ' + (cls || '') + '"><i style="width:' + w + '%"></i></div>';
  }

  function optionClass(o, q, selected, reveal) {
    const sel = selected.indexOf(o.id) >= 0;
    const isAns = q.answer.indexOf(o.id) >= 0;
    let cls = 'opt';
    if (sel) cls += ' sel';
    if (reveal && isAns) cls += ' ans';
    if (reveal && sel && !isAns) cls += ' bad';
    return cls;
  }

  function optionMark(o, q, selected, reveal) {
    if (!reveal) return '';
    const sel = selected.indexOf(o.id) >= 0;
    const isAns = q.answer.indexOf(o.id) >= 0;
    if (isAns && sel) return '<span class="omark ok">正确</span>';
    if (isAns) return '<span class="omark ok">应选</span>';
    if (sel) return '<span class="omark no">错选</span>';
    return '';
  }

  function optionList(q, selected, reveal, disabled) {
    return (
      '<div class="opts' + (q.type === 'multiple' ? ' multi' : '') + '">' +
      q.options
        .map((o) => {
          const txt = plain(o.text);
          const mono = LP.isCommand(txt) ? ' mono' : '';
          return (
            '<button type="button" class="' + optionClass(o, q, selected, reveal) + '"' +
            ' data-act="opt" data-id="' + esc(o.id) + '"' + (disabled ? ' disabled' : '') + '>' +
            '<span class="badge">' + esc(o.id) + '</span>' +
            '<span class="otext' + mono + '">' + esc(txt) + '</span>' +
            optionMark(o, q, selected, reveal) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* 「不正确 / 不属于 / 除外」类题目单独提示，不改写原题文字 */
  const NEG_PATTERNS = [
    /(不正确|不属于|不包括|除外|不符合|有误)/,
    /(说法|表述|描述|选项|哪项|下列|以下)[^。？！]{0,12}错误/,
    /不能(作为|使用|用于|实现|完成|直接|通过)/,
  ];
  function isNegativeStem(text) {
    const t = String(text || '');
    return NEG_PATTERNS.some((re) => re.test(t));
  }

  /* correct 传 null 表示「只看解析，不判对错」 */
  function explainBlock(q, selected, correct) {
    const neutral = correct === null || correct === undefined;
    const topic = LP.state.topicById[q.topic_id];
    const sec = LP.state.sectionById[q.section_id];
    return (
      '<div class="explain' + (neutral ? '' : correct ? ' ok' : ' bad') + '">' +
        '<div class="explain-head">' +
          '<span class="verdict">' + (neutral ? '答案与解析' : correct ? '回答正确' : '回答错误') + '</span>' +
          '<span class="ansline">正确答案 <b>' + esc(q.answer.join('、')) + '</b></span>' +
          (neutral ? '' : '<span class="ansline">你的选择 <b>' + (selected.length ? esc(selected.join('、')) : '未作答') + '</b></span>') +
        '</div>' +
        '<div class="explain-body">' +
          (q.explain ? '<p class="ana-t">' + rich(q.explain) + '</p>' : '<p class="muted">这道题暂未写解析。</p>') +
          '<div class="facts">' +
            '<div><span>所属专题</span><b>' + esc(topic ? topic.id + ' ' + topic.title : '—') + '</b></div>' +
            '<div><span>学习小节</span><b>' + esc(sec ? sec.title : '—') + '</b></div>' +
            '<div><span>适用版本</span><b>' + esc(q.version || '未标注') + '</b></div>' +
            '<div><span>题源</span><b>' + (q.source === 'site' ? '本站补充' : '按考纲预测') + '</b></div>' +
          '</div>' +
          '<div class="provrow">本题为按公开考纲编写的预测练习，不是大赛官方真题。若与官方教材、厂商文档或考前下发材料冲突，以后者为准。</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* 资料卡片：平台 / 角色 / 验收状态 / 覆盖点 / 缺口 / 版本说明 */
  function resourceCard(r) {
    const plat = PLATFORM[r.platform] || r.platform || '外部';
    const kindCls = r.kind === 'article' ? ' article' : '';
    const covers = (r.covers || []).length ? '覆盖：' + r.covers.join('、') : '';
    const metaBits = [plat, r.author, r.duration, r.checked_at ? '检查于 ' + r.checked_at : ''].filter(Boolean);
    return (
      '<div class="vcard">' +
        '<div class="vcard-main">' +
          '<div class="vcard-top">' +
            '<span class="vkind' + kindCls + '">' + (r.kind === 'article' ? '图文' : '视频') + '</span>' +
            '<span class="vtitle">' + esc(r.title) + '</span>' +
            '<span class="vbadge ' + esc(r.status || 'candidate') + '">' + esc(RSTATUS[r.status] || '待验收') + '</span>' +
            '<span class="vrole ' + esc(r.role || 'main') + '">' + esc(ROLE[r.role] || '主资料') + '</span>' +
          '</div>' +
          '<div class="vmeta">' + esc(metaBits.join(' · ')) + (covers ? ' · ' + esc(covers) : '') + '</div>' +
          (r.version_note ? '<div class="vmeta">版本口径：' + esc(r.version_note) + '</div>' : '') +
          (r.gaps ? '<div class="vnote">缺口：' + esc(r.gaps) + '</div>' : '') +
          (r.status === 'candidate' ? '<div class="vnote">尚未人工验收：可先看，遇到与官方文档冲突以文档为准。</div>' : '') +
        '</div>' +
        (r.url
          ? '<a class="btn ghost xs vopen" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">打开</a>'
          : '<span class="vopen"></span>') +
      '</div>'
    );
  }

  function labCard(lab) {
    const rec = LP.labResult(lab.id);
    const passed = rec && rec.passed;
    return (
      '<a class="lab-card' + (passed ? ' done' : '') + '" href="#/lab/' + esc(lab.id) + '">' +
        '<div class="lab-card-top">' +
          '<span class="tag">' + esc(LEVEL[lab.level] || lab.level) + '</span>' +
          '<span class="tag ghost">' + esc(KIND[lab.kind] || lab.kind) + '</span>' +
          '<span class="tag ghost">' + esc(lab.minutes) + ' 分钟</span>' +
        '</div>' +
        '<h3>' + esc(lab.title) + '</h3>' +
        '<p>' + esc(lab.subtitle) + '</p>' +
        '<div class="lab-card-foot">' +
          '<span>' + esc(LP.state.domainById[lab.domain] ? LP.state.domainById[lab.domain].name : lab.domain) + '</span>' +
          (rec
            ? '<b>' + (passed ? '已通过' : '未通过') + ' · 最好 ' + rec.best + ' 分 · ' + rec.attempts + ' 次</b>'
            : '<b>未开始</b>') +
          '<span style="margin-left:auto">进入 →</span>' +
        '</div>' +
      '</a>'
    );
  }

  function topicRow(t) {
    const st = LP.topicStats(t);
    const secs = t.sections.length;
    return (
      '<a class="topic-row" href="#/topic/' + esc(t.id) + '">' +
        '<span class="tr-id">' + esc(t.id) + '</span>' +
        '<div class="tr-main">' +
          '<h3>' + esc(t.title) + ' <span class="wbadge ' + esc(t.weight) + '">' + esc(t.weight) + '</span></h3>' +
          '<p>' + esc(t.summary) + '</p>' +
        '</div>' +
        '<div class="tr-side">' +
          '<span>' + secs + ' 小节</span>' +
          '<span>' + t.qCount + ' 题</span>' +
          '<span>' + (t.lab_ids.length ? t.lab_ids.length + ' 实验' : '—') + '</span>' +
          '<span>' + (st.done ? LP.pct(st.rate) : '未开始') + '</span>' +
          (st.coverage > 0 ? bar(st.coverage, 'tiny') : '') +
        '</div>' +
      '</a>'
    );
  }

  /* ---------------- 概览 ---------------- */

  V.dashboard = () => {
    const site = LP.state.catalog.site;
    const s = LP.globalStats();
    const sess = LP.state.session;
    const canResume = sess && sess.qids && sess.qids.length && !sess.finished;
    const labsTotal = LP.state.labs.length;
    const labsPassed = LP.state.labs.filter((l) => (LP.labResult(l.id) || {}).passed).length;
    const nWrong = LP.wrongIds().length;

    const resumeHtml = canResume
      ? '<div class="resume">' +
          '<div class="resume-ico">▶</div>' +
          '<div class="resume-txt">' +
            '<strong>上次练习未完成</strong>' +
            '<span>' + esc(sess.title) + ' · 第 ' + (sess.index + 1) + '/' + sess.qids.length + ' 题</span>' +
          '</div>' +
          '<div class="resume-act">' +
            '<button class="btn ghost sm" data-act="drop-session">放弃</button>' +
            '<button class="btn primary sm" data-act="resume">继续练习</button>' +
          '</div>' +
        '</div>'
      : '';

    const domCards = LP.state.catalog.domains
      .map((d) => {
        const full = LP.state.domainById[d.id];
        const ds = LP.domainStats(full);
        const secN = full.topics.reduce((acc, t) => acc + t.sections.length, 0);
        return (
          '<a class="dom-card" href="#/domain/' + esc(d.id) + '" style="--accent:' + esc(d.accent) + '">' +
            '<div class="dom-head">' +
              '<span class="dom-badge">' + esc(d.short) + '</span>' +
              '<div class="dom-name"><b>' + esc(d.name) + '</b><span>' + esc(d.tagline) + '</span></div>' +
            '</div>' +
            '<div class="dom-scope">' + esc(d.scope) + '</div>' +
            bar(ds.coverage) +
            '<div class="dom-foot">' +
              '<span><b>' + full.topics.length + '</b> 专题</span>' +
              '<span><b>' + secN + '</b> 小节</span>' +
              '<span><b>' + ds.total + '</b> 题</span>' +
              '<span><b>' + ds.labsPassed + '/' + ds.labs + '</b> 实验</span>' +
            '</div>' +
          '</a>'
        );
      })
      .join('');

    const bars = LP.state.catalog.domains
      .map((d) => {
        const ds = LP.domainStats(LP.state.domainById[d.id]);
        return (
          '<div class="dom-bar-row">' +
            '<span>' + esc(d.name) + '</span>' +
            bar(ds.coverage) +
            '<b>' + Math.round(ds.coverage * 100) + '%</b>' +
          '</div>'
        );
      })
      .join('');

    const stages = LP.state.catalog.domains
      .map((d, i) => {
        const ds = LP.domainStats(LP.state.domainById[d.id]);
        return (
          '<div class="stage-row">' +
            '<span class="stage-no">' + (i + 1) + '</span>' +
            '<div class="stage-main">' +
              '<b>' + esc(d.name) + ' 单域自测</b>' +
              '<p>' + ds.total + ' 题池 · 已做 ' + ds.done + ' · ' + (ds.done ? '正确率 ' + LP.pct(ds.rate) : '未开始') + '</p>' +
            '</div>' +
            '<a class="btn ghost sm" href="#/exam?d=' + esc(d.id) + '">配置</a>' +
          '</div>'
        );
      })
      .join('');

    return (
      '<section class="hero split">' +
        '<div class="hero-main">' +
          '<div class="eyebrow">' + esc(site.subtitle) + ' · ' + esc(site.season) + '</div>' +
          '<h1>' + esc(site.title) + '</h1>' +
          '<p>' + esc(site.tagline) + '。每个小节按「学习目标 → 资料 → 文字补充 → 理论题 → 实操 → 测验」走一遍。</p>' +
          '<div class="hero-act">' +
            '<a class="btn primary lg" href="#/section/oe-02-01">从纵向样板开始</a>' +
            '<a class="btn ghost lg" href="#/exam">综合模拟</a>' +
          '</div>' +
        '</div>' +
        '<div class="hero-stats">' +
          '<div class="hs"><span>已做</span><b>' + s.done + '<small>/' + s.total + '</small></b></div>' +
          '<div class="hs"><span>正确率</span><b>' + LP.pct(s.rate) + '</b></div>' +
          '<div class="hs"><span>实验通过</span><b>' + labsPassed + '<small>/' + labsTotal + '</small></b></div>' +
          '<div class="hs"><span>错题</span><b>' + nWrong + '</b></div>' +
        '</div>' +
      '</section>' +
      resumeHtml +
      '<div class="section-head"><h2>三条知识线</h2><span class="muted">按本赛季考纲拆成专题与小节</span></div>' +
      '<div class="dom-grid">' + domCards + '</div>' +
      '<div class="section-head"><h2>阶段测验</h2><span class="muted">先单域自测，再综合模拟</span></div>' +
      stages +
      '<div class="section-head"><h2>各域进度</h2></div>' +
      '<div class="card"><div class="dom-bars">' + bars + '</div></div>' +
      '<div class="section-head"><h2>使用说明</h2></div>' +
      '<div class="note-card">' +
        '<p>' + esc(site.scope_note) + '</p>' +
        '<p class="muted">实操为浏览器内的状态模拟，判分只看最终状态，不看敲了哪条命令；真实环境请另找沙箱练习。进度保存在本机浏览器，可用「进度与数据」导出备份。</p>' +
        '<div class="srcs">' +
          (site.official || [])
            .map((o) => '<a href="' + esc(o.url) + '" target="_blank" rel="noopener noreferrer">' + esc(o.label) + '</a>')
            .join('') +
        '</div>' +
      '</div>'
    );
  };

  /* ---------------- 域页 ---------------- */

  V.domain = (domainId) => {
    const d = LP.state.domainById[domainId];
    if (!d) return '<div class="empty">没有找到这个学习域。<a href="#/">返回概览</a></div>';
    const ds = LP.domainStats(d);

    const map = d.topics
      .map((t) => {
        const nodes = (t.nodes || [])
          .map((n) => {
            const sec = LP.state.sectionById[n.section];
            const done = sec ? LP.sectionProgress(sec).coverage >= 1 : false;
            const cls = 'map-node' + (n.level === 1 ? ' lv1' : '') + (done ? ' done' : '');
            if (!sec) return '<span class="' + cls + '">' + esc(n.label) + '</span>';
            return '<a class="' + cls + '" href="#/section/' + esc(sec.id) + '">' + esc(n.label) + '</a>';
          })
          .join('');
        return (
          '<div class="map-topic">' +
            '<h4><a href="#/topic/' + esc(t.id) + '">' + esc(t.title) + '</a>' +
              ' <span class="wbadge ' + esc(t.weight) + '">' + esc(t.weight) + '</span></h4>' +
            '<div class="map-nodes">' + nodes + '</div>' +
          '</div>'
        );
      })
      .join('');

    return (
      '<div class="crumb"><a href="#/">概览</a> / ' + esc(d.name) + '</div>' +
      '<div class="domain-hero" style="--accent:' + esc(d.accent) + '">' +
        '<div>' +
          '<h1>' + esc(d.name) + '</h1>' +
          '<p>' + esc(d.tagline) + ' · ' + esc(d.scope) + '</p>' +
          '<div class="dh-tags">' +
            '<span class="tag">版本 ' + esc(d.version) + '</span>' +
            '<span class="tag">' + d.topics.length + ' 专题</span>' +
            '<span class="tag">' + ds.total + ' 题</span>' +
            '<span class="tag">' + ds.labs + ' 实验</span>' +
            (d.doc ? '<a class="tag" href="' + esc(d.doc.url) + '" target="_blank" rel="noopener noreferrer">' + esc(d.doc.label) + ' ↗</a>' : '') +
          '</div>' +
        '</div>' +
        '<div style="min-width:190px">' +
          '<div class="dom-bar-row"><span>题覆盖</span>' + bar(ds.coverage) + '<b>' + Math.round(ds.coverage * 100) + '%</b></div>' +
          '<div class="dom-bar-row"><span>正确率</span>' + bar(ds.rate || 0) + '<b>' + LP.pct(ds.rate) + '</b></div>' +
          '<div class="dom-bar-row"><span>实验</span>' + bar(ds.labs ? ds.labsPassed / ds.labs : 0) + '<b>' + ds.labsPassed + '/' + ds.labs + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="section-head"><h2>知识图谱</h2><span class="muted">点节点直接进小节；加粗的是主干节点</span></div>' +
      '<div class="map-grid"><div class="map-col"><div class="map-col-head"><span class="dotc" style="background:' + esc(d.accent) + '"></span><b>' + esc(d.name) + '</b><span class="muted small">' + d.topics.length + ' 个专题</span></div><div class="map-body">' + map + '</div></div></div>' +
      '<div class="section-head"><h2>专题与小节</h2></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' + d.topics.map(topicRow).join('') + '</div>'
    );
  };

  /* ---------------- 专题页 ---------------- */

  V.topic = (topicId) => {
    const t = LP.state.topicById[topicId];
    if (!t) return '<div class="empty">没有找到这个专题。<a href="#/">返回概览</a></div>';
    const d = LP.state.domainById[t.domain];
    const st = LP.topicStats(t);
    const labs = t.lab_ids.map((id) => LP.state.labById[id]).filter(Boolean);

    const secs = t.sections
      .map((sec) => {
        const sp = LP.sectionProgress(sec);
        const ready = sec.status === 'ready';
        return (
          '<a class="qline" href="#/section/' + esc(sec.id) + '">' +
            '<span class="tr-id">' + esc(sec.id) + '</span>' +
            '<span class="qline-stem">' + esc(sec.title) + '</span>' +
            (ready ? '<span class="tag st-mastered">已成型</span>' : '<span class="tag st-new">待补</span>') +
            '<span class="muted small">' + LP.sectionQids(sec).length + ' 题</span>' +
            '<span class="muted small">' + sec.minutes + ' 分钟</span>' +
            '<span class="muted small">' + Math.round(sp.coverage * 100) + '%</span>' +
          '</a>'
        );
      })
      .join('');

    return (
      '<div class="crumb"><a href="#/">概览</a> / <a href="#/domain/' + esc(t.domain) + '">' + esc(d.name) + '</a> / ' + esc(t.id) + '</div>' +
      '<div class="page-head">' +
        '<h1>' + esc(t.title) + ' <span class="wbadge ' + esc(t.weight) + '">' + esc(t.weight) + '</span></h1>' +
        '<p>' + esc(t.summary) + '</p>' +
      '</div>' +
      '<div class="card">' +
        '<div class="facts wide">' +
          '<div><span>小节</span><b>' + t.sections.length + ' 个</b></div>' +
          '<div><span>理论题</span><b>' + t.qCount + ' 道</b></div>' +
          '<div><span>已做</span><b>' + st.done + ' 道</b></div>' +
          '<div><span>正确率</span><b>' + LP.pct(st.rate) + '</b></div>' +
          '<div><span>模拟实操</span><b>' + labs.length + ' 个</b></div>' +
        '</div>' +
        '<div class="action-row">' +
          (t.qCount ? '<button class="btn primary" data-act="start-topic" data-topic="' + esc(t.id) + '">练这个专题 ' + t.qCount + ' 题</button>' : '') +
          '<button class="btn ghost" data-act="start-topic" data-topic="' + esc(t.id) + '" data-only="new">只练未做</button>' +
          '<button class="btn ghost" data-act="start-topic" data-topic="' + esc(t.id) + '" data-only="weak">只练错题</button>' +
        '</div>' +
      '</div>' +
      '<div class="section-head"><h2>学习小节</h2><span class="muted">按顺序走完：目标 → 资料 → 补充 → 理论 → 实操 → 测验</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' + (secs || '<div class="empty">这个专题还没有拆小节。</div>') + '</div>' +
      (labs.length
        ? '<div class="section-head"><h2>配套实操</h2></div><div class="lab-grid">' + labs.map(labCard).join('') + '</div>'
        : '')
    );
  };

  /* ---------------- 小节页（学习闭环） ---------------- */

  V.section = (sectionId) => {
    const sec = LP.state.sectionById[sectionId];
    if (!sec) return '<div class="empty">没有找到这个小节。<a href="#/">返回概览</a></div>';
    const t = LP.state.topicById[sec.topic_id];
    const d = LP.state.domainById[t.domain];
    const sp = LP.sectionProgress(sec);
    const qids = LP.sectionQids(sec);
    const res = LP.sectionResources(sec);
    let labs = LP.sectionLabs(sec);
    let labFallback = false;
    if (!labs.length) {
      // 本节没有专属实验时，回退到本专题的实验，避免「实操」一栏空着
      labs = (t.lab_ids || []).map((id) => LP.state.labById[id]).filter(Boolean);
      labFallback = labs.length > 0;
    }
    const ready = sec.status === 'ready';

    /* 1. 学习目标 */
    const objectives =
      '<div class="block" id="sec-obj">' +
        '<div class="block-head"><h2>学习目标</h2><span>学完这一节应该能</span></div>' +
        (sec.objectives && sec.objectives.length
          ? '<ul class="objlist">' + sec.objectives.map((o) => '<li>' + rich(o) + '</li>').join('') + '</ul>'
          : '<p class="muted">这一节的学习目标还在补。</p>') +
      '</div>';

    /* 2. 推荐资料 */
    const resources =
      '<div class="block" id="sec-res">' +
        '<div class="block-head"><h2>推荐讲解资源</h2><span>外部平台只放链接，不转载</span></div>' +
        (res.length
          ? '<div style="display:flex;flex-direction:column;gap:8px">' + res.map(resourceCard).join('') + '</div>'
          : '<div class="vempty">这一节暂时没有收录讲解资源，先用下面的文字补充。</div>') +
        (sec.search_terms && sec.search_terms.length
          ? '<p class="gap-note">想自己找资料，可以搜：' + esc(sec.search_terms.join(' / ')) + '</p>'
          : '') +
      '</div>';

    /* 3. 本站补充与版本纠错 */
    const notes =
      '<div class="block" id="sec-note">' +
        '<div class="block-head"><h2>本站文字补充与版本纠错</h2><span>以官方文档为最终依据</span></div>' +
        (sec.notes && sec.notes.length
          ? '<div class="note-block">' +
              sec.notes
                .map((n) => '<div class="note-item"><h4>' + rich(n.h) + '</h4><p>' + rich(n.t) + '</p></div>')
                .join('') +
            '</div>'
          : '<p class="muted">这一节的文字补充还在写。</p>') +
        (sec.pitfalls && sec.pitfalls.length
          ? '<div class="pitfall" style="margin-top:12px"><h4>常见误区</h4><ul>' +
              sec.pitfalls.map((p) => '<li>' + rich(p) + '</li>').join('') +
            '</ul></div>'
          : '') +
        (sec.gaps ? '<p class="gap-note">资料缺口：' + esc(sec.gaps) + '</p>' : '') +
      '</div>';

    /* 4. 理论题 */
    const qRows = qids
      .map((id) => {
        const q = LP.state.qById[id];
        return (
          '<button class="qline" data-act="peek" data-qid="' + esc(id) + '">' +
            statusDot(id) +
            '<span class="tr-id">' + esc(id) + '</span>' +
            typeTag(q) +
            '<span class="qline-stem">' + esc(plain(q.stem)) + '</span>' +
            statusTag(id) +
          '</button>'
        );
      })
      .join('');

    const questions =
      '<div class="block" id="sec-q">' +
        '<div class="block-head"><h2>理论题</h2><span>' + qids.length + ' 道 · 已做 ' + sp.done + ' · ' + (sp.done ? '正确率 ' + LP.pct(sp.rate) : '未开始') + '</span>' +
          (qids.length ? '<button class="btn primary sm" data-act="start-section" data-sec="' + esc(sec.id) + '">开始理论练习</button>' : '') +
        '</div>' +
        (qids.length
          ? '<div style="display:flex;flex-direction:column;gap:6px">' + qRows + '</div>' +
            '<p class="kbd-hint">点题号行看答案与解析；「开始理论练习」按本节顺序答题，答完即时判分。</p>'
          : '<p class="muted">这一节的题目还在补。</p>') +
      '</div>';

    /* 5. 模拟实操 */
    const labsBlock =
      '<div class="block" id="sec-lab">' +
        '<div class="block-head"><h2>模拟实操</h2><span>按最终状态评分，命令写法不限</span></div>' +
        (labs.length
          ? (labFallback ? '<p class="gap-note" style="margin:0 0 10px">本节没有专属实验，下面是同一专题（' + esc(t.id) + '）的实验，可以先做着。</p>' : '') +
            '<div class="lab-grid">' + labs.map(labCard).join('') + '</div>'
          : '<div class="vempty">这一节暂时没有配套实验。可以先做理论题，等实验补齐再回来。</div>') +
      '</div>';

    /* 6. 测验与复盘 */
    const quiz =
      '<div class="block" id="sec-quiz">' +
        '<div class="block-head"><h2>小节测验与复盘</h2><span>覆盖本节全部题与实验</span></div>' +
        '<div class="scorebar">' +
          '<div class="score-num">' + Math.round(sp.coverage * 100) + '<small>%</small></div>' +
          '<div class="score-msg">' +
            '题目覆盖 ' + sp.done + '/' + sp.total +
            (sp.labs ? ' · 实验通过 ' + sp.labsPassed + '/' + sp.labs : '') +
            (sp.done ? ' · 正确率 ' + LP.pct(sp.rate) : '') +
            (sp.coverage >= 1 ? ' · 这一节已经走完一遍' : ' · 还没走完') +
          '</div>' +
          '<div class="action-row" style="margin:0">' +
            (qids.length ? '<button class="btn primary sm" data-act="start-section" data-sec="' + esc(sec.id) + '">开始测验</button>' : '') +
            (qids.length ? '<button class="btn ghost sm" data-act="start-section" data-sec="' + esc(sec.id) + '" data-only="weak">只练错题</button>' : '') +
            '<a class="btn ghost sm" href="#/wrong/weak">错题本</a>' +
          '</div>' +
        '</div>' +
      '</div>';

    /* 上/下一节 */
    const idx = t.sections.findIndex((x) => x.id === sec.id);
    const prev = idx > 0 ? t.sections[idx - 1] : null;
    const next = idx >= 0 && idx < t.sections.length - 1 ? t.sections[idx + 1] : null;
    const pager =
      '<div class="action-row" style="margin-top:18px">' +
        (prev ? '<a class="btn ghost sm" href="#/section/' + esc(prev.id) + '">← ' + esc(prev.title) + '</a>' : '') +
        '<a class="btn ghost sm" href="#/topic/' + esc(t.id) + '">回到 ' + esc(t.title) + '</a>' +
        (next ? '<a class="btn ghost sm" href="#/section/' + esc(next.id) + '">' + esc(next.title) + ' →</a>' : '') +
      '</div>';

    return (
      '<div class="crumb"><a href="#/">概览</a> / <a href="#/domain/' + esc(d.id) + '">' + esc(d.name) + '</a> / <a href="#/topic/' + esc(t.id) + '">' + esc(t.title) + '</a> / ' + esc(sec.id) + '</div>' +
      '<div class="sec-hero" style="border-left:3px solid ' + esc(d.accent) + '">' +
        '<div class="muted small">' + esc(sec.id) + ' · ' + esc(t.title) + ' · 约 ' + sec.minutes + ' 分钟' +
          (ready ? '' : ' · 内容待补') + '</div>' +
        '<h1>' + esc(sec.title) + '</h1>' +
        '<p>' + (sec.objectives && sec.objectives.length ? rich(sec.objectives[0]) : '') + '</p>' +
        '<div class="sec-flow">' +
          '<a class="flow-step" href="#sec-obj"><b>1</b> 学习目标</a>' +
          '<a class="flow-step" href="#sec-res"><b>2</b> 资料</a>' +
          '<a class="flow-step" href="#sec-note"><b>3</b> 文字补充</a>' +
          '<a class="flow-step" href="#sec-q"><b>4</b> 理论题</a>' +
          '<a class="flow-step" href="#sec-lab"><b>5</b> 实操</a>' +
          '<a class="flow-step" href="#sec-quiz"><b>6</b> 测验</a>' +
        '</div>' +
      '</div>' +
      objectives + resources + notes + questions + labsBlock + quiz + pager
    );
  };

  /* ---------------- 实验列表 ---------------- */

  V.labs = () => {
    const passed = LP.state.labs.filter((l) => (LP.labResult(l.id) || {}).passed).length;
    const groups = LP.state.catalog.domains
      .map((d) => {
        const list = LP.state.labs.filter((l) => l.domain === d.id);
        if (!list.length) return '';
        return (
          '<div class="section-head"><h2>' + esc(d.name) + '</h2><span class="muted">' + list.length + ' 个实验</span></div>' +
          '<div class="lab-grid">' + list.map(labCard).join('') + '</div>'
        );
      })
      .join('');

    return (
      '<div class="page-head"><h1>模拟实操</h1>' +
        '<p class="muted">共 ' + LP.state.labs.length + ' 个实验，已通过 ' + passed + ' 个。判分只看最终状态：同一目标用不同命令都算对。</p></div>' +
      '<div class="card">' +
        '<div class="facts wide">' +
          '<div><span>实验总数</span><b>' + LP.state.labs.length + ' 个</b></div>' +
          '<div><span>已通过</span><b>' + passed + ' 个</b></div>' +
          '<div><span>L1 引导模拟</span><b>' + LP.state.labs.filter((l) => l.level === 'L1').length + ' 个</b></div>' +
          '<div><span>L2 状态实验</span><b>' + LP.state.labs.filter((l) => l.level === 'L2').length + ' 个</b></div>' +
        '</div>' +
        '<p class="muted small">L1 是给定证据做判断；L2 是可操作的状态机模拟（终端 / SQL 控制台）。每个实验都能一键重置，随时重来。</p>' +
      '</div>' +
      groups
    );
  };

  /* ---------------- 实验运行 ---------------- */

  V.lab = (labId) => {
    const lab = LP.state.labById[labId];
    if (!lab) return '<div class="empty">没有找到这个实验。<a href="#/labs">返回实验列表</a></div>';
    const rec = LP.labResult(lab.id);
    const d = LP.state.domainById[lab.domain];

    const tasks = (lab.tasks || [])
      .map(
        (t, i) =>
          '<div class="task">' +
            '<span class="task-no">' + (i + 1) + '</span>' +
            '<span>' + rich(t.text) + '</span>' +
          '</div>'
      )
      .join('');

    const left =
      '<div class="lab-col">' +
        '<div class="lab-col-head">任务提示 <span class="muted">' +
          ((lab.tasks || []).length ? (lab.tasks || []).length + ' 步' : '按证据逐项判定') + '</span></div>' +
        '<div class="lab-col-body">' +
          '<div class="scenario">' + rich(lab.scenario) + '</div>' +
          tasks +
          (lab.objectives && lab.objectives.length
            ? '<div style="margin-top:12px"><div class="vgroup-label">这一题要练</div><ul class="objlist" style="margin-top:6px">' +
                lab.objectives.map((o) => '<li>' + rich(o) + '</li>').join('') + '</ul></div>'
            : '') +
        '</div>' +
      '</div>';

    let mid = '';
    if (lab.kind === 'audit') {
      const opts = (lab.options || [])
        .map((o) => '<span class="tag ghost">' + esc(o.id) + '. ' + esc(o.label) + '</span>')
        .join('');
      const items = (lab.items || [])
        .map((it) => {
          const chosen = E.auditAnswer(it.id);
          const buttons = (lab.options || [])
            .map(
              (o) =>
                '<button class="audit-opt' + (chosen === o.id ? ' on' : '') + '" data-act="lab-audit-opt" data-item="' + esc(it.id) + '" data-opt="' + esc(o.id) + '">' +
                  esc(o.id) + '. ' + esc(o.label) +
                '</button>'
            )
            .join('');
          return (
            '<div class="audit-item" data-item="' + esc(it.id) + '">' +
              '<div class="audit-head"><b>' + esc(it.name) + '</b></div>' +
              '<pre class="audit-ev">' + esc(it.evidence) + '</pre>' +
              '<div class="audit-opts">' + buttons + '</div>' +
            '</div>'
          );
        })
        .join('');
      mid =
        '<div class="lab-col">' +
          '<div class="lab-col-head">证据与判定 <span class="muted">选项：' + esc((lab.options || []).length) + ' 种处理方式</span></div>' +
          '<div class="lab-col-body">' +
            '<div class="gap-note" style="margin:0 0 10px">' + opts + '</div>' +
            items +
          '</div>' +
        '</div>';
    } else {
      const st = E.cur() ? E.cur().st : null;
      const host = st && st.host ? st.host : 'euler01';
      mid =
        '<div class="lab-col">' +
          '<div class="lab-col-head">' + (lab.kind === 'sql' ? 'gsql 控制台' : '终端') +
            ' <span class="muted">' + (lab.kind === 'sql' ? 'openGauss 7.0 语法子集' : '状态模拟，不连真实系统') + '</span></div>' +
          '<div class="lab-col-body" style="padding:10px">' +
            '<div class="term">' +
              '<div class="term-bar"><i class="r"></i><i class="y"></i><i class="g"></i><span>' + esc(host) + '</span></div>' +
              '<div class="term-out" id="term-out">' + termLogHtml() + '</div>' +
              '<div class="term-in-row">' +
                '<span class="term-ps" id="term-ps">' + esc(E.prompt()) + '</span>' +
                '<input class="term-in" id="term-in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' +
                  (lab.kind === 'sql' ? '输入 SQL 后回车，\\du 查看角色' : '输入命令后回车，help 查看帮助') + '">' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    const state =
      '<div class="lab-col state-col">' +
        '<div class="lab-col-head">状态面板 <span class="muted">判分依据</span></div>' +
        '<div class="lab-col-body" id="lab-state">' + stateHtml() + '</div>' +
      '</div>';

    return (
      '<div class="crumb"><a href="#/">概览</a> / <a href="#/labs">模拟实操</a> / ' + esc(lab.id) + '</div>' +
      '<div class="lab-top">' +
        '<div style="display:flex;align-items:flex-start;gap:10px;min-width:0">' +
          '<a class="icon-btn" href="#/labs" title="返回实验列表">←</a>' +
          '<div>' +
            '<h1>' + esc(lab.title) + '</h1>' +
            '<p>' + esc(lab.subtitle) + ' · ' + esc(LEVEL[lab.level] || lab.level) + ' · ' + esc(lab.version) + ' · 约 ' + esc(lab.minutes) + ' 分钟' +
              (rec ? ' · 最好成绩 ' + rec.best + ' 分' : '') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="right">' +
          '<button class="btn primary sm" data-act="lab-check">提交检查</button>' +
          '<button class="btn ghost sm" data-act="lab-diff">查看差异</button>' +
          '<button class="btn ghost sm" data-act="lab-hint">提示</button>' +
          '<button class="btn ghost sm" data-act="lab-solution">参考解法</button>' +
          '<button class="btn ghost sm" data-act="lab-reset">重置环境</button>' +
        '</div>' +
      '</div>' +
      '<div class="lab-wrap">' + left + mid + state + '</div>' +
      '<div id="lab-result"></div>'
    );
  };

  /* ---------------- 综合模拟配置 ---------------- */

  V.exam = (query) => {
    const prefs = LP.state.prefs;
    const want = query && query.get('d');
    const chosen = new Set(
      want && LP.state.domainById[want]
        ? [want]
        : prefs.examDomains && prefs.examDomains.length
          ? prefs.examDomains
          : LP.state.catalog.domains.map((d) => d.id)
    );

    const chips = LP.state.catalog.domains
      .map((d) => {
        const ds = LP.domainStats(LP.state.domainById[d.id]);
        return (
          '<button class="chip' + (chosen.has(d.id) ? ' on' : '') + '" data-act="exam-domain" data-domain="' + esc(d.id) + '" data-count="' + ds.total + '">' +
            esc(d.name) + ' <b>' + ds.total + '</b></button>'
        );
      })
      .join('');

    const countOpts = [10, 20, 30, 50, 88]
      .map((n) => '<option value="' + n + '"' + (prefs.examCount === n ? ' selected' : '') + '>' + n + ' 题</option>')
      .join('');
    const timeOpts = [[0, '不限时'], [10, '10 分钟'], [20, '20 分钟'], [30, '30 分钟'], [45, '45 分钟']]
      .map(([v, l]) => '<option value="' + v + '"' + (prefs.examMinutes === v ? ' selected' : '') + '>' + l + '</option>')
      .join('');

    const pool = LP.state.catalog.domains
      .filter((d) => chosen.has(d.id))
      .reduce((acc, d) => acc + LP.domainStats(LP.state.domainById[d.id]).total, 0);

    return (
      '<div class="page-head"><h1>综合模拟</h1>' +
        '<p class="muted">按域抽题、随机不重复、可限时。交卷后按域给出正确率，错题自动进错题本。</p></div>' +
      '<div class="card">' +
        '<div class="field">' +
          '<label>考试范围</label>' +
          '<div class="chips" id="exam-domains">' + chips + '</div>' +
          '<p class="muted small" id="exam-sum">已选 ' + chosen.size + ' 个域 · 可抽 ' + pool + ' 题</p>' +
        '</div>' +
        '<div class="field two">' +
          '<div><label>题量</label><select class="select" id="exam-count">' + countOpts + '</select></div>' +
          '<div><label>时间</label><select class="select" id="exam-time">' + timeOpts + '</select></div>' +
        '</div>' +
        '<div class="action-row">' +
          '<button class="btn primary" data-act="exam-start">开始模拟</button>' +
          '<a class="btn ghost" href="#/">返回概览</a>' +
          '<span class="muted small">建议先各域自测一次，再来综合。</span>' +
        '</div>' +
      '</div>' +
      '<div class="section-head"><h2>分域自测</h2></div>' +
      LP.state.catalog.domains
        .map((d, i) => {
          const ds = LP.domainStats(LP.state.domainById[d.id]);
          return (
            '<div class="stage-row">' +
              '<span class="stage-no">' + (i + 1) + '</span>' +
              '<div class="stage-main"><b>' + esc(d.name) + '</b><p>' + ds.total + ' 题 · 已做 ' + ds.done + ' · ' + (ds.done ? LP.pct(ds.rate) : '未开始') + '</p></div>' +
              '<a class="btn ghost sm" href="#/exam?d=' + esc(d.id) + '">只考这一域</a>' +
            '</div>'
          );
        })
        .join('')
    );
  };

  /* ---------------- 答题页 ---------------- */

  function examCard(session) {
    const answered = session.qids.filter((id) => (session.answers[id] || []).length).length;
    return (
      '<div class="cardbox" id="sheetbox">' +
        '<div class="cardbox-head"><h3>答题卡</h3><span class="muted">已答 ' + answered + '/' + session.qids.length + '</span></div>' +
        '<div class="sheet">' +
          session.qids
            .map((id, i) => {
              const done = (session.answers[id] || []).length > 0;
              const cls = 'sheet-cell' + (i === session.index ? ' cur' : '') + (done ? ' done' : '');
              return '<button class="' + cls + '" data-act="goto" data-index="' + i + '">' + (i + 1) + '</button>';
            })
            .join('') +
        '</div>' +
      '</div>'
    );
  }

  V.questionCard = (session) => {
    const qid = session.qids[session.index];
    const q = LP.state.qById[qid];
    if (!q) return '<div class="empty">题目不存在：' + esc(qid) + '</div>';
    const selected = session.answers[qid] || [];
    const isExam = session.mode === 'exam';
    const submitted = !isExam && !!session.submitted[qid];
    const rec = LP.getRecord(qid);
    const fav = rec && rec.favorite;
    const rev = rec && rec.needsReview;
    const correct = submitted ? LP.isCorrect(q, selected) : null;
    const topic = LP.state.topicById[q.topic_id];
    const sec = LP.state.sectionById[q.section_id];

    const footer =
      '<div class="qfoot">' +
        '<div class="qfoot-left">' +
          '<button class="chipbtn' + (fav ? ' on' : '') + '" data-act="fav">' + (fav ? '★ 已收藏' : '☆ 收藏') + '</button>' +
          '<button class="chipbtn' + (rev ? ' on' : '') + '" data-act="review">' + (rev ? '⚑ 已在待复习' : '⚑ 加入待复习') + '</button>' +
        '</div>' +
        '<div class="qfoot-right">' +
          '<button class="btn ghost sm" data-act="prev"' + (session.index === 0 ? ' disabled' : '') + '>上一题</button>' +
          (isExam
            ? '<button class="btn ghost sm" data-act="next"' + (session.index === session.qids.length - 1 ? ' disabled' : '') + '>下一题</button>' +
              '<button class="btn ghost sm" data-act="finish">交卷</button>'
            : submitted
              ? '<button class="btn primary sm" data-act="next">' + (session.index === session.qids.length - 1 ? '完成练习' : '下一题') + '</button>'
              : '<button class="btn primary sm" data-act="submit"' + (selected.length ? '' : ' disabled') + '>提交答案</button>') +
        '</div>' +
      '</div>';

    return (
      '<div class="qcard" id="qcard">' +
        '<div class="qhead">' +
          '<span class="qid">' + esc(q.id) + '</span>' +
          typeTag(q) +
          statusTag(q.id) +
        '</div>' +
        (isNegativeStem(q.stem) ? '<p class="qnote">注意：本题选错误项</p>' : '') +
        '<h2 class="stem" id="stem" tabindex="-1">' + rich(q.stem) + '</h2>' +
        '<div class="qmeta">' +
          '<span class="tag ghost">' + esc(topic ? topic.id + ' ' + topic.title : '') + '</span>' +
          (sec ? '<a class="tag ghost" href="#/section/' + esc(sec.id) + '">' + esc(sec.title) + '</a>' : '') +
          '<span class="tag ghost">' + esc(q.version) + '</span>' +
        '</div>' +
        (q.type === 'multiple'
          ? '<p class="hint">多选：完整选中全部正确项才计分' + (selected.length && !submitted ? ' · 已选 ' + selected.length + ' 项' : '') + '</p>'
          : '') +
        optionList(q, selected, submitted, submitted) +
        (submitted ? explainBlock(q, selected, correct) + footer : footer) +
        '<p class="kbd-hint">快捷键：A–D 选择 · Enter 提交/下一题 · ← → 翻页</p>' +
      '</div>'
    );
  };

  V.practice = () => {
    const s = LP.state.session;
    if (!s || !s.qids.length) {
      return '<div class="empty">还没有进行中的练习。<a href="#/">回到概览</a></div>';
    }
    const total = s.qids.length;
    const pct = Math.round(((s.index + 1) / total) * 100);
    const isExam = s.mode === 'exam';
    const timer = s.deadline
      ? '<span class="timer" id="timer">' + LP.fmtClock((s.deadline - Date.now()) / 1000) + '</span>'
      : '';

    return (
      '<div class="ptop">' +
        '<button class="icon-btn" data-act="exit" title="退出练习">←</button>' +
        '<div class="ptop-title">' +
          '<strong>' + esc(s.title) + '</strong>' +
          '<span>' + esc(MODE_LABEL[s.mode] || '练习') + '</span>' +
        '</div>' +
        '<div class="ptop-right">' +
          timer +
          '<span class="counter">' + (s.index + 1) + '<small>/' + total + '</small></span>' +
          (isExam ? '<button class="btn primary sm" data-act="finish">交卷</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
      V.questionCard(s) +
      (isExam ? examCard(s) : '')
    );
  };

  /* ---------------- 结果页 ---------------- */

  V.result = () => {
    const s = LP.state.session;
    if (!s || !s.results) return '<div class="empty">没有可查看的结果。<a href="#/">回到概览</a></div>';

    const qids = s.qids;
    const right = qids.filter((id) => s.results[id] && s.results[id].correct).length;
    const wrong = qids.filter((id) => s.results[id] && !s.results[id].correct);
    const rate = qids.length ? right / qids.length : 0;
    const used = (s.finishedAt || Date.now()) - s.startedAt;

    /* 按域拆分正确率 */
    const byDomain = {};
    qids.forEach((id) => {
      const q = LP.state.qById[id];
      if (!q) return;
      const d = q.domain;
      if (!byDomain[d]) byDomain[d] = { total: 0, right: 0 };
      byDomain[d].total += 1;
      if (s.results[id] && s.results[id].correct) byDomain[d].right += 1;
    });
    const domainRows = Object.keys(byDomain)
      .map((d) => {
        const x = byDomain[d];
        const name = LP.state.domainById[d] ? LP.state.domainById[d].name : d;
        return '<div class="dom-bar-row"><span>' + esc(name) + '</span>' + bar(x.right / x.total) + '<b>' + x.right + '/' + x.total + '</b></div>';
      })
      .join('');

    const wrongHtml = wrong.length
      ? wrong
          .map((id) => {
            const q = LP.state.qById[id];
            const sel = (s.results[id] && s.results[id].selected) || [];
            return (
              '<div class="review-item">' +
                '<div class="ri-head">' +
                  '<span class="qid">' + esc(q.id) + '</span>' + typeTag(q) +
                  '<span class="tag ghost">' + esc(q.cluster) + '</span>' +
                  '<span class="tag st-weak">错</span>' +
                '</div>' +
                '<h3 class="ri-stem">' + esc(plain(q.stem)) + '</h3>' +
                optionList(q, sel, true, true) +
                '<details class="exp-toggle"><summary>查看解析</summary>' + explainBlock(q, sel, false) + '</details>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="allright">全部答对，这一组已经很稳了。</div>';

    return (
      '<div class="result-hero">' +
        '<div class="ring" style="--p:' + Math.round(rate * 100) + '"><span>' + LP.pct(rate) + '</span></div>' +
        '<div class="rh-main">' +
          '<h1>练习完成</h1>' +
          '<p>' + esc(s.title) + ' · 共 ' + qids.length + ' 题 · 正确 ' + right + ' · 错误 ' + wrong.length + ' · 用时 ' + LP.fmtDuration(used) + '</p>' +
          '<div class="action-row">' +
            (wrong.length ? '<button class="btn primary" data-act="redo-wrong">只练这 ' + wrong.length + ' 道错题</button>' : '') +
            '<a class="btn ghost" href="#/wrong/weak">错题本</a>' +
            '<a class="btn ghost" href="#/">返回概览</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (domainRows ? '<div class="card" style="margin-top:14px"><div class="vgroup-label">分域表现</div><div class="dom-bars" style="margin-top:8px">' + domainRows + '</div></div>' : '') +
      '<div class="section-head"><h2>错题回顾</h2><span class="muted">点开每题查看解析与适用版本</span></div>' +
      wrongHtml
    );
  };

  /* ---------------- 错题与收藏 ---------------- */

  V.wrong = (tab) => {
    tab = tab || 'weak';
    const weakIds = LP.wrongIds();
    const reviewIds = LP.reviewIds();
    const favIds = LP.favoriteIds();
    const labFailed = LP.state.labs.filter((l) => {
      const r = LP.labResult(l.id);
      return r && !r.passed;
    });
    const labAll = LP.state.labs.filter((l) => LP.labResult(l.id));

    const tabs =
      '<div class="tabs">' +
        '<a class="tab' + (tab === 'weak' ? ' on' : '') + '" href="#/wrong/weak">错题 <b>' + weakIds.length + '</b></a>' +
        '<a class="tab' + (tab === 'review' ? ' on' : '') + '" href="#/wrong/review">待复习 <b>' + reviewIds.length + '</b></a>' +
        '<a class="tab' + (tab === 'fav' ? ' on' : '') + '" href="#/wrong/fav">收藏 <b>' + favIds.length + '</b></a>' +
        '<a class="tab' + (tab === 'labs' ? ' on' : '') + '" href="#/wrong/labs">实验记录 <b>' + labAll.length + '</b></a>' +
      '</div>';

    if (tab === 'labs') {
      const rows = labAll
        .map((l) => {
          const r = LP.labResult(l.id);
          return (
            '<a class="wrow" href="#/lab/' + esc(l.id) + '" style="text-decoration:none;color:inherit">' +
              '<div class="wrow-main">' +
                '<div class="wrow-meta">' +
                  '<span class="qid">' + esc(l.id) + '</span>' +
                  '<span class="tag ghost">' + esc(LEVEL[l.level] || l.level) + '</span>' +
                  '<span class="tag ghost">' + esc(l.title) + '</span>' +
                  '<span class="' + (r.passed ? 'tag st-mastered' : 'tag st-weak') + '">' + (r.passed ? '已通过' : '未通过') + '</span>' +
                  '<span class="muted">最好 ' + r.best + ' 分 · ' + r.attempts + ' 次 · ' + LP.fmtDate(r.at) + '</span>' +
                '</div>' +
                '<p class="wrow-stem">' + esc(l.subtitle) + '</p>' +
              '</div>' +
              '<div class="wrow-act"><span class="btn ghost xs">重做</span></div>' +
            '</a>'
          );
        })
        .join('');
      return (
        '<div class="page-head"><h1>错题与实验记录</h1><p class="muted">理论错题自动记录；实验按最好成绩保存，随时可以重做。</p></div>' +
        tabs +
        '<div class="action-row"><span class="muted">共 ' + labAll.length + ' 个实验做过，其中 ' + labFailed.length + ' 个还没通过。</span></div>' +
        (labAll.length
          ? '<div class="wlist">' + rows + '</div>'
          : '<div class="empty">还没有实验记录，去<a href="#/labs">模拟实操</a>做一个。</div>')
      );
    }

    const map = { weak: weakIds, review: reviewIds, fav: favIds };
    const ids = map[tab] || weakIds;
    const titleMap = { weak: '最近一次答错的题', review: '手动标记为待复习的题', fav: '收藏的题目' };

    const rows = ids
      .map((id) => {
        const q = LP.state.qById[id];
        const rec = LP.getRecord(id) || {};
        const topic = LP.state.topicById[q.topic_id];
        const flagBtn =
          tab === 'review'
            ? '<button class="btn ghost xs" data-act="unflag" data-flag="needsReview" data-qid="' + esc(id) + '">移出</button>'
            : tab === 'fav'
              ? '<button class="btn ghost xs" data-act="unflag" data-flag="favorite" data-qid="' + esc(id) + '">取消收藏</button>'
              : '';
        return (
          '<div class="wrow">' +
            '<div class="wrow-main">' +
              '<div class="wrow-meta">' +
                '<span class="qid">' + esc(q.id) + '</span>' + typeTag(q) +
                '<span class="tag ghost">' + esc(topic ? topic.title : '') + '</span>' +
                '<span class="muted">累计错 ' + (rec.wrongCount || 0) + ' 次 · ' + LP.fmtDate(rec.answeredAt) + '</span>' +
              '</div>' +
              '<p class="wrow-stem">' + esc(plain(q.stem)) + '</p>' +
            '</div>' +
            '<div class="wrow-act">' +
              '<button class="btn ghost xs" data-act="peek" data-qid="' + esc(id) + '">看解析</button>' +
              '<button class="btn xs" data-act="start-single" data-qid="' + esc(id) + '">重做</button>' +
              flagBtn +
            '</div>' +
          '</div>'
        );
      })
      .join('');

    return (
      '<div class="page-head"><h1>错题与收藏</h1><p class="muted">答错的题会自动进入错题；猜对但不踏实的题可以手动加入待复习。</p></div>' +
      tabs +
      '<div class="action-row">' +
        (ids.length ? '<button class="btn primary" data-act="start-set" data-set="' + tab + '">练习全部 ' + ids.length + ' 题</button>' : '') +
        '<span class="muted">' + esc(titleMap[tab] || '') + '</span>' +
      '</div>' +
      (ids.length ? '<div class="wlist">' + rows + '</div>' : '<div class="empty">这一类还是空的，去专题里练几道题吧。</div>')
    );
  };

  /* ---------------- 题库浏览 ---------------- */

  function browseFilter(topicId, st) {
    const kw = (st.q || '').trim().toLowerCase();
    let list = LP.state.questions;
    if (topicId && topicId !== 'all') list = list.filter((q) => q.topic_id === topicId);
    if (kw) {
      list = list.filter(
        (q) =>
          q.stem.toLowerCase().indexOf(kw) >= 0 ||
          (q.cluster || '').toLowerCase().indexOf(kw) >= 0 ||
          q.id.toLowerCase().indexOf(kw) >= 0 ||
          q.options.some((o) => o.text.toLowerCase().indexOf(kw) >= 0)
      );
    }
    if (st.status && st.status !== 'all') list = list.filter((q) => LP.statusOf(q.id) === st.status);
    return list;
  }
  V.browseList = browseFilter;

  V.browse = (topicId, bstate) => {
    const st = bstate || { topic: 'all', status: 'all', q: '', openSet: new Set() };
    const list = browseFilter(topicId, st);
    const openSet = st.openSet || new Set();
    const visible = list.slice(0, 400);
    const allOpen = visible.length > 0 && visible.every((q) => openSet.has(q.id));

    const topicOpts =
      '<option value="all"' + (st.topic === 'all' ? ' selected' : '') + '>全部专题</option>' +
      LP.state.topics
        .map((t) => '<option value="' + esc(t.id) + '"' + (st.topic === t.id ? ' selected' : '') + '>' + esc(t.id + ' ' + t.title) + '</option>')
        .join('');

    const chips = [
      ['all', '全部'],
      ['new', '未做'],
      ['weak', '薄弱'],
      ['shaky', '待巩固'],
      ['mastered', '已掌握'],
    ]
      .map(([k, label]) => '<button class="chip' + (st.status === k ? ' on' : '') + '" data-act="browse-status" data-status="' + k + '">' + label + '</button>')
      .join('');

    const rows = visible.map((q) => {
      const open = openSet.has(q.id);
      const rec = LP.getRecord(q.id);
      const sec = LP.state.sectionById[q.section_id];
      return (
        '<div class="brow' + (open ? ' open' : '') + '">' +
          '<button class="brow-head" data-act="browse-toggle" data-qid="' + esc(q.id) + '">' +
            statusDot(q.id) +
            '<span class="qid">' + esc(q.id) + '</span>' +
            typeTag(q) +
            '<span class="brow-stem">' + esc(plain(q.stem)) + '</span>' +
            '<span class="brow-tag">' + esc(q.cluster) + '</span>' +
            '<span class="caret">' + (open ? '▾' : '▸') + '</span>' +
          '</button>' +
          (open
            ? '<div class="brow-body">' +
                optionList(q, rec && rec.attempts ? rec.selected : [], true, true) +
                '<div class="explain ok plain">' +
                  '<div class="explain-head"><span class="ansline">正确答案 <b>' + esc(q.answer.join('、')) + '</b></span>' +
                  '<span class="muted">' + esc(q.version) + ' · ' + esc(q.difficulty) + '</span></div>' +
                  '<div class="explain-body"><p class="ana-t">' + rich(q.explain || '暂未写解析。') + '</p>' +
                  (sec ? '<div class="srcrow"><span>学习小节</span><div class="srcs"><a href="#/section/' + esc(sec.id) + '">' + esc(sec.title) + '</a></div></div>' : '') +
                  '</div>' +
                '</div>' +
                '<div class="brow-act">' +
                  '<button class="btn xs" data-act="start-single" data-qid="' + esc(q.id) + '">练这道题</button>' +
                  '<button class="btn ghost xs" data-act="fav-q" data-qid="' + esc(q.id) + '">' + (rec && rec.favorite ? '取消收藏' : '收藏') + '</button>' +
                  '<button class="btn ghost xs" data-act="review-q" data-qid="' + esc(q.id) + '">' + (rec && rec.needsReview ? '移出待复习' : '加入待复习') + '</button>' +
                '</div>' +
              '</div>'
            : '') +
        '</div>'
      );
    });

    return (
      '<div class="page-head"><h1>题库浏览</h1><p class="muted">共 ' + LP.state.questions.length + ' 题，当前筛选 ' + list.length + ' 题。展开可看答案与解析。</p></div>' +
      '<div class="filters">' +
        '<select class="select" id="browse-topic">' + topicOpts + '</select>' +
        '<input class="input" id="browse-search" type="search" placeholder="搜索题干、选项、题号" value="' + esc(st.q) + '">' +
        '<div class="chips">' + chips + '</div>' +
      '</div>' +
      '<div class="browse-bar">' +
        '<span class="muted small">' +
          (visible.length ? '当前 ' + visible.length + ' 题，已展开 ' + visible.filter((q) => openSet.has(q.id)).length + ' 题' : '没有符合条件的题目') +
        '</span>' +
        '<button class="btn ' + (allOpen ? 'primary' : 'ghost') + ' sm" data-act="browse-expand-all"' + (visible.length ? '' : ' disabled') + '>' +
          (allOpen ? '收起全部答案' : '显示全部答案') +
        '</button>' +
      '</div>' +
      '<div class="blist">' + (rows.length ? rows.join('') : '<div class="empty">没有符合条件的题目。</div>') + '</div>' +
      (list.length > 400 ? '<p class="muted center">仅显示前 400 条，请用搜索或筛选缩小范围。</p>' : '') +
      (visible.some((q) => openSet.has(q.id))
        ? '<div class="blist-foot">' +
            '<button class="btn ghost sm" data-act="browse-collapse-all">收起全部答案</button>' +
            '<button class="btn ghost sm" data-act="to-top">回到顶部</button>' +
          '</div>'
        : '')
    );
  };

  /* ---------------- 进度与数据 ---------------- */

  V.data = () => {
    const s = LP.globalStats();
    const b = LP.state.bank;
    const cat = LP.state.catalog;
    const storageOK = LP.storageTest();
    const nWrong = LP.wrongIds().length;
    const nFav = LP.favoriteIds().length;
    const nReview = LP.reviewIds().length;
    const labsPassed = LP.state.labs.filter((l) => (LP.labResult(l.id) || {}).passed).length;
    const resources = Object.keys(cat.resources || {}).map((id) => Object.assign({ id }, cat.resources[id]));
    const nVideo = resources.filter((r) => r.kind === 'video').length;
    const nVerified = resources.filter((r) => r.status === 'verified').length;
    const sections = cat.sections || [];
    const nReady = sections.filter((x) => x.status === 'ready').length;

    return (
      '<div class="page-head"><h1>进度与数据</h1><p class="muted">进度保存在当前浏览器本地。换设备或换域名不会自动同步，请用导出/导入迁移。</p></div>' +
      '<div class="stat-row">' +
        '<div class="stat"><span>已做</span><b>' + s.done + '</b></div>' +
        '<div class="stat"><span>正确率</span><b>' + LP.pct(s.rate) + '</b></div>' +
        '<div class="stat"><span>已掌握</span><b>' + s.mastered + '</b></div>' +
        '<div class="stat"><span>错题</span><b>' + nWrong + '</b></div>' +
        '<div class="stat"><span>收藏</span><b>' + nFav + '</b></div>' +
        '<div class="stat"><span>待复习</span><b>' + nReview + '</b></div>' +
      '</div>' +
      (storageOK
        ? '<div class="okline">本地存储可用，刷新后进度会自动恢复。</div>'
        : '<div class="warnline">当前浏览器禁止写入本地存储（可能是无痕模式或隐私设置）。进度只在本次会话有效，请及时导出。</div>') +
      '<div class="section-head"><h2>备份与迁移</h2></div>' +
      '<div class="data-grid">' +
        '<div class="card"><h3>导出进度</h3>' +
          '<p class="muted">下载 JSON 文件，含作答记录、错题次数、收藏、待复习与实验成绩。</p>' +
          '<button class="btn primary" data-act="export">导出进度 JSON</button></div>' +
        '<div class="card"><h3>导入进度</h3>' +
          '<p class="muted">合并到当前进度，不会清空已有记录。导入前会先预览影响范围。</p>' +
          '<label class="btn ghost file-btn">选择文件<input type="file" id="import-file" accept="application/json,.json"></label></div>' +
        '<div class="card danger"><h3>清空本机进度</h3>' +
          '<p class="muted">删除当前浏览器中的全部作答、收藏与实验成绩，不可撤销。</p>' +
          '<button class="btn danger" data-act="clear-all">清空全部记录</button></div>' +
      '</div>' +
      '<div class="section-head"><h2>内容台账</h2><span class="muted">资料来源、验收状态与实验覆盖</span></div>' +
      '<div class="card">' +
        '<div class="facts wide">' +
          '<div><span>学习小节</span><b>' + sections.length + ' 个（已成型 ' + nReady + '）</b></div>' +
          '<div><span>理论题</span><b>' + LP.state.questions.length + ' 道</b></div>' +
          '<div><span>模拟实操</span><b>' + LP.state.labs.length + ' 个（已通过 ' + labsPassed + '）</b></div>' +
          '<div><span>讲解资料</span><b>' + resources.length + ' 条（视频 ' + nVideo + '）</b></div>' +
          '<div><span>已人工验收</span><b>' + nVerified + ' / ' + resources.length + '</b></div>' +
          '<div><span>题库版本</span><b>' + esc(b.bank_version) + '</b></div>' +
        '</div>' +
        (nVerified < resources.length
          ? '<p class="warnline">还有 ' + (resources.length - nVerified) + ' 条资料未人工验收。未验收的资料只作候选，遇到与官方文档冲突以文档为准。</p>'
          : '<p class="okline">全部资料均已人工验收。</p>') +
        '<p class="muted small">资料台账见 docs/resources.md；实验说明见 docs/labs.md。</p>' +
      '</div>' +
      '<div class="section-head"><h2>数据说明</h2></div>' +
      '<div class="card">' +
        '<div class="facts wide">' +
          '<div><span>题库</span><b>' + esc(b.title) + '</b></div>' +
          '<div><span>结构版本</span><b>' + esc(b.schema_version) + '</b></div>' +
          '<div><span>更新日期</span><b>' + esc(b.updated_at) + '</b></div>' +
          '<div><span>域 / 专题</span><b>' + cat.stats.domains + ' / ' + cat.stats.topics + '</b></div>' +
        '</div>' +
        '<p class="muted small">' + esc(b.scope_note) + '</p>' +
      '</div>'
    );
  };

  /* ---------------- 解析浮层 ---------------- */

  V.peekHtml = (qid) => {
    const q = LP.state.qById[qid];
    if (!q) return '';
    const rec = LP.getRecord(qid);
    const sel = rec && rec.attempts ? rec.selected : [];
    const sec = LP.state.sectionById[q.section_id];
    return (
      '<div class="peek-card">' +
        '<div class="qhead"><span class="qid">' + esc(q.id) + '</span>' + typeTag(q) +
          '<span class="tag ghost">' + esc(q.cluster) + '</span>' +
          '<button class="icon-btn right" data-act="close-peek">✕</button></div>' +
        (isNegativeStem(q.stem) ? '<p class="qnote">注意：本题选错误项</p>' : '') +
        '<h2 class="stem">' + rich(q.stem) + '</h2>' +
        optionList(q, sel, true, true) +
        explainBlock(q, sel, rec && rec.attempts ? !!rec.correct : null) +
        (sec ? '<div class="action-row"><a class="btn ghost sm" href="#/section/' + esc(sec.id) + '">去这一节学</a>' +
          '<button class="btn xs" data-act="start-single" data-qid="' + esc(qid) + '">练这道题</button></div>' : '') +
      '</div>'
    );
  };

  /* ---------------- 实验页的小工具（app.js 也会用） ---------------- */

  function termLogHtml() {
    return E.log()
      .map((l) => '<div' + (l.cls ? ' class="' + l.cls + '"' : '') + '>' + esc(l.text) + '</div>')
      .join('');
  }

  function stateHtml() {
    const groups = E.stateView();
    if (!groups.length) return '<p class="muted small">还没有状态。</p>';
    return groups
      .map(
        (g) =>
          '<div class="state-group"><h5>' + esc(g.title) + '</h5>' +
          g.rows
            .map(
              (r) =>
                '<div class="state-row' + (r.sub ? ' has-sub' : '') + '">' +
                  '<span title="' + esc(r.k) + '">' + esc(r.k) + '</span>' +
                  '<b class="' + (r.cls || '') + '">' + esc(r.v) + '</b>' +
                  (r.sub ? '<em class="' + (r.cls || '') + '">' + esc(r.sub) + '</em>' : '') +
                '</div>'
            )
            .join('') +
          '</div>'
      )
      .join('');
  }

  V.termLogHtml = termLogHtml;
  V.stateHtml = stateHtml;
})();
