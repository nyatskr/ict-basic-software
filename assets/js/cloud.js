/* cloud.js — Supabase 登录与跨设备同步（可选模块）
 *
 * 设计要点：
 * - 没有填 cloud-config.js 时完全不初始化客户端，站点行为与纯本地版一致。
 * - 任何一次答题都先写本机，再排队上传；断网、关页面都不影响本机记录。
 * - 登录后进度改存到「账号专属」的本地键，避免换账号时把记录混在一起。
 * - 同步两张表：理论题记录（ict_progress_records）与实验成绩（ict_lab_results）。
 * - 合并规则与导入共用 LP.mergeRecord / LP.mergeLab。
 */
(function () {
  'use strict';

  const LP = window.LP;
  if (!LP) return;

  const TABLE = 'ict_progress_records';
  const LAB_TABLE = 'ict_lab_results';
  const MIGRATED_PREFIX = 'ict.migrated.';
  const RETURN_KEY = 'ict.auth.return';
  const SYNC_DELAY = 1200;      // 本机保存后延迟上传，避免连续点选时刷请求
  const FOCUS_THROTTLE = 30000; // 切回标签页时最多每 30 秒拉一次
  const CHUNK = 200;            // upsert 单批行数

  const cfg = window.ICT_CLOUD_CONFIG || {};
  const configured = !!(cfg.url && cfg.publishableKey);
  const sdkReady = !!(window.supabase && typeof window.supabase.createClient === 'function');
  const available = configured && sdkReady;
  const returning = /[?&]auth=callback/.test(location.search || '');

  const status = {
    state: available ? 'signed-out' : 'off',
    user: null,
    lastSyncAt: 0,
    message: available ? '' : configured ? 'Supabase SDK 未加载，请检查网络' : '尚未配置 Supabase',
    pending: false,
  };

  let client = null;
  let syncing = false;
  let pendingSync = false;
  let suppress = false;
  let timer = null;
  let focusAt = 0;
  let migrateDismissed = false;
  const listeners = [];

  if (available) {
    try {
      client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    } catch (e) {
      client = null;
      status.state = 'off';
      status.message = '初始化失败：' + (e && e.message ? e.message : e);
    }
  }

  /* ---------------- 状态广播 ---------------- */

  function notify() {
    const snapshot = Object.assign({}, status);
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (e) { /* 忽略单个订阅者的错误 */ }
    });
    try {
      window.dispatchEvent(new CustomEvent('ict:cloud-status', { detail: snapshot }));
    } catch (e) { /* 旧浏览器没有 CustomEvent 构造器 */ }
  }

  function setStatus(patch) {
    Object.assign(status, patch);
    notify();
  }

  /* ---------------- 地址工具 ---------------- */

  function baseUrl() {
    const path = location.pathname.replace(/index\.html?$/i, '');
    return location.origin + path;
  }

  /* 登录回跳后把 ?auth=callback&code=... 从地址栏清掉，避免刷新时重复兑换 */
  function cleanAuthUrl() {
    if (!/[?&](auth=callback|code=|error=)/.test(location.search || '')) return;
    try {
      history.replaceState(null, '', baseUrl() + (location.hash || ''));
    } catch (e) { /* 忽略 */ }
  }

  function rememberReturn() {
    try {
      window.localStorage.setItem(RETURN_KEY, location.hash && location.hash !== '#/' ? location.hash : '#/data');
    } catch (e) { /* 忽略 */ }
  }

  function restoreReturn() {
    let hash = null;
    try {
      hash = window.localStorage.getItem(RETURN_KEY);
      window.localStorage.removeItem(RETURN_KEY);
    } catch (e) { /* 忽略 */ }
    if (!hash) return;
    if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = hash;
  }

  function friendly(err) {
    const msg = (err && (err.message || err.error_description || err.msg)) || String(err || '');
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return '网络不可用，恢复后会自动重试';
    if (/row-level security|permission denied/i.test(msg)) return '数据库策略拒绝了这次写入，请确认已登录且 RLS 配置正确';
    if (/JWT expired|invalid claim|token is expired/i.test(msg)) return '登录状态已过期，请重新登录';
    if (/relation .*does not exist|schema cache|Could not find the table/i.test(msg)) return '数据表不存在，请先执行建表 SQL';
    if (/Invalid login credentials|code verifier/i.test(msg)) return '登录回调已失效，请重新登录一次';
    return msg || '未知错误';
  }

  /* ---------------- 账号切换 ---------------- */

  function markMigrated() {
    if (!status.user) return;
    try {
      window.localStorage.setItem(MIGRATED_PREFIX + status.user.id, String(Date.now()));
    } catch (e) { /* 忽略 */ }
  }

  function isMigrated() {
    if (!status.user) return true;
    try {
      return !!window.localStorage.getItem(MIGRATED_PREFIX + status.user.id);
    } catch (e) {
      return false;
    }
  }

  function applyUser(user) {
    const prev = status.user ? status.user.id : null;
    const next = user ? user.id : null;
    status.user = user || null;

    if (next !== prev) {
      const switched = LP.setProgressScope(next || 'guest');
      if (switched) {
        try {
          window.dispatchEvent(new CustomEvent('ict:auth-changed', { detail: { user: status.user } }));
        } catch (e) { /* 忽略 */ }
      }
    }

    if (next) {
      setStatus({ state: 'signed-in', message: '' });
      syncNow('login');
    } else {
      setStatus({ state: 'signed-out', message: '', lastSyncAt: 0 });
    }
  }

  /* ---------------- 行 ↔ 记录 ---------------- */

  function rowToRecord(row) {
    const q = LP.state.qById[row.qid];
    if (!q) return null; // 题号在当前题库里不存在，跳过
    const valid = new Set(q.options.map((o) => o.id));
    return LP.mergeRecord(null, {
      qid: row.qid,
      bankVersion: row.bank_version || '',
      selected: (row.selected || []).filter((id) => valid.has(id)),
      correct: row.correct,
      answeredAt: row.answered_at,
      attempts: row.attempts,
      wrongCount: row.wrong_count,
      favorite: row.favorite,
      favoriteUpdatedAt: row.favorite_updated_at,
      needsReview: row.needs_review,
      reviewUpdatedAt: row.review_updated_at,
    });
  }

  function recordToRow(rec) {
    return {
      user_id: status.user.id,
      qid: rec.qid,
      bank_version: rec.bankVersion || '',
      selected: Array.isArray(rec.selected) ? rec.selected : [],
      correct: !!rec.correct,
      answered_at: rec.answeredAt || 0,
      attempts: rec.attempts || 0,
      wrong_count: rec.wrongCount || 0,
      favorite: !!rec.favorite,
      favorite_updated_at: rec.favoriteUpdatedAt || 0,
      needs_review: !!rec.needsReview,
      review_updated_at: rec.reviewUpdatedAt || 0,
    };
  }

  function rowToLab(row) {
    if (!LP.state.labById || !LP.state.labById[row.lab_id]) return null;
    return {
      id: row.lab_id,
      attempts: row.attempts || 0,
      best: row.best || 0,
      passed: !!row.passed,
      at: row.at || 0,
    };
  }

  function labToRow(labId, res) {
    return {
      user_id: status.user.id,
      lab_id: labId,
      attempts: res.attempts || 0,
      best: res.best || 0,
      passed: !!res.passed,
      at: res.at || 0,
    };
  }

  const RECORD_COLUMNS =
    'qid,bank_version,selected,correct,answered_at,attempts,wrong_count,' +
    'favorite,favorite_updated_at,needs_review,review_updated_at';
  const LAB_COLUMNS = 'lab_id,attempts,best,passed,at';

  /* ---------------- 同步 ---------------- */

  async function pull() {
    /* 显式带 user_id 过滤：RLS 正常时本来就只返回自己的行，
       这里再收一道，避免策略被改宽后把别人的记录合并进本机再传回去。 */
    const recRes = await client
      .from(TABLE)
      .select(RECORD_COLUMNS)
      .eq('user_id', status.user.id);
    if (recRes.error) throw recRes.error;

    const labRes = await client
      .from(LAB_TABLE)
      .select(LAB_COLUMNS)
      .eq('user_id', status.user.id);
    if (labRes.error) throw labRes.error;

    const records = [];
    (recRes.data || []).forEach((row) => {
      const rec = rowToRecord(row);
      if (rec) records.push(rec);
    });
    const labs = {};
    (labRes.data || []).forEach((row) => {
      const lab = rowToLab(row);
      if (lab) labs[lab.id] = lab;
    });
    return { records, labs };
  }

  /* 只取条数，用于「账号核对」面板 */
  async function countCloud() {
    if (!client || !status.user) throw new Error('未登录');
    const rec = await client
      .from(TABLE)
      .select('qid', { count: 'exact', head: true })
      .eq('user_id', status.user.id);
    if (rec.error) throw rec.error;
    const lab = await client
      .from(LAB_TABLE)
      .select('lab_id', { count: 'exact', head: true })
      .eq('user_id', status.user.id);
    if (lab.error) throw lab.error;
    return { records: rec.count || 0, labs: lab.count || 0 };
  }

  function mergeRemote(data) {
    const before = JSON.stringify(LP.state.progress.records) + JSON.stringify(LP.state.progress.labs);
    data.records.forEach((rec) => {
      LP.state.progress.records[rec.qid] = LP.mergeRecord(LP.state.progress.records[rec.qid], rec);
    });
    Object.keys(data.labs).forEach((id) => {
      LP.state.progress.labs[id] = LP.mergeLab(LP.state.progress.labs[id], data.labs[id]);
    });
    const after = JSON.stringify(LP.state.progress.records) + JSON.stringify(LP.state.progress.labs);
    return before !== after;
  }

  async function push() {
    /* hasSyncState 而不是「有作答或当前是收藏」：
       先收藏再取消、且从没答过的题，三个布尔都是 false，
       但它带着 favoriteUpdatedAt 墓碑，必须上传才能让别的设备收到取消。 */
    const rows = LP.recordList().filter(LP.hasSyncState).map(recordToRow);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await client
        .from(TABLE)
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,qid' });
      if (error) throw error;
    }

    const labs = LP.state.progress.labs || {};
    const labRows = Object.keys(labs)
      .filter((id) => (labs[id].attempts || 0) > 0)
      .map((id) => labToRow(id, labs[id]));
    for (let i = 0; i < labRows.length; i += CHUNK) {
      const { error } = await client
        .from(LAB_TABLE)
        .upsert(labRows.slice(i, i + CHUNK), { onConflict: 'user_id,lab_id' });
      if (error) throw error;
    }
    return rows.length + labRows.length;
  }

  async function syncNow() {
    if (!client || !status.user) return false;
    if (syncing) {
      pendingSync = true;
      status.pending = true;
      return false;
    }
    if (!navigator.onLine) {
      setStatus({ state: 'offline', message: '离线，恢复网络后会自动同步' });
      return false;
    }

    syncing = true;
    setStatus({ state: 'syncing', message: '', pending: false });

    try {
      const remote = await pull();
      const changed = mergeRemote(remote);
      if (changed) {
        suppress = true;
        try {
          LP.saveProgress();
        } finally {
          suppress = false;
        }
      }
      await push();
      setStatus({ state: 'synced', lastSyncAt: Date.now(), message: '', pending: false });
      if (changed) {
        try {
          window.dispatchEvent(new CustomEvent('ict:data-changed'));
        } catch (e) { /* 忽略 */ }
      }
      return true;
    } catch (err) {
      setStatus({ state: 'error', message: friendly(err), pending: false });
      console.warn('云同步失败', err);
      return false;
    } finally {
      syncing = false;
      if (pendingSync) {
        pendingSync = false;
        queueSync();
      }
    }
  }

  function queueSync() {
    if (!client || !status.user || suppress) return;
    /* 同步进行中又有新的本机写入：记下来，等这轮结束后补一次，避免丢改动 */
    if (syncing) {
      pendingSync = true;
      return;
    }
    if (!navigator.onLine) {
      if (status.state !== 'offline') setStatus({ state: 'offline', message: '离线，恢复网络后会自动同步' });
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      syncNow();
    }, SYNC_DELAY);
  }

  /* ---------------- 登录 / 退出 ---------------- */

  async function init() {
    if (!client) return null;

    try {
      const { data } = await client.auth.getSession();
      const session = data && data.session;
      if (returning) {
        const params = new URLSearchParams(location.search);
        const errText = params.get('error_description') || params.get('error');
        if (errText && !session) LP.toast('登录未完成：' + errText, 'warn');
        cleanAuthUrl();
        if (session) restoreReturn();
      }
      applyUser(session ? session.user : null);
    } catch (e) {
      setStatus({ state: 'error', message: friendly(e) });
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        clearTimeout(timer);
        applyUser(null);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        const user = session ? session.user : null;
        if (user && (!status.user || status.user.id !== user.id)) applyUser(user);
      } else if (event === 'USER_UPDATED') {
        applyUser(session ? session.user : null);
      }
    });

    window.addEventListener('online', () => {
      if (status.user) {
        setStatus({ state: 'signed-in', message: '' });
        syncNow();
      }
    });

    window.addEventListener('offline', () => {
      if (status.user) setStatus({ state: 'offline', message: '离线，恢复网络后会自动同步' });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!status.user || syncing) return;
      const now = Date.now();
      if (now - focusAt < FOCUS_THROTTLE) return;
      focusAt = now;
      syncNow();
    });

    return status.user;
  }

  async function signIn() {
    if (!client) {
      LP.toast(configured ? 'Supabase SDK 未加载，无法登录' : '云同步尚未配置，见 docs/cloud-sync.md', 'warn');
      return;
    }
    rememberReturn();
    const redirectTo = baseUrl() + '?auth=callback';
    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo,
        /* 显式要 user:email：否则 GitHub 只回登录名，页面上分不清两个账号 */
        scopes: 'read:user user:email',
      },
    });
    if (error) {
      LP.toast('登录失败：' + friendly(error), 'warn');
      throw error;
    }
  }

  async function signOut() {
    if (!client) return;
    clearTimeout(timer);
    const { error } = await client.auth.signOut();
    if (error) {
      LP.toast('退出登录失败：' + friendly(error), 'warn');
      throw error;
    }
  }

  /* ---------------- 本机记录迁移到账号 ---------------- */

  function guestCount() {
    const guest = LP.readProgressFor('guest');
    if (!guest) return 0;
    let n = 0;
    Object.keys(guest.records).forEach((qid) => {
      if (LP.hasSyncState(guest.records[qid])) n++;
    });
    return n + Object.keys(guest.labs || {}).length;
  }

  function migrationInfo() {
    if (!status.user || isMigrated()) return null;
    const count = guestCount();
    return count ? { count } : null;
  }

  function dismissMigration() {
    migrateDismissed = true;
  }

  function migrationDismissed() {
    return migrateDismissed;
  }

  async function migrate() {
    const guest = LP.readProgressFor('guest');
    if (!guest) {
      markMigrated();
      return 0;
    }
    let merged = 0;
    Object.keys(guest.records).forEach((qid) => {
      if (!LP.state.qById[qid]) return;
      LP.state.progress.records[qid] = LP.mergeRecord(LP.state.progress.records[qid], guest.records[qid]);
      merged++;
    });
    Object.keys(guest.labs || {}).forEach((id) => {
      if (LP.state.labById && !LP.state.labById[id]) return;
      LP.state.progress.labs[id] = LP.mergeLab(LP.state.progress.labs[id], guest.labs[id]);
      merged++;
    });
    suppress = true;
    try {
      LP.saveProgress();
    } finally {
      suppress = false;
    }
    markMigrated();
    await syncNow();
    return merged;
  }

  function skipMigration() {
    markMigrated();
    dismissMigration();
  }

  /* ---------------- 清空云端 ---------------- */

  async function clearCloud() {
    if (!client || !status.user) throw new Error('未登录');
    const rec = await client.from(TABLE).delete().eq('user_id', status.user.id);
    if (rec.error) throw rec.error;
    const lab = await client.from(LAB_TABLE).delete().eq('user_id', status.user.id);
    if (lab.error) throw lab.error;
    markMigrated();
    status.lastSyncAt = Date.now();
    notify();
  }

  /* ---------------- 按题号清除记录（维护用） ----------------
   *
   * 只处理明确列出来的题号，不动其它记录。
   * 两步走：先 probeQids 看当前账号有没有这些题，再 purgeQids 才真正删。 */

  function normalizeQids(qids) {
    if (!Array.isArray(qids) || !qids.length) throw new Error('需要传入题号数组');
    return qids.map((q) => String(q).trim()).filter(Boolean);
  }

  async function probeQids(qids) {
    const list = normalizeQids(qids);
    const local = list.filter((q) => !!LP.state.progress.records[q]);
    let cloud = null;
    if (client && status.user) {
      const { data, error } = await client
        .from(TABLE)
        .select('qid')
        .eq('user_id', status.user.id)
        .in('qid', list);
      if (error) throw error;
      cloud = (data || []).map((r) => r.qid);
    }
    return {
      account: status.user ? { id: status.user.id, email: status.user.email || '' } : null,
      asked: list,
      local,
      cloud,
    };
  }

  async function purgeQids(qids) {
    const list = normalizeQids(qids);

    let local = 0;
    list.forEach((q) => {
      if (LP.state.progress.records[q]) {
        delete LP.state.progress.records[q];
        local++;
      }
    });
    if (local) {
      suppress = true;
      try {
        LP.saveProgress();
      } finally {
        suppress = false;
      }
    }

    let cloud = 0;
    if (client && status.user) {
      const { error, count } = await client
        .from(TABLE)
        .delete({ count: 'exact' })
        .eq('user_id', status.user.id)
        .in('qid', list);
      if (error) throw error;
      cloud = count || 0;
    }

    try {
      window.dispatchEvent(new CustomEvent('ict:data-changed'));
    } catch (e) { /* 忽略 */ }
    return { asked: list, removedLocal: local, removedCloud: cloud };
  }

  /* ---------------- 对外接口 ---------------- */

  LP.cloud = {
    enabled: () => available,
    configured: () => configured,
    init,
    signIn,
    signOut,
    syncNow,
    queueSync,
    clearCloud,
    countCloud,
    probeQids,
    purgeQids,
    migrate,
    skipMigration,
    migrationInfo,
    migrationDismissed,
    dismissMigration,
    isSignedIn: () => !!status.user,
    user: () => status.user,
    status: () => Object.assign({}, status),
    onChange: (fn) => {
      if (typeof fn !== 'function') return () => {};
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };

  if (returning && !available) cleanAuthUrl();
})();
