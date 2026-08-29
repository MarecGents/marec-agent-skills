/**
 * install-skill.js
 *
 * 技能安装模块（v3.0 重构版）— 五通道回退链 + 仓库级批量安装
 *
 * 通道链（默认官方优先；--cdn-first 时 CDN 优先）:
 *   0. 已安装 → npx skills update <name> -g -y（只更新，不重装）
 *   1. HTTPS → npx skills add <https-url> --skill <names...> -g -a ...
 *   2. SSH   → npx skills add <ssh-url> --skill <names...> -g -a ...
 *   3. codeload tarball URL 直装 → npx skills add <codeload-url> --skill <names...>（download 类型，无需 git）
 *   4. codeload zip 手动下载解压 → npx skills add <本地目录> --skill <names...>（一次下载共享给同仓库多技能）
 *   5. jsDelivr 逐文件下载 → 写 ~/.agents/skills/<name> + 更新锁 + experimental_sync（CDN）
 *   6. GitHub API 逐文件下载 → 写 ~/.agents/skills/<name> + 更新锁（最后兜底，限流敏感）
 *
 * 安装成功后统一回写锁：sourceUrl=GitHub URL, sourceType=github, skillFolderHash=最新 commit SHA
 * （保证下次对比一致性，避免 npx 写入的内容 hash / 本地路径破坏对比与后续 update）
 *
 * 用法（CLI）:
 *   node install-skill.js --name <skill-name> --url <origin-url> [--agents "a,b,c"] [--cdn-first] [--dry-run] [--lock <path>]
 *
 * 模块导出:
 *   installOriginSkills(origin, skills, opts) — 仓库级安装（sync-skills.js 使用）
 *   installSingleSkill(name, url, opts)       — 单技能安装（CLI / 兼容旧调用）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
  DEFAULT_AGENTS,
  extractGitHubInfo,
  httpsToSsh,
  runCommand,
  downloadFile,
  githubApiGet,
  getDefaultBranch,
  getLatestCommitSha,
  isRealCommit,
  getLockData,
  writeLockData,
  updateLockEntry,
  concurrentMap,
  sleep
} = require('./utils');

// ============================================================
// 参数解析（CLI）
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    agents: [...DEFAULT_AGENTS],
    cdnFirst: false,
    dryRun: false,
    lockFile: null
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name' && i + 1 < args.length) opts.name = args[++i];
    else if (a === '--url' && i + 1 < args.length) opts.url = args[++i];
    else if (a === '--agents' && i + 1 < args.length) opts.agents = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--lock' && i + 1 < args.length) opts.lockFile = args[++i];
    else if (a === '--cdn-first') opts.cdnFirst = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

// ============================================================
// 命令构建
// ============================================================
function buildNpxAddCmd(url, skillNames, agents) {
  const agentFlags = agents.map(a => `-a "${a}"`).join(' ');
  const skillFlags = skillNames.map(s => `--skill "${s}"`).join(' ');
  return `npx skills add "${url}" ${skillFlags} -g ${agentFlags} -y`;
}

function buildNpxUpdateCmd(skillName) {
  return `npx skills update "${skillName}" -g -y`;
}

// ============================================================
// 通道 0：已安装技能更新（npx skills update）
// ============================================================
async function updateViaNpx(skillName, opts, timeoutMs = 30000) {
  if (opts.dryRun) {
    console.error(`[DRY-RUN] ${buildNpxUpdateCmd(skillName)}`);
    return { status: 'updated', method: 'update', details: '[dry-run]', dryRun: true };
  }
  const cmd = buildNpxUpdateCmd(skillName);
  console.error(`[UPDATE] 执行: ${cmd}`);
  const result = runCommand(cmd, timeoutMs);
  if (result.success) {
    return { status: 'updated', method: 'update', details: result.output };
  }
  console.error(`[UPDATE] ✗ 失败: ${result.error}`);
  return null;
}

// ============================================================
// 通道 1/2：npx skills add（HTTPS / SSH / codeload URL 直装）
// ============================================================
async function addViaNpx(url, skillNames, opts, timeoutMs = 60000, extraNote = '') {
  if (opts.dryRun) {
    console.error(`[DRY-RUN] ${buildNpxAddCmd(url, skillNames, opts.agents)}`);
    return { status: 'installed', method: 'npx', details: '[dry-run]', dryRun: true };
  }
  const cmd = buildNpxAddCmd(url, skillNames, opts.agents);
  console.error(`[NPX]${extraNote ? ` ${extraNote}` : ''} 执行: ${cmd}`);
  const result = runCommand(cmd, timeoutMs);
  if (result.success) {
    return { status: 'installed', method: 'npx', details: result.output };
  }
  console.error(`[NPX] ✗ 失败: ${result.error}`);
  return null;
}

// ============================================================
// 通道 3：codeload zip 手动下载 → 解压 → npx skills add <本地目录>
// ============================================================
async function installViaCodeloadZip(originUrl, skillNames, opts, latestSha) {
  const ghInfo = extractGitHubInfo(originUrl);
  if (!ghInfo) return null;
  const { owner, repo } = ghInfo;

  if (opts.dryRun) {
    console.error(`[DRY-RUN] codeload zip: https://codeload.github.com/${owner}/${repo}/zip/refs/heads/{branch} → 解压 → npx skills add <local> --skill ${skillNames.join(',')}`);
    return { status: 'installed', method: 'codeload-zip', details: '[dry-run]', dryRun: true };
  }

  let tempRoot = null;
  try {
    const branch = await getDefaultBranch(owner, repo, { cache: opts.cache || null });
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-codeload-'));
    const zipPath = path.join(tempRoot, 'repo.zip');
    const extractDir = path.join(tempRoot, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });

    const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`;
    console.error(`[CODELOAD] 下载 ${zipUrl} → ${zipPath}`);
    await downloadFile(zipUrl, zipPath, { timeoutMs: 120000, retries: 1 });

    // 解压：优先系统 tar.exe（Windows 10+ / macOS / Linux 均自带，支持 zip），失败回退 PowerShell Expand-Archive
    let extracted = false;
    const tarResult = runCommand(`tar -xf "${zipPath}" -C "${extractDir}"`, 60000);
    if (tarResult.success) {
      extracted = true;
    } else {
      console.error(`[CODELOAD] tar 解压失败，回退 Expand-Archive: ${tarResult.error}`);
      const psResult = runCommand(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, 120000);
      if (psResult.success) extracted = true;
    }
    if (!extracted) {
      console.error('[CODELOAD] ✗ 解压失败');
      return null;
    }

    // 定位每个技能目录：递归找 <name>/SKILL.md，父目录即技能目录；仓库内相对路径作为 skillPath
    const results = [];
    for (const skillName of skillNames) {
      const skillDir = findSkillDir(extractDir, skillName);
      if (!skillDir) {
        console.error(`[CODELOAD] ⚠ 未在解压目录找到技能 ${skillName}`);
        results.push({ name: skillName, ok: false, reason: 'skill dir not found in tarball' });
        continue;
      }
      const relPath = path.relative(extractDir, skillDir).split(path.sep).join('/');
      const addResult = await addViaNpx(skillDir, [skillName], opts, 60000, `(codeload-zip ${relPath})`);
      if (addResult) {
        // 回写锁：sourceUrl 回 GitHub、skillFolderHash 回最新 commit SHA
        await patchLockAfterInstall(skillName, originUrl, relPath, latestSha, opts);
        results.push({ name: skillName, ok: true, relPath });
      } else {
        results.push({ name: skillName, ok: false, reason: 'npx add failed' });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    if (okCount === 0) return null;
    return {
      status: 'installed',
      method: 'codeload-zip',
      details: `codeload zip 安装 ${okCount}/${results.length} 个技能`,
      results
    };
  } catch (err) {
    console.error(`[CODELOAD] ✗ 失败: ${err.message}`);
    return null;
  } finally {
    if (tempRoot && !opts.keepTemp) {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

/**
 * 在解压目录中递归查找 <skillName>/SKILL.md，返回技能目录绝对路径
 */
