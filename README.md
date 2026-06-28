# marec-agent-skills

[![skills.sh](https://skills.sh/b/MarecGents/marec-agent-skills)](https://skills.sh/MarecGents/marec-agent-skills)

A collection of Agent Skills for AI coding agents. Skills are packaged instructions and scripts that extend agent capabilities, following the [Agent Skills](https://agentskills.io/) format.

## Installation

```bash
npx skills add MarecGents/marec-agent-skills
```

## Available Skills

### default

通用默认工作流技能。当没有更具体的专项技能匹配时，使用此技能作为兜底方案。
提供标准化的三阶段工作流：Brainstorming 前期构思 → Planning with Files 任务追踪 → 收尾归档。

**Use when:**
- "帮我做个..."、"写一个..."、"实现..."、"分析..." 等通用任务
- 没有明确 skill 匹配的任意任务

### douyin-downloader

下载抖音(Douyin/TikTok中国版)无水印原视频 — 从分享链接直接提取 4K 视频直链，无需登录、无需 cookies、无需第三方 API。

**Use when:**
- "下载这个抖音视频"、"抖音链接去水印"、"保存抖音视频"
- 任何与抖音视频下载相关的需求

**Features:**
- 支持短链接 `v.douyin.com`、网页版、国际版链接
- 4K 原画质无水印下载
- 无需登录/cookies/第三方 API
- 附带 Python 脚本 `scripts/douyin_dl.py`

### github-project-replication

自动化复现 GitHub 开源项目的完整工作流。涵盖从项目理解、环境配置、代码搭建到运行评估与迭代修复的全流程自动化。

**Use when:**
- "复现这个项目"、"部署这个仓库"、"帮我跑一下这个项目"
- 给出 GitHub 仓库 URL 要求运行/安装/部署

**Features:**
- 六阶段系统化工作流（项目理解→环境配置→代码搭建→运行验证→迭代修复→收尾归档）
- 自动调用 brainstorming 和 planning-with-files 进行辅助分析

### check-reasonix-update

检查 DeepSeek-Reasonix 最新版本更新日志，翻译总结并与旧版对比，保存报告到 `./ReasonixUpdateLog/`。

**Use when:**
- "检查更新"、"查看更新日志"、"版本对比"
- "Reasonix 更新"、"DeepSeek-Reasonix"

### zh-quotes

在 Word 文档(.docx)中将英文直引号替换为中文全角弯引号，成对交替，保留原格式。

**Use when:**
- 处理中文标点符号、整理中文排版
- 将英文直引号转为中文前后引号
- 修复 docx 文件中的引号格式

**Features:**
- 成对交替替换（左 `\u201c`、右 `\u201d`）
- 完整保留原文所有格式（字体、字号、加粗、斜体、颜色等）
- 附带 Python 脚本 `scripts/replace_quotes.py`

## Creating Your Own Skills

Each skill is a folder under `skills/` containing at minimum a `SKILL.md` file:

```
skills/
└── my-skill/
    ├── SKILL.md          # Required: metadata + instructions
    ├── scripts/          # Optional: executable code
    ├── references/       # Optional: documentation
    └── assets/           # Optional: templates, resources
```

Use the [`template/`](./template/SKILL.md) in this repository as a starting point.

For more details, see the [Agent Skills Specification](https://agentskills.io/specification.md).

## License

MIT
