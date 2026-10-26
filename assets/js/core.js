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

  /* 进度按「作用域」分键：未登录用 .guest，登录后按 Supabase 用户 ID 分开。
     同一台电脑换账号时，A 的记录不会被合并进 B。 */
  let progressScope = 'guest';
  const progressKey = (scope) =>
    scope && scope !== 'guest' ? KEY_PROGRESS + '.user.' + scope : KEY_PROGRESS + '.guest';

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

  /* 时间戳统一走这里：非法值一律当 0，避免 NaN 混进比较 */
  const safeTime = (value) => Math.max(0, Number(value) || 0);

  /* 同一毫秒内连续修改时，时间仍然要往前走一格，否则后者覆盖不了前者 */
  const nextTime = (previous) => Math.max(Date.now(), safeTime(previous) + 1);

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
      favoriteUpdatedAt: 0,
      needsReview: false,
      reviewUpdatedAt: 0,
    };
  }

  LP.getRecord = (qid) => state.progress.records[qid] || null;

  LP.ensureRecord = (qid) => {
    if (!state.progress.records[qid]) state.progress.records[qid] = emptyRecord(qid);
    return state.progress.records[qid];
  };

  LP.saveProgress = () => {
    if (state.bank) state.progress.bankVersion = state.bank.bank_version;
    const ok = storageSet(progressKey(progressScope), JSON.stringify(state.progress));
    if (!ok) LP.warnStorage();
    /* 登录后延迟上传；未登录时 cloud.js 自己会忽略 */
    if (LP.cloud && typeof LP.cloud.queueSync === 'function') LP.cloud.queueSync();
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
    rec.favoriteUpdatedAt = nextTime(rec.favoriteUpdatedAt);
    LP.saveProgress();
    return rec.favorite;
  };

  LP.toggleReview = (qid) => {
    const rec = LP.ensureRecord(qid);
    rec.needsReview = !rec.needsReview;
    rec.reviewUpdatedAt = nextTime(rec.reviewUpdatedAt);
    LP.saveProgress();
    return rec.needsReview;
  };

  /* 「取消收藏 / 移出待复习」在错题本、收藏页也走这里，时间戳不能漏 */
  const FLAG_STAMP = {
    favorite: 'favoriteUpdatedAt',
    needsReview: 'reviewUpdatedAt',
  };

  LP.clearRecordFlag = (qid, flag) => {
    const rec = state.progress.records[qid];
    if (!rec) return;
    rec[flag] = false;
    const stamp = FLAG_STAMP[flag];
    if (stamp) rec[stamp] = nextTime(rec[stamp]);
    LP.saveProgress();
  };

  LP.recordList = () => Object.values(state.progress.records);

  /* 一条记录是否值得同步 / 导出：作答过，或带收藏、待复习状态。
     「已取消收藏」的记录也必须算 —— 它带着 favoriteUpdatedAt 墓碑，
     丢了的话别的设备就不知道用户取消过。 */
  LP.hasSyncState = (r) =>
    !!r &&
    ((r.attempts || 0) > 0 ||
      r.favorite ||
      r.needsReview ||
      (r.favoriteUpdatedAt || 0) > 0 ||
      (r.reviewUpdatedAt || 0) > 0);

  /* 记录标准化：兼容旧本机数据与旧导出文件（缺两个时间字段时补 0） */
  LP.normalizeRecord = (src) => {
    const rec = emptyRecord(src && src.qid ? String(src.qid) : '');
    if (!src) return rec;

    rec.bankVersion = src.bankVersion || '';
    rec.selected = Array.isArray(src.selected) ? src.selected.slice() : [];
    rec.correct = !!src.correct;
    rec.answeredAt = safeTime(src.answeredAt);
    rec.attempts = Math.max(0, Number(src.attempts) || 0);
    if (!rec.attempts && rec.answeredAt) rec.attempts = 1;
    rec.wrongCount = Math.max(0, Number(src.wrongCount) || 0);

    rec.favorite = !!src.favorite;
    rec.favoriteUpdatedAt = safeTime(src.favoriteUpdatedAt);
    rec.needsReview = !!src.needsReview;
    rec.reviewUpdatedAt = safeTime(src.reviewUpdatedAt);

    return rec;
  };

  /* 布尔标记按「最后修改时间」取胜；两边都是旧数据（没有时间）时退回并集，
     避免升级过程中把已有收藏弄丢。 */
  function mergeFlag(cur, inc, valueKey, timeKey) {
    const curTime = safeTime(cur[timeKey]);
    const incTime = safeTime(inc[timeKey]);

    if (incTime > curTime) {
      cur[valueKey] = !!inc[valueKey];
      cur[timeKey] = incTime;
      return;
    }
    if (!curTime && !incTime) {
      cur[valueKey] = !!cur[valueKey] || !!inc[valueKey];
      cur[timeKey] = 0;
    }
  }

  /* 合并一条外部记录到本地（JSON 导入 / 云同步 / 登录迁移共用同一套规则）：
     作答取较新，次数与错误数取较大，收藏与待复习按最后修改时间取胜。 */
  LP.mergeRecord = (cur, src) => {
    const inc = LP.normalizeRecord(src);
    if (!cur) return inc;

    if (inc.answeredAt > safeTime(cur.answeredAt)) {
      cur.selected = inc.selected.slice();
      cur.correct = inc.correct;
      cur.answeredAt = inc.answeredAt;
      cur.bankVersion = inc.bankVersion || cur.bankVersion;
    }

    cur.attempts = Math.max(cur.attempts || 0, inc.attempts);
    cur.wrongCount = Math.max(cur.wrongCount || 0, inc.wrongCount);

    mergeFlag(cur, inc, 'favorite', 'favoriteUpdatedAt');
    mergeFlag(cur, inc, 'needsReview', 'reviewUpdatedAt');

    return cur;
  };

  /* 实验成绩合并：次数与最好成绩取较大，通过取并集，时间取较晚 */
  LP.mergeLab = (cur, inc) => {
    const base = cur || { attempts: 0, best: 0, passed: false, at: 0 };
    base.attempts = Math.max(base.attempts || 0, inc.attempts || 0);
    base.best = Math.max(base.best || 0, inc.best || 0);
    base.passed = base.passed || !!inc.passed;
    base.at = Math.max(base.at || 0, inc.at || 0);
    return base;
  };

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

  /* ---------------- 作用域 ---------------- */

  const emptyProgress = () => ({
    schema: 1,
    bankVersion: state.bank ? state.bank.bank_version : '',
    records: {},
    labs: {},
  });

  /* 读取某个作用域的进度，不改变当前状态；读不到返回 null */
  function readProgressFor(scope) {
    const key = progressKey(scope);
    let raw = storageGet(key);
    if (raw == null && scope === 'guest') {
      /* 兼容升级前的单一存储键：旧记录原样当作本机（未登录）记录，旧键保留不删 */
      raw = storageGet(KEY_PROGRESS);
      if (raw != null) storageSet(key, raw);
    }
    if (raw == null) return null;
    try {
      const p = JSON.parse(raw);
      if (!p || !p.records || typeof p.records !== 'object') return null;
      return {
        schema: 1,
        bankVersion: p.bankVersion || '',
        records: p.records,
        labs: p.labs && typeof p.labs === 'object' ? p.labs : {},
      };
    } catch (e) {
      console.warn('进度读取失败', e);
      return null;
    }
  }

  LP.readProgressFor = readProgressFor;
  LP.getProgressScope = () => progressScope;
  LP.progressKeyFor = progressKey;

  /* 切换作用域（登录 / 退出时调用）。返回是否真的切换了。 */
  LP.setProgressScope = (scope) => {
    const next = scope && scope !== 'guest' ? String(scope) : 'guest';
    if (next === progressScope) return false;
    progressScope = next;
    state.progress = readProgressFor(next) || emptyProgress();
    return true;
  };

  /* 只清当前作用域的本机记录；云端由 cloud.js 负责 */
  LP.resetProgress = () => {
    state.progress = emptyProgress();
    LP.saveProgress();
  };

  /* 列出本机缓存过的所有作用域（guest + 每个登录过的账号）及记录数。
     排查「同一台电脑登过两个账号」时用：每个账号的记录是分开存的，
     这里能直接看出哪一份有记录、各有多少条。 */
  LP.localScopeSummary = () => {
    const out = [];
    const add = (scope) => {
      const p = readProgressFor(scope);
      if (!p) return;
      let active = 0;
      Object.keys(p.records).forEach((qid) => {
        const r = p.records[qid] || {};
        if (LP.hasSyncState(r)) active++;
      });
      const labs = Object.keys(p.labs || {}).length;
      if (!active && !labs) return;
      out.push({ scope, key: progressKey(scope), active, labs, current: scope === progressScope });
    };

    add('guest');
    const prefix = KEY_PROGRESS + '.user.';
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) keys.push(k);
      }
      keys.sort().forEach((k) => add(k.slice(prefix.length)));
    } catch (e) {
      /* 隐私模式下枚举可能失败，只返回 guest */
    }
    return out;
  };

  /* ---------------- 初始化 ---------------- */

  LP.init = (bank, catalog, labs) => {
    buildIndex(bank, catalog, labs || []);

    progressScope = 'guest';
    state.progress = readProgressFor('guest') || emptyProgress();

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
    schemaVersion: 2,
    bankVersion: state.bank ? state.bank.bank_version : '',
    exportedAt: new Date().toISOString(),
    /* 用 hasSyncState：把「已取消收藏」的墓碑记录也带上 */
    records: LP.recordList().filter(LP.hasSyncState),
    labs: state.progress.labs,
  });
})();
