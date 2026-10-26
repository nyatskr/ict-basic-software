#!/usr/bin/env python3
"""构建数据层：把固化基础题（或可选源 Markdown）与 content/ 内容合并成浏览器可直接加载的 JS。

产物（assets/js/data/）：
    bank.js      window.ICT_BANK     理论题
    catalog.js   window.ICT_CATALOG  域 / 专题 / 小节 / 资料
    labs.js      window.ICT_LABS     模拟实操

源文件：
    content/questions.base.json    固化的基础题（84 题，可独立构建）
    content/questions.extra.json   本站补充题
    content/explanations.json      源文档缺失的解析
    content/catalog.json           域、专题、资料
    content/sections.*.json        学习小节（按域拆文件）
    content/labs.json              模拟实操

可选输入：
    <markdown>                     重新解析第 9 章；构建成功后刷新 questions.base.json

用法：
    python tools/build-data.py                    # 用固化 JSON 构建
    python tools/build-data.py --check            # 用固化 JSON 校验
    python tools/build-data.py <markdown>          # 重新解析、刷新固化 JSON 并构建
    python tools/build-data.py <markdown> --check  # 只解析和校验，不写文件
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_QUESTIONS = os.path.join(ROOT, "content", "questions.base.json")
sys.path.insert(0, os.path.join(ROOT, "tools"))
from importlib.machinery import SourceFileLoader  # noqa: E402

parse_mod = SourceFileLoader("parse_questions", os.path.join(ROOT, "tools", "parse-questions.py")).load_module()

TYPE_MAP = {"单选": "single", "多选": "multiple", "判断": "judge"}
VERSION_OF = {
    "oe": "openEuler 24.03-LTS-SP2",
    "og": "openGauss 7.0",
    "kp": "Kunpeng DevKit / AArch64",
}
DIFFICULTY_OF = {"single": "基础", "multiple": "进阶", "judge": "基础"}

errors = []
warnings = []
notes = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def note(msg):
    notes.append(msg)


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_source_questions(markdown=None):
    """读基础题：给了 Markdown 就重新解析，否则用仓库内固化的快照。"""
    if markdown:
        if not os.path.isfile(markdown):
            raise SystemExit(f"找不到题库 Markdown：{markdown}")
        with open(markdown, encoding="utf-8") as f:
            return parse_mod.parse(f.read()), f"Markdown：{markdown}"
    if not os.path.isfile(BASE_QUESTIONS):
        raise SystemExit(
            "缺少 content/questions.base.json。"
            "请从版本库恢复，或运行 python tools/build-data.py <题库.md> 重新生成。"
        )
    return load(BASE_QUESTIONS), "content/questions.base.json"


def write_json(path, data):
    # newline="\n" 固定换行符：Windows 上默认会写成 \r\n，导致同一份内容在不同平台产生 diff
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def reset_messages():
    errors.clear()
    warnings.clear()
    notes.clear()


def build(markdown=None, raw_questions=None):
    reset_messages()
    catalog = load(os.path.join(ROOT, "content", "catalog.json"))
    explanations = load(os.path.join(ROOT, "content", "explanations.json"))
    extra = [dict(q) for q in load(os.path.join(ROOT, "content", "questions.extra.json"))]
    labs = load(os.path.join(ROOT, "content", "labs.json"))

    sections = []
    for f in sorted(glob.glob(os.path.join(ROOT, "content", "sections.*.json"))):
        sections.extend(load(f))

    # ---------- 域 / 专题 ----------
    domain_ids = {d["id"] for d in catalog["domains"]}
    topic_by_id = {}
    for t in catalog["topics"]:
        if t["id"] in topic_by_id:
            err(f"专题 id 重复：{t['id']}")
        topic_by_id[t["id"]] = t
        if t["domain"] not in domain_ids:
            err(f"专题 {t['id']} 的域 {t['domain']} 不存在")

    # ---------- 题库 ----------
    if raw_questions is None:
        raw_questions, _ = load_source_questions(markdown)
    raw = [dict(q) for q in raw_questions]
    for q in raw:
        q["source"] = "prediction"
    for q in extra:
        q["source"] = "site"

    all_q = raw + extra
    q_by_id = {}
    for q in all_q:
        if q["id"] in q_by_id:
            err(f"题号重复：{q['id']}")
        q_by_id[q["id"]] = q

    # ---------- 小节 ----------
    sec_by_id = {}
    qid_owner = {}
    for s in sections:
        sid = s["id"]
        if sid in sec_by_id:
            err(f"小节 id 重复：{sid}")
        sec_by_id[sid] = s
        if s["topic_id"] not in topic_by_id:
            err(f"小节 {sid} 的专题 {s['topic_id']} 不存在")
        elif topic_by_id[s["topic_id"]]["domain"] != sid.split("-")[0]:
            err(f"小节 {sid} 与专题 {s['topic_id']} 的域不一致")
        for qid in s.get("question_ids", []):
            if qid not in q_by_id:
                err(f"小节 {sid} 引用了不存在的题号 {qid}")
                continue
            if qid in qid_owner:
                err(f"题号 {qid} 同时属于 {qid_owner[qid]} 与 {sid}")
            qid_owner[qid] = sid
        for rid in s.get("resources", []):
            if rid not in catalog["resources"]:
                err(f"小节 {sid} 引用了不存在的资料 {rid}")
        if not s.get("objectives"):
            warn(f"小节 {sid} 没有学习目标")

    for q in all_q:
        if q["id"] not in qid_owner:
            err(f"题号 {q['id']} 没有归入任何小节")

    # ---------- 实验 ----------
    lab_by_id = {}
    for lab in labs:
        lid = lab["id"]
        if lid in lab_by_id:
            err(f"实验 id 重复：{lid}")
        lab_by_id[lid] = lab
        if lab.get("section_id") and lab["section_id"] not in sec_by_id:
            err(f"实验 {lid} 指向不存在的小节 {lab['section_id']}")
        if lab.get("topic_id") not in topic_by_id:
            err(f"实验 {lid} 指向不存在的专题 {lab.get('topic_id')}")
        if lab["kind"] == "audit":
            if not lab.get("items"):
                err(f"实验 {lid} 是 audit 类型但没有 items")
            for it in lab.get("items", []):
                if it["answer"] not in {o["id"] for o in lab.get("options", [])}:
                    err(f"实验 {lid} 的 {it['id']} 答案不在选项内")
        else:
            total = sum(v.get("weight", 0) for v in lab.get("validators", []))
            if total != 100:
                err(f"实验 {lid} 的分值合计为 {total}，应为 100")
            for v in lab.get("validators", []):
                if not isinstance(v.get("path"), list):
                    err(f"实验 {lid} 的校验项 {v.get('id')} 缺少 path 数组")

    for s in sections:
        for lid in s.get("lab_ids", []):
            if lid not in lab_by_id:
                err(f"小节 {s['id']} 引用了不存在的实验 {lid}")
        for lid in s.get("lab_ids", []):
            lab = lab_by_id.get(lid)
            if lab and lab.get("section_id") and lab["section_id"] != s["id"]:
                note(f"共享实验：{lid} 主归属 {lab['section_id']}，{s['id']} 也引用它")

    # ---------- 组装题库 ----------
    questions = []
    for q in all_q:
        qtype = TYPE_MAP[q["kind"]]
        sid = qid_owner.get(q["id"], "")
        explain = (q.get("explain") or "").strip()
        if not explain:
            explain = (explanations.get(q["id"]) or "").strip()
            if not explain:
                err(f"题号 {q['id']} 没有解析")
        questions.append({
            "id": q["id"],
            "domain": q["domain"],
            "topic_id": sec_by_id[sid]["topic_id"] if sid in sec_by_id else "",
            "section_id": sid,
            "cluster": q.get("cluster", ""),
            "type": qtype,
            "stem": q["stem"],
            "options": q["options"],
            "answer": q["answer"],
            "explain": explain,
            "source": q["source"],
            "version": VERSION_OF.get(q["domain"], ""),
            "difficulty": DIFFICULTY_OF[qtype],
        })

    order = {t["id"]: i for i, t in enumerate(catalog["topics"])}
    questions.sort(key=lambda q: (order.get(q["topic_id"], 99), q["id"]))

    bank = {
        "schema_version": 1,
        "bank_version": "2026.10-b2",
        "title": "基础软件赛道 · 理论题库",
        "scope_note": catalog["site"]["scope_note"],
        "updated_at": catalog["updated_at"],
        "questions": questions,
    }

    # ---------- 组装目录 ----------
    for s in sections:
        s.setdefault("lab_ids", [])
        s.setdefault("resources", [])
        s.setdefault("notes", [])
        s.setdefault("pitfalls", [])
        s.setdefault("search_terms", [])
        s.setdefault("gaps", "")
    for t in catalog["topics"]:
        t["section_ids"] = [s["id"] for s in sections if s["topic_id"] == t["id"]]
        t["lab_ids"] = [l["id"] for l in labs if l.get("topic_id") == t["id"]]

    out_catalog = dict(catalog)
    out_catalog["sections"] = sections
    out_catalog["stats"] = {
        "domains": len(catalog["domains"]),
        "topics": len(catalog["topics"]),
        "sections": len(sections),
        "resources": len(catalog["resources"]),
        "labs": len(labs),
        "questions": len(questions),
    }

    return bank, out_catalog, labs


def dump(name, var, data):
    path = os.path.join(ROOT, "assets", "js", "data", name)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* 由 tools/build-data.py 生成，不要手改。源文件在 content/，也可从题库 Markdown 刷新基础题。 */\n")
        f.write(f"window.{var}={body};\n")
    return path, len(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("markdown", nargs="?", help="可选：含第 9 章原创题库的 Markdown")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    raw_questions, source_label = load_source_questions(args.markdown)
    bank, catalog, labs = build(raw_questions=raw_questions)

    print(f"基础题 {len(raw_questions)} 道（{source_label}）")
    print(f"题目 {len(bank['questions'])} 道")
    print(f"域 {catalog['stats']['domains']} / 专题 {catalog['stats']['topics']} / 小节 {catalog['stats']['sections']} / 资料 {catalog['stats']['resources']} / 实验 {catalog['stats']['labs']}")

    by_sec = {}
    for q in bank["questions"]:
        by_sec[q["section_id"]] = by_sec.get(q["section_id"], 0) + 1
    thin = [s["id"] for s in catalog["sections"] if by_sec.get(s["id"], 0) < 2]
    if thin:
        print(f"  题量少于 2 的小节：{', '.join(thin)}")

    for w in warnings:
        print(f"  ! {w}")
    for n in notes:
        print(f"  · {n}")
    if errors:
        print("\n有 %d 处错误：" % len(errors))
        for e in errors:
            print("  x", e)
        return 1

    if args.check:
        print("\n校验通过（未写文件）")
        return 0

    if args.markdown:
        write_json(BASE_QUESTIONS, raw_questions)
        print(f"  刷新 {os.path.relpath(BASE_QUESTIONS, ROOT)}")

    for name, var, data in (
        ("bank.js", "ICT_BANK", bank),
        ("catalog.js", "ICT_CATALOG", catalog),
        ("labs.js", "ICT_LABS", labs),
    ):
        p, n = dump(name, var, data)
        print(f"  写入 {os.path.relpath(p, ROOT)}  {n / 1024:.1f} KB")

    print("\n构建完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
