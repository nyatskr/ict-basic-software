# 云同步配置（Supabase）

站点默认是纯本地模式：进度存在浏览器的 `localStorage` 里。启用云同步后，用 GitHub 账号登录即可在多台设备间同步进度。

```text
GitHub Pages：继续托管网页（纯静态）
        ↓
Supabase Auth：GitHub 账号登录（与 Linux 练习站共用同一个项目）
        ↓
Supabase 数据库：ict_progress_records（理论题）+ ict_lab_results（实验成绩）
        ↕
浏览器 localStorage：离线缓存
```

## 和 Linux 练习站的关系

两个站共用**同一个 Supabase 项目**和**同一个 GitHub OAuth App**，因为 OAuth 回调地址是 Supabase 的：

```text
https://mvrdlzjnhxzhqxszpcgi.supabase.co/auth/v1/callback
```

数据完全分开：Linux 站用 `progress_records`，本站用 `ict_progress_records` / `ict_lab_results`。
同一个 GitHub 账号在两个站上各有各的进度，互不影响。

## 同步行为

| 场景 | 行为 |
| --- | --- |
| 未登录 | 记录只存在本机（`ict.progress.v1.guest`） |
| 第一次登录 | 询问是否把本机已有记录（含实验成绩）合并到账号 |
| 已登录 | 每次答题先写本机，延迟约 1 秒自动上传 |
| 换设备 | 登录同一 GitHub 账号后自动下载并合并 |
| 临时断网 | 照常答题，恢复网络后自动补同步 |
| 手动备份 | JSON 导出 / 导入继续保留 |
| 正在进行的练习与实验 | 只存在本机（`ict.session.v1`），不跨设备同步 |

同步范围：作答记录、错题次数、收藏、待复习、实验最好成绩与通过状态。

合并规则（与导入一致）：同一题保留最近一次作答，错误次数取较大值，收藏与待复习取并集；
实验的次数与最好成绩取较大值，通过取并集。

> **已知限制**：记录里没有「收藏/待复习的修改时间」，所以取消收藏无法跨设备传播——
> A 设备收藏过，B 设备取消后同步，会变回收藏。要修得给记录加时间戳，属于数据结构变更。

---

## 一、建表（只需做一次）

Supabase Dashboard → `SQL Editor` → `New query`，整段执行：

```sql
-- 理论题记录
create table if not exists public.ict_progress_records (
  user_id uuid not null
    references auth.users(id) on delete cascade,

  qid text not null
    check (char_length(qid) between 1 and 32),

  bank_version text not null default '',
  selected text[] not null default '{}',
  correct boolean not null default false,

  answered_at bigint not null default 0
    check (answered_at >= 0),

  attempts integer not null default 0
    check (attempts >= 0),

  wrong_count integer not null default 0
    check (wrong_count >= 0),

  favorite boolean not null default false,
  needs_review boolean not null default false,

  updated_at timestamptz not null default now(),

  primary key (user_id, qid)
);

-- 实验成绩
create table if not exists public.ict_lab_results (
  user_id uuid not null
    references auth.users(id) on delete cascade,

  lab_id text not null
    check (char_length(lab_id) between 1 and 48),

  attempts integer not null default 0
    check (attempts >= 0),

  best integer not null default 0
    check (best between 0 and 100),

  passed boolean not null default false,

  at bigint not null default 0
    check (at >= 0),

  updated_at timestamptz not null default now(),

  primary key (user_id, lab_id)
);

-- 更新时间戳（Linux 站已经建过这个函数，这里 create or replace 是幂等的）
create or replace function public.touch_progress_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ict_progress_touch_updated_at
before update on public.ict_progress_records
for each row execute function public.touch_progress_updated_at();

create trigger ict_lab_touch_updated_at
before update on public.ict_lab_results
for each row execute function public.touch_progress_updated_at();

-- RLS：未登录完全不能读写，登录用户只能碰自己的行
alter table public.ict_progress_records enable row level security;
alter table public.ict_lab_results enable row level security;

revoke all on table public.ict_progress_records from anon, authenticated;
revoke all on table public.ict_lab_results from anon, authenticated;
grant select, insert, update, delete on table public.ict_progress_records to authenticated;
grant select, insert, update, delete on table public.ict_lab_results to authenticated;

create policy "ict_progress_select_own"
on public.ict_progress_records for select to authenticated
using ((select auth.uid()) = user_id);

create policy "ict_progress_insert_own"
on public.ict_progress_records for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "ict_progress_update_own"
on public.ict_progress_records for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "ict_progress_delete_own"
on public.ict_progress_records for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "ict_lab_select_own"
on public.ict_lab_results for select to authenticated
using ((select auth.uid()) = user_id);

create policy "ict_lab_insert_own"
on public.ict_lab_results for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "ict_lab_update_own"
on public.ict_lab_results for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "ict_lab_delete_own"
on public.ict_lab_results for delete to authenticated
using ((select auth.uid()) = user_id);
```

## 二、加一条跳转地址

`Authentication → URL Configuration → Redirect URLs`，追加：

```text
https://nyatskr.github.io/ict-basic-software/?auth=callback
http://127.0.0.1:8849/?auth=callback
http://localhost:8849/?auth=callback
```

GitHub OAuth App **不用再建**——回调地址是 Supabase 的，和 Linux 站共用同一个。
`Client ID / Client Secret` 也不用重填。

## 三、前端配置

`assets/js/cloud-config.js` 已经填好（与 Linux 站同一个 Project URL 和 Publishable key）。
两行都留空时，站点按纯本地模式运行，页面上「云同步」会显示「未启用」。

`index.html` 的脚本顺序已经就位：

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="assets/js/cloud-config.js"></script>
<script src="assets/js/cloud.js"></script>
<script src="assets/js/app.js"></script>
```

---

## 多个 GitHub 账号

本机按账号 ID 分开存，互不覆盖：

```text
ict.progress.v1.guest                              未登录时的记录
ict.progress.v1.user.<账号ID A>                    A 的记录
ict.progress.v1.user.<账号ID B>                    B 的记录
```

判断「现在用的是哪个账号」，看数据页「云同步」卡片：

```text
已登录：@nyatskr · nyatskr@gmail.com · ID bc72dac8
```

点「账号核对」可以看：用户名 / 邮箱 / 完整 ID / 云端条数与实验数，以及本机每个作用域各有几条。
这个面板只读，不会合并、修改或删除任何记录。

## 按题号清除记录（维护用）

界面上只有「清空本机」「清空云端」两种粒度，想删掉某一节的几条记录时，用浏览器控制台两步走。
**只删你列出来的题号，其它记录不动**；本机和云端一起删，云端只删当前账号的行。

```js
// 1. 先看这些题在当前账号里有没有（本机 / 云端分开显示）
await LP.cloud.probeQids(['A074', 'A033', 'A034', 'P045', 'P046']);

// 2. 确认无误再删
await LP.cloud.purgeQids(['A074', 'A033', 'A034', 'P045', 'P046']);
```

删之前先导出一次 JSON 备份；删除不可撤销。换账号后要重新执行一次——每个账号的记录是分开的。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 卡片显示「Supabase SDK 未加载」 | CDN 被拦截，换网络或把 SDK 下载到本地引用 |
| 登录后立刻跳回、仍是未登录 | Supabase 的 Redirect URLs 里没有本站地址 |
| 提示「数据表不存在」 | 上面第一段 SQL 没执行，或没跑完 |
| 提示「数据库策略拒绝了这次写入」 | RLS 没开全，确认四条策略都建了 |
| 换了账号，记录看起来「没了」 | 记录是按账号分开存的，切回原账号即可 |
