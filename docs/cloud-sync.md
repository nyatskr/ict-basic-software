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

合并规则（与导入一致）：同一题保留最近一次作答，错误次数取较大值；
收藏与待复习分别记录最后修改时间，合并时由修改时间较新的一边决定，
所以**添加和取消都能跨设备传播**。旧记录没有修改时间时仍按并集处理，避免升级时丢失已有收藏；
实验的次数与最好成绩取较大值，通过取并集。

## 已有表升级（v1 → v2）

如果表是在「收藏/待复习时间戳」之前建的，先执行这两条再加代码，否则同步会因为查不到列而失败：

```sql
alter table public.ict_progress_records
  add column if not exists favorite_updated_at bigint not null default 0
    check (favorite_updated_at >= 0);

alter table public.ict_progress_records
  add column if not exists review_updated_at bigint not null default 0
    check (review_updated_at >= 0);
```

老数据自动得到 `0`，不需要人工回填。验证：

```sql
select qid, favorite, favorite_updated_at, needs_review, review_updated_at
from public.ict_progress_records
limit 20;
```

不要复用 `updated_at`：它随答题、错误次数一起变，判断不出最后改的是哪个字段。

> 升级前已经发生、但还没同步过的「取消收藏」没有时间证据，无法自动推断。
> 部署后在任意一台设备上重新取消一次即可，之后的添加和取消都会正常传播。

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
  favorite_updated_at bigint not null default 0
    check (favorite_updated_at >= 0),

  needs_review boolean not null default false,
  review_updated_at bigint not null default 0
    check (review_updated_at >= 0),

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
<script src="assets/vendor/supabase-js-2.118.0.js"></script>
<script src="assets/js/cloud-config.js"></script>
<script src="assets/js/cloud.js"></script>
<script src="assets/js/app.js"></script>
```

## 三之二、SDK 自托管（vendor）

Supabase SDK **不走 CDN**，文件在仓库里：

| 项 | 值 |
| --- | --- |
| 版本 | `@supabase/supabase-js@2.118.0`（UMD 构建 `dist/umd/supabase.js`） |
| 来源 | npm registry：`https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.118.0.tgz` |
| 下载日期 | 2026-10-27 |
| 文件 | `assets/vendor/supabase-js-2.118.0.js`（218 KB，未压缩） |
| 许可证 | MIT，见 `assets/vendor/supabase-js-LICENSE.txt` |
| SHA-256 | `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3` |

**为什么自托管**：SDK 是可选功能，但它是阻塞脚本。挂在 CDN 上时，CDN 慢或被墙，
整个应用（不只是云同步）都会卡在启动阶段——这个站就踩过一次，headless 里 app.js 晚了几十秒才执行。
自托管后只要站点能打开，SDK 就能加载。

**为什么钉死版本**：`@2` 是浮动标签，会在不改仓库的情况下自动升到新的 2.x。钉死后升级是可审计的动作。

升级步骤：

```powershell
curl.exe -L -o sb.tgz https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-<新版本>.tgz
tar -xzf sb.tgz
copy package\dist\umd\supabase.js assets\vendor\supabase-js-<新版本>.js
copy package\LICENSE assets\vendor\supabase-js-LICENSE.txt
Get-FileHash assets\vendor\supabase-js-<新版本>.js -Algorithm SHA256   # 记下新值，同步改 index.html 与本表
node tools/test-boot-without-cdn.mjs
```

`tools/test-boot-without-cdn.mjs` 会屏蔽 `cdn.jsdelivr.net` 后启动站点，
校验题库、目录、实验、路由、SDK、云状态与控制台错误，并断言页面没有向 CDN 发请求。
**如果有人把 SDK 改回 CDN 引入，这条测试会直接失败。**

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
