/**
 * compare-skills.js
 *
 * 技能列表对比脚本 — 读取技能列表文件 + 获取当前全局安装状态 → 输出差异对比 JSON
 *
 * 用法:
 *   node compare-skills.js --list <path-to-list-file>
 *   node compare-skills.js --list <path-to-list-file> --lock <path-to-skill-lock.json>
 *
 * 输出 JSON 格式:
 * {
 *   "origins": [...],
 *   "installed": [...],
 *   "missing": [...],        // 可安装但未安装的技能
 *   "skippable": [...],      // 不可安装的条目（如 _shared，无 installCmd）
 *   "outdated": [...],       // 已安装但有远程更新的技能
 *   "upToDate": [...],       // 已是最新的技能
 *   "unknown": [...],        // 版本状态未知的技能
 *   "summary": { ... }
 * }
 */

const fs = require('fs');
const path = require('path');
const { extractGitHubInfo, gitLsRemoteWithRetry } = require('./utils');

// ============================================================
// 命令行参数解析
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list' && i + 1 < args.length) {
      opts.listFile = args[++i];
    } else if (args[i] === '--lock' && i + 1 < args.length) {
      opts.lockFile = args[++i];
    }
  }
  return opts;
}

// ============================================================
// 解析技能列表文件
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
      // 保存上一个 URL 的数据
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

  // 保存最后一个 URL 的数据
  if (currentOriginUrl && currentSkills.length > 0) {
    origins.push({ url: currentOriginUrl, skills: currentSkills });
  }

  return origins;
}

