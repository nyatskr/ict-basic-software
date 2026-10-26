/* app.js — 路由、会话、实验交互、导入导出 */
(function () {
  'use strict';

  const LP = window.LP;
  const E = LP.labEngine;
  const V = LP.views;
  const $ = (sel) => document.querySelector(sel);

  const browseState = { topic: 'all', status: 'all', q: '', openSet: new Set() };
  let timerId = null;
  let lastRouteKey = '';

  /* ---------------- 路由 ---------------- */

  function parseHash() {
    const raw = (location.hash || '#/').replace(/^#/, '');
    const qi = raw.indexOf('?');
    const path = qi >= 0 ? raw.slice(0, qi) : raw;
    const query = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    return { parts, query, key: raw };
  }

  function render() {
    const { parts, query, key } = parseHash();
    const app = $('#app');
    if (!app) return;
    const route = parts[0] || 'home';
    const keyChanged = key !== lastRouteKey;
    let html = '';

    if (route === 'home') {
      html = V.dashboard();
    } else if (route === 'domain') {
      html = V.domain(parts[1]);
    } else if (route === 'topic') {
      html = V.topic(parts[1]);
    } else if (route === 'section') {
      html = V.section(parts[1]);
    } else if (route === 'labs') {
      html = V.labs();
    } else if (route === 'lab') {
      if (parts[1] && LP.state.labById[parts[1]]) E.open(parts[1]);
      html = V.lab(parts[1]);
    } else if (route === 'exam') {
      html = V.exam(query);
    } else if (route === 'practice') {
      html = V.practice();
    } else if (route === 'result') {
      html = V.result();
    } else if (route === 'wrong') {
      html = V.wrong(parts[1] || 'weak');
    } else if (route === 'browse') {
      if (keyChanged) browseState.topic = parts[1] && parts[1] !== 'all' ? parts[1] : 'all';
      html = V.browse(browseState.topic, browseState);
    } else if (route === 'data') {
      html = V.data();
    } else {
      html = '<div class="empty">页面不存在。<a href="#/">返回概览</a></div>';
    }

    app.innerHTML = html;

    if (keyChanged) {
      window.scrollTo(0, 0);
      lastRouteKey = key;
    }

    afterRender(route);
    updateChrome(route);
  }

  function afterRender(route) {
    stopTimer();
    document.title =
      route === 'practice'
        ? '答题 · 基础软件赛道学习平台'
        : route === 'lab'
          ? '模拟实操 · 基础软件赛道学习平台'
          : '基础软件赛道学习平台';

    if (route === 'practice') {
      const s = LP.state.session;
      if (s && s.deadline && !s.finished) startTimer();
    }

    if (route === 'lab') bindTerminal();

    if (route === 'exam') bindExamForm();

    if (route === 'browse') {
      const sel = $('#browse-topic');
      if (sel) {
        sel.addEventListener('change', () => {
          browseState.topic = sel.value;
          render();
        });
      }
      const input = $('#browse-search');
      if (input) {
        let t = null;
        input.addEventListener('input', () => {
          clearTimeout(t);
          const val = input.value;
          t = setTimeout(() => {
            browseState.q = val;
            render();
            const again = $('#browse-search');
            if (again) {
              again.focus();
              again.setSelectionRange(again.value.length, again.value.length);
            }
          }, 220);
        });
      }
    }

    if (route === 'data') {
      const file = $('#import-file');
      if (file) file.addEventListener('change', onImportFile);
    }
  }

  function updateChrome(route) {
    const s = LP.globalStats();
    const done = $('#side-done');
    const total = $('#side-total');
    const barEl = $('#side-bar');
    if (done) done.textContent = s.done;
    if (total) total.textContent = s.total;
    if (barEl) barEl.style.width = Math.round((s.done / Math.max(1, s.total)) * 100) + '%';

    const { parts } = parseHash();
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const nav = el.getAttribute('data-nav');
      let on = false;
      if (nav === route) on = true;
      // 域页高亮对应域；专题页 / 小节页不猜域，避免误亮
      if (nav.indexOf('domain-') === 0) on = parts[0] === 'domain' && nav === 'domain-' + parts[1];
      el.classList.toggle('on', on);
    });
  }

  /* ---------------- 计时 ---------------- */

  function startTimer() {
    tick();
    timerId = setInterval(tick, 500);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function tick() {
    const s = LP.state.session;
    const el = $('#timer');
    if (!s || !s.deadline) return;
    const left = (s.deadline - Date.now()) / 1000;
    if (el) {
      el.textContent = LP.fmtClock(left);
      el.classList.toggle('urgent', left <= 60);
    }
    if (left <= 0) {
      stopTimer();
      LP.toast('时间到，已自动交卷', 'warn');
      finishExam(true);
    }
  }

  /* ---------------- 会话 ---------------- */

  function startSession(opts) {
    if (!opts.qids.length) {
      LP.toast('没有符合条件的题目', 'warn');
      return;
    }
    LP.state.session = {
      id: LP.uid(),
      mode: opts.mode,
      title: opts.title,
      qids: opts.qids.slice(),
      index: 0,
      answers: {},
      submitted: {},
      startedAt: Date.now(),
      deadline: opts.deadline || null,
      config: opts.config || null,
      results: null,
      finished: false,
    };
    LP.saveSession();
    go('#/practice');
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function currentQid() {
    const s = LP.state.session;
    return s ? s.qids[s.index] : null;
  }

  /* 翻题后统一把视线拉回题干 */
  function focusStem() {
    const el = document.getElementById('stem');
    if (!el) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const offset = window.innerWidth <= 860 ? 64 : 24;
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    try {
      el.focus({ preventScroll: true });
    } catch (e) { /* 忽略 */ }
  }

  function refreshCard() {
    const s = LP.state.session;
    const card = $('#qcard');
    if (!s || !card) return;
    const holder = document.createElement('div');
    holder.innerHTML = V.questionCard(s);
    const fresh = holder.firstElementChild;
    if (fresh) card.replaceWith(fresh);
    const sheet = $('#sheetbox');
    if (sheet) {
      const answered = s.qids.filter((id) => (s.answers[id] || []).length).length;
      const meta = sheet.querySelector('.cardbox-head .muted');
      if (meta) meta.textContent = '已答 ' + answered + '/' + s.qids.length;
      sheet.querySelectorAll('.sheet-cell').forEach((cell, i) => {
        const id = s.qids[i];
        cell.classList.toggle('done', (s.answers[id] || []).length > 0);
        cell.classList.toggle('cur', i === s.index);
      });
    }
  }

  function toggleOption(id) {
    const s = LP.state.session;
    if (!s) return;
    const qid = currentQid();
    const q = LP.state.qById[qid];
    if (!q) return;
    if (s.mode !== 'exam' && s.submitted[qid]) return;

    let sel = (s.answers[qid] || []).slice();
    if (q.type === 'single') {
      sel = sel[0] === id ? [] : [id];
    } else if (sel.indexOf(id) >= 0) {
      sel = sel.filter((x) => x !== id);
    } else {
      sel = sel.concat(id).sort();
    }
    s.answers[qid] = sel;
    LP.saveSession();
    refreshCard();
  }

  function submitCurrent() {
    const s = LP.state.session;
    if (!s) return;
    const qid = currentQid();
    const q = LP.state.qById[qid];
    const sel = s.answers[qid] || [];
    if (!q || !sel.length) return;
    const ok = LP.isCorrect(q, sel);
    LP.applyAnswer(qid, sel, ok);
    s.submitted[qid] = true;
    LP.saveSession();
    refreshCard();
    const ex = document.querySelector('.explain');
    if (ex) ex.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function nextQuestion() {
    const s = LP.state.session;
    if (!s) return;
    if (s.index >= s.qids.length - 1) {
      if (s.mode === 'exam') return finishExam();
      return finishPractice();
    }
    s.index += 1;
    LP.saveSession();
    render();
    focusStem();
  }

  function prevQuestion() {
    const s = LP.state.session;
    if (!s || s.index === 0) return;
    s.index -= 1;
    LP.saveSession();
    render();
    focusStem();
  }

  function finishPractice() {
    const s = LP.state.session;
    if (!s) return;
    const results = {};
    s.qids.forEach((id) => {
      if (s.submitted[id]) {
        results[id] = { selected: s.answers[id] || [], correct: LP.isCorrect(LP.state.qById[id], s.answers[id] || []) };
      }
    });
    s.results = results;
    s.finished = true;
    s.finishedAt = Date.now();
    LP.saveSession();
    go('#/result');
  }

  function finishExam(silent) {
    const s = LP.state.session;
    if (!s) return;
    const unanswered = s.qids.filter((id) => !(s.answers[id] || []).length).length;
    if (!silent && unanswered > 0) {
      openModal(
        '<h3>还有 ' + unanswered + ' 题未作答</h3>' +
          '<p class="muted">未作答的题会记为错误。确定现在交卷吗？</p>' +
          '<div class="modal-act"><button class="btn ghost" data-act="close-modal">继续答题</button>' +
          '<button class="btn primary" data-act="confirm-finish">确定交卷</button></div>'
      );
      return;
    }
    const results = {};
    s.qids.forEach((id) => {
      const sel = s.answers[id] || [];
      const ok = LP.isCorrect(LP.state.qById[id], sel);
      results[id] = { selected: sel, correct: ok };
      if (sel.length) {
        LP.applyAnswer(id, sel, ok);
      } else {
        const rec = LP.ensureRecord(id);
        rec.selected = [];
        rec.correct = false;
        rec.answeredAt = Date.now();
        rec.attempts = (rec.attempts || 0) + 1;
        rec.wrongCount = (rec.wrongCount || 0) + 1;
      }
    });
    LP.saveProgress();
    s.results = results;
    s.finished = true;
    s.finishedAt = Date.now();
    LP.saveSession();
    closeModal();
    go('#/result');
  }

  /* ---------------- 启动练习 ---------------- */

  function startSection(sectionId, only) {
    const sec = LP.state.sectionById[sectionId];
    if (!sec) return;
    let qids = LP.sectionQids(sec);
    if (only === 'new') qids = qids.filter((id) => LP.statusOf(id) === 'new');
    if (only === 'weak') qids = qids.filter((id) => LP.statusOf(id) === 'weak');
    startSession({ mode: 'section', title: sec.id + ' ' + sec.title, qids });
  }

  function startTopic(topicId, only) {
    const t = LP.state.topicById[topicId];
    if (!t) return;
    let qids = t.qids.slice();
    if (only === 'new') qids = qids.filter((id) => LP.statusOf(id) === 'new');
    if (only === 'weak') qids = qids.filter((id) => LP.statusOf(id) === 'weak');
    startSession({
      mode: 'topic',
      title: t.id + ' ' + t.title + (only === 'new' ? ' · 未做' : only === 'weak' ? ' · 错题' : ''),
      qids,
    });
  }

  function startSet(kind) {
    const map = { weak: LP.wrongIds(), review: LP.reviewIds(), fav: LP.favoriteIds() };
    const ids = map[kind] || [];
    const label = { weak: '错题练习', review: '待复习', fav: '收藏练习' }[kind] || '练习';
    startSession({ mode: kind === 'weak' ? 'wrong' : kind, title: label + ' · ' + ids.length + ' 题', qids: ids });
  }

  function startSingle(qid) {
    startSession({ mode: 'single', title: '单题 · ' + qid, qids: [qid] });
  }

  /* ---------------- 综合模拟 ---------------- */

  function bindExamForm() {
    const box = $('#exam-domains');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="exam-domain"]');
      if (!b) return;
      b.classList.toggle('on');
      const on = Array.from(box.querySelectorAll('.chip.on'));
      const n = on.reduce((a, c) => a + (parseInt(c.getAttribute('data-count'), 10) || 0), 0);
      const sum = $('#exam-sum');
      if (sum) sum.textContent = '已选 ' + on.length + ' 个域 · 可抽 ' + n + ' 题';
    });
  }

  function beginExam() {
    const chips = Array.from(document.querySelectorAll('#exam-domains .chip.on'));
    const domainIds = chips.map((c) => c.getAttribute('data-domain'));
    if (!domainIds.length) {
      LP.toast('至少选择一个域', 'warn');
      return;
    }
    const count = parseInt($('#exam-count').value, 10) || 20;
    const minutes = parseInt($('#exam-time').value, 10) || 0;

    let pool = [];
    domainIds.forEach((id) => {
      const d = LP.state.domainById[id];
      if (d) d.topics.forEach((t) => (pool = pool.concat(t.qids)));
    });
    if (!pool.length) {
      LP.toast('所选域没有题目', 'warn');
      return;
    }
    const pick = Math.min(count, pool.length);
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    LP.state.prefs.examCount = count;
    LP.state.prefs.examMinutes = minutes;
    LP.state.prefs.examDomains = domainIds;
    LP.savePrefs();

    startSession({
      mode: 'exam',
      title: '综合模拟 · ' + pick + ' 题' + (minutes ? ' · ' + minutes + ' 分钟' : ''),
      qids: shuffled.slice(0, pick),
      deadline: minutes ? Date.now() + minutes * 60000 : null,
      config: { domainIds, count: pick, minutes },
    });
  }

  /* ---------------- 实验页交互 ---------------- */

  function bindTerminal() {
    const input = $('#term-in');
    if (!input) return;
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const line = input.value;
        input.value = '';
        runLine(line);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const v = E.historyUp();
        if (v != null) input.value = v;
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const v = E.historyDown();
        input.value = v || '';
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        const out = $('#term-out');
        if (out) out.innerHTML = '';
      }
    });
    const term = input.closest('.term');
    if (term) {
      term.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') input.focus();
      });
    }
    const out = $('#term-out');
    if (out) out.scrollTop = out.scrollHeight;
  }

  function appendEntries(list) {
    const out = $('#term-out');
    if (!out) return;
    list.forEach((l) => {
      const div = document.createElement('div');
      if (l.cls) div.className = l.cls;
      div.textContent = l.text;
      out.appendChild(div);
    });
    out.scrollTop = out.scrollHeight;
  }

  function runLine(line) {
    const res = E.exec(line);
    if (!res.length) return;
    appendEntries(res);
    const ps = $('#term-ps');
    if (ps) ps.textContent = E.prompt();
    refreshState();
  }

  function refreshState() {
    const el = $('#lab-state');
    if (el) el.innerHTML = V.stateHtml();
  }

  function labCheck() {
    const cur = E.cur();
    if (!cur) return;
    const r = E.check();
    if (!r) return;
    const lab = cur.lab;
    LP.recordLab(lab.id, r.score, r.passed);

    const rows = r.items
      .map((it) => {
        const extra = lab.kind === 'audit' && it.chosen
          ? ' <span class="muted small">（你选了 ' + LP.esc(it.chosen) + '，正确 ' + LP.esc(it.answer) + '）</span>'
          : '';
        return (
          '<div class="vrow ' + (it.pass ? 'pass' : 'fail') + '">' +
            '<span class="vrow-ico">' + (it.pass ? '✓' : '✗') + '</span>' +
            '<span class="vrow-label">' + LP.esc(it.label) + extra + '</span>' +
            '<span class="vrow-w">' + it.weight + ' 分</span>' +
          '</div>'
        );
      })
      .join('');

    const msg = r.passed
      ? '通过。最终状态符合要求，命令怎么写不影响判分。'
      : '还没通过（≥80 分算通过）。看下面没打勾的项，对照左侧任务再改一次；状态面板会实时反映改动。';

    const html =
      '<div class="scorebar">' +
        '<div class="score-num">' + r.score + '<small> 分</small></div>' +
        '<div class="score-msg">' + LP.esc(msg) + '</div>' +
        '<div class="action-row" style="margin:0">' +
          (r.passed ? '<a class="btn primary sm" href="#/labs">下一个实验</a>' : '') +
          '<button class="btn ghost sm" data-act="lab-reset">重置重做</button>' +
        '</div>' +
      '</div>' +
      '<div class="vlist">' + rows + '</div>';

    const box = $('#lab-result');
    if (box) box.innerHTML = html;

    /* 审计型：逐项展开为什么 */
    if (lab.kind === 'audit') {
      r.items.forEach((it) => {
        const item = document.querySelector('.audit-item[data-item="' + it.id + '"]');
        if (!item) return;
        item.classList.toggle('pass', it.pass);
        item.classList.toggle('fail', !it.pass);
        let why = item.querySelector('.audit-why');
        if (!why) {
          why = document.createElement('div');
          why.className = 'audit-why';
          item.appendChild(why);
        }
        why.innerHTML = '<b>' + (it.pass ? '判断正确' : '判断有误') + '：</b>' + LP.esc(it.why || '');
      });
    }

    if (r.passed) LP.toast('实验通过：' + r.score + ' 分');
    else LP.toast('得分 ' + r.score + '，还没到 80 分', 'warn');
    refreshState();
  }

  function labHint() {
    const cur = E.cur();
    if (!cur) return;
    const hints = cur.lab.hints || [];
    if (!hints.length) {
      LP.toast('这个实验没有提示');
      return;
    }
    const next = E.hintsUsed();
    if (next >= hints.length) {
      LP.toast('提示已经全部给出');
    } else {
      E.hint(next);
    }
    const shown = hints.slice(0, E.hintsUsed());
    const box = $('#lab-result');
    if (box) {
      box.innerHTML =
        '<div class="block" style="margin-top:14px"><div class="block-head"><h2>提示</h2><span>共 ' + hints.length + ' 条，已看 ' + shown.length + ' 条</span></div>' +
        '<div class="hintlist">' +
        shown.map((h, i) => '<div class="hintitem"><b>提示 ' + (i + 1) + '：</b>' + LP.rich(h.text) + '</div>').join('') +
        '</div></div>';
    }
  }

  function labSolution() {
    const cur = E.cur();
    if (!cur) return;
    const lab = cur.lab;
    const sol = lab.solution || [];
    openModal(
      '<h3>参考解法</h3>' +
        '<p class="muted">' + LP.esc(lab.title) + ' · 这只是其中一种写法，判分只看最终状态。</p>' +
        (sol.length
          ? '<div class="solution"><code>' + LP.esc(sol.join('\n')) + '</code></div>'
          : '<p class="muted">这个实验是判断题，没有命令解法。逐项对照证据看「为什么」即可。</p>') +
        '<div class="modal-act"><button class="btn ghost" data-act="close-modal">关闭</button></div>',
      { wide: true }
    );
  }

  /* 状态差异：把 initial_state 与当前状态都拍平成 路径 → 值 */
  function flatten(obj, prefix, out) {
    if (obj == null) return out;
    if (typeof obj !== 'object') {
      out[prefix] = String(obj);
      return out;
    }
    if (Array.isArray(obj)) {
      out[prefix] = obj.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
      return out;
    }
    Object.keys(obj).forEach((k) => flatten(obj[k], prefix ? prefix + '.' + k : k, out));
    return out;
  }

  function labDiff() {
    const cur = E.cur();
    if (!cur) return;
    const before = flatten(cur.lab.initial_state || {}, '', {});
    const after = flatten(cur.st, '', {});
    const keys = Object.keys(after).sort();
    const rows = [];
    keys.forEach((k) => {
      const a = before[k];
      const b = after[k];
      if (a === b) return;
      rows.push(
        '<div class="state-row"><span title="' + LP.esc(k) + '">' + LP.esc(k) + '</span>' +
          '<b>' + (a == null ? '<span class="muted">—</span>' : LP.esc(a)) + ' → ' + LP.esc(b) + '</b></div>'
      );
    });
    if (cur.lab.kind === 'audit') {
      const n = Object.keys(cur.audit).length;
      rows.push('<div class="state-row"><span>已判定项</span><b>' + n + ' / ' + (cur.lab.items || []).length + '</b></div>');
    }
    openModal(
      '<h3>当前状态与初始状态的差异</h3>' +
        '<p class="muted">判分只看「现在」，不看「过程」。下面只列出发生过变化的字段。</p>' +
        (rows.length ? '<div class="vlist" style="margin-top:0">' + rows.slice(0, 80).join('') + '</div>' : '<div class="empty">还没有任何变化。</div>') +
        (rows.length > 80 ? '<p class="muted small">仅显示前 80 项。</p>' : '') +
        '<div class="modal-act"><button class="btn ghost" data-act="close-modal">关闭</button></div>',
      { wide: true }
    );
  }

  function labReset() {
    const cur = E.cur();
    if (!cur) return;
    E.reset();
    render();
    LP.toast('环境已重置');
  }

  /* ---------------- 弹层 ---------------- */

  function openModal(html, opts) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.id = 'modal';
    wrap.innerHTML = '<div class="modal' + (opts && opts.wide ? ' wide' : '') + '">' + html + '</div>';
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) closeModal();
    });
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    const el = $('#modal');
    if (el) el.remove();
    document.body.classList.remove('modal-open');
  }

  /* 账号核对面板里的云端条数：单独异步填，免得弹窗卡在网络上 */
  async function fillCloudCount() {
    const el = document.getElementById('diag-cloud-count');
    if (!el) return;
    if (!LP.cloud || !LP.cloud.isSignedIn()) {
      el.textContent = '未登录';
      return;
    }
    el.textContent = '查询中…';
    try {
      const n = await LP.cloud.countCloud();
      el.textContent = n.records + ' 条记录 · ' + n.labs + ' 个实验';
    } catch (e) {
      el.textContent = '查询失败：' + (e && e.message ? e.message : e);
    }
  }

  /* 登录后第一次进来：询问是否把本机未登录记录并进账号 */
  function maybePromptMigration() {
    if (!LP.cloud) return;
    const info = LP.cloud.migrationInfo();
    if (!info) return;
    openModal(
      '<h3>把本机记录合并到账号？</h3>' +
        '<p class="muted">检测到本机已有 <b>' + info.count + '</b> 条未登录记录（含实验成绩）。合并后与云端记录取并集：同一题保留最近一次作答，错误次数取较大值。</p>' +
        '<p class="muted small">选择「不合并」时，本机记录仍留在这台设备上，但不会进入云端。</p>' +
        '<div class="modal-act"><button class="btn ghost" data-act="cloud-skip-migrate">不合并</button>' +
        '<button class="btn primary" data-act="cloud-migrate">合并到云端</button></div>'
    );
  }

  /* ---------------- 导入导出 ---------------- */

  function exportProgress() {
    const payload = LP.exportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name =
      'ict-progress-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    LP.toast('已导出 ' + payload.records.length + ' 条记录');
  }

  function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data = null;
      try {
        data = JSON.parse(String(reader.result));
      } catch (err) {
        LP.toast('文件不是有效的 JSON', 'warn');
        return;
      }
      previewImport(data, file.name);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  function previewImport(data, fileName) {
    const records = Array.isArray(data) ? data : data && data.records;
    if (!Array.isArray(records)) {
      LP.toast('文件里没有 records 数组，可能不是本网站的进度文件', 'warn');
      return;
    }
    let added = 0, updated = 0, skipped = 0, badOption = 0;
    records.forEach((rec) => {
      if (!rec || !rec.qid || !LP.state.qById[rec.qid]) {
        skipped++;
        return;
      }
      const q = LP.state.qById[rec.qid];
      const valid = new Set(q.options.map((o) => o.id));
      const sel = Array.isArray(rec.selected) ? rec.selected : [];
      if (sel.some((id) => !valid.has(id))) badOption++;
      if (!LP.state.progress.records[rec.qid]) added++;
      else updated++;
    });
    const labs = (data && data.labs) || {};

    openModal(
      '<h3>导入预览</h3>' +
        '<p class="muted">文件：' + LP.esc(fileName) + (data.bankVersion ? ' · 题库版本 ' + LP.esc(data.bankVersion) : '') + '</p>' +
        '<div class="import-stats">' +
          '<div><b>' + added + '</b><span>新增记录</span></div>' +
          '<div><b>' + updated + '</b><span>合并更新</span></div>' +
          '<div><b>' + skipped + '</b><span>跳过（题号不存在）</span></div>' +
          '<div><b>' + Object.keys(labs).length + '</b><span>实验成绩</span></div>' +
        '</div>' +
        (badOption ? '<p class="warnline">有 ' + badOption + ' 条记录的选项 ID 与当前题库不匹配，这些选项会被忽略。</p>' : '') +
        '<p class="muted small">导入只做合并，不会清空现有进度；同一题保留最近一次的作答结果，累计错误次数取较大值。</p>' +
        '<div class="modal-act"><button class="btn ghost" data-act="close-modal">取消</button>' +
        '<button class="btn primary" data-act="confirm-import">确认导入</button></div>',
      { wide: true }
    );
    window.__pendingImport = { records, labs };
  }

  function doImport() {
    const pending = window.__pendingImport;
    if (!pending || !Array.isArray(pending.records)) return closeModal();
    let added = 0, updated = 0, skipped = 0;
    pending.records.forEach((rec) => {
      const q = rec && rec.qid ? LP.state.qById[rec.qid] : null;
      if (!q) {
        skipped++;
        return;
      }
      const valid = new Set(q.options.map((o) => o.id));
      const sel = (Array.isArray(rec.selected) ? rec.selected : []).filter((id) => valid.has(id));
      const cur = LP.state.progress.records[rec.qid];
      if (!cur) {
        LP.state.progress.records[rec.qid] = {
          qid: rec.qid,
          bankVersion: rec.bankVersion || '',
          selected: sel,
          correct: !!rec.correct,
          answeredAt: rec.answeredAt || 0,
          attempts: rec.attempts || (rec.answeredAt ? 1 : 0),
          wrongCount: rec.wrongCount || 0,
          favorite: !!rec.favorite,
          needsReview: !!rec.needsReview,
        };
        added++;
      } else {
        if ((rec.answeredAt || 0) > (cur.answeredAt || 0)) {
          cur.selected = sel;
          cur.correct = !!rec.correct;
          cur.answeredAt = rec.answeredAt || 0;
          cur.bankVersion = rec.bankVersion || cur.bankVersion;
        }
        cur.attempts = Math.max(cur.attempts || 0, rec.attempts || 0);
        cur.wrongCount = Math.max(cur.wrongCount || 0, rec.wrongCount || 0);
        cur.favorite = cur.favorite || !!rec.favorite;
        cur.needsReview = cur.needsReview || !!rec.needsReview;
        updated++;
      }
    });

    let labMerged = 0;
    Object.keys(pending.labs || {}).forEach((id) => {
      if (!LP.state.labById[id]) return;
      const inc = pending.labs[id] || {};
      const cur = LP.state.progress.labs[id] || { attempts: 0, best: 0, passed: false, at: 0 };
      cur.attempts = Math.max(cur.attempts || 0, inc.attempts || 0);
      cur.best = Math.max(cur.best || 0, inc.best || 0);
      cur.passed = cur.passed || !!inc.passed;
      cur.at = Math.max(cur.at || 0, inc.at || 0);
      LP.state.progress.labs[id] = cur;
      labMerged++;
    });

    LP.saveProgress();
    window.__pendingImport = null;
    closeModal();
    render();
    LP.toast('已导入：新增 ' + added + ' 条，合并 ' + updated + ' 条，实验 ' + labMerged + ' 个，跳过 ' + skipped + ' 条');
  }

  /* ---------------- 事件 ---------------- */

  const actions = {
    resume: () => go('#/practice'),
    'drop-session': () => {
      LP.clearSession();
      render();
      LP.toast('已放弃上次练习');
    },

    /* 练习 */
    opt: (el) => toggleOption(el.getAttribute('data-id')),
    submit: () => submitCurrent(),
    next: () => nextQuestion(),
    prev: () => prevQuestion(),
    finish: () => finishExam(false),
    'confirm-finish': () => finishExam(true),
    goto: (el) => {
      const s = LP.state.session;
      if (!s) return;
      s.index = parseInt(el.getAttribute('data-index'), 10) || 0;
      LP.saveSession();
      render();
      focusStem();
    },
    exit: () => {
      const s = LP.state.session;
      if (s && s.mode === 'exam' && !s.finished) {
        openModal(
          '<h3>退出综合模拟？</h3><p class="muted">本次作答会保留为未完成状态，可以从概览继续。</p>' +
            '<div class="modal-act"><button class="btn ghost" data-act="close-modal">继续答题</button>' +
            '<a class="btn primary" href="#/">退出</a></div>'
        );
        return;
      }
      go('#/');
    },
    fav: () => {
      const id = currentQid();
      if (!id) return;
      const on = LP.toggleFavorite(id);
      refreshCard();
      LP.toast(on ? '已收藏' : '已取消收藏');
    },
    review: () => {
      const id = currentQid();
      if (!id) return;
      const on = LP.toggleReview(id);
      refreshCard();
      LP.toast(on ? '已加入待复习' : '已移出待复习');
    },
    'redo-wrong': () => {
      const s = LP.state.session;
      if (!s || !s.results) return;
      const ids = s.qids.filter((id) => s.results[id] && !s.results[id].correct);
      startSession({ mode: 'wrong', title: '重练错题 · ' + ids.length + ' 题', qids: ids });
    },

    /* 入口 */
    'start-section': (el) => startSection(el.getAttribute('data-sec'), el.getAttribute('data-only')),
    'start-topic': (el) => startTopic(el.getAttribute('data-topic'), el.getAttribute('data-only')),
    'start-set': (el) => startSet(el.getAttribute('data-set')),
    'start-single': (el) => startSingle(el.getAttribute('data-qid')),
    'exam-start': () => beginExam(),

    /* 浮层 */
    peek: (el) => openModal(V.peekHtml(el.getAttribute('data-qid')), { wide: true }),
    'close-modal': () => closeModal(),
    'close-peek': () => closeModal(),

    /* 标记 */
    unflag: (el) => {
      const qid = el.getAttribute('data-qid');
      const flag = el.getAttribute('data-flag');
      LP.clearRecordFlag(qid, flag);
      render();
      LP.toast(flag === 'favorite' ? '已取消收藏' : '已移出待复习');
    },
    'fav-q': (el) => {
      const on = LP.toggleFavorite(el.getAttribute('data-qid'));
      render();
      LP.toast(on ? '已收藏' : '已取消收藏');
    },
    'review-q': (el) => {
      const on = LP.toggleReview(el.getAttribute('data-qid'));
      render();
      LP.toast(on ? '已加入待复习' : '已移出待复习');
    },

    /* 实验 */
    'lab-check': () => labCheck(),
    'lab-reset': () => labReset(),
    'lab-hint': () => labHint(),
    'lab-solution': () => labSolution(),
    'lab-diff': () => labDiff(),
    'lab-audit-opt': (el) => {
      const item = el.getAttribute('data-item');
      const opt = el.getAttribute('data-opt');
      E.setAudit(item, opt);
      const wrap = el.closest('.audit-opts');
      if (wrap) {
        wrap.querySelectorAll('.audit-opt').forEach((b) => b.classList.toggle('on', b === el));
      }
      refreshState();
    },

    /* 浏览 */
    'browse-status': (el) => {
      browseState.status = el.getAttribute('data-status');
      render();
    },
    'browse-toggle': (el) => {
      const qid = el.getAttribute('data-qid');
      if (browseState.openSet.has(qid)) browseState.openSet.delete(qid);
      else browseState.openSet.add(qid);
      render();
    },
    'browse-expand-all': () => {
      const list = V.browseList(browseState.topic, browseState).slice(0, 400);
      if (!list.length) return;
      if (list.every((q) => browseState.openSet.has(q.id))) browseState.openSet.clear();
      else list.forEach((q) => browseState.openSet.add(q.id));
      render();
    },
    'browse-collapse-all': () => {
      browseState.openSet.clear();
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    'to-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),

    /* 数据 */
    export: () => exportProgress(),
    'confirm-import': () => doImport(),
    'clear-all': () => {
      openModal(
        '<h3>清空全部学习记录？</h3><p class="muted">将删除本机 ' + LP.recordList().length + ' 条理论记录与 ' +
          Object.keys(LP.state.progress.labs || {}).length + ' 个实验成绩，包括作答、错题、收藏与待复习标记。此操作不可撤销，建议先导出备份。</p>' +
          '<div class="modal-act"><button class="btn ghost" data-act="close-modal">取消</button>' +
          '<button class="btn danger" data-act="confirm-clear">确认清空</button></div>'
      );
    },
    'confirm-clear': () => {
      LP.state.progress = { schema: 1, bankVersion: LP.state.bank.bank_version, records: {}, labs: {} };
      LP.saveProgress();
      LP.clearSession();
      closeModal();
      render();
      LP.toast('已清空本机学习记录');
    },

    /* ---------------- 云同步 ---------------- */

    'cloud-login': async () => {
      if (!LP.cloud) return;
      try {
        await LP.cloud.signIn();
      } catch (e) { /* 已在模块内提示 */ }
    },
    'cloud-sync': async () => {
      if (!LP.cloud || !LP.cloud.isSignedIn()) return;
      await LP.cloud.syncNow();
      const st = LP.cloud.status();
      if (st.state === 'synced') LP.toast('已同步');
      else if (st.state === 'offline') LP.toast('当前离线，联网后会自动同步', 'warn');
      else if (st.state === 'error') LP.toast('同步失败：' + st.message, 'warn');
      render();
    },
    'cloud-logout': async () => {
      if (!LP.cloud) return;
      try {
        await LP.cloud.signOut();
      } catch (e) { /* 已在模块内提示 */ }
    },
    'cloud-migrate': async () => {
      closeModal();
      if (!LP.cloud) return;
      try {
        const n = await LP.cloud.migrate();
        render();
        LP.toast(n ? '已合并 ' + n + ' 条记录到云端' : '本机没有可合并的记录');
      } catch (e) {
        LP.toast('合并失败：' + (e && e.message ? e.message : e), 'warn');
      }
    },
    'cloud-skip-migrate': () => {
      if (LP.cloud) LP.cloud.skipMigration();
      closeModal();
      render();
      LP.toast('本机记录已保留，不会上传');
    },
    'cloud-diag': () => {
      if (!LP.cloud || !LP.cloud.isSignedIn()) return;
      const user = LP.cloud.user();
      const m = (user && user.user_metadata) || {};
      const name = m.user_name || m.preferred_username || m.name || '（GitHub 未提供）';
      const scopes = LP.localScopeSummary();
      const list = scopes.length
        ? scopes
            .map((s) => {
              const label =
                s.scope === 'guest'
                  ? '未登录（guest）'
                  : '账号 ID ' + LP.esc(s.scope.slice(0, 8)) + (s.current ? '（当前登录）' : '');
              return (
                '<li>' + label + '：<b>' + s.active + '</b> 条有效记录' +
                '<span class="muted small">（实验 ' + s.labs + ' 个）</span></li>'
              );
            })
            .join('')
        : '<li class="muted">本机没有缓存任何记录</li>';

      openModal(
        '<h3>账号与记录核对</h3>' +
          '<p class="muted small">先确认这一块：现在用的是哪个 GitHub 账号。</p>' +
          '<ul class="diag-list">' +
            '<li>GitHub 用户名：<b>@' + LP.esc(name) + '</b></li>' +
            '<li>邮箱：<b>' + LP.esc(user.email || '未获取到（重新登录一次可补上）') + '</b></li>' +
            '<li>账号 ID：<code>' + LP.esc(String(user.id)) + '</code></li>' +
            '<li>云端记录：<span id="diag-cloud-count">查询中…</span></li>' +
          '</ul>' +
          '<p class="muted small">本机缓存过的作用域 —— 每登一个账号就多存一份，彼此不会覆盖。</p>' +
          '<ul class="diag-list">' + list + '</ul>' +
          '<p class="muted small">要确认某个 ID 对应哪个账号：退出登录，用那个账号登进来，再打开这里看邮箱。' +
          '本面板只读，不会合并、修改或删除任何记录。</p>' +
          '<div class="modal-act"><button class="btn ghost" data-act="close-modal">关闭</button>' +
          '<button class="btn sm" data-act="cloud-diag-refresh">重新查询云端</button></div>',
        { wide: true }
      );
      fillCloudCount();
    },
    'cloud-diag-refresh': () => {
      fillCloudCount();
    },
    'cloud-help': () => {
      openModal(
        '<h3>如何启用云同步</h3>' +
          '<p class="muted">云同步使用与 Linux 练习站同一个 Supabase 项目，配置一次即可。</p>' +
          '<ol class="steps">' +
          '<li>在 Supabase SQL Editor 执行 <code>docs/cloud-sync.md</code> 里的建表 SQL（两张表）。</li>' +
          '<li>在 Authentication → URL Configuration 的 Redirect URLs 里加上本站的 <code>?auth=callback</code> 地址。</li>' +
          '<li>把 Project URL 和 Publishable key 填进 <code>assets/js/cloud-config.js</code>。</li>' +
          '<li>刷新本页，用 GitHub 账号登录。</li>' +
          '</ol>' +
          '<p class="muted small">完整步骤与建表 SQL 见仓库中的 docs/cloud-sync.md。</p>' +
          '<div class="modal-act"><button class="btn primary" data-act="close-modal">知道了</button></div>',
        { wide: true }
      );
    },
    'clear-cloud': () => {
      const user = LP.cloud && LP.cloud.user();
      openModal(
        '<h3>清空云端与本机记录？</h3>' +
          '<p class="muted">将删除该账号在云端的全部记录与实验成绩，并清空本机。其他设备下次同步时也会被清空，不可撤销，建议先导出备份。</p>' +
          (user
            ? '<p class="muted small">当前账号：' + LP.esc(user.user_metadata && user.user_metadata.user_name ? '@' + user.user_metadata.user_name : '') +
              ' · ' + LP.esc(user.email || '未取到邮箱') + ' · ID ' + LP.esc(String(user.id).slice(0, 8)) + '</p>'
            : '') +
          '<div class="modal-act"><button class="btn ghost" data-act="close-modal">取消</button>' +
          '<button class="btn danger" data-act="confirm-clear-cloud">确认清空云端</button></div>'
      );
    },
    'confirm-clear-cloud': async () => {
      if (!LP.cloud || !LP.cloud.isSignedIn()) return closeModal();
      try {
        await LP.cloud.clearCloud();
        LP.resetProgress();
        LP.clearSession();
        closeModal();
        render();
        LP.toast('已清空云端与本机记录');
      } catch (e) {
        LP.toast('清空云端失败：' + (e && e.message ? e.message : e), 'warn');
      }
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (el.tagName === 'A' && el.getAttribute('href')) return;
    if (actions[act]) {
      e.preventDefault();
      actions[act](el, e);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      return;
    }
    if ($('#modal')) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (parseHash().parts[0] !== 'practice') return;

    const s = LP.state.session;
    if (!s) return;
    const q = LP.state.qById[currentQid()];
    if (!q) return;

    const k = e.key.toUpperCase();
    const letter = /^[A-D]$/.test(k) ? k : /^[1-4]$/.test(k) ? 'ABCD'[parseInt(k, 10) - 1] : null;
    if (letter && q.options.some((o) => o.id === letter)) {
      e.preventDefault();
      toggleOption(letter);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (s.mode === 'exam') return nextQuestion();
      if (s.submitted[currentQid()]) return nextQuestion();
      return submitCurrent();
    }
    if (e.key === 'ArrowRight') return nextQuestion();
    if (e.key === 'ArrowLeft') return prevQuestion();
  });

  /* ---------------- 侧栏域导航 ---------------- */

  function buildDomainNav() {
    const box = document.getElementById('nav-domains');
    if (!box) return;
    LP.state.catalog.domains.forEach((d) => {
      const a = document.createElement('a');
      a.href = '#/domain/' + d.id;
      a.setAttribute('data-nav', 'domain-' + d.id);
      a.innerHTML =
        '<i class="ni"><span class="dotc" style="background:' + LP.esc(d.accent) + '"></span></i>' +
        '<span>' + LP.esc(d.name) + '</span>';
      box.appendChild(a);
    });
  }

  /* ---------------- 云同步接线 ---------------- */

  function wireCloud() {
    if (!LP.cloud) return;

    LP.cloud.onChange(() => {
      if (parseHash().parts[0] === 'data') render();
    });

    window.addEventListener('ict:auth-changed', () => {
      render();
      maybePromptMigration();
    });

    window.addEventListener('ict:data-changed', () => {
      if ((parseHash().parts[0] || 'home') === 'data') render();
    });

    LP.cloud.init();
  }

  /* ---------------- 启动 ---------------- */

  LP.dev = { render, go, startSession };

  function boot() {
    const app = document.getElementById('app');
    if (!window.ICT_BANK || !window.ICT_CATALOG || !window.ICT_LABS) {
      if (app) app.innerHTML = '<div class="empty">数据脚本未加载。请确认 assets/js/data/ 下的三个文件存在。</div>';
      return;
    }
    LP.init(window.ICT_BANK, window.ICT_CATALOG, window.ICT_LABS);
    buildDomainNav();
    if (!LP.storageTest()) LP.warnStorage();
    window.addEventListener('hashchange', render);
    render();
    const ver = document.getElementById('side-ver');
    if (ver) ver.textContent = '题库 ' + window.ICT_BANK.bank_version;
    wireCloud();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
