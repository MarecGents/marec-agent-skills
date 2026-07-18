---
name: skill-standard-harness
description: >
  标准规范约束中心。统一管理操作层面的公共规范（如 GitHub 仓库访问规范、Markdown 输出规范等），
  供其他技能引用，避免各技能重复维护相同规范内容。
  触发场景：任何技能需要获取公共操作规范时；用户任务涉及 GitHub 仓库访问、文档输出、文件化任务追踪等需要遵循标准规范的场景。
  default、github-project-replication 等技能在核心原则中声明了本技能为必选前置依赖。
license: MIT
compatibility: 需要 curl 和 git 命令行工具。
metadata:
  author: user
  version: "1.0"
  model-task: standard-harness
---

# skill-standard-harness — 标准规范约束

本技能为其他技能提供标准化的操作规范引用。目前包含以下规范：

## 规范索引

| 规范名称 | 参考文件 | 说明 |
|---|---|---|
| GitHub 仓库访问规范 | `references/github-access-standard.md` | 获取 GitHub 仓库代码的四级优先级规范 |
| Markdown 输出规范 | `references/markdown-output-standard.md` | Markdown 文档的标题层级、时间戳、日志结构、文件命名等统一格式 |

## 使用方式

### 作为其他技能的引用规范

当你在编写或使用某个技能时，如果涉及公共操作规范（如 GitHub 仓库访问、Markdown 文档输出等），**不要**在技能体内重复编写完整的规范内容，而是引用本技能：

> 涉及 GitHub 仓库访问时，请调用 `skill-standard-harness` 技能并读取 `references/github-access-standard.md` 中的规范执行。
> 涉及 Markdown 输出格式时，请读取 `references/markdown-output-standard.md` 中的规范执行。

### 直接调用

当用户任务涉及以下场景时，直接触发本技能：

1. **获取公共操作规范** — 其他技能在执行过程中需引用统一规范（如 GitHub 仓库访问、Markdown 输出等）
2. **复现 GitHub 项目** — 用户给出仓库 URL 要求运行/部署
3. **下载 GitHub 源码** — 用户需要获取某个仓库的代码文件
4. **需要规范文档输出** — 任务涉及生成结构化 Markdown 报告或日志文档

按照对应规范文件中的规则执行。

## 规范目录结构

```
skill-standard-harness/
├── SKILL.md                              # 技能描述、触发条件、规范索引
└── references/
    ├── github-access-standard.md          # GitHub 仓库访问规范
    └── markdown-output-standard.md        # Markdown 输出规范
```

## 扩展说明

如需添加新的规范约束：
1. 在 `references/` 下创建对应的规范参考文件
2. 更新本 SKILL.md 中的**规范索引**表格
3. 在对应的技能中通过引用 `skill-standard-harness` 的方式调用
