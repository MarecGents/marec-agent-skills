---
name: skill-install-manager
description: >
  技能安装管理器 — 自动读取技能列表文件，与当前全局已安装技能进行对比，
  找出未安装或存在更新的技能，并执行一键安装/更新。支持三级回退：
  HTTPS → SSH → MCP/GitHub API 直接抓取。使用 `npx skills` 命令安装，
  安装为 Global，指定 Reasonix / Claude Code / OpenCode 三个 Agent。
  当用户提到"检查技能"、"同步技能"、"安装技能"、"技能管理"、
  "skill update"、"skill sync"、"批量安装"、"缺少技能"等任何与
  技能安装管理相关的需求时，务必使用本技能。
license: MIT
compatibility: "Requires Node.js >= 18, git, and npx skills CLI"
---

# skill-install-manager

> 技能安装管理器 — 自动读取技能列表文件，与当前全局已安装技能进行对比，找出未安装或存在更新的技能，并执行一键安装/更新。支持三级回退：HTTPS → SSH → MCP/GitHub API 直接抓取。使用 `npx skills` 命令安装，安装为 Global，指定 Reasonix / Claude Code / OpenCode 三个 Agent。

## 触发条件

用户表达以下任一意图时触发。**即使只是暗示或间接提及技能安装/管理工作，也应使用本技能**：

- "检查并安装缺少的技能" / "看看哪些技能还没装"
- "同步技能列表" / "同步 skills" / "skill sync"
- "更新所有技能到最新版本" / "检查更新" / "skill update"
- "技能管理" / "skill manager" / "管理技能"
- "批量安装 skills" / "安装这些技能" / "一键安装"
- "从技能列表安装" / "按列表安装"
- "帮我整理技能" / "技能状态" / "看看技能"
- "把新技能装上" / "补一下缺少的技能"
- "npx skills" / "skills add" / "技能仓库"

## 执行模式说明

本 Skill 采用 **agent 直接执行（主路径）+ JS 脚本（可选辅助）** 的双模式设计：

| 模式 | 适用场景 | 特点 |
|------|---------|------|
| **🟢 agent 直行** | 默认模式，推荐 | 每一步可见进度、超时可控、超时后自动降级 |
| **🔵 JS 脚本辅助** | 需要批量格式化输出时 | 快速输出结构化 JSON，但遇到网络问题可能卡住 |

**核心原则**：所有 shell 命令设严格超时（15-30s），超时后 agent 用自己的工具降级执行，不允许长时间无响应。

---

## 工作流程概述

```
步骤① 读取列表文件（agent read_file 直接读取）
     │
     ▼
步骤② 解析列表（agent 在推理中解析，或调用 compare-skills.js 做格式化）
     │
     ▼
步骤③ 获取安装状态（agent 直接运行 npx skills ls + read_file 读锁文件）
     │
     ▼
步骤④ 对比分析（agent 逐一对比，每仓库 git ls-remote 15s 超时）
     │     ├─ 成功 → 标记 outdated/upToDate
     │     └─ 超时 → web_fetch GitHub API 降级 → 标记 unknown
     │
     ▼
步骤⑤ 执行安装（每 skill：npx skills add 30s 超时 → SSH 30s → 手动下载）
     │     ├─ 成功 → ✅
     │     ├─ SSH 成功 → ✅ (ssh)
     │     └─ 手动下载 → ✅ (manual)
     │
     ▼
步骤⑥ 生成报告（agent 直接格式化输出）
```

---

## 详细执行步骤

### 步骤①：确定技能列表文件路径

1. 检查用户是否在任务中明确指定了文件路径。如果是，直接使用。
2. 如果用户未指定，按以下优先级查找默认路径：
   - `./skill-list.md`（当前工作目录）
   - `./skills/skill-list.md`
   - `./sandbox/dev/skill-list.md`
   - `references/Reasonix-skill-list-v2.md`（Skill 内置列表文件）
