---
name: skill-install-manager
description: >
  技能安装管理器 — 自动读取技能列表文件，与当前全局已安装技能进行对比，
  找出未安装或存在更新的技能，并执行一键安装/更新。v3.0 起全部流程由
  脚本自动完成（sync-skills.js 主编排），支持五通道回退与 CDN 加速：
  HTTPS → SSH → codeload tarball → jsDelivr CDN → GitHub API。使用
  `npx skills` 命令安装，安装为 Global，指定 Reasonix / Claude Code /
  OpenCode / Codex 四个 Agent。当用户提到"检查技能"、"同步技能"、
  "安装技能"、"技能管理"、"skill update"、"skill sync"、"批量安装"、
  "缺少技能"等任何与技能安装管理相关的需求时，务必使用本技能。
license: MIT
compatibility: "Requires Node.js >= 18, git, and npx skills CLI"
metadata:
  author: user
  version: "3.0"
---

# skill-install-manager

> 技能安装管理器 — 自动读取技能列表文件，与当前全局已安装技能进行对比，找出未安装或存在更新的技能，并执行一键安装/更新。**v3.0：所有流程、判断、渠道切换均由脚本自动完成，agent 只运行脚本并读取 JSON 报告。**

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

## 执行模式（v3.0：单一脚本驱动）

**agent 不再逐条执行安装命令。** 全部流程由 `scripts/sync-skills.js` 一次跑完，
agent 只做四件事：

1. **运行主编排脚本**（默认全自动同步，或按需加参数）
2. **读取 JSON 报告**（脚本写入 `~/.agents/skill-sync-report.json`）
3. **向用户汇报**结果（脚本输出的控制台摘要可直接转述）
4. **处理脚本标注的异常**（见「异常处理」节，通常只需转告用户）

| 脚本 | 职责 | 何时用 |
|------|------|--------|
| `scripts/sync-skills.js` | **主编排**：自更新→读列表→对比→依赖→安装→报告，全自动 | 默认入口，覆盖 99% 场景 |
| `scripts/install-skill.js` | 单技能安装（五通道回退） | 只装/只更一个技能时 |
| `scripts/compare-skills.js` | 只对比不安装（兼容旧入口，转发到 sync --compare） | 只想看差异时 |
| `scripts/utils.js` | 共享工具模块 | 被以上脚本引用，不直接调用 |

---

## 快速开始

### 🟢 一键同步（默认，最常用）

```powershell
node "<skill-path>\scripts\sync-skills.js"
```

全自动完成：自更新 → 读取最新列表 → 对比安装状态 → 版本检查（并发+缓存）→
依赖预检 → 安装/更新（五通道回退）→ 生成报告。

**Agent 操作步骤：**

1. 确认技能包路径（`pwd` 后定位 `skill-install-manager/scripts/`，路径大小写敏感）
2. 运行上面的命令（超时 10 分钟；脚本内部有逐级超时与降级，不会无限卡住）
3. 读取 `~/.agents/skill-sync-report.json`，向用户汇报摘要
4. 若报告中有 ❌ 失败项或 ⚠️ 依赖警告，如实转告用户并给出建议

### 🔵 只对比不安装

```powershell
node "<skill-path>\scripts\sync-skills.js" --compare --list "<list-file>"
```

### 🟣 安装单个技能

```powershell
node "<skill-path>\scripts\install-skill.js" --name <skill-name> --url <origin-url>
```

---

## 主编排脚本参数（sync-skills.js）

| 参数 | 说明 | 默认 |
|------|------|------|
| `--list <path>` | 技能列表文件路径 | 自动查找（见下） |
| `--no-self-update` | 跳过自更新 | 开启自更新 |
| `--cdn-first` | CDN 优先（codeload/jsDelivr 在 npx add 之前） | 官方优先 |
| `--dry-run` | 演练模式：只打印将执行的命令，不真正安装 | 关闭 |
| `--concurrency <n>` | 仓库级安装并发数 | 3 |
| `--agents <a,b,c>` | 安装到的 Agent 列表 | `reasonix,claude-code,opencode,codex` |
| `--lock <path>` | 锁文件路径 | `~/.agents/.skill-lock.json` |
| `--report <path>` | 报告输出路径 | `~/.agents/skill-sync-report.json` |
| `--cache-ttl <min>` | 远端 commit 缓存 TTL | 360 分钟（6 小时） |
| `--compare` | 只对比不安装（输出 JSON） | 关闭 |
| `--only <name1,name2>` | 只处理指定技能 | 全部 |
| `--skip-deps` | 跳过依赖预检 | 执行依赖预检 |

