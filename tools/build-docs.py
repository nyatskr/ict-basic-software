#!/usr/bin/env python3
"""从 content/ 生成 docs/ 下的两份台账，保证文档与数据同源。

产物：
    docs/resources.md   讲解资料台账（平台、标题、角色、验收状态、覆盖、缺口、检查日期）
    docs/labs.md        模拟实操说明（场景、任务、校验项与分值、提示、参考解法）

用法：
    python tools/build-docs.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PLATFORM = {
    "bilibili": "B 站",
    "douyin": "抖音",
    "xiaohongshu": "小红书",
    "aliyun": "阿里云开发者社区",
    "php.cn": "php.cn",
    "web": "网页",
    "blog": "博客",
    "doc": "官方文档",
    "site": "本站",
}
ROLE = {"main": "主资料", "supplement": "补充", "backup": "备用"}
STATUS = {"candidate": "待验收", "verified": "已验收", "dead": "已失效"}
LEVEL = {"L1": "L1 引导模拟", "L2": "L2 状态实验", "L3": "L3 真实沙箱"}
KIND = {"linux": "终端", "sql": "SQL 控制台", "audit": "证据审查"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cell(text):
    """表格单元里不能出现竖线，长文本压成一行。"""
    s = str(text if text is not None else "").replace("|", "／").replace("\n", " ").strip()
    return s if s else "—"


def build_resources(catalog, sections):
    res = catalog["resources"]
    sec_by_res = {}
    for s in sections:
        for rid in s.get("resources", []):
            sec_by_res.setdefault(rid, []).append(s["id"])

    n_video = sum(1 for r in res.values() if r.get("kind") == "video")
    n_art = len(res) - n_video
    n_verified = sum(1 for r in res.values() if r.get("status") == "verified")
    n_dead = sum(1 for r in res.values() if r.get("status") == "dead")

    out = [
        "# 讲解资料台账",
        "",
        "> 由 `tools/build-docs.py` 从 `content/catalog.json` 生成，不要手改。",
        "",
        "## 验收规则",
        "",
        "1. **只有 `verified` 的资料才能当主资料用。** `candidate` 表示链接与时长已核对、内容还没人工看完；"
        "`dead` 表示链接失效或内容已被版本淘汰。",
        "2. 每条资料必须记录**适用版本**与**覆盖/缺口**。技术事实以厂商官方文档为最终依据，视频只作讲解。",
        "3. 抖音、小红书只存链接与摘要，不下载、不转载。",
        "4. 每个小节至少准备一条**备用资料**，主资料失效时能立刻替换。",
        "5. 改完内容后重新跑 `python tools/build-data.py <题库.md>` 与 `python tools/build-docs.py`。",
        "",
        "## 统计",
        "",
        f"- 资料总数 **{len(res)}** 条：视频 {n_video} · 图文 {n_art}",
        f"- 已人工验收 **{n_verified}** 条 · 待验收 **{len(res) - n_verified - n_dead}** 条 · 已失效 **{n_dead}** 条",
        "",
        "## 按域查看",
        "",
    ]

    for d in catalog["domains"]:
        ids = [t["id"] for t in catalog["topics"] if t["domain"] == d["id"]]
        rows = []
        for rid, r in res.items():
            used = sec_by_res.get(rid, [])
            if not any(u.startswith(tuple(ids)) for u in used):
                continue
            rows.append((rid, r, used))
        out.append(f"### {d['name']}（{d['id']}）")
        out.append("")
        if not rows:
            out.append("_暂无收录资料。_")
            out.append("")
            continue
        out.append("| ID | 平台 | 标题 | 链接 | 类型 | 角色 | 状态 | 覆盖 | 缺口 | 版本口径 | 检查日期 | 用于小节 |")
        out.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
        for rid, r, used in rows:
            out.append(
                "| `{}` | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |".format(
                    rid,
                    PLATFORM.get(r.get("platform"), r.get("platform", "—")),
                    cell(r.get("title")),
                    ("[打开](%s)" % r["url"]) if r.get("url") else "—",
                    "视频" if r.get("kind") == "video" else "图文",
                    ROLE.get(r.get("role"), r.get("role", "—")),
                    STATUS.get(r.get("status"), r.get("status", "—")),
                    cell("、".join(r.get("covers", []))),
                    cell(r.get("gaps")),
                    cell(r.get("version_note")),
                    cell(r.get("checked_at")),
                    cell("、".join(used)),
                )
            )
        out.append("")

    unused = [rid for rid in res if rid not in sec_by_res]
    if unused:
        out += ["## 未被任何小节引用", "", "、".join(f"`{x}`" for x in unused), ""]

    return "\n".join(out) + "\n"


def build_labs(labs, catalog, sections):
    sec_by_id = {s["id"]: s for s in sections}
    dom_by_id = {d["id"]: d for d in catalog["domains"]}

    out = [
        "# 模拟实操说明",
        "",
        "> 由 `tools/build-docs.py` 从 `content/labs.json` 生成，不要手改。",
        "",
        "## 设计原则",
        "",
        "- **按最终状态评分，不按命令字符串评分。** 校验项读的是状态机里的最终状态（用户属组、文件 mode、"
        "服务 active/enabled、防火墙端口、PV/VG/LV/挂载、角色授权），因此 `chmod 3770` 与"
        " `chmod u=rwx,g=rwx,o= && chmod g+s,o+t` 两种写法都算对（单独 `chmod g+s,o+t` 只加特殊位，不构成等价）。",
        "- 分值合计固定 100，**≥80 分算通过**。未通过时逐项列出没打勾的校验项。",
        "- 每个实验都能**一键重置**，回到 `initial_state` 重来，不计惩罚。",
        "- 实验分三层：L1 只读证据做判断；L2 可操作的状态机模拟；L3 真实沙箱（尚未接入）。",
        "",
        "## 实验清单",
        "",
        "| ID | 名称 | 域 | 类型 | 层级 | 分值项 | 通过线 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for lab in labs:
        n = len(lab.get("items", [])) if lab["kind"] == "audit" else len(lab.get("validators", []))
        dom = dom_by_id.get(lab["domain"], {}).get("name", lab["domain"])
        out.append(
            f"| `{lab['id']}` | {cell(lab['title'])} | {dom} | {KIND.get(lab['kind'], lab['kind'])} | "
            f"{LEVEL.get(lab['level'], lab['level'])} | {n} | 80 |"
        )
    out.append("")

    for lab in labs:
        sec = sec_by_id.get(lab.get("section_id"))
        out += [
            f"## {lab['title']}（`{lab['id']}`）",
            "",
            f"- 类型：{KIND.get(lab['kind'], lab['kind'])} · 层级：{LEVEL.get(lab['level'], lab['level'])} · 建议 {lab.get('minutes')} 分钟",
            f"- 适用版本：{lab.get('version', '—')}",
            f"- 归属：{dom_by_id.get(lab['domain'], {}).get('name', lab['domain'])} / {lab.get('topic_id')}"
            + (f" / {sec['id']} {sec['title']}" if sec else ""),
            "",
            f"**场景**：{lab.get('scenario', '')}",
            "",
        ]
        if lab.get("objectives"):
            out += ["**这一题要练**", ""] + [f"- {o}" for o in lab["objectives"]] + [""]
        if lab.get("tasks"):
            out += ["**任务**", ""] + [f"{i}. {t['text']}" for i, t in enumerate(lab["tasks"], 1)] + [""]
        if lab["kind"] == "audit":
            out += ["**证据项与正确判定**", "", "| 组件 | 证据 | 正确判定 | 为什么 |", "| --- | --- | --- | --- |"]
            opt_label = {o["id"]: o["label"] for o in lab.get("options", [])}
            for it in lab.get("items", []):
                ev = it["evidence"].replace("\n", "<br>").replace("|", "／")
                out.append(
                    f"| {cell(it['name'])} | {ev} | {it['answer']}. {cell(opt_label.get(it['answer'], ''))} | {cell(it.get('why'))} |"
                )
            out.append("")
        else:
            out += ["**校验项（合计 100 分）**", "", "| 校验项 | 判据 | 分值 |", "| --- | --- | --- |"]
            for v in lab.get("validators", []):
                path = ".".join(str(p) for p in v.get("path", []))
                op = v.get("op")
                val = v.get("value")
                if op == "exists":
                    rule = f"`{path}` 存在"
                elif op == "eq":
                    rule = f"`{path}` == `{val}`"
                elif op == "contains":
                    rule = f"`{path}` 含 `{val}`"
                elif op == "gte":
                    rule = f"`{path}` ≥ `{val}`"
                elif op == "grant":
                    rule = f"`{path}` 具备 {val}"
                elif op == "fstab_has":
                    rule = f"fstab 含 `{val}`"
                else:
                    rule = f"`{path}` {op} {val}"
                out.append(f"| {cell(v['label'])} | {rule} | {v['weight']} |")
            out.append("")
        if lab.get("hints"):
            out += ["**提示（可在页面逐条展开）**", ""] + [f"- {h['text']}" for h in lab["hints"]] + [""]
        if lab.get("solution"):
            out += ["**参考解法（只是一种写法）**", "", "```bash"] + lab["solution"] + ["```", ""]

    return "\n".join(out) + "\n"


def main():
    catalog = load(os.path.join(ROOT, "content", "catalog.json"))
    labs = load(os.path.join(ROOT, "content", "labs.json"))
    sections = []
    for name in sorted(os.listdir(os.path.join(ROOT, "content"))):
        if name.startswith("sections.") and name.endswith(".json"):
            sections.extend(load(os.path.join(ROOT, "content", name)))

    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    rp = os.path.join(ROOT, "docs", "resources.md")
    lp = os.path.join(ROOT, "docs", "labs.md")
    with open(rp, "w", encoding="utf-8") as f:
        f.write(build_resources(catalog, sections))
    with open(lp, "w", encoding="utf-8") as f:
        f.write(build_labs(labs, catalog, sections))
    print(f"写入 {os.path.relpath(rp, ROOT)}")
    print(f"写入 {os.path.relpath(lp, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
