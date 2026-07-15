# Skill: skill-install-manager

> 技能安装管理器 — 自动读取技能列表文件，与当前全局已安装技能进行对比，找出未安装或存在更新的技能，并执行一键安装/更新。支持三级回退：HTTPS → SSH → MCP/GitHub API 直接抓取。使用 `npx skills` 命令安装，安装为 Global，指定 Reasonix / Claude Code / OpenCode 三个 Agent。

## 触发条件

用户表达以下任一意图时触发：
- "检查并安装缺少的技能"
- "同步技能列表" / "同步 skills"
- "更新所有技能到最新版本"
- "技能管理" / "skill manager"
- "看看哪些技能还没装"
- "从技能列表安装"
- "批量安装 skills"
- "skill sync" / "skill install manager"

## 工作流程概述

```
用户提供技能列表文件路径（或使用默认路径）
     │
     ▼
解析列表文件 → 提取每个 Origin URL 及其下属 Skills
     │
     ▼
获取当前全局安装状态（npx skills ls -g --json）
     │
     ▼
对比分析 → 标记缺失 / 可更新的 Skills
     │
     ▼
批量执行安装（按 Origin URL 分组，避免重复拉取仓库）
     │
     ▼
三级回退链：HTTPS → SSH → MCP/GitHub API
     │
     ▼
生成安装报告
```

---

## 详细执行步骤

### 第一步：确定技能列表文件路径

1. 检查用户是否在任务中明确指定了文件路径。如果是，直接使用。
2. 如果用户未指定，按以下优先级查找默认路径：
   - `./skill-list.md`（当前工作目录）
   - `./skills/skill-list.md`
   - `./sandbox/dev/skill-list.md`
   - `references/Reasonix-skill-list-v2.md`（Skill 内置列表文件）
3. 如果以上都不存在，询问用户提供文件路径。
4. 用户提供的文件应符合 `Reasonix-skill-list-v2.md` 的格式（格式说明见 `references/skill-list-format.md`，内置副本位于 `references/Reasonix-skill-list-v2.md`）。

### 第二步：解析列表文件

读取技能列表文件，按以下结构解析：

每个 `## Origin URL: <url>` 段落后跟若干行 `N. <skill-name>: npx skills add <url> --skill <skill-name>`

提取数据结构：
```json
{
  "origins": [
    {
      "url": "https://github.com/owner/repo",
      "skills": [
        {"name": "skill-name", "installCmd": "npx skills add ..."}
      ]
    }
  ]
}
```

**注意**：
- 去除空行和注释行
- 忽略 `## Origin URL:` 后无内容的条目（URL 为空）
- 提取 URL 时去除尾部空格和多余的空白
- 每个 skill 的安装命令从行中提取完整命令

### 第三步：获取当前全局安装状态

执行以下命令获取当前全局安装的技能列表：

```
npx skills ls -g --json
```

解析输出 JSON 数组，提取每个技能的：
- `name` — 技能名称
- `agents` — 已安装的 agent 列表
- `path` — 安装路径

同时读取 `C:\Users\<username>\.agents\.skill-lock.json`（或 `~/.agents/.skill-lock.json`），用于版本对比：
- `skillFolderHash` — 安装时的 git commit SHA
- `sourceUrl` — 来源仓库 URL
- `skillPath` — 仓库内的 skill 路径

### 第四步：对比分析

将列表中的 skills 与已安装的 skills 进行对比：

**4.1 找出未安装的技能**

遍历每个 Origin URL 下的每个 skill：
- 如果在 `npx skills ls -g --json` 的输出中找不到同名 skill → **未安装**
- 标记为待安装

**4.2 找出可更新的技能**

对于已安装的技能：
1. 从 `.skill-lock.json` 中读取该技能的 `skillFolderHash`（git commit SHA）
2. 从 Origin URL 解析出仓库 owner/repo
3. 执行 `git ls-remote https://github.com/<owner>/<repo>.git HEAD` 获取远程仓库最新 commit SHA
4. 对比两个 SHA：
   - 如果不同 → **远程有更新**
   - 如果相同 → **已是最新**
5. 对于使用 SSH sourceUrl 的条目，同样用 HTTP 方式检查远程（`git ls-remote` 支持 HTTPS）

