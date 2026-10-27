#!/usr/bin/env python3
"""离线能力静态校验：manifest / 图标 / Service Worker 预缓存清单 / 页面接线。

    python tools/check-offline.py

只做静态检查（不需要浏览器）。运行时的断网回归在 tools/test-offline.mjs。

检查项：
1. manifest.json 字段齐全，图标文件存在且尺寸与声明一致；
2. index.html 引了 manifest、apple-touch-icon、offline.js、flight-pack.js；
3. service-worker.js 的预缓存清单覆盖 index.html 里所有本地脚本与样式；
4. 预缓存里没有跨域地址，版本号已由构建脚本写入且与当前资源一致。
"""

from __future__ import annotations

import importlib.util
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
MANIFEST = ROOT / "manifest.json"
SW = ROOT / "service-worker.js"
ICONS = ROOT / "assets" / "icons"

errors: list[str] = []
notes: list[str] = []


def load_build_offline():
    spec = importlib.util.spec_from_file_location("build_offline", ROOT / "tools" / "build-offline.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def png_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) < 24:
        return None
    return struct.unpack(">II", data[16:24])


def check_manifest() -> None:
    if not MANIFEST.is_file():
        errors.append("缺 manifest.json")
        return
    try:
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"manifest.json 不是合法 JSON：{e}")
        return

    for key in ("name", "short_name", "start_url", "scope", "display", "icons", "theme_color"):
        if key not in m:
            errors.append(f"manifest 缺字段 {key}")
    if m.get("display") not in ("standalone", "fullscreen", "minimal-ui"):
        errors.append("manifest.display 应为 standalone（iPad 才会以独立窗口打开）")

    icons = m.get("icons") or []
    if not icons:
        errors.append("manifest.icons 为空")
    has_512 = False
    for icon in icons:
        src = str(icon.get("src", ""))
        path = ROOT / src
        if not path.is_file():
            errors.append(f"manifest 图标不存在：{src}")
            continue
        got = png_size(path)
        want = str(icon.get("sizes", ""))
        if got and want and f"{got[0]}x{got[1]}" != want:
            errors.append(f"{src} 实际 {got[0]}x{got[1]}，manifest 写的是 {want}")
        if want == "512x512":
            has_512 = True
    if not has_512:
        errors.append("manifest 缺 512x512 图标（iPad 主屏幕会用）")

    if not any(i.get("purpose") == "maskable" for i in icons):
        notes.append("manifest 没有 maskable 图标，Android 上图标会被裁切（iPad 无影响）")


def check_index() -> None:
    html = INDEX.read_text(encoding="utf-8")
    required = {
        'rel="manifest"': "manifest 链接",
        'rel="apple-touch-icon"': "apple-touch-icon",
        "apple-mobile-web-app-capable": "iOS 独立窗口 meta",
        "assets/js/offline.js": "离线注册脚本",
        "assets/js/flight-pack.js": "飞行离线包脚本",
        'data-nav="offline"': "侧栏离线包入口",
    }
    for needle, label in required.items():
        if needle not in html:
            errors.append(f"index.html 缺{label}（{needle}）")

    if "http://" in html.replace("http://www.w3.org", ""):
        notes.append("index.html 里出现 http:// 链接，离线时不可用（确认是有意的）")


def check_sw() -> None:
    if not SW.is_file():
        errors.append("缺 service-worker.js，运行 python tools/build-offline.py")
        return

    build = load_build_offline()
    files = build.collect()
    version = build.version_of(files)
    text = SW.read_text(encoding="utf-8")

    if "__VERSION__" in text or "__PRECACHE__" in text:
        errors.append("service-worker.js 还是模板，运行 python tools/build-offline.py")

    m = re.search(r"const VERSION = '([^']+)'", text)
    if not m:
        errors.append("service-worker.js 里读不到 VERSION")
    elif m.group(1) != version:
        errors.append(
            f"缓存版本过期：现有 {m.group(1)}，应为 {version}（资源改过但没重建 SW，运行 build-offline.py）"
        )
    else:
        notes.append(f"缓存版本 {version}，预缓存 {len(files)} 项")

    for rel in files:
        if rel.startswith("./") and rel != "./" and rel[2:] not in text:
            errors.append(f"预缓存清单漏了 {rel}")
        if re.match(r"^https?://", rel):
            errors.append(f"预缓存里混进跨域地址：{rel}")

    if "skipWaiting()" not in text:
        notes.append("SW 没有 skipWaiting：更新需要用户点刷新（本项目的预期行为）")
    if "self.clients.claim()" not in text:
        errors.append("SW 没有 clients.claim()，首次安装后要再开一次才离线可用")


def main() -> int:
    check_manifest()
    check_index()
    check_sw()

    for n in notes:
        print("  ·", n)
    if errors:
        print(f"\n{len(errors)} 处问题：")
        for e in errors:
            print("  x", e)
        return 1
    print("\n离线配置校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
