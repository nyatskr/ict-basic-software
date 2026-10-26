/* core.js — 索引、进度存储、判分与统计 */
(function () {
  'use strict';

  const LP = (window.LP = window.LP || {});

  /* ---------------- 基础工具 ---------------- */

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  LP.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  /* 行内 `命令` → <code>：先转义再包裹，避免注入 */
  LP.rich = (s) =>
    LP.esc(s || '').replace(/`([^`]+)`/g, '<code>$1</code>');

  LP.isCommand = (s) => {
    const t = String(s || '');
    if (!/^[\x20-\x7E]+$/.test(t)) return false;
    if (t.length >= 16) return true;
    return /[\s/\-=_|>]/.test(t);
  };

  LP.clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  LP.uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  LP.pct = (n) => (n == null ? '—' : Math.round(n * 100) + '%');

  LP.fmtClock = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  };

  LP.fmtDuration = (ms) => {
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + ' 分 ' + (sec % 60) + ' 秒';
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  };

  LP.fmtDate = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  LP.durationSec = (text) => {
    const parts = String(text || '').match(/\d+/g);
    if (!parts) return 0;
    return parts.reduce((acc, n) => acc * 60 + parseInt(n, 10), 0);
  };

  /* ---------------- 本地存储（含降级） ---------------- */

  const KEY_PROGRESS = 'ict.progress.v1';
  const KEY_SESSION = 'ict.session.v1';
  const KEY_PREFS = 'ict.prefs.v1';

  const memStore = {};
  let storageOK = true;

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      storageOK = false;
      return Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : null;
    }
  }

  function storageSet(key, value) {
    memStore[key] = value;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      storageOK = false;
      return false;
    }
  }

  LP.storageTest = () => {
    try {
      const k = '__ict_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  };

  /* ---------------- 状态 ---------------- */

  const state = (LP.state = {
    bank: null,
    catalog: null,
    labs: [],
    topics: [],
    topicById: {},
    sectionById: {},
    sectionsByTopic: {},
    qById: {},
    resourceById: {},
    labById: {},
    progress: { schema: 1, bankVersion: '', records: {}, labs: {} },
    session: null,
    prefs: { examCount: 20, examMinutes: 20, examDomains: [] },
  });

  /* ---------------- 索引 ---------------- */

  function buildIndex(bank, catalog, labs) {
    state.bank = bank;
    state.catalog = catalog;
    state.labs = labs;

    const qById = {};
    bank.questions.forEach((q, i) => {
      q.__order = i;
      qById[q.id] = q;
    });
    state.qById = qById;
    state.questions = bank.questions;

    const resById = {};
    Object.keys(catalog.resources || {}).forEach((id) => {
      resById[id] = Object.assign({ id }, catalog.resources[id]);
    });
    state.resourceById = resById;

    const labById = {};
    labs.forEach((l) => (labById[l.id] = l));
    state.labById = labById;

    const sectionById = {};
    const sectionsByTopic = {};
    catalog.sections.forEach((s) => {
      sectionById[s.id] = s;
      if (!sectionsByTopic[s.topic_id]) sectionsByTopic[s.topic_id] = [];
      sectionsByTopic[s.topic_id].push(s);
    });
    state.sectionById = sectionById;
    state.sectionsByTopic = sectionsByTopic;

    const topicById = {};
    state.topics = catalog.topics.map((t) => {
      const secs = (sectionsByTopic[t.id] || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const qids = [];
      secs.forEach((s) => s.question_ids.forEach((id) => qids.push(id)));
      const out = Object.assign({}, t, {
        sections: secs,
        qids,
        lab_ids: t.lab_ids || [],
        qCount: qids.length,
      });
      topicById[t.id] = out;
      return out;
    });
    state.topicById = topicById;

    state.domainById = {};
    catalog.domains.forEach((d) => {
      state.domainById[d.id] = Object.assign({}, d, {
        topics: state.topics.filter((t) => t.domain === d.id),
      });
    });
  }

  LP.topicOf = (sectionId) => {
    const s = state.sectionById[sectionId];
    return s ? state.topicById[s.topic_id] : null;
  };
  LP.domainOf = (topicId) => {
    const t = state.topicById[topicId];
    return t ? state.domainById[t.domain] : null;
  };
  LP.sectionQids = (section) => (section ? section.question_ids.filter((id) => state.qById[id]) : []);
  LP.sectionResources = (section) =>
    (section && section.resources ? section.resources : []).map((id) => state.resourceById[id]).filter(Boolean);
  LP.sectionLabs = (section) => (section && section.lab_ids ? section.lab_ids : []).map((id) => state.labById[id]).filter(Boolean);

  /* ---------------- 进度记录 ---------------- */

  function emptyRecord(qid) {
    return {
      qid,
      bankVersion: state.bank ? state.bank.bank_version : '',
      selected: [],
      correct: false,
      answeredAt: 0,
      attempts: 0,
      wrongCount: 0,
      favorite: false,
      needsReview: false,
    };
  }

  LP.getRecord = (qid) => state.progress.records[qid] || null;

  LP.ensureRecord = (qid) => {
    if (!state.progress.records[qid]) state.progress.records[qid] = emptyRecord(qid);
    return state.progress.records[qid];
  };

  LP.saveProgress = () => {
    if (state.bank) state.progress.bankVersion = state.bank.bank_version;
    const ok = storageSet(KEY_PROGRESS, JSON.stringify(state.progress));
    if (!ok) LP.warnStorage();
    return ok;
  };

  LP.applyAnswer = (qid, selected, correct) => {
    const rec = LP.ensureRecord(qid);
    rec.selected = selected.slice();
    rec.correct = !!correct;
    rec.answeredAt = Date.now();
    rec.attempts = (rec.attempts || 0) + 1;
    if (!correct) rec.wrongCount = (rec.wrongCount || 0) + 1;
    rec.bankVersion = state.bank.bank_version;
    LP.saveProgress();
    return rec;
  };

  LP.toggleFavorite = (qid) => {
    const rec = LP.ensureRecord(qid);
    rec.favorite = !rec.favorite;
    LP.saveProgress();
    return rec.favorite;
  };

  LP.toggleReview = (qid) => {
    const rec = LP.ensureRecord(qid);
    rec.needsReview = !rec.needsReview;
    LP.saveProgress();
    return rec.needsReview;
  };

  LP.clearRecordFlag = (qid, flag) => {
    const rec = state.progress.records[qid];
    if (!rec) return;
    rec[flag] = false;
    LP.saveProgress();
  };

  LP.recordList = () => Object.values(state.progress.records);

  const pickBy = (fn) =>
    LP.recordList()
      .filter(fn)
      .sort((a, b) => (b.answeredAt || 0) - (a.answeredAt || 0))
      .map((r) => r.qid)
      .filter((id) => state.qById[id]);

  LP.wrongIds = () => pickBy((r) => r.attempts > 0 && !r.correct);
  LP.reviewIds = () => pickBy((r) => r.needsReview);
  LP.favoriteIds = () => pickBy((r) => r.favorite);

  /* 实验记录：按 lab id 保存最好成绩 */
  LP.labResult = (labId) => state.progress.labs[labId] || null;

  LP.recordLab = (labId, score, passed) => {
    const cur = state.progress.labs[labId] || { attempts: 0, best: 0, passed: false, at: 0 };
    cur.attempts += 1;
    cur.best = Math.max(cur.best || 0, score);
    cur.passed = cur.passed || !!passed;
    cur.at = Date.now();
    state.progress.labs[labId] = cur;
    LP.saveProgress();
    return cur;
  };

  /* ---------------- 统计 ---------------- */

  LP.statsFor = (qids) => {
    let done = 0, correct = 0, mastered = 0, weak = 0, wrongTotal = 0;
    qids.forEach((qid) => {
      const r = state.progress.records[qid];
      if (!r || !r.attempts) return;
      done++;
      if (r.correct) {
        correct++;
        if (!r.wrongCount) mastered++;
      } else {
        weak++;
      }
      wrongTotal += r.wrongCount || 0;
    });
    return {
      total: qids.length,
      done,
      correct,
      mastered,
      weak,
      wrongTotal,
      rate: done ? correct / done : null,
      coverage: qids.length ? done / qids.length : 0,
    };
  };

  LP.topicStats = (t) => LP.statsFor(t.qids);
  LP.domainStats = (d) => {
    const qids = [];
    d.topics.forEach((t) => t.qids.forEach((id) => qids.push(id)));
    const s = LP.statsFor(qids);
    s.labs = d.topics.reduce((acc, t) => acc + t.lab_ids.length, 0);
    s.labsPassed = d.topics.reduce(
      (acc, t) => acc + t.lab_ids.filter((id) => (LP.labResult(id) || {}).passed).length,
      0
    );
    return s;
  };
  LP.globalStats = () => LP.statsFor(state.questions.map((q) => q.id));

  LP.statusOf = (qid) => {
    const r = state.progress.records[qid];
    if (!r || !r.attempts) return 'new';
    if (r.correct && !r.wrongCount) return 'mastered';
    if (r.correct) return 'shaky';
    return 'weak';
  };
  LP.STATUS_LABEL = { new: '未做', mastered: '已掌握', shaky: '待巩固', weak: '薄弱' };

  /* 小节完成度：题目覆盖 + 实验是否通过 */
  LP.sectionProgress = (section) => {
    const qids = LP.sectionQids(section);
    const s = LP.statsFor(qids);
    const labs = LP.sectionLabs(section);
    const labsPassed = labs.filter((l) => (LP.labResult(l.id) || {}).passed).length;
    const parts = [s.coverage];
    if (labs.length) parts.push(labsPassed / labs.length);
    const coverage = parts.reduce((a, b) => a + b, 0) / parts.length;
    return Object.assign(s, { labs: labs.length, labsPassed, coverage });
  };

  /* ---------------- 判分 ---------------- */

  LP.isCorrect = (question, selectedIds) => {
    const selected = new Set(selectedIds || []);
    const valid = new Set(question.options.map((o) => o.id));
    for (const id of selected) if (!valid.has(id)) return false;
    if (question.type === 'single' && selected.size !== 1) return false;
    const expected = new Set(question.answer);
    if (selected.size !== expected.size) return false;
    for (const id of expected) if (!selected.has(id)) return false;
    return true;
  };

  LP.TYPE_LABEL = { single: '单选', multiple: '多选', judge: '判断' };

  /* ---------------- Toast ---------------- */

  let toastTimer = null;
  LP.toast = (msg, kind) => {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 2600);
  };

  let warned = false;
  LP.warnStorage = () => {
    if (warned) return;
    warned = true;
    LP.toast('浏览器禁止写入本地存储，进度只保存在本次会话中', 'warn');
  };

  /* ---------------- 初始化 ---------------- */

  LP.init = (bank, catalog, labs) => {
    buildIndex(bank, catalog, labs || []);

    try {
      const raw = storageGet(KEY_PROGRESS);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.records && typeof p.records === 'object') {
          state.progress = {
            schema: 1,
            bankVersion: p.bankVersion || '',
            records: p.records,
            labs: p.labs && typeof p.labs === 'object' ? p.labs : {},
          };
        }
      }
    } catch (e) {
      console.warn('进度读取失败', e);
    }

    try {
      const raw = storageGet(KEY_SESSION);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.qids) && s.qids.length) state.session = s;
      }
    } catch (e) {
      console.warn('会话读取失败', e);
    }

    try {
      const raw = storageGet(KEY_PREFS);
      if (raw) Object.assign(state.prefs, JSON.parse(raw));
    } catch (e) { /* 忽略 */ }
  };

  LP.saveSession = () => {
    if (!state.session) {
      try { window.localStorage.removeItem(KEY_SESSION); } catch (e) { /* 忽略 */ }
      return;
    }
    storageSet(KEY_SESSION, JSON.stringify(state.session));
  };

  LP.clearSession = () => {
    state.session = null;
    try { window.localStorage.removeItem(KEY_SESSION); } catch (e) { /* 忽略 */ }
  };

  LP.savePrefs = () => storageSet(KEY_PREFS, JSON.stringify(state.prefs));

  LP.exportPayload = () => ({
    kind: 'ict-basic-software-progress',
    schemaVersion: 1,
    bankVersion: state.bank ? state.bank.bank_version : '',
    exportedAt: new Date().toISOString(),
    records: LP.recordList().filter((r) => r.attempts > 0 || r.favorite || r.needsReview),
    labs: state.progress.labs,
  });
})();
