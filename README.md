# 基础软件赛道学习平台

华为 ICT 大赛 · 实践赛 · 基础软件赛道（openEuler / openGauss / 鲲鹏应用开发）的个人备赛学习平台。

**定位**：知识图谱 + 外部讲解资源 + 理论题库 + 模拟实操 + 阶段测验。
不是又一个题库站，而是把「学什么 → 看什么 → 补什么 → 练什么 → 会不会」串成一条闭环。

纯静态站点，无构建依赖、无后端。双击 `index.html` 就能用（`file://` 直接打开，不需要起服务器）。

| | 地址 |
| --- | --- |
| 在线访问 | https://nyatskr.github.io/ict-basic-software/ |
| 源码仓库 | https://github.com/nyatskr/ict-basic-software |

---

## 快速开始

```bash
# 方式一：直接打开
start index.html          # Windows
open index.html           # macOS

# 方式二：起本地服务器（推荐，避免个别浏览器对 file:// 的限制）
python -m http.server 8000
# 然后访问 http://localhost:8000
```

数据与内容分开：`content/*.json` 是内容源，`assets/js/data/*.js` 是构建产物。

```bash
# 用仓库内固化的 84 道基础题重新生成题库 / 目录 / 实验数据
python tools/build-data.py

# 只校验不写文件
python tools/build-data.py --check

# 如果持有源 Markdown：重新解析第 9 章、刷新基础题快照并构建
python tools/build-data.py "路径/华为ICT大赛_基础软件赛道_历年真题与2026-2027预测.md"

# 全量内容校验（题号归属、答案解析、域/cluster、反引号、产物新鲜度）
python tools/check-content.py

# 按 ready 门槛逐节评估（默认只报告；加 --strict 才在 ready 小节不达标时返回 1）
python tools/check-ready.py

# 核对资料链接：还活着吗、标题/作者/时长有没有漂移（B 站条目需要 yt-dlp）
python tools/check-resources.py

# 重新生成 docs/ 下的资料台账与实验说明
python tools/build-docs.py

# 实验引擎回归测试（需要本机有 Chrome，或设 CHROME_PATH）
node tools/test-lab.mjs          # 全部
node tools/test-lab.mjs chmod    # 只跑 chmod 符号模式
node tools/test-lab.mjs lab      # 只跑实验判分
node tools/test-lab.mjs files    # 只跑文件 / 链接 / 归档用例
```

---

## 页面结构

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `#/` | 概览 | 三域卡片、阶段测验入口、各域进度 |
| `#/domain/oe` `og` `kp` | 域页 | 知识图谱（点节点直接进小节）+ 专题列表 |
| `#/topic/oe-02` | 专题页 | 小节清单、题量、实验、练习入口 |
| `#/section/oe-02-01` | 小节页 | 学习闭环六步 |
| `#/labs` | 实验列表 | 按域分组，显示通过状态与最好成绩 |
| `#/lab/oe-lab-perm-01` | 实验页 | 三栏：任务提示 / 终端或 SQL / 状态面板 |
| `#/exam` | 综合模拟 | 选域、选题量、限时，随机不重复 |
| `#/practice` | 答题 | 即时判分（模拟考试除外） |
| `#/result` | 结果 | 正确率、分域表现、错题回顾 |
| `#/wrong/weak` `review` `fav` `labs` | 错题与收藏 | 理论错题 / 待复习 / 收藏 / 实验记录 |
| `#/browse` | 题库浏览 | 按专题与状态筛选、搜索、展开解析 |
| `#/data` | 进度与数据 | 导入导出、清空、内容台账 |

### 小节页的固定流程

> 学习目标 → 推荐视频/图文 → 本站文字补充与版本纠错 → 理论题 → 模拟实操 → 小节测验与复盘

六块内容都在同一页，用顶部流程条跳转。小节的完成度 = 题目覆盖率与实验通过率的平均。

---

## 三条知识线

| 域 | 专题 | 小节 | 题 | 实验 |
| --- | --- | --- | --- | --- |
| openEuler（OE） | 8 | 19 | 40 | 4 |
| openGauss（OG） | 5 | 14 | 34 | 1 |
| 鲲鹏应用开发（KP） | 3 | 12 | 29 | 1 |
| 合计 | 16 | 45 | 103 | 6 |

