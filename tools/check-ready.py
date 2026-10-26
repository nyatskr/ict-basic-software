#!/usr/bin/env python3
"""按 ready 门槛逐节评估，回答「这一节到底能不能标 ready」。

默认只报告，不影响退出码——因为现有 oe-02 资料仍是 candidate，立刻当硬错误会把
整条链路卡死。等 oe-02 的资料补齐、规则稳定后，再用 --strict 接进 CI。

用法：
    python tools/check-ready.py             # 报告所有小节
    python tools/check-ready.py oe-01-01    # 只看指定小节（可多个）
    python tools/check-ready.py --draft     # 只看 draft
    python tools/check-ready.py --ready     # 只看已标 ready 的（查有没有名不副实）
    python tools/check-ready.py --strict    # 已标 ready 的小节若不达标，返回 1
"""

import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "content")

# 门槛值集中在这里，改标准只改这一处
MIN_OBJECTIVES = 2
MAX_OBJECTIVES = 4
MIN_PITFALLS = 2
MIN_QUESTIONS = 2
MIN_BACKUP = 1
MIN_NOTES = 2
VALIDATOR_TOTAL = 100

# 页面类检查无法离线判定，明确列为人工项，避免被当成"自动通过"
MANUAL_CHECKS = [
    "页面无裸反引号（跑 tools/check-content.py 可覆盖一部分）",
    "浏览器控制台 0 错误",
    "820px / 480px 无横向溢出",
]


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_all():
    catalog = load_json(os.path.join(CONTENT, "catalog.json"))
    labs = load_json(os.path.join(CONTENT, "labs.json"))
    explanations = load_json(os.path.join(CONTENT, "explanations.json"))
    questions = {}
    for name in ("questions.base.json", "questions.extra.json"):
        for q in load_json(os.path.join(CONTENT, name)):
            questions[q["id"]] = q
    sections = []
    for path in sorted(glob.glob(os.path.join(CONTENT, "sections.*.json"))):
        sections.extend(load_json(path))
    return catalog, labs, explanations, questions, sections


def evaluate(section, catalog, labs_by_id, questions, explanations):
    """返回 [(项名, 是否通过, 说明)]。"""
    resources = catalog.get("resources") or {}
    checks = []

    def add(name, ok, detail):
        checks.append((name, bool(ok), detail))

    objectives = section.get("objectives") or []
    ok = MIN_OBJECTIVES <= len(objectives) <= MAX_OBJECTIVES
    add(
        "学习目标",
        ok,
        f"{len(objectives)} 条（要求 {MIN_OBJECTIVES}–{MAX_OBJECTIVES}）",
    )

    res_ids = section.get("resources") or []
    res = [(rid, resources.get(rid)) for rid in res_ids]
    known = [(rid, r) for rid, r in res if isinstance(r, dict)]

    mains = [(rid, r) for rid, r in known if r.get("role") == "main" and r.get("status") == "verified"]
    add("主资料 verified+main", mains, f"{len(mains)} 条" + ("" if mains else "（需要至少 1 条人工看完并标 verified）"))

    backups = [(rid, r) for rid, r in known if r.get("role") == "backup"]
    backups_checked = [(rid, r) for rid, r in backups if r.get("checked_at")]
    add(
        "备用资料 backup",
        len(backups_checked) >= MIN_BACKUP,
        f"{len(backups_checked)} 条已检查" + ("" if backups_checked else f"（要求至少 {MIN_BACKUP} 条）"),
    )

    notes = section.get("notes") or []
    gaps = (section.get("gaps") or "").strip()
    add(
        "本站补充与缺口记录",
        len(notes) >= MIN_NOTES and bool(gaps),
        f"补充 {len(notes)} 条，缺口说明 {'有' if gaps else '无'}（要求补充 ≥{MIN_NOTES} 条且有缺口说明）",
    )

    pitfalls = section.get("pitfalls") or []
    add("常见误区", len(pitfalls) >= MIN_PITFALLS, f"{len(pitfalls)} 条（要求 ≥{MIN_PITFALLS}）")

    qids = section.get("question_ids") or []
    bad_q = []
    for qid in qids:
        q = questions.get(qid)
        if not q:
            bad_q.append(f"{qid} 不存在")
            continue
        if not (q.get("explain") or explanations.get(qid)):
            bad_q.append(f"{qid} 无解析")
        if not q.get("answer"):
            bad_q.append(f"{qid} 无答案")
    add(
        "理论题",
        len(qids) >= MIN_QUESTIONS and not bad_q,
        f"{len(qids)} 道（要求 ≥{MIN_QUESTIONS}）" + (f"，问题：{'；'.join(bad_q)}" if bad_q else ""),
    )

    lab_ids = section.get("lab_ids") or []
    labs = [(lid, labs_by_id.get(lid)) for lid in lab_ids]
    labs_ok = [(lid, lab) for lid, lab in labs if isinstance(lab, dict)]
    add("配套实操", labs_ok, f"{len(labs_ok)} 个" + ("" if labs_ok else "（需要专属实验或明确相关的专题实验）"))

    bad_lab = []
    for lid, lab in labs_ok:
        validators = lab.get("validators") or []
        total = sum(int(v.get("weight") or 0) for v in validators)
        if total != VALIDATOR_TOTAL:
            bad_lab.append(f"{lid} 分值合计 {total}≠{VALIDATOR_TOTAL}")
        if not validators:
            bad_lab.append(f"{lid} 没有校验项")
    add(
        "实验按状态判分",
        labs_ok and not bad_lab,
        "校验项齐全、合计 100" if labs_ok and not bad_lab else ("；".join(bad_lab) or "无实验"),
    )

    return checks