3. 使用 `read_file` 工具读取文件内容。如果文件不存在，向下查找下一优先级。
4. 如果所有路径都不存在，询问用户提供文件路径。

### 步骤②：解析列表文件

**agent 直行（主路径）**：在推理中直接解析文件内容

每行按以下规则处理：
- 以 `## Origin URL:` 开头的行 → 提取 URL，开始一个新的来源节
- 以 `N. <skill-name>: npx skills add ...` 格式的行 → 提取技能名称和安装命令
- 以 `N. <skill-name>` 格式的行（无安装命令）→ 提取名称，标记 installCmd=null
- 空白行或非匹配行 → 跳过

解析结果存入一个临时结构，格式如下：
```
来源 1: https://github.com/owner/repo
  ├── skill-a  → npx skills add ...
  ├── skill-b  → npx skills add ...
来源 2: https://github.com/another/repo
  ├── skill-c  → npx skills add ...
```

> 🔵 **JS 脚本辅助**：如需输出结构化 JSON，可运行以下脚本（可选，非必须）：
> ```powershell
> node "<skill-path>\scripts\compare-skills.js" --parse-only --list "<list-file>"
> ```

**进度报告**：✅ 解析完成：N 个来源，M 个技能

### 步骤③：获取当前全局安装状态

**agent 直行（主路径）**：

1. 运行以下命令获取全局安装列表：
   ```powershell
   npx skills ls -g --json
   ```
   如果命令在 15s 内无响应（卡住），按 Ctrl+C 终止并跳过（标记为"安装列表获取失败"）。

2. 读取锁文件获取版本信息：
   ```powershell
   Get-Content "$env:USERPROFILE\.agents\.skill-lock.json" | ConvertFrom-Json
   ```
   或者用 MCP `read_file` 工具直接读取 `~/.agents/.skill-lock.json`。

3. 提取每个已安装技能的：
   - `name` — 技能名称
   - `agents` — 已安装的 agent 列表
   - `skillFolderHash` — 安装时的 git commit SHA（用于版本对比）
   - `sourceUrl` / `skillPath` — 来源信息

**进度报告**：✅ 已读取全局安装状态：N 个已安装技能

### 步骤④：对比分析

**agent 直行（主路径）** — 在推理中逐一对比，每步报告进度：

#### 4.1 按来源分组处理

将步骤②解析的 origins 列表按 URL 分组，同一仓库的技能一起处理。

#### 4.2 逐仓库版本检查

对每个来源仓库：

```
正在检查: [仓库名称] (N 个技能)...
```

**方式 A（优先）— `git ls-remote` 快速检查**：
```powershell
$job = Start-Job -ScriptBlock { git ls-remote https://github.com/{owner}/{repo}.git HEAD }
$result = $job | Wait-Job -Timeout 15
if ($result) {
    $sha = (Receive-Job $job).Trim().Split()[0]
    Remove-Job $job
} else {
    Stop-Job $job; Remove-Job $job
    # 降级到方式 B
}
```
- 成功（15s 内返回）→ 提取 SHA，与锁文件对比 → 标记 outdated/upToDate
- **超时（15s 无响应）→ 降级到方式 B**

**方式 B（降级）— `web_fetch` GitHub API 查询**：
```
web_fetch: https://api.github.com/repos/{owner}/{repo}/commits?per_page=1
```
- 成功 → 从返回的 JSON 中提取 latest_commit.sha
- 失败 → 标记为"状态未知（网络不可达）"

#### 4.3 分类汇总

每处理完一个仓库，实时输出进度：

```
📦 anthropics/skills (1 skill):
   ✅ skill-creator → 可更新 (hash: 7e3c9c... → 9d2f1a...)
📦 obra/superpowers (10 skills): 
   ⚠️  git ls-remote 超时 → web_fetch 降级 → 最新 commit d884ae...
   ✅ brainstorming → 可更新
   ... (等)
```

### 步骤⑤：执行安装

对 missing 和 outdated 列表中的技能，按以下规则安装：

