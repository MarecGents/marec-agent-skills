/**
 * utils.js
 *
 * skill-install-manager 共享工具函数模块（v3.0 重构版）
 *
 * 提供 sync-skills.js / install-skill.js / compare-skills.js 共用的函数：
 * - extractGitHubInfo() / httpsToSsh()   — URL 解析与转换
 * - runCommand() / runCommandAsync()     — shell 命令执行（同步/异步，带超时）
 * - httpGetJson() / httpGetText() / downloadFile() — HTTP 请求（Node 18+ 全局 fetch）
 * - githubApiGet() / getLatestCommitSha() / getDefaultBranch() / isRealCommit() — GitHub API
 * - parseSkillList()                     — 技能列表文件解析（从 compare-skills.js 迁入）
 * - getInstalledSkills() / getLockData() — 全局安装状态（npx skills ls + 锁文件兜底）
 * - concurrentMap()                      — 并发池（限流）
 * - readJsonFile() / writeJsonFileAtomic() — JSON 安全读写
 * - RemoteCache (getRemoteCache / saveRemoteCache) — commit SHA 缓存（TTL 控制）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFile } = require('child_process');

// ============================================================
// 常量
// ============================================================
const DEFAULT_AGENTS = ['reasonix', 'claude-code', 'opencode', 'codex'];
const DEFAULT_LOCK_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents',
  '.agents', '.skill-lock.json'
);
const DEFAULT_REMOTE_CACHE_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents',
  '.agents', '.skill-remote-cache.json'
);
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

// ============================================================
// URL 解析与转换
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

function httpsToSsh(url) {
  const info = extractGitHubInfo(url);
  if (!info) return null;
  return `git@github.com:${info.owner}/${info.repo}.git`;
}

// ============================================================
// Shell 命令执行
// ============================================================
/**
 * 同步执行 shell 命令，返回结构化结果
 * @param {string} cmd 命令
 * @param {number} timeoutMs 超时毫秒
 * @param {object} [env] 额外环境变量
 */
function runCommand(cmd, timeoutMs = 30000, env) {
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(env ? { env: { ...process.env, ...env } } : {})
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return {
      success: false,
      output: ((err.stdout || '') + '\n' + (err.stderr || '')).trim(),
      error: err.message
    };
  }
}

/**
 * 异步执行 shell 命令（不带 shell 包装，返回 Promise）
 */
function runCommandAsync(cmd, args, timeoutMs = 30000, env) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {})
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, output: `${stdout}\n${stderr}`.trim(), error: error.message });
      } else {
        resolve({ success: true, output: `${stdout}`.trim() });
      }
    });
  });
}

/**
 * 带重试机制的 git ls-remote 查询（单仓库 HEAD commit）
 */
function gitLsRemoteWithRetry(owner, repo, retries = 1, timeoutMs = 15000) {
  const cmd = `git ls-remote https://github.com/${owner}/${repo}.git HEAD`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        timeout: timeoutMs,
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

// ============================================================
// HTTP 请求（Node 18+ 全局 fetch）
// ============================================================
async function httpGet(url, { timeoutMs = 15000, headers = {}, retries = 0, expectedStatus = 200 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'skill-install-manager/3.0',
          'Accept': 'application/vnd.github.v3+json',
          ...headers
        }
      });
      clearTimeout(timer);
      if (res.status !== expectedStatus) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