function findSkillDir(rootDir, skillName) {
  const queue = [rootDir];
  let visited = 0;
  while (queue.length > 0 && visited < 5000) {
    const dir = queue.shift();
    visited++;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === skillName) {
          // 确认该目录下（或递归子目录）有 SKILL.md
          const skillMd = findFileRecursive(path.join(dir, entry.name), 'SKILL.md', 3);
          if (skillMd) return path.join(dir, entry.name);
        }
        queue.push(path.join(dir, entry.name));
      }
    }
  }
  return null;
}

function findFileRecursive(dir, fileName, depth) {
  if (depth < 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) return full;
      if (entry.isDirectory()) {
        const found = findFileRecursive(full, fileName, depth - 1);
        if (found) return found;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ============================================================
// 通道 4：jsDelivr 逐文件下载（CDN）
// ============================================================
async function installViaJsdelivr(originUrl, skillNames, opts, latestSha) {
  const ghInfo = extractGitHubInfo(originUrl);
  if (!ghInfo) return null;
  const { owner, repo } = ghInfo;

  if (opts.dryRun) {
    console.error(`[DRY-RUN] jsdelivr 逐文件: data.jsdelivr.com 文件树 → cdn.jsdelivr.net/gh/${owner}/${repo}@{branch}/... → ~/.agents/skills/`);
    return { status: 'installed', method: 'jsdelivr', details: '[dry-run]', dryRun: true };
  }

  try {
    const branch = await getDefaultBranch(owner, repo, { cache: opts.cache || null });
    const treeUrl = `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${encodeURIComponent(branch)}`;
    console.error(`[JSDELIVR] 获取文件树 ${treeUrl}`);
    const tree = await fetchJsonWithRetry(treeUrl, { timeoutMs: 20000, retries: 2 });
    if (!tree || !Array.isArray(tree.files)) {
      console.error('[JSDELIVR] ✗ 文件树获取失败');
      return null;
    }

    const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents';
    const globalSkillsDir = path.join(userProfile, '.agents', 'skills');

    const results = [];
    for (const skillName of skillNames) {
      try {
        // 在文件树中定位技能目录（路径段匹配 <name>）
        const skillFiles = collectSkillFiles(tree.files, skillName);
        if (!skillFiles || skillFiles.length === 0) {
          console.error(`[JSDELIVR] ⚠ 未在文件树中找到技能 ${skillName}`);
          results.push({ name: skillName, ok: false, reason: 'not found in jsdelivr tree' });
          continue;
        }

        const destDir = path.join(globalSkillsDir, skillName);
        fs.mkdirSync(destDir, { recursive: true });

        // 并发下载文件（限流 10）
        const dlLimit = Math.min(10, Math.max(4, opts.concurrency || 8));
        let okCount = 0;
        await concurrentMap(skillFiles, dlLimit, async (file) => {
          const rel = file.path;
          const fileUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${encodeURIComponent(branch)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
          const destPath = path.join(destDir, rel);
          try {
            await downloadFile(fileUrl, destPath, { timeoutMs: 60000, retries: 1 });
            okCount++;
          } catch (err) {
            console.error(`[JSDELIVR]   ✗ ${rel}: ${err.message}`);
          }
        });

        if (okCount < skillFiles.length) {
          console.error(`[JSDELIVR] ⚠ ${skillName} 只下载了 ${okCount}/${skillFiles.length} 个文件`);
        }

        // 更新锁 + 注册
        const basePath = skillFiles[0].path.split('/').slice(0, -1).join('/'); // 目录路径（最后一个文件）
        const baseDir = deriveSkillBasePath(skillFiles, skillName);
        await patchLockAfterInstall(skillName, originUrl, baseDir, latestSha, opts);

        // 通过 experimental_sync 注册到 agent 目录
        const syncResult = runCommand('npx skills experimental_sync -y', 60000);
        if (syncResult.success) {
          console.error(`[JSDELIVR] ✓ ${skillName} 下载完成并已注册（${okCount} 文件）`);
        } else {
          console.error(`[JSDELIVR] ✓ ${skillName} 下载完成，但 experimental_sync 失败（${syncResult.error}），需手动注册`);
        }
        results.push({ name: skillName, ok: true, files: okCount });
      } catch (err) {
        console.error(`[JSDELIVR] ✗ ${skillName}: ${err.message}`);
        results.push({ name: skillName, ok: false, reason: err.message });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    if (okCount === 0) return null;
    return {
      status: 'installed',
      method: 'jsdelivr',
      details: `jsdelivr 逐文件安装 ${okCount}/${results.length} 个技能`,
      results
    };
  } catch (err) {
    console.error(`[JSDELIVR] ✗ 失败: ${err.message}`);
    return null;
  }
}

/**
 * 在 jsdelivr 文件树（files 数组）中收集技能目录下的所有文件
 * 返回 [{ path, size }]，path 为仓库内相对路径
 */
function collectSkillFiles(files, skillName) {
  // 文件树结构：目录节点有 .files 子数组，叶子文件节点有 .name/.type/.size/.hash
  // 先找匹配的目录节点（路径段含 skillName）
  const result = [];
  walkJsdelivrTree(files, '', skillName, result);
  return result;
}

function walkJsdelivrTree(nodes, prefix, skillName, out) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node.name !== 'string') continue;
    const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'directory') {
      // 若当前路径段已含 skillName 且尚未进入更深匹配，标记基础目录
      const segs = nodePath.split('/');
      if (segs.includes(skillName)) {
        // 进入技能目录：收集所有叶子文件
        collectLeaves(node, nodePath, out);
        continue;
      }
      walkJsdelivrTree(node.files, nodePath, skillName, out);
    } else if (node.type === 'file') {
      // 技能目录可能直接以文件形式出现（极少见），忽略
      const segs = nodePath.split('/');
      if (segs.includes(skillName)) {
        out.push({ path: nodePath, size: node.size || 0 });
      }
    }
  }
}

function collectLeaves(dirNode, dirPath, out) {
  if (!Array.isArray(dirNode.files)) return;
  for (const node of dirNode.files) {
    if (!node || typeof node.name !== 'string') continue;
    const nodePath = `${dirPath}/${node.name}`;
    if (node.type === 'directory') {
      collectLeaves(node, nodePath, out);
    } else if (node.type === 'file') {
      out.push({ path: nodePath, size: node.size || 0 });
    }
  }
}

/** 从文件路径集合推导技能的基础目录（公共前缀，最后一段为技能名） */
function deriveSkillBasePath(files, skillName) {
  if (!files || files.length === 0) return skillName;
  const first = files[0].path;
  const idx = first.indexOf(skillName);
  if (idx >= 0) {
    return first.substring(0, idx + skillName.length);
  }
  return skillName;
}

async function fetchJsonWithRetry(url, { timeoutMs, retries }) {
  const { httpGetJson } = require('./utils');
  return httpGetJson(url, { timeoutMs, retries });
}

// ============================================================
// 通道 5：GitHub API 逐文件下载（最后兜底）
// ============================================================
async function installViaGithubApi(originUrl, skillNames, opts, latestSha) {
  const ghInfo = extractGitHubInfo(originUrl);
  if (!ghInfo) return null;
  const { owner, repo } = ghInfo;

  if (opts.dryRun) {
    console.error(`[DRY-RUN] GitHub API 逐文件: api.github.com tree → raw.githubusercontent.com 下载 → ~/.agents/skills/`);
    return { status: 'installed', method: 'github-api', details: '[dry-run]', dryRun: true };
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents';
  const globalSkillsDir = path.join(userProfile, '.agents', 'skills');

  try {
    const branch = await getDefaultBranch(owner, repo, { cache: opts.cache || null });
    const tree = await githubApiGet(owner, repo, `/git/trees/${encodeURIComponent(branch)}?recursive=1`, { timeoutMs: 20000, retries: 1 });

    const results = [];
    for (const skillName of skillNames) {
      try {
        const skillFiles = (tree.tree || []).filter(item => {
          if (item.type !== 'blob') return false;
          const parts = item.path.split('/');
          return parts.includes(skillName);
        });
        if (skillFiles.length === 0) {
          results.push({ name: skillName, ok: false, reason: 'not found in tree' });
          continue;
        }
        const basePath = deriveSkillBasePath(skillFiles.map(f => ({ path: f.path })), skillName);
        const destDir = path.join(globalSkillsDir, skillName);
        fs.mkdirSync(destDir, { recursive: true });

        let okCount = 0;
        await concurrentMap(skillFiles, 4, async (file) => {
          const rel = file.path.substring(basePath.length).replace(/^\/+/, '');
          const destPath = path.join(destDir, rel);
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
          try {
            await downloadFile(rawUrl, destPath, { timeoutMs: 60000, retries: 1 });
            okCount++;
          } catch (err) {
            console.error(`[GH-API]   ✗ ${file.path}: ${err.message}`);
          }
        });

        await patchLockAfterInstall(skillName, originUrl, basePath, latestSha, opts);
        results.push({ name: skillName, ok: true, files: okCount });
      } catch (err) {
        results.push({ name: skillName, ok: false, reason: err.message });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    if (okCount === 0) return null;
    return {
      status: 'installed',
      method: 'github-api',
      details: `GitHub API 安装 ${okCount}/${results.length} 个技能`,
      results
    };
  } catch (err) {
    console.error(`[GH-API] ✗ 失败: ${err.message}`);
    return null;
  }
}

// ============================================================
// 锁回写：统一 sourceUrl=GitHub、skillFolderHash=commit SHA
// ============================================================
async function patchLockAfterInstall(skillName, originUrl, skillPath, latestSha, opts) {
  const ghInfo = extractGitHubInfo(originUrl);
  if (!ghInfo) return;
  const patch = {
    source: `${ghInfo.owner}/${ghInfo.repo}`,
    sourceType: 'github',
    sourceUrl: `https://github.com/${ghInfo.owner}/${ghInfo.repo}.git`
  };
  if (skillPath) patch.skillPath = skillPath;
  // 只回写合法的 40 位 commit SHA；否则保留原值（由 npx 写入内容 hash 时会走 unknown 分支，不误报）
  if (latestSha && /^[0-9a-f]{40}$/i.test(latestSha)) {
    patch.skillFolderHash = latestSha;
  }
  try {
    updateLockEntry(skillName, patch, opts.lockFile || null);
    console.error(`[LOCK] ✓ 已回写锁 ${skillName} (sourceUrl=${patch.sourceUrl}, hash=${patch.skillFolderHash ? patch.skillFolderHash.substring(0, 8) : '保留原值'})`);
  } catch (err) {
    console.error(`[LOCK] ⚠ 锁回写失败: ${err.message}`);
  }
}

// ============================================================
// 安装编排：仓库级安装（多技能共享下载）
// ============================================================
/**
 * 对同一 origin 下的多个技能执行安装（五通道回退，仓库级共享下载）
 * @param {object} origin { url, skills: [{name, installCmd}] }
 * @param {string[]} skillNames 待安装技能名
 * @param {object} opts { agents, cdnFirst, dryRun, lockFile, cache, latestShaByRepo }
 * @returns {object} { status, method, details, perSkill: {name, ok, method}[] }
 */
async function installOriginSkills(origin, skillNames, opts) {
  const { url } = origin;
  const ghInfo = extractGitHubInfo(url);
  const perSkill = skillNames.map(name => ({ name, ok: false, method: null }));

  if (!ghInfo) {
    // 非 GitHub 来源：只能走 npx add 原文
    const result = await addViaNpx(url, skillNames, opts);
    if (result) {
      perSkill.forEach(s => { s.ok = true; s.method = result.method; });
    }
    return {
      status: perSkill.every(s => s.ok) ? 'installed' : 'failed',
      method: 'npx',
      details: `npx add ${url}`,
      perSkill
    };
  }

  const { owner, repo } = ghInfo;
  const latestSha = opts.latestShaByRepo ? opts.latestShaByRepo[`${owner}/${repo}`.toLowerCase()] : null;

  // 通道顺序
  const cdnFirst = !!opts.cdnFirst;
  const channels = [];
  if (cdnFirst) {
    channels.push(
      { name: 'codeload-zip', fn: () => installViaCodeloadZip(url, skillNames, opts, latestSha) },
      { name: 'jsdelivr', fn: () => installViaJsdelivr(url, skillNames, opts, latestSha) },
      { name: 'https', fn: () => addViaNpx(`https://github.com/${owner}/${repo}`, skillNames, opts, 60000) },
      { name: 'ssh', fn: () => addViaNpx(httpsToSsh(url), skillNames, opts, 60000, '(ssh)') },
      { name: 'github-api', fn: () => installViaGithubApi(url, skillNames, opts, latestSha) }
    );
  } else {
    channels.push(
      { name: 'https', fn: () => addViaNpx(`https://github.com/${owner}/${repo}`, skillNames, opts, 60000) },
      { name: 'ssh', fn: () => addViaNpx(httpsToSsh(url), skillNames, opts, 60000, '(ssh)') },
      { name: 'codeload-zip', fn: () => installViaCodeloadZip(url, skillNames, opts, latestSha) },
      { name: 'jsdelivr', fn: () => installViaJsdelivr(url, skillNames, opts, latestSha) },
      { name: 'github-api', fn: () => installViaGithubApi(url, skillNames, opts, latestSha) }
    );
  }

  for (const channel of channels) {
    console.error(`\n━━━ 通道 ${channel.name}（${skillNames.join(', ')}）━━━`);
    const result = await channel.fn();
    if (result && !result.dryRun) {
      // 成功：标记 perSkill
      if (result.results) {
        for (const r of result.results) {
          const target = perSkill.find(s => s.name === r.name);
          if (target) {
            target.ok = !!r.ok;
            target.method = r.ok ? channel.name : null;
            target.reason = r.ok ? undefined : (r.reason || '');
          }
        }
      } else {
        perSkill.forEach(s => { s.ok = true; s.method = channel.name; });
      }
      const okCount = perSkill.filter(s => s.ok).length;
      return {
        status: okCount === skillNames.length ? 'installed' : 'partial',
        method: channel.name,
        details: result.details || `通道 ${channel.name} 成功`,
        perSkill
      };
    }
    if (result && result.dryRun) {
      perSkill.forEach(s => { s.ok = true; s.method = channel.name; });
      return { status: 'installed', method: channel.name, details: '[dry-run]', perSkill, dryRun: true };
    }
  }

  return {
    status: 'failed',
    method: 'none',
    details: '所有安装通道均失败',
    perSkill
  };
}

// ============================================================
// 单技能安装（CLI / 兼容旧调用）
// ============================================================
async function installSingleSkill(name, url, opts = {}) {
  const fullOpts = {
    agents: opts.agents || [...DEFAULT_AGENTS],
    cdnFirst: !!opts.cdnFirst,
    dryRun: !!opts.dryRun,
    lockFile: opts.lockFile || null,
    cache: opts.cache || null,
    latestShaByRepo: opts.latestShaByRepo || null
  };

  console.error(`[INFO] 开始安装技能: ${name}`);
  console.error(`[INFO] 来源 URL: ${url}`);
  console.error(`[INFO] Agents: ${fullOpts.agents.join(', ')}${fullOpts.cdnFirst ? '（CDN 优先）' : ''}`);

  // 已安装技能：优先 npx skills update
  if (!opts.forceReinstall && isSkillInstalled(name)) {
    console.error(`\n[INFO] 检测到 "${name}" 已安装，尝试更新而非重装`);
    const updateResult = await updateViaNpx(name, fullOpts);
    if (updateResult) return updateResult;
  }

  const origin = { url, skills: [{ name, installCmd: null }] };
  return installOriginSkills(origin, [name], fullOpts);
}

function isSkillInstalled(skillName) {
  const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents';
  const dirs = [
    path.join(userProfile, '.agents', 'skills', skillName),
    path.join(userProfile, '.reasonix', 'skills', skillName)
  ];
  return dirs.some(d => fs.existsSync(d));
}

// ============================================================
// CLI 入口
// ============================================================
async function main() {
  const opts = parseArgs();

  if (opts.help) {
    console.log(`
install-skill.js — 技能安装工具（v3.0 五通道回退）

用法:
  node install-skill.js --name <skill-name> --url <origin-url> [选项]
  node install-skill.js --help

选项:
  --name <name>     技能名称（必需）
  --url <url>       来源仓库 URL（必需）
  --agents <list>   Agent 列表，逗号分隔（默认 reasonix,claude-code,opencode,codex）
  --lock <path>     锁文件路径（默认 ~/.agents/.skill-lock.json）
  --cdn-first       CDN 优先（codeload zip / jsdelivr 在 npx add 之前）
  --dry-run         只打印将执行的命令，不真正执行
  --force-reinstall 即使已安装也重新安装（默认已安装走 npx skills update）

通道链（默认官方优先）:
  0. 已安装 → npx skills update
  1. HTTPS  → npx skills add <https>
  2. SSH    → npx skills add <ssh>
  3. codeload zip → 下载解压 → npx skills add <local>
  4. jsdelivr 逐文件 → ~/.agents/skills + experimental_sync
  5. GitHub API 逐文件 → ~/.agents/skills（最后兜底）
`);
    return;
  }

  if (!opts.name || !opts.url) {
    console.error('[ERROR] 请指定 --name <skill-name> 和 --url <origin-url>');
    process.exit(1);
  }

  const result = await installSingleSkill(opts.name, opts.url, opts);
  const statusIcon = result.status === 'installed' ? '✓' : '✗';
  console.error(`\n[RESULT] ${statusIcon} ${opts.name}: ${result.status} (${result.method})`);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[FATAL] ${err.message}`);
    console.log(JSON.stringify({ status: 'failed', method: 'none', details: err.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  installOriginSkills,
  installSingleSkill,
  updateViaNpx,
  isSkillInstalled
};