### 列表文件查找顺序（未指定 `--list` 时）

1. `./skill-list.md`（当前工作目录）
2. `./skills/skill-list.md`
3. `./sandbox/dev/skill-list.md`
4. `<skill-path>\references\Reasonix-skill-list-v2.md`（技能内置列表，默认兜底）

---

## 脚本内部流程（agent 无需手动执行，仅作理解）

```
⓪ 自更新 skill-install-manager 自身（update → add → codeload zip 三级）
      │
      ▼
① 定位并读取技能列表文件
      │
      ▼
② 新旧列表对比（自更新后标记 🆕新增 / 🗑️移除 / ➡️延续）
      │
      ▼
③ 解析列表（utils.parseSkillList，兼容注释行/重复 origin/_shared 条目）
      │
      ▼
④ 获取全局安装状态（npx skills ls -g --json → 锁文件兜底）
      │
      ▼
⑤ 版本对比（每仓库只查一次：缓存 → git ls-remote 15s → GitHub API 兜底，
   并发 4；40 位 hash 差异用 isRealCommit 校验，避免误报 outdated）
      │
      ▼
⑤.5 依赖预检（内置依赖表 + dependencies.local.json 覆盖）
      │
      ▼
⑥ 执行安装/更新（pendingDeps → 🆕 → missing → outdated；
   同仓库技能共享一次下载，仓库级并发 3，五通道回退）
      │
      ▼
⑦ 生成 JSON 报告（~/.agents/skill-sync-report.json）+ 控制台摘要
```

### 安装通道链（脚本自动逐级降级，无需 agent 干预）

| 优先级 | 通道 | 说明 |
|--------|------|------|
| 0 | `npx skills update` | 已安装技能优先增量更新 |
| 1 | `npx skills add` HTTPS | 官方通道，整仓 shallow clone（--depth=1） |
| 2 | `npx skills add` SSH | HTTPS 失败降级 |
| 3 | **codeload tarball zip** | 一次 HTTP 下载整仓 zip → 解压 → `npx skills add <本地目录>`（无需 git 协议，通常比 clone 快） |
| 4 | **jsDelivr CDN 逐文件** | `data.jsdelivr.com` 文件树 + `cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/` 并发下载，只取所需技能目录（单文件上限 20MB，技能文件均远小于此） |
| 5 | GitHub API 逐文件 | 最后兜底（未认证限流 60 次/h，慎用） |

- `--cdn-first` 时顺序变为：3 → 4 → 1 → 2 → 5
- 安装成功后脚本**回写锁文件**（`sourceUrl` 统一为 GitHub URL、`skillFolderHash` 为最新 commit SHA），保证下次对比一致、后续 `npx skills update` 可正常定位源
- 网络极差时脚本自动多级降级；全部通道失败才标记 ❌，不阻塞其他技能

### 版本对比与缓存

- 每个来源仓库**只查一次** commit SHA，同仓库多技能共享结果
- `~/.agents/.skill-remote-cache.json` 缓存 commit SHA，默认 TTL 6 小时（`--cache-ttl` 可调），重复运行几乎秒出
- 对比基准：`git ls-remote HEAD` → 失败 `api.github.com/repos/{owner}/{repo}/commits` 兜底
- **jsDelivr 不提供 commit SHA，只用于下载，不参与版本对比**

### 依赖预检

脚本内置依赖表（default→brainstorming 等，原 SKILL.md 5.5.1 表已迁入脚本）+ 可选覆盖文件：

```
<script-path>\scripts\dependencies.local.json
```

格式：`{ "skill-name": ["dep1", "dep2"] }` 或 `{ "skill-name": "dep1,dep2" }`。
预检逻辑：未安装的前置依赖自动加入安装队列并**优先安装**；依赖不在列表文件中时
只在报告里提示 ⚠️（不阻塞）。

---

## 异常处理（agent 的兜底职责）