async function httpGetJson(url, opts = {}) {
  const res = await httpGet(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return res.json();
}

async function httpGetText(url, opts = {}) {
  const res = await httpGet(url, opts);
  return res.text();
}

/**
 * 流式下载文件到本地路径
 */
async function downloadFile(url, destPath, { timeoutMs = 60000, retries = 1 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'skill-install-manager/3.0' },
        redirect: 'follow'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const arrayBuffer = await res.arrayBuffer();
      clearTimeout(timer);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
      return destPath;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ============================================================
// GitHub API
// ============================================================
async function githubApiGet(owner, repo, apiPath, { timeoutMs = 15000, retries = 1 } = {}) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}${apiPath}`;
  const res = await httpGetJson(url, {
    timeoutMs,
    retries,
    headers: GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}
  });
  return res;
}

/**
 * 获取仓库默认分支（带缓存）
 * @param {string} owner
 * @param {string} repo
 * @param {object} [opts] { cache: RemoteCache }
 */
async function getDefaultBranch(owner, repo, opts = {}) {
  const cache = opts.cache || null;
  const key = `${owner}/${repo}`;
  if (cache && cache.getBranch && cache.getBranch(key)) {
    return cache.getBranch(key);
  }
  try {
    const info = await githubApiGet(owner, repo, '', { timeoutMs: 10000, retries: 0 });
    const branch = info.default_branch || 'main';
    if (cache && cache.setBranch) cache.setBranch(key, branch);
    return branch;
  } catch {
    return 'main'; // 默认假设 main
  }
}

/**
 * 获取仓库最新 commit SHA（GitHub API）
 */
async function getLatestCommitSha(owner, repo, { branch, timeoutMs = 15000, retries = 1 } = {}) {
  const br = branch || (await getDefaultBranch(owner, repo));
  const commits = await githubApiGet(owner, repo, `/commits?sha=${encodeURIComponent(br)}&per_page=1`, { timeoutMs, retries });
  if (Array.isArray(commits) && commits.length > 0 && commits[0].sha) {
    return commits[0].sha;
  }
  return null;
}

/**
 * 验证一个 40 位 hash 是否为仓库中真实存在的 commit
 * 返回: true=是 commit | false=不是 commit（404）| null=网络错误
 */
async function isRealCommit(owner, repo, sha, { timeoutMs = 10000 } = {}) {
  try {
    const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'skill-install-manager/3.0',
        'Accept': 'application/vnd.github.v3+json',
        ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {})
      }
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 技能列表文件解析（从 compare-skills.js 迁入，兼容原输出）
// ============================================================
function parseSkillList(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const origins = [];
  let currentOriginUrl = null;
  let currentSkills = [];

  // Origin URL 正则: "## Origin URL: https://..."
  const originRe = /^##\s+Origin\s+URL:\s*(.*)\s*$/i;
  // 技能条目正则: "1. skill-name: npx skills add ..."
  const skillRe = /^\d+\.\s+(\S+):\s*(npx skills\s+.*)$/i;
  // 共享条目正则: "0. _shared" 等（无命令）
  const sharedRe = /^\d+\.\s+(\S+)\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 检查 Origin URL 节
    const originMatch = line.match(originRe);
    if (originMatch) {
      if (currentOriginUrl && currentSkills.length > 0) {
        origins.push({ url: currentOriginUrl, skills: currentSkills });
      }
      currentOriginUrl = originMatch[1].trim() || null;
      currentSkills = [];
      continue;
    }

    if (!currentOriginUrl) continue;

    // 检查技能条目（带完整安装命令）
    const skillMatch = line.match(skillRe);
    if (skillMatch) {
      currentSkills.push({
        name: skillMatch[1],
        installCmd: skillMatch[2]
      });
      continue;
    }

    // 检查共享条目（如 _shared）
    const sharedMatch = line.match(sharedRe);
    if (sharedMatch) {
      currentSkills.push({
        name: sharedMatch[1],
        installCmd: null
      });
      continue;
    }
  }

  if (currentOriginUrl && currentSkills.length > 0) {
    origins.push({ url: currentOriginUrl, skills: currentSkills });
  }

  return origins;
}

// ============================================================
// 全局安装状态
// ============================================================
/**
 * 获取当前全局安装状态。
 * 优先 npx skills ls -g --json；失败/空则降级到锁文件推断。
 * @param {string} [lockFilePath]
 * @returns {{ name: string, agents: string[], path: string|null, skillFolderHash: string|null }[]}
 */
function getInstalledSkills(lockFilePath) {
  try {
    const output = execSync('npx skills ls -g --json', {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(output.trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(s => ({
        name: s.name || s.skillName,
        agents: s.agents || [],
        path: s.path || null,
        skillFolderHash: s.skillFolderHash || null
      }));
    }
    console.error('[WARN] npx skills ls 返回空，降级到锁文件推断安装状态');
    return installedFromLock(lockFilePath);
  } catch (err) {
    console.error(`[WARN] npx skills ls 失败（${err && err.message ? err.message : err}），降级到锁文件推断安装状态`);
    return installedFromLock(lockFilePath);
  }
}

function installedFromLock(lockFilePath) {
  const lockData = getLockData(lockFilePath);
  const lockSkills = lockData.skills || {};
  const result = [];
  for (const name of Object.keys(lockSkills)) {
    const entry = lockSkills[name];
    if (!entry) continue;
    result.push({
      name,
      agents: entry.agents || [],
      path: entry.skillPath || null,
      skillFolderHash: entry.skillFolderHash || null
    });
  }
  return result;
}

// ============================================================
// 锁文件读写
// ============================================================
function getLockData(lockFilePath) {
  const lockPath = lockFilePath || DEFAULT_LOCK_PATH;
  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return { skills: {} };
  }
}

function writeLockData(lockData, lockFilePath) {
  const lockPath = lockFilePath || DEFAULT_LOCK_PATH;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  writeJsonFileAtomic(lockPath, lockData);
}

/**
 * 更新锁文件中单个技能的记录（合并式）
 */
function updateLockEntry(skillName, entryPatch, lockFilePath) {
  const lockData = getLockData(lockFilePath);
  if (!lockData.skills) lockData.skills = {};
  const now = new Date().toISOString();
  const existing = lockData.skills[skillName] || {};
  lockData.skills[skillName] = {
    ...existing,
    ...entryPatch,
    installedAt: existing.installedAt || now,
    updatedAt: now
  };
  writeLockData(lockData, lockFilePath);
  return lockData.skills[skillName];
}

// ============================================================
// 远端版本缓存（commit SHA 缓存，TTL 控制）
// ============================================================
class RemoteCache {
  constructor(cachePath = DEFAULT_REMOTE_CACHE_PATH, ttlMs = 6 * 60 * 60 * 1000) {
    this.path = cachePath;
    this.ttlMs = ttlMs;
    this.data = { version: 1, repos: {} };
    this._load();
  }

  _load() {
    try {
      const content = fs.readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.repos) this.data = parsed;
    } catch {
      // 无缓存或损坏，用空缓存
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      writeJsonFileAtomic(this.path, this.data);
    } catch (err) {
      console.error(`[WARN] 无法写入缓存 ${this.path}: ${err.message}`);
    }
  }

  _key(owner, repo) {
    return `${owner}/${repo}`.toLowerCase();
  }

  /** 获取缓存的 commit SHA（未过期才返回） */
  getSha(owner, repo) {
    const entry = this.data.repos[this._key(owner, repo)];
    if (!entry || !entry.sha) return null;
    if (Date.now() - entry.fetchedAt > this.ttlMs) return null;
    return entry.sha;
  }

  setSha(owner, repo, sha) {
    this.data.repos[this._key(owner, repo)] = {
      sha,
      fetchedAt: Date.now()
    };
  }

  /** 获取缓存的默认分支 */
  getBranch(owner, repo) {
    const entry = this.data.repos[this._key(owner, repo)];
    return entry && entry.branch ? entry.branch : null;
  }

  setBranch(owner, repo, branch) {
    const key = this._key(owner, repo);
    if (!this.data.repos[key]) this.data.repos[key] = {};
    this.data.repos[key].branch = branch;
  }
}

// ============================================================
// JSON 安全读写
// ============================================================
function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ============================================================
// 并发池
// ============================================================
/**
 * 并发执行任务，返回与输入顺序一致的结果数组
 * @param {any[]} items 输入项
 * @param {number} limit 并发上限
 * @param {(item, index) => Promise<any>} worker 处理函数
 */
async function concurrentMap(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker(index) {
    results[index] = await worker(items[index], index);
  }

  const workers = [];
  while (cursor < items.length && workers.length < limit) {
    const index = cursor++;
    workers.push(runWorker(index));
  }

  async function pump() {
    while (cursor < items.length) {
      const index = cursor++;
      await runWorker(index);
    }
  }

  await Promise.all(workers.map(async (w) => { await w; await pump(); }));
  return results;
}

// ============================================================
// 工具
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function unique(arr) {
  return [...new Set(arr)];
}

module.exports = {
  DEFAULT_AGENTS,
  DEFAULT_LOCK_PATH,
  DEFAULT_REMOTE_CACHE_PATH,
  GITHUB_TOKEN,
  extractGitHubInfo,
  httpsToSsh,
  runCommand,
  runCommandAsync,
  gitLsRemoteWithRetry,
  httpGet,
  httpGetJson,
  httpGetText,
  downloadFile,
  githubApiGet,
  getDefaultBranch,
  getLatestCommitSha,
  isRealCommit,
  parseSkillList,
  getInstalledSkills,
  installedFromLock,
  getLockData,
  writeLockData,
  updateLockEntry,
  RemoteCache,
  readJsonFile,
  writeJsonFileAtomic,
  concurrentMap,
  sleep,
  nowIso,
  unique
};