#### 5.1 对每个待安装技能

```
正在安装: [skill-name] (来源: [origin-url])...
```

**尝试 A（优先）— HTTPS 安装（30s 超时）**：
```powershell
$job = Start-Job -ScriptBlock { npx skills add "{url}" --skill "{name}" -g -a Reasonix -a "Claude Code" -a OpenCode -y }
$result = $job | Wait-Job -Timeout 30
if ($result) {
    $output = Receive-Job $job
    Remove-Job $job
    # 安装成功 → ✅
} else {
    Stop-Job $job; Remove-Job $job
    # 超时 → 降级到尝试 B
}
```
- 成功（30s 内返回）→ ✅ 记录成功
- **超时（30s 无响应）→ 降级到尝试 B**

**尝试 B（降级）— SSH 安装（30s 超时）**：
```
URL 转换: https://github.com/owner/repo → git@github.com:owner/repo.git
```
```powershell
$job = Start-Job -ScriptBlock { npx skills add "git@github.com:{owner}/{repo}.git" --skill "{name}" -g -a Reasonix -a "Claude Code" -a OpenCode -y }
$result = $job | Wait-Job -Timeout 30
```
- 成功 → ✅ (ssh) 记录成功
- **超时 → 降级到尝试 C**

**尝试 C（最终降级）— agent 直接手动下载安装**：

当 `npx skills add` 完全不可用时，agent 用自己的工具完成安装：

1. **获取仓库默认分支**：
   ```
   web_fetch: https://api.github.com/repos/{owner}/{repo}
   ```   
   提取 `default_branch`（通常为 main 或 master）

2. **获取文件树，定位 skill 目录**：
   ```
   web_fetch: https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1
   ```
   在文件树中查找包含技能名称的路径，确定基础路径。

3. **逐个下载所有文件**：
   对基础路径下的每个 blob 文件：
   ```
   web_fetch: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{filepath}
   ```
   将内容写入 `~/.agents/skills/{skill-name}/{relative-path}`。
   - 使用 `bash`（`New-Item` + `Set-Content`）或 MCP Filesystem `write_file` 写入

4. **更新锁文件**：
   ```powershell
   $lock = Get-Content "$env:USERPROFILE\.agents\.skill-lock.json" | ConvertFrom-Json
   $lock.skills."{name}" = @{
       source = "{owner}/{repo}"
       sourceType = "github"
       sourceUrl = "https://github.com/{owner}/{repo}.git"
       skillPath = "{base-path}"
       skillFolderHash = "{tree-sha}"
       installedAt = (Get-Date -Format o)
       updatedAt = (Get-Date -Format o)
   }
   $lock | ConvertTo-Json -Depth 10 | Set-Content "$env:USERPROFILE\.agents\.skill-lock.json"
   ```

5. **注册 skill（可选）**：
   手动安装后，如果有 `npx skills` 可用，运行：
   ```powershell
   npx skills experimental_sync -y
   ```
   如果 `npx skills` 仍不可用，告知用户 skill 文件已写入但需手动注册。

#### 5.2 安装顺序

按 Origin URL 分组安装，同一仓库的技能一起处理。先安装所有缺失技能，再更新可更新技能。

### 步骤⑥：生成报告

**agent 直行（主路径）** — 直接格式化输出：

```
╔════════════════════════════════════════════╗
║        Skill 安装/更新报告                  ║
╚════════════════════════════════════════════╝

📊 汇总:
   总计     : 36 个技能
   已安装   : 36 个
   缺失     : 0 个
   可更新   : 5 个（已更新: 3, 失败: 2）
   已最新   : 28 个
   状态未知 : 3 个

📦 anthropics/skills:
   ✅ skill-creator → 已更新 (HTTPS)

📦 imbad0202/academic-research-skills:
   ✅ academic-paper → 已更新 (SSH 降级)
   ❌ academic-pipeline → 更新失败: 手动下载超时

📦 MarecGents/marec-agent-skills:
   ⏭️  check-reasonix-update → 状态未知（锁文件数据缺失）
```