| 报告状态 | Agent 处理 |
|---------|-----------|
| ❌ 技能安装失败（五通道均失败） | 转告用户具体原因（网络？仓库不存在？技能名不匹配？），建议手动 `npx skills add <url> --skill <name>` 或检查网络/代理 |
| ⚠️ 依赖不在列表中 | 转告用户，询问是否将依赖安装命令补充进列表文件后重跑 |
| 🔶 状态未知（锁文件缺 hash / 网络不可达） | 多数可通过再跑一次 `npx skills update <name> -g -y` 刷新锁记录解决；报告中有 refreshHint |
| 脚本本身报错 | 先看 stderr 的 `[ERROR]`/`[FATAL]` 行；Node 版本需 ≥18；确认 git、npx skills 可用 |
| 需要代理的环境 | 设置环境变量后重跑：`GITHUB_TOKEN`（GitHub API 认证，限流 5000/h）、`SKILLS_CLONE_TIMEOUT_MS`（clone 超时）、HTTP(S)_PROXY（如需代理） |

**三次失败协议**：同一技能连续 3 次安装失败 → 停止自动重试，向用户说明尝试过
的通道与具体错误，请求指导（如检查网络代理、仓库是否私有）。

---

## 注意事项

1. **Agent 名白名单（大小写敏感）**：必须用小写连字符 `reasonix` / `claude-code` /
   `opencode` / `codex`。**不安装** `github-copilot` 与 `kimi-code-cli`。脚本默认
   已按白名单配置，`--agents` 可覆盖。
2. **路径大小写**：`MarecGents` 等路径大小写敏感，务必用 `pwd` 确认准确路径。
3. **jsDelivr 限制**：单文件上限 20MB（技能文件通常 <1MB，安全）；官方无打包端点，
   只能逐文件，故 jsDelivr 通道定位为兜底而非主通道。
4. **GitHub API 限流**：未认证 60 次/h（按 IP）。脚本只在 git ls-remote 失败时才
   调用 API，且默认有缓存，通常不会触限；如遇 403/429 请设置 `GITHUB_TOKEN`。
5. **codeload 二级限流**：频繁下载可能触发 429 + Retry-After，脚本已有重试与退避；
   大批量安装建议错峰或使用 `--cache-ttl` 减少重复请求。
6. **锁文件**：`~/.agents/.skill-lock.json`（v3）。脚本安装后回写
   `sourceUrl`/`skillFolderHash`，保证与 git commit SHA 对比一致。
7. **超时设计**：脚本内所有命令带超时（git ls-remote 15s、npx update 30s、
   npx add 60s、下载 60-120s），逐级降级，不会无限卡住；整体建议 agent 侧给
   10 分钟运行窗口。
8. **报告**：`~/.agents/skill-sync-report.json` 为机器可读完整报告（含每个技能的
   状态、通道、原因），控制台摘要为人读概览；agent 汇报以报告为准。

---

## 使用示例

**示例 1：完整同步**

> 用户：帮我同步一下技能

```powershell
node "<skill-path>\scripts\sync-skills.js"
```

脚本自动：自更新 → 读最新列表 → 对比 → 依赖预检 → 安装/更新 → 报告。
Agent 读 `~/.agents/skill-sync-report.json` 汇报：`总计 N | 缺失 X | 可更新 Y | 已最新 Z | 失败 F`。

**示例 2：只想看差异**

```powershell
node "<skill-path>\scripts\sync-skills.js" --compare
```

**示例 3：网络环境差（CDN 优先 + 演练）**

```powershell
node "<skill-path>\scripts\sync-skills.js" --cdn-first --dry-run   # 先看将执行什么
node "<skill-path>\scripts\sync-skills.js" --cdn-first             # 正式执行
```

**示例 4：安装特定技能**

```powershell
node "<skill-path>\scripts\install-skill.js" --name xx-skill --url <origin-url>
```

**示例 5：完全离线/受限网络（npx 不可用）**

1. 运行 `sync-skills.js --compare` 确定缺失技能
2. 逐技能手动安装：`install-skill.js` 的 jsDelivr/GitHub API 通道会直接写文件
   `~/.agents/skills/<name>` 并回写锁
3. 若 `npx skills` 完全不可用，脚本会提示文件已就位、需手动注册
   （`npx skills experimental_sync -y` 或告知用户）
