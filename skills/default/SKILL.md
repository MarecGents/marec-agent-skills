---
name: default
description: 通用默认工作流技能。当用户提出一个任务但没有匹配到更具体的专项技能时，使用此技能作为兜底方案。
  提供标准化的三阶段工作流：先 Brainstorming 进行前期构思与设计确认，再用 Planning with Files 进行文件化任务追踪，
  最后收尾归档生成任务日志并清理临时文件。
  触发词：帮我做个、我要、写一个、建一个、实现、开发、完成、整理、分析、处理任何没有明确技能匹配的任务。
  当 brainstorming、planning-with-files 等 slash command 可用时优先使用此工作流。
license: MIT
compatibility: 需要 brainstorming 和 planning-with-files-zh 两个 slash command 可用。
metadata:
  author: user
  version: "1.0"
  model-task: default-workflow
---

# Default — 通用默认工作流

当你收到一个用户任务，且没有更具体的专项技能匹配时，按照本技能定义的三阶段工作流执行。

---

## 核心原则

1. **必须先调用 brainstorming** — 每次任务执行必须启用 brainstorming 技能进行前期构思和分析。这帮助你在动手之前全面理解用户意图、项目目标和潜在挑战。
2. **必须用 planning-with-files 做追踪** — 启用 planning-with-files-zh 技能，创建三个核心追踪文件，让整个过程有迹可循、可回溯。
3. **任务结束后清理并归档** — 基于三个规划文件生成最终的任务日志文档，存入 `./docs/`，然后删除过程中产生的无用文件。

### 三个核心追踪文件

由 planning-with-files-zh 创建，贯穿整个任务生命周期：

| 文件 | 用途 |
|---|---|
| `task_plan.md` | 记录任务的阶段划分与进度清单 |
| `findings.md` | 记录研究笔记、发现、决策 |
| `progress.md` | 记录每步操作的详细日志（含时间戳） |

---

## GitHub 仓库访问规范

当任务涉及从 GitHub 获取仓库代码时（如复现项目、下载源码、引用示例等），请严格按照以下优先级依次尝试，直到成功获取代码。此规范确保在各种网络环境下都能有效地获取目标仓库内容。

### 优先级一：git clone HTTP(S)

```bash
git clone https://github.com/{owner}/{repo}.git
```

使用 HTTPS 协议进行 clone，兼容性最好，无需额外配置 SSH 密钥。**优先使用此方式。**

### 优先级二：git clone SSH

```bash
git clone git@github.com:{owner}/{repo}.git
```

如果 HTTPS clone 失败（如网络限流、超时、被阻断），尝试 SSH 协议进行 clone。需要本地已配置 SSH 密钥并关联到 GitHub 账户。

### 优先级三：下载 ZIP 包并解压

如果 git clone（HTTP 和 SSH）均失败，尝试直接下载仓库 ZIP 压缩包：

```bash
# 方式 A：通过 GitHub 的 archive 链接（推荐，速度最快）
curl -L -o repo.zip https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip

# 方式 B：通过 GitHub API 获取默认分支的 ZIP
curl -L -o repo.zip https://api.github.com/repos/{owner}/{repo}/zipball
```

下载完成后使用 `unzip` 或系统解压工具解压得到源码目录。

### 优先级四：GitHub API 下载

如果以上所有 clone/下载方式均不可行，使用 GitHub REST API 逐个获取文件内容：

- `GET /repos/{owner}/{repo}/contents/{path}` — 获取单个文件内容或目录列表
- `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1` — 获取完整的目录树结构

此方式适用于极端网络限制环境，但效率较低，仅作最后手段。

### 约束说明

- **每方式最多重试 2 次** — 同一方法连续失败 2 次后方可切换到下一优先级
- **记录失败原因** — 每次尝试失败需将错误信息记录到 `progress.md` 或 `findings.md`
- **切换方式前需记录原因** — 在追踪文件中注明为何降级到下一方式
- **所有方式均失败后求助用户** — 如果四种方法全部失败，停止尝试并向用户报告具体情况，请求网络环境协助

---

## 三阶段工作流

```
阶段一：Brainstorming（前期构思）
  ↓
阶段二：Planning with Files（文件化执行）
  ↓
阶段三：任务收尾（归档 + 清理）
```

### 阶段一：Brainstorming（前期构思）

**触发条件**：接收到用户任务后立即进入此阶段。

**执行步骤：**

1. **调用 brainstorming** — 对任务进行初步分析构思。思考：
   - 用户到底想要什么？核心诉求是什么？
   - 这个任务涉及哪些方面？
   - 可能遇到哪些主要挑战？
   - 需要哪些前置条件或资源？

2. **遵循 brainstorming 流程**：
   - 探索项目上下文（文件、文档、最近的变更）
   - 逐一提出澄清性问题，理解目的、约束和成功标准
   - 提出 2-3 种方案，附上权衡分析和你的推荐
   - 分部分呈现设计，每部分获得用户确认后再继续
   - 将确认后的设计写入设计文档（按 brainstorming 默认路径）
   - 让用户审查书面规格
   - **重要**：在用户批准设计之前，不得开始任何实现工作