**注意**：
- 如果 `git ls-remote` 失败（网络原因），跳过版本检查，仅报告"无法检查更新"
- 对于 `skillFolderHash` 不存在的技能，标记为"版本状态未知"，并尝试通过 `git ls-remote` 获取远程版本作为参考（`fallback` 字段）
- 同一 Origin URL 下的技能共享同一个仓库，只需 `git ls-remote` 一次
- `git ls-remote` 默认 1 次尝试 + 1 次重试（共 2 次），每次最长 12 秒，可通过修改 `scripts/utils.js` 中的 `gitLsRemoteWithRetry` 调整

### 第五步：执行安装

**5.1 按 Origin URL 分组安装**

为避免重复拉取同一仓库，按 Origin URL 分组，对每个 URL 执行一次安装包含该 URL 下所有需要安装/更新的技能：

```
npx skills add <origin-url> --skill <skill-name-1> --skill <skill-name-2> ... -g -a Reasonix -a "Claude Code" -a OpenCode -y
```

- `-g`：安装为 Global
- `-a Reasonix`：安装到 Reasonix
- `-a "Claude Code"`：安装到 Claude Code
- `-a OpenCode`：安装到 OpenCode
- `-y`：跳过所有交互式确认（即"recommend"选项）

**对每个需要安装/更新的技能都需要指定 `--skill` 参数**。但如果整个 Origin URL 下只有一个技能需要安装/更新，则只需指定一个 `--skill`。

**5.2 安装顺序**

先安装所有缺失的技能，再更新所有已安装但可更新的技能。

### 第六步：失败回退链

如果安装命令执行失败，按以下顺序尝试回退：

**6.1 优先使用 HTTPS URL**

直接从技能列表文件中提取的 URL（如 `https://github.com/owner/repo`）进行安装。

```
npx skills add https://github.com/owner/repo --skill <name> -g -a Reasonix -a "Claude Code" -a OpenCode -y
```

**6.2 HTTPS 失败 → SSH 格式**

将 HTTPS URL 转换为 SSH 格式：

```
HTTPS: https://github.com/owner/repo
SSH:   git@github.com:owner/repo.git
```

然后重试：

```
npx skills add git@github.com:owner/repo.git --skill <name> -g -a Reasonix -a "Claude Code" -a OpenCode -y
```

**注意**：转换时保留所有路径信息。如果原始 URL 包含子路径（如 `https://github.com/owner/repo/tree/main/subdir`），SSH 格式可能不支持，此时应使用原始 URL 的 `--skill <name>` 方式单独指定技能路径。

**6.3 SSH 也失败 → MCP/GitHub API 直接抓取**

如果 `npx skills add` 命令无论用 HTTPS 还是 SSH 都失败，执行以下手动安装流程：

1. **使用 GitHub API 获取仓库文件列表**：
   ```
   GET https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1
   ```
   找到对应 skill 的所有文件路径（从 `skillPath` 或直接在仓库根目录下寻找）

2. **逐个下载技能文件**：
   使用 `GET https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{filepath}` 下载每个文件

3. **创建本地 skill 目录**：
   在全局 skills 目录（`C:\Users\<username>\.agents\skills\<skill-name>\`）下创建对应目录结构

4. **写入所有文件**：
   将下载的文件内容写入到对应路径中

5. **更新锁文件**：
   记录此次手动安装到 `.skill-lock.json` 中

> **注意**：使用 MCP Filesystem 工具时，需要确保目标目录在允许的访问路径内。如果路径受限，使用 PowerShell 命令完成文件操作。

### 第七步：生成安装报告

安装完成后，输出清晰的报告：

```
╔══════════════════════════════════════════════════════════╗
║               Skill 安装/更新报告                        ║
╚══════════════════════════════════════════════════════════╝

📦 来源: https://github.com/owner/repo
   ✅ skill-a: 已安装 ✓
   ⚠️  skill-b: 已更新到最新版
   ❌ skill-c: 安装失败（原因：...）
   ⏭️  skill-d: 跳过（已是最新）

📊 汇总:
   总计: 10 个技能
   ✅ 已安装/更新: 8 个
   ⏭️  跳过（已最新）: 1 个
   ❌ 失败: 1 个
