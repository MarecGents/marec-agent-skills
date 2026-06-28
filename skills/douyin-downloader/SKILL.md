---
name: douyin-downloader
description: 下载抖音(Douyin/TikTok中国版)无水印原视频 — 从分享链接直接提取4K视频直链，无需登录、无需cookies、无需第三方API。当用户提到"抖音视频下载"、"抖音链接"、"抖音去水印"、"douyin download"、"保存抖音视频"等任何与抖音视频下载相关需求时，务必使用本技能，即使只是问"能不能下载某个抖音视频"。
user-invocable: true
allowed-tools: "Bash(git clone:*), Bash(pip install:*), Bash(python:*), Read, Write"
---

# 抖音视频下载

从抖音分享链接下载无水印原视频。通过解析抖音移动端分享页面的 `window._ROUTER_DATA` 提取视频直链，无需 cookies、无需登录、无需第三方 API。

## 脚本位置

- 主脚本: `scripts/douyin_dl.py`
- 运行依赖: Python 3 + `requests` 库

## 安装依赖

```bash
pip install requests
```

## 使用方法

```bash
python scripts/douyin_dl.py "<抖音链接>"
# 指定输出文件名
python scripts/douyin_dl.py "https://v.douyin.com/dl1KJ_7jHuM/" -o 我的视频.mp4
```

## 支持链接格式

- `https://v.douyin.com/xxxxx/` — 短链接（推荐）
- `https://www.douyin.com/video/xxxxx` — 网页版链接
- `https://www.iesdouyin.com/share/video/xxxxx/` — 国际版链接

## 工作原理

1. **解析链接**：跟随短链接重定向，提取 `video_id`
2. **获取信息**：用移动端 UA 请求 `iesdouyin.com/share/video/{id}/`
3. **提取数据**：从 HTML 中提取 `window._ROUTER_DATA` JSON（花括号配对解析）
4. **获取直链**：从 `loaderData → video_(id)/page → videoInfoRes → item_list[0] → video → play_addr → url_list` 获取视频直链
5. **下载**：以 4K 原画质下载无水印视频，保存为 `douyin_{video_id}.mp4`

## 输出说明

- **格式**: MP4，4K 原画质，无水印
- **大小**: 4K 视频通常 200-500 MB
- **文件位置**: 当前工作目录或 `-o` 指定路径

## 如果脚本失效（调试指南）

抖音可能更新页面结构导致提取失败。调试步骤：

1. 用 iPhone UA 手动访问 `https://www.iesdouyin.com/share/video/{video_id}/`
2. 在页面源码中搜索 `_ROUTER_DATA`
3. 追踪新的 JSON 路径找到 `url_list`
4. 更新 `douyin_dl.py` 中的提取路径

## 限制

- 仅支持公开视频（私密/已删除的视频无法下载）
- 抖音 API 可能更新导致数据结构变化，届时需适配 `_ROUTER_DATA` 路径
- 如需小文件，可修改脚本中 `get_download_url` 的 `ratio` 参数选择较低分辨率