3. **设计获得批准后**，进入阶段二。

### 阶段二：Planning with Files（文件化执行）

**执行步骤：**

1. **调用 planning-with-files-zh** — 初始化三个追踪文件：
   - `task_plan.md` — 将任务拆解为可执行的阶段和清单
   - `findings.md` — 预留研究笔记空间
   - `progress.md` — 准备记录操作日志

2. **遵循 planning-with-files-zh 的工作模式**：
   - 每一步操作前重新读取计划文件，保持目标清晰
   - 每执行 2 次查看/搜索操作后，将关键发现写入文件
   - 所有错误都要记录到文件中，防止重复失败
   - 每个阶段完成后更新 task_plan.md 状态
   - 遵循「三次失败协议」：3 次尝试失败后向用户求助

3. **按计划执行任务** — 根据 task_plan.md 的阶段划分，逐一完成。实时更新进度和发现。

### 阶段三：任务收尾（归档 + 清理）

**执行步骤：**

1. **生成任务日志文档**：
   - 基于 `task_plan.md`、`findings.md`、`progress.md` 三份文件
   - 整合生成一份完整的日志文档
   - **命名规则**：根据任务内容总结一个概括性名称，加上年月日时分
   - 格式：`{概括性名称}-{YYYY-MM-DD-HHmm}.md`
   - 例如：`用户登录模块重构-2026-06-27-1530.md`
   - 保存路径：`./docs/`（如果 `./docs/` 目录不存在，自动创建）
   - 内容应包含：
     - 任务概述（名称、目标、范围）
     - 执行过程摘要（每个阶段做了什么）
     - 关键发现与决策
     - 遇到的问题与解决方案
     - 最终结果与状态

2. **清理无用文件**：
   - 删除 `.planning/` 目录（如果存在）
   - 删除项目根目录下的 `task_plan.md`（如果存在）
   - 删除项目根目录下的 `findings.md`（如果存在 — 注意：如果用户原本就有自己的 findings.md，只删除由 planning-with-files 创建的内容，或与用户确认）
   - 删除项目根目录下的 `progress.md`（如果存在）
   - **注意**：不要删除用户原有的重要文件。如果发现 findings.md 在技能运行前就已存在，询问用户是否删除。

3. **输出最终结果摘要** — 用简洁的语言告诉用户：
   - 任务是否完成
   - 主要产出物（文件列表、路径）
   - 任务日志位置
   - 遗留问题（如果有）

---

## 错误处理与异常

| 异常场景 | 处理方式 |
|---|---|
| **用户未批准设计** | 如果 brainstorming 阶段用户对设计不满意，回到设计环节修改，直到用户批准 |
| **任务中途变更需求** | 更新 task_plan.md 和 findings.md，记录变更，调整剩余计划 |
| **三次连续失败** | 停止当前操作，向用户说明尝试过的方法和具体错误，请求指导 |
| **清理时发现用户原有文件** | 不自动删除，询问用户确认 |

---

## 输出规范

- **所有 Markdown 文件使用清晰的层级标题**（`#` → `##` → `###`）
- **`progress.md` 每条记录必须包含时间戳**（格式：`YYYY-MM-DD HH:mm`）
- **最终日志文档必须包含**：
  - 任务概述
  - 执行过程（每个阶段的摘要）
  - 关键发现与决策
  - 遇到的问题与解决方案
  - 最终结果与状态

---

## 成功标准

任务完成时，以下条件应全部满足：

- [ ] Brainstorming 已完成，设计已获用户批准
- [ ] Planning with Files 的三个追踪文件已创建并全程使用
- [ ] 任务目标已达成
- [ ] 完整的任务日志文档已生成到 `./docs/`
- [ ] 无用文件已清理

---

## 使用示例

**示例 1：数据处理任务**

> 用户：帮我整理一下这个 CSV 文件，把销售额按月份汇总

触发此技能后：
1. 调用 brainstorming：理解数据结构、汇总需求、输出格式
2. 用户确认设计后，创建 task_plan.md 等文件开始执行
3. 完成数据汇总，生成日志 `销售额月度汇总-2026-06-27-1530.md` 到 `./docs/`
4. 清理 .planning/ 和追踪文件

**示例 2：小型功能开发**

> 用户：给我的网站加一个回到顶部按钮

触发此技能后：
1. 调用 brainstorming：探讨按钮样式、位置、滚动行为、兼容性
2. 用户确认后创建规划文件并实现
3. 生成日志 `回到顶部按钮-2026-06-27-1600.md` 到 `./docs/`
4. 清理临时文件

---

## 与 github-project-replication 技能的关系

本技能（default）是通用兜底方案，而 github-project-replication 是专门针对 GitHub 项目复现场景的专项技能。两者共享 brainstorming → planning-with-files → 归档清理的核心模式，但 github-project-replication 有更详细的六阶段复现流程。如果用户任务明确是 GitHub 项目复现，应优先使用 github-project-replication。