题号体系稳定：`OE-01`～`OE-30`、`OG-01`～`OG-30`、`KP-01`～`KP-24` 来自题库 Markdown 的第 9 章；
本站补充题用 `OE-X01` 这类带 `X` 的号段，与预测题分开。小节 id 形如 `oe-02-01`，实验 id 形如 `oe-lab-perm-01`。

---

## 模拟实操

三层分级：

- **L1 引导模拟**：只读证据 + 归类判定（如鲲鹏迁移依赖审查），不需要终端。
- **L2 状态实验**：浏览器内的状态机，可真的敲命令 / 敲 SQL，状态面板实时反映。
- **L3 真实沙箱**：尚未接入，以后单独部署后端。

**判分只看最终状态，不看命令字符串。** 校验项读的是状态机里的最终状态：

| 实验 | 状态机覆盖 |
| --- | --- |
| `oe-lab-perm-01` | 用户 / 组 / 文件 owner:group:mode / ACL 与 mask / setgid、sticky |
| `oe-lab-files-01` | inode 与硬链接、软链接 target 与悬空、find 的 -type/-name/-size、tar 归档条目与 -C 解包 |
| `oe-lab-svc-01` | systemctl active+enabled、firewall-cmd 的 runtime 与 permanent 双视图 |
| `oe-lab-lvm-01` | PV → VG → LV → mkfs → fstab → lvextend -r |
| `og-lab-grant-01` | 角色、schema、表三层授权（CONNECT / USAGE / SELECT），且不能多给 DELETE |
| `kp-lab-scan-01` | 6 个组件的架构证据 → 处理方式判定 |

因此下面两种写法都能拿满分——校验项读的是最终 mode，不是命令字符串：

```bash
chmod 3770 /srv/share
# 等价：
chmod u=rwx,g=rwx,o= /srv/share && chmod g+s,o+t /srv/share
```

注意 `chmod g+s,o+t` 单独用**不**够：它只加特殊位，不会把 755 改成 770。
分值合计固定 100，**≥80 分算通过**，每个实验都能一键重置。

详见 [docs/labs.md](docs/labs.md)。

---

## 资料工作流

讲解资源优先级：B 站 > 抖音 > 小红书 > 博客 > 自编。技术事实**以厂商官方文档为准**。

每条资料在 `content/catalog.json` 里都有统一 ID 与完整字段：

```
kind(视频/图文) platform title author url duration
role(main/supplement/backup) status(candidate/verified/dead)
covers[] gaps version_note checked_at note
```

规则：

1. 只有 `verified` 的资料才能当主资料用；`candidate` 表示链接与时长已核对、内容还没人工看完。
2. 每条资料必须写清**适用版本**与**缺口**，视频讲错或过时的地方由本站文字补充纠偏。
3. 抖音、小红书只存链接与摘要，不下载、不转载。
4. 每个小节至少准备一条备用资料。
5. 完整台账见 [docs/resources.md](docs/resources.md)（由脚本生成，不要手改）。

### 链接核对能做什么、不能做什么

`tools/check-resources.py` 用 yt-dlp 逐条探测，能自动确认：

- 链接是否还能打开（`dead`）
- 标题、作者、时长是否与台账记录一致（漂移说明视频被替换或当初记错）
- UP 主账号是否已注销（视频还在但随时可能消失，必须补备用资料）

它**不能**替代人工验收：元数据全对，也不代表视频里真讲了 `covers` 里写的那些点。
`status` 仍只能靠人看完再改。

关于用 Whisper 自动转写来辅助验收，实测结论（`BV1az421b7ub`，130 秒，`small` int8，CPU）：

- 速度约 **0.48x 实时**，本站 5.2 小时音频约需 2.5 小时 CPU。
- 不加提示词时中文术语大面积出错：`属主` 对 2 次错 8 次、`属组` 一次都没对、`八进制` 8 次全错成`八禁制`。
- 用 `initial_prompt` 注入术语表后，中文术语基本可靠（`属主` 9 次全对、`八进制` 8 次全对），
  但**英文单字母权限串依然不可用**：`rwx` 会变成 `二wx`、`r-x` 变成 `二杆x`。

