#!/usr/bin/env python3
"""
抖音视频下载器 — 无需 cookies，无需登录，无需第三方 API
从抖音分享链接直接下载无水印原视频（4K）

用法:
    python douyin_dl.py "https://v.douyin.com/dl1KJ_7jHuM/"
    python douyin_dl.py "https://www.douyin.com/video/7483462094705151271"
    python douyin_dl.py "https://v.douyin.com/dl1KJ_7jHuM/" -o my_video.mp4

原理:
    1. 短链接重定向 → 提取 video_id
    2. 移动端 UA 访问 iesdouyin.com/share/video/{id}/
    3. 提取 window._ROUTER_DATA (花括号配对)
    4. 从 JSON 中取出 play_addr.url_list → 视频直链
    5. 下载保存
"""

import requests
import re
import json
import os
import sys
import argparse

# ── 配置 ──────────────────────────────────────────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Referer": "https://www.douyin.com/",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# ── 核心逻辑 ──────────────────────────────────────────

def extract_video_id(url: str) -> str:
    """从各种格式的抖音链接中提取 video_id"""
    session = requests.Session()
    session.headers.update(HEADERS)

    # 先跟随重定向
    resp = session.get(url, allow_redirects=True, timeout=15)
    final_url = resp.url

    # 尝试从 URL 中匹配 /video/{id}
    match = re.search(r'/video/(\d+)', final_url)
    if match:
        return match.group(1)

    # 兼容 share 页面
    match = re.search(r'/share/video/(\d+)', final_url)
    if match:
        return match.group(1)

    raise ValueError(f"无法从链接中提取视频 ID: {final_url}")


def fetch_video_info(video_id: str) -> dict:
    """从抖音分享页提取视频元信息"""
    share_url = f"https://www.iesdouyin.com/share/video/{video_id}/"
    resp = requests.get(share_url, headers=HEADERS, timeout=15)
    html = resp.text

    # 定位 window._ROUTER_DATA
    pos = html.find("window._ROUTER_DATA")
    if pos == -1:
        raise RuntimeError("页面中未找到 _ROUTER_DATA（可能需要更新提取逻辑）")

    eq_pos = html.find("=", pos)
    start = html.find("{", eq_pos)
    if start == -1:
        raise RuntimeError("无法定位 JSON 起始位置")

    # 花括号配对 —— 正确处理嵌套 JSON
    depth = 0
    end = start
    for i in range(start, len(html)):
        ch = html[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    json_str = html[start:end]
    data = json.loads(json_str)

    # 提取视频详情
    try:
        video_obj = data["loaderData"]["video_(id)/page"]["videoInfoRes"]["item_list"][0]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"数据结构变化，提取失败: {e}")

    return video_obj


def get_download_url(video_info: dict) -> str:
    """从视频信息中提取下载直链"""
    video = video_info.get("video", {})
    play_addr = video.get("play_addr", {})

    url_list = play_addr.get("url_list", [])
    if not url_list:
        # 回退：部分视频用 download_addr
        download_addr = video.get("download_addr", {})
        url_list = download_addr.get("url_list", [])

    if not url_list:
        raise RuntimeError("未找到可下载的视频地址")

    url = url_list[0]
    # 修复转义字符
    url = url.replace("\\u0026", "&")
    return url


def download_video(url: str, output_path: str) -> int:
    """下载视频到本地，返回文件大小"""
    dl_headers = {**HEADERS}
    resp = requests.get(url, headers=dl_headers, timeout=120, stream=True)

    if resp.status_code != 200:
        raise RuntimeError(f"下载失败: HTTP {resp.status_code}")

    total = 0
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
                total += len(chunk)

    return total


# ── CLI ───────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="抖音视频下载器 — 无需登录，无水印，4K 原画",
        epilog="示例: python douyin_dl.py https://v.douyin.com/xxxxx/ -o 我的视频.mp4",
    )
    parser.add_argument("url", help="抖音分享链接或视频页面链接")
    parser.add_argument("-o", "--output", default=None, help="输出文件名（默认: douyin_{video_id}.mp4）")
    args = parser.parse_args()

    print(f"[1/4] 解析链接...")
    video_id = extract_video_id(args.url)
    print(f"      Video ID: {video_id}")

    print(f"[2/4] 获取视频信息...")
    video_info = fetch_video_info(video_id)

    # 显示视频元信息
    desc = video_info.get("desc", "无描述")
    video_obj = video_info.get("video", {})
    width = video_obj.get("width", "?")
    height = video_obj.get("height", "?")
    duration_ms = video_obj.get("duration", 0)
    duration_s = duration_ms / 1000 if duration_ms else 0
    print(f"      标题: {desc[:80]}")
    print(f"      分辨率: {width}×{height}")
    print(f"      时长: {duration_s:.0f}s")

    print(f"[3/4] 获取下载链接...")
    dl_url = get_download_url(video_info)
    print(f"      链接: {dl_url[:100]}...")

    output = args.output or f"douyin_{video_id}.mp4"
    output = os.path.abspath(output)

    print(f"[4/4] 下载中...")
    size = download_video(dl_url, output)

    print(f"\n✅ 下载完成!")
    print(f"   文件: {output}")
    print(f"   大小: {size:,} bytes ({size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