---

## JS 辅助脚本（可选）

本技能附带 JS 脚本作为可选辅助工具，非核心工作流依赖：

| 脚本 | 用途 | 触发方式 |
|------|------|---------|
| `scripts/utils.js` | 共享工具模块 | 被其他脚本引用 |
| `scripts/compare-skills.js` | 快速输出结构化 JSON | `node "<path>\scripts\compare-skills.js" --list "<file>"` |
| `scripts/install-skill.js` | 批量安装带三级回退 | `node "<path>\scripts\install-skill.js" --name "<name>" --url "<url>"` |

**使用场景**：当需要快速获取格式化 JSON 输出（如集成到其他工具链）时使用。日常工作流中推荐使用 agent 直行模式。

---

## 参考文件

- `references/Reasonix-skill-list-v2.md` — 内置的技能列表文件，包含所有 Origin URL 及对应 Skills
- `references/skill-list-format.md` — 技能列表文件的格式说明

---

## 使用示例

**示例 1：完整同步**

> 用户：帮我同步一下技能

执行流程：
1. 读取内置列表文件 `references/Reasonix-skill-list-v2.md`
2. agent 解析：7 个来源，36 个技能
3. `npx skills ls -g --json` → 读取安装状态
4. 逐仓库 `git ls-remote` 对比版本（设 15s 超时）
   - anthropics/skills → 成功，skill-creator 可更新
   - Yuan1z0825/nature-skills → 超时，web_fetch 降级成功
5. 对可更新技能执行安装（设 30s 超时）
6. 输出报告

**示例 2：安装特定技能**

> 用户：帮我安装 xx-skill，列表在 ./my-list.md

执行流程：
1. 读取 `./my-list.md`
2. 解析找到 xx-skill 及其来源 URL
3. 检查是否已安装 → 未安装
4. `npx skills add <url> --skill xx-skill -g -a Reasonix -a "Claude Code" -a OpenCode -y`（30s 超时）
5. 成功 → ✅ 输出报告

**示例 3：完全离线安装（npx 不可用）**

1. 解析列表，确定需要安装的技能列表
2. 对所有技能，直接走"尝试 C"手动下载流程
3. `web_fetch` GitHub API → 获取文件树
4. `web_fetch` raw 内容 → 写入 `~/.agents/skills/`
5. 更新锁文件
6. 告知用户文件已就位

---

## 注意事项

1. **超时设计**：所有 shell 命令使用 `Start-Job` + `Wait-Job -Timeout` 控制超时，避免长时间卡住。`git ls-remote` 15s 超时，`npx skills add` 30s 超时。
2. **降级路径**：每步都有明确的降级路径：shell 超时 → web_fetch 降级 → 手动文件操作。不允许失败后无反馈。
3. **进度可见**：每处理完一个仓库/技能，必须输出进度标记（`✅`/`⚠️`/`❌`），不能长时间静默。
4. **网络环境**：GitHub API（`api.github.com`）和 raw 文件（`raw.githubusercontent.com`）可能需要代理。如果所有方式都失败，向用户报告具体情况。
5. **文件路径**：Windows 路径中的反斜杠需要用双引号包裹，或在 PowerShell 中使用单引号。
6. **`skillFolderHash`**：这是 `.skill-lock.json` 中记录的安装时刻的 git commit SHA。如果锁文件中缺少此字段，技能会被标记为"状态未知"，agent 会尝试通过 `web_fetch` GitHub API 获取远程版本作为参考。
7. **`skippable` 分类**：列表中的特殊条目（如 `_shared` 共享资源目录）没有安装命令，跳过不处理。
8. **快速更新**：对于已安装的技能，也可直接使用 `npx skills update <skill-name> -g -y` 快速更新。
9. **路径大小写**：`MarecGents` 等路径大小写敏感，务必使用 `pwd` 确认的准确路径。