因此转写稿只能用来**定位**（“这段讲了 setgid 吗，在 3:20 左右”），
不能用来抄命令、权限串或参数。字幕也不进仓库：B 站视频绝大多数没有字幕，
转录稿既含识别错误又涉及第三方内容版权，只作本地工作底稿。

2026-10-26 起改用**飞书妙记转写 + 自动章节摘要**做主题级验收（`oe-01` 两节的
`v-file-hardlink`、`v-file-redirect` 等）：妙记转写质量明显好于本地 Whisper，
中文术语基本全对，可按时间点核对 `covers` 里的主题。验收结论写进每条资源的
`note`，`covers`/`gaps` 按实际内容校正——`v-file-tar` 实际未讲 `-C`/`-t`、
`v-file-find` 未讲引号，均已如实改注。转写稿仍只作工作底稿，不进仓库。

---

## 目录结构

```
index.html                    应用外壳：侧栏 + #app + 七个脚本
assets/css/base.css           设计系统（变量、shell、通用组件、响应式）
assets/css/app.css            本平台新增组件（域卡片、知识图谱、小节流程、终端、状态面板）
assets/js/data/bank.js        构建产物：题库
assets/js/data/catalog.js     构建产物：域 / 专题 / 小节 / 资料
assets/js/data/labs.js        构建产物：实验
assets/js/core.js             索引、进度存储（含降级）、判分、统计
assets/js/lab-engine.js       状态机实验引擎（linux / sql / audit 三类）
assets/js/views.js            各页面渲染
assets/js/app.js              hash 路由、会话、计时、实验交互、导入导出
content/catalog.json          域 / 专题 / 知识图谱节点 / 资料
content/sections.oe.json      学习小节（按域拆文件）
content/sections.og.json
content/sections.kp.json
content/labs.json             模拟实操定义（含 initial_state 与 validators）
content/questions.base.json   从源 Markdown 固化的 84 道基础题
content/questions.extra.json  本站补充题
content/explanations.json     源文档缺失的解析
tools/parse-questions.py      解析题库 Markdown 第 9 章
tools/build-data.py           自包含构建；也可从 Markdown 刷新基础题
tools/check-content.py        全量内容一致性与富文本风险校验
tools/check-ready.py          按 ready 门槛逐节评估（先报告，不阻断）
tools/check-resources.py      资料链接存活与元数据漂移核对（需 yt-dlp）
tools/build-docs.py           生成 docs/resources.md 与 docs/labs.md
tools/test-lab.mjs            实验引擎回归测试（headless Chrome 里跑真命令）
docs/resources.md             资料台账（生成）
docs/labs.md                  实验说明（生成）
```

---

## 内容怎么改

**改题目 / 加题**：仓库默认从 `content/questions.base.json` 读取 84 道基础题，不再依赖仓库外文件。
如果持有源 Markdown，传给 `build-data.py` 会重新解析第 9 章，并在校验通过后刷新这份固化快照。
本站补充题只写进 `content/questions.extra.json`，题号用 `XX-X01` 号段，并在某个小节的 `question_ids` 里引用它。
改完运行 `python tools/check-content.py`；漏挂、重挂、答案越界、解析缺失、域或 cluster 不一致、生成产物过期都会报错。

**改小节**：编辑 `content/sections.oe.json` 等文件。字段含义：

```jsonc
{
  "id": "oe-02-01",              // 稳定 id，路径与进度都靠它
  "topic_id": "oe-02",
  "title": "权限位与三类主体",
  "status": "ready",             // ready = 内容成型；draft = 待补
  "minutes": 10,
  "objectives": ["..."],         // 学习目标
  "resources": ["v-perm-who"],   // 引用 catalog.resources 的 id
  "notes": [{ "h": "小标题", "t": "正文，可用 `反引号` 标命令" }],
  "pitfalls": ["..."],
  "question_ids": ["OE-01", "OE-02"],
  "lab_ids": ["oe-lab-perm-01"],
  "search_terms": ["linux chmod 权限"],  // 给「自己找资料」用
  "gaps": "资料缺口说明"
}
```

**加实验**：在 `content/labs.json` 追加一条，写 `initial_state` 与 `validators`。
`validators` 的 `path` 指向状态机里的字段，`op` 支持 `exists` / `eq` / `contains` / `gte` / `grant` / `fstab_has`，
`weight` 合计必须等于 100，否则构建会报错。