```

---

## 辅助脚本

本技能包含以下辅助脚本，在执行时按需使用：

| 脚本 | 用途 |
|---|---|
| `scripts/utils.js` | Node.js 共享工具模块，提供 extractGitHubInfo、httpsToSsh、runCommand、gitLsRemoteWithRetry |
| `scripts/compare-skills.js` | Node.js 脚本，解析列表文件 + 读取安装状态 → 输出差异对比 JSON |
| `scripts/install-skill.js` | Node.js 脚本，执行单个技能的安装命令并处理回退逻辑 |

### 使用脚本

在 PowerShell 中执行：

```powershell
node "<skill-path>\scripts\compare-skills.js" --list "<path-to-list-file>"
node "<skill-path>\scripts\install-skill.js" --name "<skill-name>" --url "<origin-url>"
```

**compare-skills.js** 输出格式：

```json
{
  "missing": [{"name": "...", "originUrl": "..."}],
  "skippable": [{"name": "...", "originUrl": "...", "installCmd": null}],
  "outdated": [{"name": "...", "originUrl": "...", "currentHash": "...", "latestHash": "..."}],
  "upToDate": [{"name": "..."}],
  "unknown": [{"name": "...", "reason": "...", "fallback": {...}}]
}
```

字段说明：
- `missing` — 可安装但尚未安装的技能
- `skippable` — 不可安装的条目（如 `_shared`，无 installCmd），自动过滤不参与安装
- `outdated` — 已安装但远程仓库有更新的技能，含本地和远程的 commit SHA
- `upToDate` — 已安装且已是最新的技能
- `unknown` — 版本状态未知的技能，含失败原因说明；若有 `fallback` 字段表示锁文件缺失但已通过 `git ls-remote` 获取了远程版本参考

---

## 参考文件

- `references/Reasonix-skill-list-v2.md` — 内置的技能列表文件，包含所有 Origin URL 及对应 Skills
- `references/skill-list-format.md` — 技能列表文件的格式说明

---

## 使用示例

**示例 1：用户已拷贝列表文件到工作目录**

> 用户：帮我检查并安装缺少的技能，列表文件在 ./my-skills.md

执行流程：
1. 读取 `./my-skills.md`
2. 解析 Origin URL 和技能列表
3. 执行 `npx skills ls -g --json` 获取安装状态
4. 对比找出 3 个未安装的技能
5. 分别执行安装命令
6. 生成安装报告

**示例 2：用户未指定文件路径**

> 用户：帮我同步一下技能

执行流程：
1. 查找默认路径 `./skill-list.md` → 不存在
2. 查找 `./skills/skill-list.md` → 不存在
3. 使用内置列表文件 `references/Reasonix-skill-list-v2.md`
4. 解析并对比
5. 发现某个 skill 有更新版本
6. 执行更新安装
7. 输出报告

**示例 3：HTTPS 安装失败**

1. `npx skills add https://github.com/owner/repo --skill my-skill -g -a Reasonix -a "Claude Code" -a OpenCode -y` → 失败（网络超时）
2. 转换为 SSH：`npx skills add git@github.com:owner/repo.git --skill my-skill -g ...` → 成功
3. 记录到报告："my-skill: 已安装（通过 SSH 回退）"

---

## 注意事项

1. **网络环境**：某些 GitHub 仓库可能需要代理或 SSH 密钥才能访问。如果所有方式都失败，向用户报告具体情况并建议检查网络连接或 SSH 配置。
2. **文件路径**：Windows 路径中的反斜杠需要用双引号包裹，或在 PowerShell 中使用单引号。
3. **npx 命令**：执行 `npx skills add` 前确保 Node.js 和 npx 可用（通常随 Reasonix 环境预装）。
4. **`skillFolderHash`**：这是 `.skill-lock.json` 中记录的安装时刻的 git commit SHA，用于版本比对。如果锁文件中缺少此字段，技能会被标记为"版本状态未知"（`unknown`），脚本会尝试通过 `git ls-remote` 获取远程版本作为参考。
5. **`skippable` 分类**：列表中的特殊条目（如 `_shared` 共享资源目录）没有安装命令（`installCmd === null`），会被自动归入 `skippable` 分类，不会参与安装流程。
6. **快速更新**：对于已安装的技能，也可以直接使用 `npx skills update <skill-name> -g -y` 命令进行快速批量更新，无需经过完整的对比分析流程。
7. **PowerShell 转义**：在 PowerShell 中传递 JSON 参数给脚本时，注意引号转义规则。
8. **路径大小写**：`MarecGents` 等路径大小写敏感，务必使用 `pwd` 确认的准确路径。