// ============================================================
// 获取当前全局安装状态
// ============================================================
function getInstalledSkills() {
  try {
    const { execSync } = require('child_process');
    const output = execSync('npx skills ls -g --json', {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    return JSON.parse(output.trim());
  } catch (err) {
    console.error(`[ERROR] 无法获取已安装技能列表: ${err.message}`);
    return [];
  }
}

// ============================================================
// 读取 skill-lock.json
// ============================================================
function getLockData(lockFilePath) {
  const defaultPath = path.join(
    process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents',
    '.agents', '.skill-lock.json'
  );
  const lockPath = lockFilePath || defaultPath;

  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[WARN] 无法读取锁文件 ${lockPath}: ${err.message}`);
    return { skills: {} };
  }
}

// ============================================================
// 降级策略：当 skillFolderHash 缺失时，尝试通过远程仓库
// 获取最新 commit SHA 作为参考，并标记来源
// ============================================================
function fallbackVersionCheck(originUrl) {
  const ghInfo = extractGitHubInfo(originUrl);
  if (!ghInfo) return null;

  const latestSha = gitLsRemoteWithRetry(ghInfo.owner, ghInfo.repo);
  if (latestSha) {
    return {
      remoteLatest: latestSha,
      note: 'skillFolderHash 缺失，仅提供远程最新版本供参考；如需更新请执行 npx skills update'
    };
  }
  return null;
}

// ============================================================
// 主逻辑
// ============================================================
function main() {
  const opts = parseArgs();

  if (!opts.listFile) {
    console.error('[ERROR] 请指定 --list <path> 参数指向技能列表文件');
    process.exit(1);
  }

  if (!fs.existsSync(opts.listFile)) {
    console.error(`[ERROR] 技能列表文件不存在: ${opts.listFile}`);
    process.exit(1);
  }

  // 1. 解析列表文件
  const origins = parseSkillList(opts.listFile);
  console.error(`[INFO] 已解析 ${origins.length} 个来源，共 ${origins.reduce((s, o) => s + o.skills.length, 0)} 个技能`);

  // 展开所有技能（扁平化）
  const allListedSkills = [];
  for (const origin of origins) {
    for (const skill of origin.skills) {
      allListedSkills.push({
        name: skill.name,
        originUrl: origin.url,
        installCmd: skill.installCmd
      });
    }
  }

  // 2. 获取已安装技能
  const installed = getInstalledSkills();
  const installedNames = new Set(installed.map(s => s.name));
  console.error(`[INFO] 当前已全局安装 ${installed.length} 个技能`);

  // 3. 获取锁数据
  const lockData = getLockData(opts.lockFile);
  const lockSkills = lockData.skills || {};

  // 4. 对比分析
  const missing = [];     // 可安装但未安装
  const skippable = [];   // 不可安装的条目（_shared 等）
  const outdated = [];
  const upToDate = [];
  const unknown = [];

  // 按 origin URL 分组，避免重复检查同一仓库
  const originCheckCache = new Map(); // cache: owner/repo -> latest SHA

  for (const skill of allListedSkills) {
    // --- 未安装的处理 ---
    if (!installedNames.has(skill.name)) {
      if (skill.installCmd === null) {
        // 无安装命令的条目（如 _shared），标记为不可安装
        skippable.push(skill);
      } else {
        missing.push(skill);
      }
      continue;
    }

    // --- 已安装，检查版本 ---
    const lockEntry = lockSkills[skill.name];

    // 情况 A：锁文件中无此技能条目
    if (!lockEntry) {
      const fallback = fallbackVersionCheck(skill.originUrl);
      unknown.push({
        ...skill,
        reason: '锁文件中无此技能记录，无法比对版本',
        fallback: fallback || undefined
      });
      continue;
    }

    // 情况 B：锁文件有条目但缺少 skillFolderHash
    if (!lockEntry.skillFolderHash) {
      const fallback = fallbackVersionCheck(skill.originUrl);
      unknown.push({
        ...skill,
        reason: '锁文件中无 skillFolderHash，无法对比版本',
        fallback: fallback || undefined
      });
      continue;
    }

    // 情况 C：有 skillFolderHash，进行远程比对
    const ghInfo = extractGitHubInfo(skill.originUrl);
    if (!ghInfo) {
      unknown.push({ ...skill, reason: `无法从 URL 解析 GitHub 信息: ${skill.originUrl}` });
      continue;
    }

    const cacheKey = `${ghInfo.owner}/${ghInfo.repo}`;
    if (!originCheckCache.has(cacheKey)) {
      // 使用带重试的 git ls-remote
      const latestSha = gitLsRemoteWithRetry(ghInfo.owner, ghInfo.repo);
      originCheckCache.set(cacheKey, latestSha);
      if (latestSha) {
        console.error(`[INFO] ${cacheKey}: 远程最新 commit ${latestSha.substring(0, 8)}`);
      } else {
        console.error(`[WARN] ${cacheKey}: 无法获取远程最新 commit（已重试）`);
      }
    }

    const latestSha = originCheckCache.get(cacheKey);
    if (!latestSha) {
      unknown.push({ ...skill, reason: '无法获取远程最新 commit SHA（网络不可达）' });
      continue;
    }

    const installedHash = lockEntry.skillFolderHash;
    if (installedHash !== latestSha) {
      outdated.push({
        ...skill,
        currentHash: installedHash,
        latestHash: latestSha
      });
    } else {
      upToDate.push(skill);
    }
  }

  // 5. 输出结果
  const result = {
    origins,
    installed: installed.map(s => ({ name: s.name, agents: s.agents, path: s.path })),
    missing,
    skippable,
    outdated,
    upToDate,
    unknown,
    summary: {
      total: allListedSkills.length,
      installed: installed.length,
      missing: missing.length,
      skippable: skippable.length,
      outdated: outdated.length,
      upToDate: upToDate.length,
      unknown: unknown.length
    }
  };

  // 增加一个可读的统计摘要
  console.error(`\n[SUMMARY] 总计 ${result.summary.total} | 已安装 ${installed.length} | 缺失 ${missing.length} | 不可安装 ${skippable.length} | 可更新 ${outdated.length} | 已最新 ${upToDate.length} | 未知 ${unknown.length}`);
  console.log(JSON.stringify(result, null, 2));
}

main();