**改版本号**：只有一个地方——`content/catalog.json` 的 `domains[].question_version`。
改完重跑 `build-data.py`，该域所有题目的 `version` 同步变化，`check-content.py` 会校验两者一致
（`build-data.py` 里不再有硬编码的版本表）。

`version` 与 `question_version` 是两个用途：前者是域页上给人看的短版本（如 `24.03-LTS-SP2`），
后者是打在每道题上的完整口径（如 `openEuler 24.03-LTS-SP2`）。

### ready 门槛

`status: "ready"` 表示这一节可以发布，不是「写完了」。`tools/check-ready.py` 按下面这张表逐项判定：

| 项目 | 门槛 |
| --- | --- |
| 学习目标 | 2–4 条 |
| 主资料 | 至少 1 条 `verified + main` |
| 备用资料 | 至少 1 条 `backup` 且 `checked_at` 非空 |
| 本站补充 | ≥2 条，且有 `gaps` 说明 |
| 常见误区 | ≥2 条 |
| 理论题 | ≥2 道，答案与解析齐全 |
| 配套实操 | 至少 1 个实验（专属或明确相关） |
| 实验判分 | 校验项齐全、分值合计 100 |
| 页面 | 裸反引号 / 控制台错误 / 窄屏溢出（人工确认） |

目前该工具**默认只报告、不阻断**（`--strict` 才返回非 0）：因为现有的 `oe-02` 五个小节虽然标了
`ready`，但资料全是 `candidate`、也没有 `backup`，按门槛并不达标。等 `oe-02` 补齐后再把
`--strict` 接进流程。

---

## 当前状态

已完成（纵向样板跑通）：

- 站点骨架与全部页面路由，`file://` 直开可用，无控制台报错。
- openEuler「用户、组与权限」整条线 5 个小节（`oe-02-01`～`oe-02-05`）状态为 `ready`：
  10 道题 + 10 条资料 + 文字补充与版本纠错 + 常见误区 + 1 个 setgid/sticky 实验。
- 103 道理论题全部有解析、全部归入小节，无重复无遗漏；其中 84 道来自源 Markdown，19 道为本站补充题。
- 84 道基础题已固化为仓库内 JSON；clone 后无需原 Markdown 即可重新构建和校验。
- 45 个小节均至少有 2 道理论题，可独立发起小节测验。
- 6 个模拟实操可完整跑通并判分（实测 100 分满分路径与重置路径）。
- 资料台账与实验说明由脚本生成，与数据同源。
- 已部署 GitHub Pages，`file://` 直开与线上 https 两种方式都跑过交互验收。
- openEuler「命令与文件」两节（`oe-01-01`、`oe-01-02`）已真正达到发布门槛：2 条主资料用妙记转写+章节摘要完成内容验收并标 `verified`，`covers`/`gaps` 按实际内容校正，`check-ready.py` 九项全绿。
- `tools/test-lab.mjs` 覆盖 18 条 chmod 写法 + 4 条实验判分路径 + 19 条文件/链接/归档用例，本地与线上各跑一遍全绿。

待补：

- 其余 38 个小节内容仍是 `draft`（小节骨架在，文字与资料未填）。
- 40 条资料仍是 `candidate`，需要人工观看后改成 `verified`，并补 `backup` 资料；`oe-01` 两节的 2 条主资料已转 `verified`。
- openGauss 与鲲鹏两域还没有中文讲解资源（`resources: []`），需要检索与验收。
- L3 真实沙箱未接入。

内容填充顺序建议：先把 openEuler 剩下 6 个专题按同样标准补完（题 → 资料 → 文字补充 → 实验），
再开 openGauss（SQL 实验引擎已就绪），最后鲲鹏（依赖审查型实验为主）。

---

## 声明

本站是**个人备赛学习平台**。题目为按公开考纲编写的预测练习，**不是大赛官方真题**，也不代表命题方立场。
软件版本、考试范围与评分规则以大赛官网、赛区通知和考前下发文档为准。

外部视频与图文只做链接跳转，不下载、不转载、不二次分发；版权归原作者所有。
