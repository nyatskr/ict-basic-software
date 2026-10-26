#!/usr/bin/env python3
"""核对资料台账里的外部链接：还活着吗、标题/作者/时长跟当初记录的对得上吗。

这不是「内容验收」——它只能证明链接有效、元数据没漂移，
不能证明视频里真的讲了 covers 里写的那些点。内容仍需人工观看。

用法：
    python tools/check-resources.py                  # 检查全部
    python tools/check-resources.py --only bilibili  # 只查某个平台
    python tools/check-resources.py --limit 5        # 先试几条
    python tools/check-resources.py --json out.json  # 附带机器可读结果
    python tools/check-resources.py --stamp          # 把通过检查的 checked_at 更新为今天

依赖：B 站走 yt-dlp（pip install yt-dlp），其它平台用 HTTP 请求。
缺 yt-dlp 时会跳过 B 站条目并明确提示，不会静默当作通过。
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "content", "catalog.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# 时长漂移容忍度（秒）。记录值取整到秒，差几秒属正常。
DURATION_TOLERANCE = 20


def load_catalog():
    with open(CATALOG, encoding="utf-8") as f:
        return json.load(f)


def normalize(text):
    """归一化标题：去空白与常见分隔标点、统一全半角、小写。

    台账里的标题在拉丁词两侧加了空格（「搞定 linux」对应实际「搞定linux」），
    直接比对会全量误报，所以两侧都归一化后再比。
    """
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", str(text)).lower()
    s = re.sub(r"[\s\-_—–·・:：|｜,，。.、/\\()（）\[\]【】「」\"'“”‘’]+", "", s)
    return s


def parse_duration(text):
    """把 06:07 / 1:02:03 转成秒。"""
    if not text:
        return None
    parts = str(text).strip().split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    return None


def fmt_seconds(sec):
    if sec is None:
        return "—"
    sec = int(round(sec))
    return f"{sec // 60:02d}:{sec % 60:02d}"


def check_bilibili(ydl, url):
    info = ydl.extract_info(url, download=False)
    return {
        "title": info.get("title") or "",
        "author": info.get("uploader") or "",
        "duration": info.get("duration"),
    }


def check_http(url):
    """非 B 站：只判断可达性，拿不到标题作者。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return {"status": resp.status, "title": "", "author": "", "duration": None}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code, "title": "", "author": "", "duration": None, "error": f"HTTP {exc.code}"}
    except Exception as exc:  # 网络层错误统一记录
        return {"status": None, "title": "", "author": "", "duration": None, "error": f"{type(exc).__name__}: {exc}"}


def judge(rid, rec, got):
    """把一次探测结果判定成状态 + 问题列表。

    分级：
      ok      元数据对得上
      info    记录时把标题缩短了（实际标题包含记录标题），不影响使用
      warn    标题/作者/时长对不上，或 UP 主账号注销 —— 需要人看
      dead    链接打不开
    """
    issues = []
    notes = []

    if got.get("error") and not got.get("status"):
        return "dead", [f"请求失败：{got['error']}"]

    if got.get("status") and int(got["status"]) >= 400:
        return "dead", [f"HTTP {got['status']}"]

    author = got.get("author") or ""
    if "账号已注销" in author or "账号已删除" in author:
        issues.append("UP 主账号已注销，视频随时可能消失，需要备用资料")

    rec_title = normalize(rec.get("title"))
    got_title = normalize(got.get("title"))
    if rec_title and got_title and rec_title != got_title:
        if rec_title in got_title:
            notes.append(f"标题被简化（实际：{got.get('title')}）")
        elif got_title in rec_title:
            notes.append("记录标题比实际更长，可能含备注")
        else:
            issues.append(f"标题不一致：记录「{rec.get('title')}」实际「{got.get('title')}」")

    rec_dur = parse_duration(rec.get("duration"))
    got_dur = got.get("duration")
    if rec_dur is not None and got_dur is not None:
        diff = abs(rec_dur - got_dur)
        if diff > DURATION_TOLERANCE:
            issues.append(f"时长不符：记录 {rec.get('duration')} 实际 {fmt_seconds(got_dur)}（差 {int(diff)}s）")

    rec_author = normalize(rec.get("author"))
    got_author = normalize(author)
    if rec_author and got_author and rec_author != got_author and "账号已注销" not in author:
        issues.append(f"作者不一致：记录「{rec.get('author')}」实际「{author}」")

    if issues:
        return "warn", issues
    return ("info" if notes else "ok"), notes


