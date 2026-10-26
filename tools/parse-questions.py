#!/usr/bin/env python3
"""把《华为ICT大赛_基础软件赛道_历年真题与2026-2027预测.md》第 9 章的原创题
解析成结构化题目，并与 content/catalog.json 里的小节做一致性校验。

只解析第 9 章（原创预测题库），第 0 章的「历年题目线索」只作为知识点索引，不进题库。

用法：
    python tools/parse-questions.py <markdown> [--json out.json]
"""
import argparse
import json
import re
import sys

DOMAIN_OF = {"OE": "oe", "OG": "og", "KP": "kp"}

Q_HEAD = re.compile(r"^\*\*(OE|OG|KP)-(\d{2})｜(单选|多选|判断)\*\*[\s\u3000]*(.*)$")
OPT_SPLIT = re.compile(r"(?:^|[\s\u3000])([A-D])\.\s*")
ANS_LINE = re.compile(r"^\*\*答案：(.+?)。\*\*[\s\u3000]*(.*)$")
CLUSTER = re.compile(r"^####\s+([A-D])\.\s*(.+?)\s*$")
DOMAIN_HEAD = re.compile(r"^###\s+9\.\d\s+(.+?)（([A-Z]{2})-")


def parse(text):
    lines = text.splitlines()

    # 只取第 9 章
    start = end = None
    for i, ln in enumerate(lines):
        if start is None and ln.startswith("## 9."):
            start = i
        elif start is not None and ln.startswith("## 10."):
            end = i
            break
    if start is None:
        raise SystemExit("没找到第 9 章（## 9. 原创预测题库）")
    if end is None:
        end = len(lines)

    questions = []
    domain = None
    cluster = ""
    cur = None
    buf = []

    def flush():
        nonlocal cur, buf
        if cur is not None:
            cur["_lines"] = buf
            questions.append(cur)
        cur = None
        buf = []

    for ln in lines[start:end]:
        m = DOMAIN_HEAD.match(ln)
        if m:
            flush()
            domain = DOMAIN_OF[m.group(2)]
            cluster = ""
            continue

        m = CLUSTER.match(ln)
        if m:
            flush()
            cluster = m.group(2).strip()
            continue

        m = Q_HEAD.match(ln)
        if m:
            flush()
            cur = {
                "id": f"{m.group(1)}-{m.group(2)}",
                "domain": DOMAIN_OF[m.group(1)],
                "kind": m.group(3),
                "cluster": cluster,
                "_stem": m.group(4).strip(),
            }
            buf = []
            continue

        if cur is None:
            continue

        m = ANS_LINE.match(ln)
        if m and not cur.get("_answer"):
            cur["_answer"] = m.group(1).strip()
            cur["_explain"] = [m.group(2).strip()] if m.group(2).strip() else []
            continue

        if cur.get("_answer"):
            s = ln.strip()
            if s and not s.startswith("---") and not s.startswith("**"):
                cur["_explain"].append(s)
        else:
            buf.append(ln)

    flush()

    out = []
    for q in questions:
        body = "\n".join(q["_lines"]).strip()
        if not body and q["kind"] != "判断":
            raise SystemExit(f"{q['id']} 没有选项")
        pieces = []
        marks = list(OPT_SPLIT.finditer(body))
        for idx, mm in enumerate(marks):
            stop = marks[idx + 1].start() if idx + 1 < len(marks) else len(body)
            pieces.append((mm.group(1), body[mm.end():stop].strip()))

        answer_raw = q.get("_answer", "")
        explain = "\n".join(x for x in q.get("_explain", []) if x).strip()

        if q["kind"] == "判断":
            options = [{"id": "A", "text": "正确"}, {"id": "B", "text": "错误"}]
            if answer_raw.startswith("正确"):
                answer = ["A"]
            elif answer_raw.startswith("错误"):
                answer = ["B"]
            else:
                raise SystemExit(f"{q['id']} 判断题答案无法识别：{answer_raw}")
        else:
            options = [{"id": k, "text": t} for k, t in pieces]
            if len(options) != 4:
                raise SystemExit(f"{q['id']} 选项数不是 4：{options}")
            letters = re.findall(r"[A-D]", answer_raw)
            answer = sorted(set(letters))
            if not answer:
                raise SystemExit(f"{q['id']} 答案无法识别：{answer_raw}")

        out.append(
            {
                "id": q["id"],
                "domain": q["domain"],
                "kind": q["kind"],
                "cluster": q["cluster"],
                "stem": q["_stem"],
                "options": options,
                "answer": answer,
                "explain": explain,
            }
        )

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("markdown")
    ap.add_argument("--json")
    args = ap.parse_args()

    text = open(args.markdown, encoding="utf-8").read()
    qs = parse(text)

    by_domain = {}
    by_kind = {}
    for q in qs:
        by_domain[q["domain"]] = by_domain.get(q["domain"], 0) + 1
        by_kind[q["kind"]] = by_kind.get(q["kind"], 0) + 1

    print(f"解析到 {len(qs)} 题")
    print("  按域：", ", ".join(f"{k}={v}" for k, v in sorted(by_domain.items())))
    print("  按型：", ", ".join(f"{k}={v}" for k, v in sorted(by_kind.items())))

    bad = [q["id"] for q in qs if not q["explain"]]
    if bad:
        print(f"  !! 缺解析：{', '.join(bad)}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(qs, f, ensure_ascii=False, indent=2)
        print(f"  已写入 {args.json}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
