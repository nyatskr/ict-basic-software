#!/usr/bin/env python3
"""对题库、目录引用、生成产物与富文本渲染约定做一次可重复的内容校验。"""

import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from importlib.machinery import SourceFileLoader


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "content")
DATA = os.path.join(ROOT, "assets", "js", "data")

DOMAIN_PREFIX = {"oe": "OE", "og": "OG", "kp": "KP"}
KINDS = {"单选", "多选", "判断"}
BASE_ID = re.compile(r"^(OE|OG|KP)-\d{2}$")
EXTRA_ID = re.compile(r"^(OE|OG|KP)-X\d{2}$")

errors = []
warnings = []


def error(message):
    errors.append(message)


def warn(message):
    warnings.append(message)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        error(f"无法读取 {os.path.relpath(path, ROOT)}：{exc}")
        return None


def text(value):
    return isinstance(value, str) and bool(value.strip())


def check_question_shape(question, source_name, explanations):
    qid = question.get("id", "<无 id>")
    required = ("id", "domain", "kind", "cluster", "stem", "options", "answer")
    for field in required:
        if field not in question:
            error(f"{source_name} 的 {qid} 缺少字段 {field}")

    domain = question.get("domain")
    prefix = DOMAIN_PREFIX.get(domain)
    if not prefix:
        error(f"{qid} 的域无效：{domain}")
    elif not str(qid).startswith(prefix + "-"):
        error(f"{qid} 的题号前缀与域 {domain} 不一致")

    pattern = BASE_ID if source_name == "基础题" else EXTRA_ID
    if not pattern.match(str(qid)):
        error(f"{source_name} 题号格式错误：{qid}")

    kind = question.get("kind")
    if kind not in KINDS:
        error(f"{qid} 的题型无效：{kind}")
    if not text(question.get("cluster")):
        error(f"{qid} 没有 cluster")
    if not text(question.get("stem")):
        error(f"{qid} 没有题干")

    options = question.get("options")
    if not isinstance(options, list):
        error(f"{qid} 的 options 不是数组")
        options = []
    option_ids = [o.get("id") for o in options if isinstance(o, dict)]
    if len(option_ids) != len(options) or any(not text(x) for x in option_ids):
        error(f"{qid} 存在无效选项 id")
    if len(option_ids) != len(set(option_ids)):
        error(f"{qid} 的选项 id 重复")
    if any(not text(o.get("text")) for o in options if isinstance(o, dict)):
        error(f"{qid} 存在空选项")
    expected_options = 2 if kind == "判断" else 4
    if kind in KINDS and len(options) != expected_options:
        error(f"{qid} 的选项数为 {len(options)}，{kind}题应为 {expected_options}")

    answer = question.get("answer")
    if not isinstance(answer, list) or not answer:
        error(f"{qid} 没有有效答案数组")
        answer = []
    invalid_answers = [x for x in answer if x not in option_ids]
    if invalid_answers:
        error(f"{qid} 的答案不在选项内：{', '.join(map(str, invalid_answers))}")
    if len(answer) != len(set(answer)):
        error(f"{qid} 的答案项重复")
    if kind in {"单选", "判断"} and len(answer) != 1:
        error(f"{qid} 是{kind}题，但答案数为 {len(answer)}")
    if kind == "多选" and len(answer) < 2:
        error(f"{qid} 是多选题，但答案少于 2 项")

    effective_explain = question.get("explain") or explanations.get(qid)
    if not text(effective_explain):
        error(f"{qid} 没有解析")


