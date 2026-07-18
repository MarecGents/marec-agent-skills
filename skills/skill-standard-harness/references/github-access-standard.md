# GitHub 仓库访问规范

当任务涉及从 GitHub 获取仓库代码时（如复现项目、下载源码、引用示例等），请严格按照以下优先级依次尝试，直到成功获取代码。此规范确保在各种网络环境下都能有效地获取目标仓库内容。

---

## 优先级一：git clone HTTP(S)

```bash
git clone https://github.com/{owner}/{repo}.git
```

使用 HTTPS 协议进行 clone，兼容性最好，无需额外配置 SSH 密钥。**优先使用此方式。**

## 优先级二：git clone SSH

```bash
git clone git@github.com:{owner}/{repo}.git
```

如果 HTTPS clone 失败（如网络限流、超时、被阻断），尝试 SSH 协议进行 clone。需要本地已配置 SSH 密钥并关联到 GitHub 账户。

## 优先级三：下载 ZIP 包并解压

如果 git clone（HTTP 和 SSH）均失败，尝试直接下载仓库 ZIP 压缩包：

```bash
# 方式 A：通过 GitHub 的 archive 链接（推荐，速度最快）
curl -L -o repo.zip https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip

# 方式 B：通过 GitHub API 获取默认分支的 ZIP
curl -L -o repo.zip https://api.github.com/repos/{owner}/{repo}/zipball
```

下载完成后使用 `unzip` 或系统解压工具解压得到源码目录。

## 优先级四：GitHub API 下载

如果以上所有 clone/下载方式均不可行，使用 GitHub REST API 逐个获取文件内容：

- `GET /repos/{owner}/{repo}/contents/{path}` — 获取单个文件内容或目录列表
- `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1` — 获取完整的目录树结构

此方式适用于极端网络限制环境，但效率较低，仅作最后手段。

## 约束说明

- **每方式最多重试 2 次** — 同一方法连续失败 2 次后方可切换到下一优先级
- **记录失败原因** — 每次尝试失败需将错误信息记录到 `progress.md` 或 `findings.md`
- **切换方式前需记录原因** — 在追踪文件中注明为何降级到下一方式
- **所有方式均失败后求助用户** — 如果四种方法全部失败，停止尝试并向用户报告具体情况，请求网络环境协助