def section_resources_summary(section, catalog):
    resources = catalog.get("resources") or {}
    counts = {"verified": 0, "candidate": 0, "dead": 0, "backup": 0, "total": 0}
    for rid in section.get("resources") or []:
        r = resources.get(rid)
        if not isinstance(r, dict):
            continue
        counts["total"] += 1
        status = r.get("status")
        if status in counts:
            counts[status] += 1
        if r.get("role") == "backup":
            counts["backup"] += 1
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sections", nargs="*", help="只检查这些小节的 id")
    ap.add_argument("--draft", action="store_true", help="只看 draft")
    ap.add_argument("--ready", action="store_true", help="只看已标 ready")
    ap.add_argument("--strict", action="store_true", help="已标 ready 的小节若不达标则返回 1")
    ap.add_argument("--quiet", action="store_true", help="只输出不达标的小节")
    args = ap.parse_args()

    catalog, labs, explanations, questions, sections = load_all()
    labs_by_id = {lab["id"]: lab for lab in labs if isinstance(lab, dict)}

    targets = sections
    if args.sections:
        wanted = set(args.sections)
        targets = [s for s in sections if s.get("id") in wanted]
        missing = wanted - {s.get("id") for s in targets}
        for sid in sorted(missing):
            print(f"! 找不到小节 {sid}")
    if args.draft:
        targets = [s for s in targets if s.get("status") == "draft"]
    if args.ready:
        targets = [s for s in targets if s.get("status") == "ready"]

    ready_fail = []
    passed_all = 0

    for section in targets:
        sid = section.get("id")
        status = section.get("status")
        checks = evaluate(section, catalog, labs_by_id, questions, explanations)
        failed = [(name, detail) for name, ok, detail in checks if not ok]
        counts = section_resources_summary(section, catalog)

        if not failed:
            passed_all += 1
            if not args.quiet:
                print(f"PASS  {sid}  [{status}]  {section.get('title')}")
            continue

        if status == "ready":
            ready_fail.append(sid)

        flag = "!!" if status == "ready" else "--"
        print(f"{flag} {sid}  [{status}]  {section.get('title')}")
        print(
            f"     资料 {counts['total']} 条：verified {counts['verified']} / "
            f"candidate {counts['candidate']} / dead {counts['dead']} / backup {counts['backup']}"
        )
        for name, detail in failed:
            print(f"     x {name}：{detail}")

    total = len(targets)
    print()
    print(f"=== 共 {total} 节：完全达标 {passed_all}，有缺口 {total - passed_all}")
    if ready_fail:
        print(f"!!! 已标 ready 但未达标：{', '.join(ready_fail)}")
        print("    这些小节在页面上显示为「已完成」，但按门槛还不能算可发布。")
    else:
        print("已标 ready 的小节全部达标。")

    print("\n需人工确认（工具无法判定）：")
    for item in MANUAL_CHECKS:
        print(f"  · {item}")

    if args.strict and ready_fail:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