def walk_strings(value, path):
    if isinstance(value, str):
        if len(re.findall(r"(?<!\\)`", value)) % 2:
            error(f"{path} 含有未配对的反引号")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            walk_strings(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            walk_strings(item, f"{path}.{key}")


def load_generated(name, variable):
    path = os.path.join(DATA, name)
    try:
        with open(path, encoding="utf-8") as f:
            source = f.read()
        marker = f"window.{variable}="
        start = source.index(marker) + len(marker)
        payload = source[start:].strip()
        if payload.endswith(";"):
            payload = payload[:-1]
        return json.loads(payload)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        error(f"无法读取生成产物 assets/js/data/{name}：{exc}")
        return None


def main():
    errors.clear()
    warnings.clear()

    base_path = os.path.join(CONTENT, "questions.base.json")
    extra_path = os.path.join(CONTENT, "questions.extra.json")
    explanations_path = os.path.join(CONTENT, "explanations.json")
    catalog_path = os.path.join(CONTENT, "catalog.json")
    labs_path = os.path.join(CONTENT, "labs.json")

    base = load_json(base_path)
    extra = load_json(extra_path)
    explanations = load_json(explanations_path)
    catalog = load_json(catalog_path)
    labs = load_json(labs_path)
    sections = []
    for path in sorted(glob.glob(os.path.join(CONTENT, "sections.*.json"))):
        value = load_json(path)
        if isinstance(value, list):
            sections.extend(value)

    if any(value is None for value in (base, extra, explanations, catalog, labs)):
        return finish()
    if not all(isinstance(value, list) for value in (base, extra, labs)):
        error("questions.base.json、questions.extra.json 与 labs.json 顶层必须是数组")
        return finish()
    if not isinstance(explanations, dict) or not isinstance(catalog, dict):
        error("explanations.json 与 catalog.json 顶层必须是对象")
        return finish()

    if len(base) != 84:
        error(f"基础题应为 84 道，实际为 {len(base)} 道")

    all_questions = base + extra
    for question in base:
        if isinstance(question, dict):
            check_question_shape(question, "基础题", explanations)
        else:
            error("questions.base.json 中存在非对象条目")
    for question in extra:
        if isinstance(question, dict):
            check_question_shape(question, "补充题", explanations)
        else:
            error("questions.extra.json 中存在非对象条目")

    qids = [q.get("id") for q in all_questions if isinstance(q, dict)]
    question_by_id = {q.get("id"): q for q in all_questions if isinstance(q, dict)}
    for qid, count in Counter(qids).items():
        if count > 1:
            error(f"题号重复：{qid}（{count} 次）")

    base_clusters = defaultdict(set)
    for question in base:
        if isinstance(question, dict):
            base_clusters[question.get("domain")].add(question.get("cluster"))
    for question in extra:
        if not isinstance(question, dict):
            continue
        domain = question.get("domain")
        if question.get("cluster") not in base_clusters.get(domain, set()):
            error(f"{question.get('id')} 的 cluster 不在 {domain} 基础题章节名中：{question.get('cluster')}")

    topics = {topic.get("id"): topic for topic in catalog.get("topics", []) if isinstance(topic, dict)}
    section_by_id = {}
    owners = defaultdict(list)
    for section in sections:
        if not isinstance(section, dict):
            error("sections.*.json 中存在非对象条目")
            continue
        sid = section.get("id", "<无 id>")
        if sid in section_by_id:
            error(f"小节 id 重复：{sid}")
        section_by_id[sid] = section
        topic = topics.get(section.get("topic_id"))
        if not topic:
            error(f"小节 {sid} 指向不存在的专题 {section.get('topic_id')}")
            section_domain = None
        else:
            section_domain = topic.get("domain")
            if sid.split("-")[0] != section_domain:
                error(f"小节 {sid} 与专题域 {section_domain} 不一致")
        section_qids = section.get("question_ids", [])
        if not isinstance(section_qids, list):
            error(f"小节 {sid} 的 question_ids 不是数组")
            continue
        if len(section_qids) < 2:
            error(f"小节 {sid} 题量少于 2 道")
        for qid in section_qids:
            owners[qid].append(sid)
            question = question_by_id.get(qid)
            if question is None:
                error(f"小节 {sid} 引用了不存在的题号 {qid}")
            elif section_domain and question.get("domain") != section_domain:
                error(f"题号 {qid} 的域 {question.get('domain')} 与所属小节 {sid} 不一致")

    for qid in qids:
        assigned = owners.get(qid, [])
        if not assigned:
            error(f"题号 {qid} 没有归入任何小节")
        elif len(assigned) > 1:
            error(f"题号 {qid} 同时归入：{', '.join(assigned)}")

    for path, value in (
        ("questions.base", base),
        ("questions.extra", extra),
        ("explanations", explanations),
        ("catalog", catalog),
        ("sections", sections),
        ("labs", labs),
    ):
        walk_strings(value, path)

    views_path = os.path.join(ROOT, "assets", "js", "views.js")
    try:
        with open(views_path, encoding="utf-8") as f:
            views = f.read()
        required_renderers = {
            r"rich\(\s*sec\.objectives\[0\]\s*\)": "小节摘要必须用 rich() 渲染",
            r"rich\(\s*n\.h\s*\)": "文字补充小标题必须用 rich() 渲染",
            r"rich\(\s*n\.t\s*\)": "文字补充正文必须用 rich() 渲染",
        }
        for pattern, message in required_renderers.items():
            if not re.search(pattern, views):
                error(message)
        for pattern, message in (
            (r"esc\(\s*sec\.objectives\[0\]\s*\)", "小节摘要退回 esc()，会露出反引号"),
            (r"esc\(\s*n\.h\s*\)", "文字补充小标题退回 esc()，会露出反引号"),
        ):
            if re.search(pattern, views):
                error(message)
    except OSError as exc:
        error(f"无法读取 assets/js/views.js：{exc}")

    if not errors:
        build_path = os.path.join(ROOT, "tools", "build-data.py")
        build_mod = SourceFileLoader("build_data_for_content_check", build_path).load_module()
        try:
            bank, built_catalog, built_labs = build_mod.build()
        except Exception as exc:  # 构建器的意外异常也要变成明确失败
            error(f"构建器异常：{exc}")
        else:
            for message in build_mod.errors:
                error(f"构建校验：{message}")
            for question in bank.get("questions", []):
                for field in ("topic_id", "section_id", "explain", "version", "difficulty"):
                    if not text(question.get(field)):
                        error(f"生成题目 {question.get('id')} 缺少 {field}")
            expected = (
                ("bank.js", "ICT_BANK", bank),
                ("catalog.js", "ICT_CATALOG", built_catalog),
                ("labs.js", "ICT_LABS", built_labs),
            )
            for name, variable, value in expected:
                generated = load_generated(name, variable)
                if generated is not None and generated != value:
                    error(f"生成产物 assets/js/data/{name} 已过期，请运行 python tools/build-data.py")

    resources = catalog.get("resources", {})
    if isinstance(resources, dict):
        resource_values = list(resources.values())
    elif isinstance(resources, list):
        resource_values = resources
    else:
        error("catalog.resources 必须是对象或数组")
        resource_values = []
    role_counts = Counter(r.get("role") for r in resource_values if isinstance(r, dict))
    status_counts = Counter(r.get("status") for r in resource_values if isinstance(r, dict))
    if role_counts.get("backup", 0) == 0:
        warn("资料库还没有 backup 资料；这是内容缺口，不阻断构建")

    if not errors:
        print(
            "内容统计："
            f"基础题 {len(base)} / 补充题 {len(extra)} / 小节 {len(sections)} / "
            f"资料 {len(resource_values)} / 实验 {len(labs)}"
        )
        print(
            "资料状态："
            + " / ".join(f"{key}={value}" for key, value in sorted(status_counts.items()))
            + "；角色："
            + " / ".join(f"{key}={value}" for key, value in sorted(role_counts.items()))
        )
    return finish()


def finish():
    for message in warnings:
        print(f"  ! {message}")
    if errors:
        print(f"\n内容校验失败（{len(errors)} 项）：")
        for message in errors:
            print(f"  x {message}")
        return 1
    print("\n内容校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
