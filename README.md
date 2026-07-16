# marec-agent-skills

[![skills.sh](https://skills.sh/b/MarecGents/marec-agent-skills)](https://skills.sh/MarecGents/marec-agent-skills)

A collection of Agent Skills for AI coding agents. Skills are packaged instructions and scripts that extend agent capabilities, following the [Agent Skills](https://agentskills.io/) format.

## Installation

```bash
npx skills add MarecGents/marec-agent-skills
```

## Available Skills

### agent-orchestra

多智能体协作 SKILL — 拥有 251 个专业 Agent（覆盖 19 个部门）的完整多 Agent 协作系统。
包含总调度 Agent（任务拆解与分配）、专业部门 Agent（各领域执行）和审查 Agent（质量门禁）。
核心理念：**先评估、再调度、审评分立、跨 Agent 协作**。

**Use when:**
- 复杂任务需要跨领域协作（前端+后端+数据库+部署等）
- 需要专业分工的高质量交付（工程/设计/营销/安全/金融/GIS/游戏等）
- 任何涉及多种技能或专业知识的任务，无论是否明确提到"多智能体"

**Features:**
- 251 个专业 Agent，覆盖 19 个部门（工程、设计、营销、金融、安全、GIS 等）
- 三层架构：总调度 → 专业 Agent → 审查官
- 任务评估矩阵自动判断是否需要启用多 Agent 流程
- 审查门禁机制确保交付质量

**致谢与声明：**

本 SKILL 中集成的 251 个 Agent 定义文件基于以下开源项目：

- [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) — 中文版 AI 智能体专家团队（266 个角色，19 个部门）
- [agency-agents](https://github.com/msitarzewski/agency-agents) — 上游英文原版

感谢以上项目的贡献者。本 SKILL 在完整翻译和本土化的基础上，对文件结构进行了重组，并增加了总调度 Agent 和审查 Agent 两个核心角色。

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

### skill-install-manager

技能安装管理器 — 自动读取技能列表文件，与当前全局已安装技能进行对比，
找出未安装或存在更新的技能，并执行一键安装/更新。

**核心改进 v2：**
- ⏫ **自更新优先**：运行技能时先更新自身，确保技能列表文件为最新
- 🔄 **`npx skills update` 优先**：对已安装技能优先使用 `npx skills update`（更快、不重复克隆），失败再降级到 `npx skills add`
- 📋 **新旧列表对比**：自更新后对比更新前后的技能列表，自动标记 🆕新增/🗑️移除/➡️延续三类技能
- 🧩 **三级安装回退**：`npx skills update` → `npx skills add` HTTPS → SSH → GitHub API 手动下载

**Use when:**
- "检查并安装缺少的技能" / "看看哪些技能还没装"
- "同步技能列表" / "skill sync" / "更新所有技能"
- "技能管理" / "批量安装 skills" / "一键安装"
- 任何与技能安装、同步、更新、管理相关的需求

**Features:**
- **自更新流程**：⓪自更新 → ①读新列表 → ②新旧对比 → ③解析 → ④获取状态 → ⑤对比 → ⑥安装/更新 → ⑦报告
- **智能更新策略**：
  - 🆕 新增技能 → `npx skills add` 安装（最先安装）
  - ❌ 缺失技能 → `npx skills add` 安装（其次安装）
  - 🔄 已安装可更新 → `npx skills update` 优先（15s 超时），失败降级到 add
- 双模式执行：agent 直行（主路径，超时可控+进度可见）+ JS 脚本辅助
- 内置技能列表文件 `references/Reasonix-skill-list-v2.md`，开机即用
- 版本对比：`git ls-remote` + `web_fetch` GitHub API 双通道
- 支持 `-a reasonix`（小写）避免大小写错误

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

## Sandbox (Skill Development Area)

`sandbox/` 是用于创建、测试和验证新 Skill 的开发沙盒，与正式发布目录 `skills/` 隔离，
方便在不影响已发布 skill 的前提下进行开发和实验。

```
sandbox/
├── dev/              # 存放正在开发中的 Skill（按 skills/ 相同规范结构）
│   └── my-skill/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
└── tests/            # 执行测试验证的环境
    ├── README.md
    └── fixtures/     # 可选：测试用数据
```

### Workflow

1. **开发** — 在 `sandbox/dev/` 下按 Skill 规范结构创建新 skill
2. **测试** — 在 `sandbox/tests/` 中编写测试脚本并执行验证
3. **发布** — 测试通过后，将 skill 移至 `skills/` 目录正式上线

## 致谢与声明 / Acknowledgements

本项目中的 [agent-orchestra](./skills/agent-orchestra/SKILL.md) SKILL 集成的 251 个 Agent 定义文件基于以下开源项目：

- [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) — 中文版 AI 智能体专家团队（266 个角色，19 个部门）
- [agency-agents](https://github.com/msitarzewski/agency-agents) — 上游英文原版

感谢以上项目的贡献者。本 SKILL 在完整翻译和本土化的基础上，对文件结构进行了重组，并增加了总调度 Agent 和审查 Agent 两个核心角色。

## License

MIT
