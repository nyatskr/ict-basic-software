#!/usr/bin/env python3
"""生成 service-worker.js 的预缓存清单与版本号。

    python tools/build-offline.py          # 重新生成 service-worker.js
    python tools/build-offline.py --check  # 只校验：清单是否覆盖全部本地资源、版本号是否最新

版本号 = 所有预缓存文件内容的 SHA-256 前 12 位。任何一处资源改动都会换一个缓存名，
旧缓存随之在 activate 阶段删除，避免「新 index.html 配旧 bank.js」。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "tools" / "sw-template.js"
TARGET = ROOT / "service-worker.js"

# 站点外壳一定会用到的入口；其余从 index.html / manifest 里扫出来
ENTRY = ["index.html", "manifest.json"]

LOCAL_REF = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""", re.I)


def local_refs(text: str) -> list[str]:
    out = []
    for raw in LOCAL_REF.findall(text):
        ref = raw.strip()
        if not ref or ref.startswith(("#", "data:", "mailto:", "javascript:")):
            continue
        if re.match(r"^[a-z]+:", ref, re.I) or ref.startswith("//"):
            continue  # 跨域资源不进预缓存
        ref = ref.split("#")[0].split("?")[0]
        if ref and ref not in out:
            out.append(ref)
    return out


def collect() -> list[str]:
    files: list[str] = []
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    for rel in ENTRY + local_refs(index):
        rel = rel.lstrip("./")
        if rel and rel not in files:
            files.append(rel)

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    for icon in manifest.get("icons", []):
        rel = str(icon.get("src", "")).lstrip("./")
        if rel and rel not in files:
            files.append(rel)

    missing = [f for f in files if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit("预缓存清单里有不存在的文件：" + ", ".join(missing))

    # './' 是「添加到主屏幕」后最常见的导航地址，单独缓一份别名
    return ["./"] + ["./" + f for f in files]


def version_of(files: list[str]) -> str:
    h = hashlib.sha256()
    for rel in files:
        path = ROOT / rel[2:] if rel.startswith("./") else ROOT / rel
        data = b"" if rel == "./" else path.read_bytes()
        # 换行符归一化：Windows 检出成 CRLF 时版本号不该变，否则每次 clone 都「过期」
        data = data.replace(b"\r\n", b"\n")
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(hashlib.sha256(data).hexdigest().encode("ascii"))
        h.update(b"\n")
    return h.hexdigest()[:12]


def render(files: list[str], version: str) -> str:
    tpl = TEMPLATE.read_text(encoding="utf-8")
    body = "[\n" + ",\n".join('  ' + json.dumps(f) for f in files) + ",\n]"
    return tpl.replace("__VERSION__", version).replace("__PRECACHE__", body)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    files = collect()
    version = version_of(files)
    out = render(files, version)

    if args.check:
        if not TARGET.is_file():
            print("FAIL service-worker.js 不存在，运行 python tools/build-offline.py")
            return 1
        cur = TARGET.read_text(encoding="utf-8")
        if cur != out:
            cur_ver = re.search(r"const VERSION = '([^']+)'", cur)
            print(
                "FAIL service-worker.js 与当前资源不一致："
                f"现有版本 {cur_ver.group(1) if cur_ver else '?'}，应为 {version}"
            )
            print("     运行 python tools/build-offline.py 重新生成")
            return 1
        print(f"ok   service-worker.js 版本 {version}，预缓存 {len(files)} 项")
        return 0

    TARGET.write_text(out, encoding="utf-8", newline="\n")
    print(f"写入 service-worker.js  版本 {version}  预缓存 {len(files)} 项")
    for f in files:
        print("  ·", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
