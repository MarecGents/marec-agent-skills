/**
 * install-skill.js
 *
 * 技能安装脚本 — 执行单个技能的安装命令，带三级回退链
 *
 * 用法:
 *   node install-skill.js --name <skill-name> --url <origin-url> [--agents "agent1,agent2,agent3"]
 *
 * 三级回退链:
 *   1. HTTPS URL → 直接安装
 *   2. SSH URL → 转换为 SSH 格式重试
 *   3. MCP/GitHub API → 直接下载文件到全局 skills 目录
 *
 * 输出 JSON:
 * {
 *   "name": "...",
 *   "status": "installed" | "updated" | "failed",
 *   "method": "https" | "ssh" | "manual",
 *   "details": "..."
 * }
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { httpsToSsh, extractGitHubInfo, runCommand } = require('./utils');

// ============================================================
// 命令行参数解析
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    agents: ['Reasonix', 'Claude Code', 'OpenCode']
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && i + 1 < args.length) {
      opts.name = args[++i];
    } else if (args[i] === '--url' && i + 1 < args.length) {
      opts.url = args[++i];
    } else if (args[i] === '--agents' && i + 1 < args.length) {
      opts.agents = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--lock' && i + 1 < args.length) {
      opts.lockFile = args[++i];
    }
  }
  return opts;
}

// ============================================================
// 构建 npx skills add 命令
// ============================================================
function buildInstallCmd(url, skillName, agents) {
  const agentFlags = agents.map(a => `-a "${a}"`).join(' ');
  return `npx skills add "${url}" --skill "${skillName}" -g ${agentFlags} -y`;
}

// ============================================================
// 尝试方法一：HTTPS URL 安装
// ============================================================
function installViaHttps(url, skillName, agents) {
  const cmd = buildInstallCmd(url, skillName, agents);
  console.error(`[HTTPS] 执行: ${cmd}`);
  const result = runCommand(cmd);
  if (result.success) {
    console.error(`[HTTPS] ✓ ${skillName} 安装成功`);
    return { status: 'installed', method: 'https', details: result.output };
  }
  console.error(`[HTTPS] ✗ 失败: ${result.error}`);
  return null;
}

// ============================================================
// 尝试方法二：SSH URL 安装
// ============================================================
function installViaSsh(url, skillName, agents) {
  const sshUrl = httpsToSsh(url);
  if (!sshUrl) {
    console.error(`[SSH] 无法将 URL 转换为 SSH 格式: ${url}`);
    return null;
  }
  const cmd = buildInstallCmd(sshUrl, skillName, agents);
  console.error(`[SSH] 执行: ${cmd}`);
  const result = runCommand(cmd);
  if (result.success) {
    console.error(`[SSH] ✓ ${skillName} 安装成功`);
    return { status: 'installed', method: 'ssh', details: result.output };
  }
  console.error(`[SSH] ✗ 失败: ${result.error}`);
  return null;
}

// ============================================================
// 尝试方法三：GitHub API 直接下载
// ============================================================
async function installViaGitHubApi(url, skillName, agents, lockFile) {
  const ghInfo = extractGitHubInfo(url);
  if (!ghInfo) {
    return { status: 'failed', method: 'manual', details: `无法解析 GitHub 信息: ${url}` };
  }

  const { owner, repo } = ghInfo;
  const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents';
  const globalSkillsDir = path.join(userProfile, '.agents', 'skills', skillName);

  console.error(`[MANUAL] 使用 GitHub API 直接下载 ${owner}/${repo}/${skillName} → ${globalSkillsDir}`);

  try {
    // 1. 获取仓库默认分支
    const repoInfo = await githubApiGet(`/repos/${owner}/${repo}`);
    const defaultBranch = repoInfo.default_branch || 'main';

    // 2. 获取仓库文件树，查找 skill 目录
    const tree = await githubApiGet(`/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`);

    // 查找 skill 相关的文件路径
    const skillFiles = tree.tree.filter(item => {
      const parts = item.path.split('/');
      // 匹配 .../<skill-name>/ 或 .../<skill-name>/SKILL.md
      return parts.includes(skillName) || item.path.includes(skillName);
    });

    if (skillFiles.length === 0) {
      return { status: 'failed', method: 'manual', details: `在仓库中未找到与 "${skillName}" 相关的文件` };
    }

    // 确定 skill 的基础路径（所有文件公共前缀中最后一个含 skillName 的部分）
    const skillPaths = skillFiles.map(f => f.path);
    const basePaths = skillPaths.map(p => {
      const idx = p.indexOf(skillName);
      return idx >= 0 ? p.substring(0, idx + skillName.length) : p;
    });
    const basePath = basePaths[0]; // 第一个匹配的路径作为 base

    // 收集需要下载的文件（在 basePath 下或 basePath 的子目录中）
    const filesToDownload = skillFiles.filter(f =>
      f.type === 'blob' && f.path.startsWith(basePath)
    );

    if (filesToDownload.length === 0) {
      return { status: 'failed', method: 'manual', details: `在路径 "${basePath}" 下未找到可下载的文件` };
    }

    // 3. 创建本地目录结构
    if (!fs.existsSync(globalSkillsDir)) {
      fs.mkdirSync(globalSkillsDir, { recursive: true });
    }

    // 4. 逐个下载文件
    for (const file of filesToDownload) {
      const relativePath = file.path.substring(basePath.length).replace(/^\//, '');
      const localPath = path.join(globalSkillsDir, relativePath);
      const localDir = path.dirname(localPath);

      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      const content = await githubApiGetRaw(owner, repo, defaultBranch, file.path);
      fs.writeFileSync(localPath, content, 'utf-8');
      console.error(`[MANUAL]   ✓ ${file.path} → ${localPath}`);
    }

    // 5. 更新锁文件
    if (lockFile) {
      try {
        const lockContent = fs.readFileSync(lockFile, 'utf-8');
        const lockData = JSON.parse(lockContent);

        if (!lockData.skills) lockData.skills = {};
        if (!lockData.skills[skillName]) {
          lockData.skills[skillName] = {};
        }

        const latestSha = tree.sha;
        // 找到 SKILL.md 的 blob SHA
        const skillMdEntry = filesToDownload.find(f => f.path.endsWith('SKILL.md'));
        lockData.skills[skillName] = {
          source: `${owner}/${repo}`,
          sourceType: 'github',
          sourceUrl: `https://github.com/${owner}/${repo}.git`,
          skillPath: basePath,
          skillFolderHash: latestSha,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2), 'utf-8');
        console.error(`[MANUAL]   ✓ 锁文件已更新`);
      } catch (lockErr) {
        console.error(`[MANUAL]   ⚠ 锁文件更新失败: ${lockErr.message}`);
      }
    }

    return { status: 'installed', method: 'manual', details: `从 GitHub API 下载了 ${filesToDownload.length} 个文件到 ${globalSkillsDir}` };

  } catch (err) {
    return { status: 'failed', method: 'manual', details: `手动安装失败: ${err.message}` };
  }
}

// ============================================================
// GitHub API 工具函数
// ============================================================
function githubApiGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'User-Agent': 'skill-install-manager/1.0',
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON 解析失败: ${e.message}`));
          }
        } else {
          reject(new Error(`GitHub API 返回 ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

function githubApiGetRaw(owner, repo, branch, filePath) {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    const options = {
      hostname: 'raw.githubusercontent.com',
      path: `/${owner}/${repo}/${branch}/${filePath}`,
      method: 'GET',
      headers: { 'User-Agent': 'skill-install-manager/1.0' },
      timeout: 20000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`raw.githubusercontent.com 返回 ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  const opts = parseArgs();

  if (!opts.name || !opts.url) {
    console.error('[ERROR] 请指定 --name <skill-name> 和 --url <origin-url>');
    process.exit(1);
  }

  console.error(`[INFO] 开始安装技能: ${opts.name}`);
  console.error(`[INFO] 来源 URL: ${opts.url}`);
  console.error(`[INFO] Agents: ${opts.agents.join(', ')}`);

  let result = null;

  // 方法一：HTTPS
  console.error(`\n━━━ 方法 1/3: HTTPS ━━━`);
  result = installViaHttps(opts.url, opts.name, opts.agents);

  // 方法二：SSH
  if (!result) {
    console.error(`\n━━━ 方法 2/3: SSH ━━━`);
    result = installViaSsh(opts.url, opts.name, opts.agents);
  }

  // 方法三：GitHub API 手动下载
  if (!result) {
    console.error(`\n━━━ 方法 3/3: GitHub API 直接下载 ━━━`);
    result = await installViaGitHubApi(opts.url, opts.name, opts.agents, opts.lockFile);
  }

  // 最终结果
  if (!result) {
    result = {
      status: 'failed',
      method: 'none',
      details: '所有安装方式均失败'
    };
  }

  const statusIcon = result.status === 'installed' ? '✓' : '✗';
  console.error(`\n[RESULT] ${statusIcon} ${opts.name}: ${result.status} (${result.method})`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  console.log(JSON.stringify({ status: 'failed', method: 'none', details: err.message }, null, 2));
  process.exit(1);
});