def stamp_checked_at(results, resources):
    """把检查通过的条目 checked_at 更新为今天。

    定点替换而不是整体 json.dump 重写：catalog.json 是手工排版的（内联对象、
    字段分组），整体重写会产生全文件 diff，把人工可读性毁掉。
    """
    ok_ids = {r["id"] for r in results if r["state"] in ("ok", "info")}
    if not ok_ids:
        print("没有检查通过的条目，未更新 checked_at")
        return

    with open(CATALOG, encoding="utf-8", newline="") as f:
        raw = f.read()

    today = str(datetime.date.today())
    # 顺序扫描：资源键 → 该键之后第一条 checked_at
    pattern = re.compile(r'"([A-Za-z0-9_-]+)"\s*:\s*\{|"checked_at"\s*:\s*"([^"]*)"')
    current = None
    edits = []
    for m in pattern.finditer(raw):
        if m.group(1) is not None:
            current = m.group(1) if m.group(1) in resources else None
        elif current and current in ok_ids and m.group(2) != today:
            edits.append((m.start(2), m.end(2), today))

    if not edits:
        print("checked_at 已是最新，无需更新")
        return

    for start, end, value in reversed(edits):
        raw = raw[:start] + value + raw[end:]

    # newline="" 保持原文件的换行风格：Windows 上默认会把 \n 写成 \r\n，
    # 在 core.autocrlf=false 的机器上会产生全文件 diff。
    with open(CATALOG, "w", encoding="utf-8", newline="") as f:
        f.write(raw)
    print(f"\n已更新 {len(edits)} 条 checked_at → {today}")
    print("注意：这只表示链接与元数据检查通过，不等于内容已人工验收，status 仍需自己判断。")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只检查某个 platform，如 bilibili")
    ap.add_argument("--limit", type=int, help="最多检查多少条（调试用）")
    ap.add_argument("--json", help="把完整结果写入该路径")
    ap.add_argument("--stamp", action="store_true", help="把检查通过的条目 checked_at 更新为今天（会改 catalog.json）")
    ap.add_argument("--sleep", type=float, default=0.6, help="每条之间的间隔秒数，默认 0.6")
    args = ap.parse_args()

    catalog = load_catalog()
    resources = catalog.get("resources") or {}
    items = list(resources.items())
    if args.only:
        items = [(k, v) for k, v in items if v.get("platform") == args.only]
    if args.limit:
        items = items[: args.limit]

    need_bili = any(v.get("platform") == "bilibili" and v.get("url") for _, v in items)
    ydl = None
    if need_bili:
        try:
            import yt_dlp

            ydl = yt_dlp.YoutubeDL(
                {
                    "quiet": True,
                    "no_warnings": True,
                    "skip_download": True,
                    "socket_timeout": 20,
                    "http_headers": {"Referer": "https://www.bilibili.com/", "User-Agent": UA},
                }
            )
        except ImportError:
            print("! 未安装 yt-dlp，跳过 B 站条目。安装：pip install yt-dlp")
            print("  （跳过不等于通过，B 站条目本次记为 skipped）\n")

    results = []
    counts = {"ok": 0, "info": 0, "warn": 0, "dead": 0, "skipped": 0}

    for index, (rid, rec) in enumerate(items, 1):
        url = rec.get("url")
        prefix = f"[{index:>3}/{len(items)}] {rid:<20}"

        if not url:
            counts["skipped"] += 1
            print(f"{prefix} 跳过：没有链接")
            results.append({"id": rid, "state": "skipped", "issues": ["没有链接"]})
            continue

        if rec.get("platform") == "bilibili" and ydl is None:
            counts["skipped"] += 1
            print(f"{prefix} 跳过：缺 yt-dlp")
            results.append({"id": rid, "state": "skipped", "issues": ["缺 yt-dlp"]})
            continue

        try:
            got = check_bilibili(ydl, url) if rec.get("platform") == "bilibili" else check_http(url)
        except Exception as exc:
            state, issues = "dead", [f"{type(exc).__name__}: {str(exc)[:90]}"]
            got = {}
        else:
            state, issues = judge(rid, rec, got)

        counts[state] += 1
        mark = {"ok": "OK  ", "info": "·   ", "warn": "⚠   ", "dead": "DEAD"}[state]
        print(f"{prefix} {mark} {rec.get('platform')}  {rec.get('duration') or '--:--'}  {rec.get('title')[:32]}")
        for issue in issues:
            print(f"{' ' * len(prefix)}      → {issue}")

        results.append({"id": rid, "state": state, "issues": issues, "url": url, "platform": rec.get("platform")})
        if args.sleep:
            time.sleep(args.sleep)

    print()
    print(
        f"=== 正常 {counts['ok']}   仅标题简化 {counts['info']}   "
        f"需处理 {counts['warn']}   失效 {counts['dead']}   跳过 {counts['skipped']}"
    )

    actionable = [r for r in results if r["state"] in ("warn", "dead")]
    if actionable:
        print("\n需要人工处理的条目：")
        for r in actionable:
            print(f"  {r['id']}（{r['state']}）")
            for issue in r["issues"]:
                print(f"    - {issue}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"checked_on": str(datetime.date.today()), "counts": counts, "results": results},
                      f, ensure_ascii=False, indent=1)
        print(f"\n结果已写入 {args.json}")

    if args.stamp:
        stamp_checked_at(results, resources)

    return 1 if counts["dead"] else 0


if __name__ == "__main__":
    sys.exit(main())
