/**
 * utils.js
 *
 * skill-install-manager 共享工具函数模块
 *
 * 提供两个脚本共用的函数：
 * - extractGitHubInfo() — 从 URL 提取 GitHub owner/repo
 * - httpsToSsh() — 将 HTTPS URL 转换为 SSH 格式
 * - runCommand() — 执行 shell 命令
 * - gitLsRemoteWithRetry() — 带重试的远程 commit 查询
 */

const { execSync } = require('child_process');

// ============================================================
// 从 URL 提取 GitHub owner/repo
// ============================================================
function extractGitHubInfo(url) {
  if (!url) return null;

  // 处理 HTTPS URL: https://github.com/owner/repo
  let match = url.match(/https?:\/\/github\.com\/([^\/]+)\/([^\/\s#?]+)/);
  if (match) return { owner: match[1], repo: match[2].replace(/\.git$/, '') };

  // 处理 SSH URL: git@github.com:owner/repo.git
  match = url.match(/git@github\.com:([^\/]+)\/([^\/\s#]+?)(?:\.git)?$/);
  if (match) return { owner: match[1], repo: match[2].replace(/\.git$/, '') };

  // 处理 short format: owner/repo
  match = url.match(/^([^\/]+)\/([^\/\s#?]+)$/);
  if (match) return { owner: match[1], repo: match[2] };

  return null;
}

// ============================================================
// 将 HTTPS URL 转换为 SSH 格式
// ============================================================
function httpsToSsh(url) {
  const info = extractGitHubInfo(url);
  if (!info) return null;
  return `git@github.com:${info.owner}/${info.repo}.git`;
}

// ============================================================
// 执行 shell 命令，返回结构化结果
// ============================================================
function runCommand(cmd, timeout = 120000) {
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || '') + '\n' + (err.stderr || ''),
      error: err.message
    };
  }
}

// ============================================================
// 带重试机制的 git ls-remote 查询
// ============================================================
function gitLsRemoteWithRetry(owner, repo, retries = 0) {
  const cmd = `git ls-remote https://github.com/${owner}/${repo}.git HEAD`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 12000,
        maxBuffer: 1024 * 128
      });
      const sha = output.trim().split(/\s+/)[0];
      if (sha) return sha;
    } catch (err) {
      // 重试之间由 execSync 的 timeout 自动产生间隔
    }
  }

  return null; // 所有重试均失败
}

module.exports = {
  extractGitHubInfo,
  httpsToSsh,
  runCommand,
  gitLsRemoteWithRetry
};
