/**
 * sync-skills.js
 *
 * skill-install-manager 主编排脚本（v3.0）— 一键同步/安装/更新全部技能
 *
 * 全自动流程（agent 只需运行本脚本并读取 JSON 报告）:
 *   ⓪ 自更新 skill-install-manager 自身（--no-self-update 跳过）
 *   ① 定位并读取技能列表文件
 *   ② 新旧列表对比（自更新后标记 🆕/🗑️/➡️）
 *   ③ 解析列表（复用 utils.parseSkillList）
 *   ④ 获取全局安装状态（npx skills ls -g --json → 锁文件兜底）
 *   ⑤ 版本对比（git ls-remote 并发 + 缓存 TTL + GitHub API 兜底 + isRealCommit 校验）
 *   ⑤.5 依赖预检（内置表 + dependencies.local.json 覆盖）→ 生成安装队列
 *   ⑥ 执行安装/更新（pendingDeps → 🆕 → missing → outdated；五通道回退，仓库级共享下载）
 *   ⑦ 输出 JSON 报告（--report，默认 ~/.agents/skill-sync-report.json）+ 控制台摘要
 *
 * 用法:
 *   node sync-skills.js [--list <path>] [--no-self-update] [--cdn-first] [--dry-run]
 *                       [--concurrency <n>] [--agents <a,b,c>] [--lock <path>]
 *                       [--report <path>] [--cache-ttl <minutes>] [--compare] [--only <name1,name2>]
 *
 * 参数:
 *   --list <path>       技能列表文件路径（默认自动查找：./skill-list.md → ./skills/skill-list.md
 *                       → ./sandbox/dev/skill-list.md → 脚本所在技能包的 references/Reasonix-skill-list-v2.md）
 *   --no-self-update    跳过步骤⓪ 自更新
 *   --cdn-first         CDN 优先（codeload zip / jsdelivr 在 npx add 之前）
 *   --dry-run           只打印将执行的命令，不真正执行（安全演练）
 *   --concurrency <n>   仓库级安装并发数（默认 3）
 *   --agents <list>     Agent 列表，逗号分隔（默认 reasonix,claude-code,opencode,codex）
 *   --lock <path>       锁文件路径（默认 ~/.agents/.skill-lock.json）
 *   --report <path>     报告输出路径（默认 ~/.agents/skill-sync-report.json）
 *   --cache-ttl <min>   远端 commit 缓存 TTL 分钟（默认 360）
 *   --compare           只对比不安装（输出 compare 模式 JSON，兼容旧 compare-skills.js）
 *   --only <list>       只处理指定技能（逗号分隔）
 *   --skip-deps         跳过依赖预检（步骤⑤.5）
 */

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_AGENTS,
  DEFAULT_LOCK_PATH,
  extractGitHubInfo,
  runCommand,
  gitLsRemoteWithRetry,
  getLatestCommitSha,
  isRealCommit,
  parseSkillList,
  getInstalledSkills,
  getLockData,
  RemoteCache,
  concurrentMap,
  nowIso
} = require('./utils');
const { installOriginSkills, installSingleSkill, updateViaNpx } = require('./install-skill');

// ============================================================
// 内置依赖表（v3.0 从 SKILL.md 5.5.1 迁入；可用 dependencies.local.json 覆盖/追加）
// ============================================================
const BUILTIN_DEPENDENCIES = {
  'default': ['brainstorming', 'planning-with-files-zh', 'skill-standard-harness'],
  'github-project-replication': ['brainstorming', 'planning-with-files-zh', 'skill-standard-harness'],
  'academic-pipeline': ['academic-paper', 'academic-paper-reviewer', 'deep-research'],
  'ieee-mg-writing': ['ieee-mg-share'],
  'ieee-mg-polishing': ['ieee-mg-share'],
  'ieee-mg-reviewer': ['ieee-mg-share'],
  'grill-me': ['grilling'],
  'zh-quotes': ['docx'],
  'researchwrite': ['brainstorming', 'docx'],
  'nature-academic-search': ['nature-shared'],
  'nature-citation': ['nature-shared'],
  'nature-data': ['nature-shared'],
  'nature-figure': ['nature-shared'],
  'nature-paper-to-patent': ['nature-shared'],
  'nature-paper2ppt': ['nature-shared'],
  'nature-polishing': ['nature-shared'],
  'nature-reader': ['nature-shared'],
  'nature-response': ['nature-shared'],
  'nature-reviewer': ['nature-shared'],
  'nature-writing': ['nature-shared'],
  'nature-downloader': ['nature-shared'],
  'nature-experiment-log': ['nature-shared'],
  'nature-literature-pipeline': ['nature-shared'],
  'nature-ref-verifier': ['nature-shared'],
  'nature-statistics': ['nature-shared']
};

// nature-* 通配（以 nature- 开头的其他技能都依赖 nature-shared）
const NATURE_PREFIX_DEPS = ['nature-shared'];

function loadDependencyTable(scriptsDir) {
  const table = { ...BUILTIN_DEPENDENCIES };
  const localPath = path.join(scriptsDir, 'dependencies.local.json');
  try {
    if (fs.existsSync(localPath)) {
      const local = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
      for (const [skill, deps] of Object.entries(local)) {
        if (Array.isArray(deps)) table[skill] = deps;
        else if (typeof deps === 'string') table[skill] = deps.split(',').map(s => s.trim()).filter(Boolean);
      }
      console.error(`[DEPS] 已加载本地依赖覆盖 ${localPath}`);
    }
  } catch (err) {
    console.error(`[WARN] 依赖覆盖文件解析失败 ${localPath}: ${err.message}`);
  }
  return table;
}

function getDependenciesFor(skillName, table) {
  if (table[skillName]) return [...table[skillName]];
  if (skillName.startsWith('nature-')) return [...NATURE_PREFIX_DEPS];
  return [];
}

// ============================================================
// 参数解析
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    agents: [...DEFAULT_AGENTS],
    concurrency: 3,
    cdnFirst: false,
    dryRun: false,
    selfUpdate: true,
    compareOnly: false,
    skipDeps: false,
    lockFile: null,
    reportPath: null,
    cacheTtlMin: 360,
    listFile: null,
    only: null,
    help: false
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--list' && i + 1 < args.length) opts.listFile = args[++i];
    else if (a === '--report' && i + 1 < args.length) opts.reportPath = args[++i];
    else if (a === '--lock' && i + 1 < args.length) opts.lockFile = args[++i];
    else if (a === '--agents' && i + 1 < args.length) opts.agents = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--concurrency' && i + 1 < args.length) opts.concurrency = Math.max(1, parseInt(args[++i], 10) || 3);
    else if (a === '--cache-ttl' && i + 1 < args.length) opts.cacheTtlMin = Math.max(1, parseInt(args[++i], 10) || 360);
    else if (a === '--only' && i + 1 < args.length) opts.only = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--no-self-update') opts.selfUpdate = false;
    else if (a === '--cdn-first') opts.cdnFirst = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--compare') opts.compareOnly = true;
    else if (a === '--skip-deps') opts.skipDeps = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

// ============================================================
// 步骤⓪：自更新 skill-install-manager 自身
// ============================================================
async function selfUpdate(opts) {
  if (opts.dryRun) {
    console.error('[DRY-RUN] 自更新: npx skills update skill-install-manager -g -y');
    return { updated: true, method: 'dry-run' };
  }

  // 方式 A：npx skills update
  const cmdA = 'npx skills update skill-install-manager -g -y';
  console.error(`[SELF-UPDATE] 方式A: ${cmdA}`);
  const resA = runCommand(cmdA, 30000);
  if (resA.success) {
    console.error('[SELF-UPDATE] ✓ 自更新成功 (update)');
    return { updated: true, method: 'update' };
  }
  console.error(`[SELF-UPDATE] ✗ update 失败: ${resA.error}，降级到 add`);

  // 方式 B：npx skills add（HTTPS）
  const cmdB = `npx skills add https://github.com/MarecGents/marec-agent-skills --skill skill-install-manager -g -a reasonix -y`;
  console.error(`[SELF-UPDATE] 方式B: ${cmdB}`);
  const resB = runCommand(cmdB, 60000);
  if (resB.success) {
    console.error('[SELF-UPDATE] ✓ 自更新成功 (add)');
    return { updated: true, method: 'add' };
  }
  console.error(`[SELF-UPDATE] ✗ add 失败: ${resB.error}，降级到 codeload zip`);

  // 方式 C：codeload zip 手动更新（覆盖安装 skill-install-manager 自身文件）
  try {
    const { installOriginSkills } = require('./install-skill');
    const origin = { url: 'https://github.com/MarecGents/marec-agent-skills', skills: [{ name: 'skill-install-manager', installCmd: null }] };
    const result = await installOriginSkills(origin, ['skill-install-manager'], {
      agents: ['reasonix'],
      cdnFirst: true,
      dryRun: false,
      lockFile: opts.lockFile,
      cache: opts.cache,
      latestShaByRepo: null
    });
    if (result.status === 'installed') {
      console.error('[SELF-UPDATE] ✓ 自更新成功 (codeload zip)');
      return { updated: true, method: 'codeload-zip' };
    }
    console.error(`[SELF-UPDATE] ✗ codeload zip 失败: ${result.details}`);
  } catch (err) {
    console.error(`[SELF-UPDATE] ✗ codeload zip 异常: ${err.message}`);
  }

  return { updated: false, method: 'none' };
}

// ============================================================
// 步骤①：定位技能列表文件
// ============================================================
function resolveListFile(opts) {
  if (opts.listFile) return opts.listFile;

  const candidates = [
    path.join(process.cwd(), 'skill-list.md'),
    path.join(process.cwd(), 'skills', 'skill-list.md'),
    path.join(process.cwd(), 'sandbox', 'dev', 'skill-list.md'),
    path.join(__dirname, '..', 'references', 'Reasonix-skill-list-v2.md')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

// ============================================================
// 步骤②：新旧列表对比
// ============================================================
function diffSkillLists(oldNames, newNames) {
  const oldSet = new Set(oldNames);
  const newSet = new Set(newNames);
  const added = [...newSet].filter(n => !oldSet.has(n));
  const removed = [...oldSet].filter(n => !newSet.has(n));
  return { added, removed, continued: [...newSet].filter(n => oldSet.has(n)) };
}

// ============================================================
// 步骤④：安装状态（供报告）
// ============================================================

// ============================================================
// 步骤⑤：版本对比（每仓库一次 + 缓存 + 并发）
// ============================================================
/**
 * 检查单个仓库的最新 commit SHA（缓存 → git ls-remote → GitHub API）
 */
async function getRepoLatestSha(owner, repo, cache) {
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const cached = cache.getSha(owner, repo);
  if (cached) {
    console.error(`[VERSION] ${cacheKey}: 缓存命中 ${cached.substring(0, 8)}`);
    return { sha: cached, source: 'cache' };
  }

  // git ls-remote（带重试，15s 超时）
  const sha = gitLsRemoteWithRetry(owner, repo, 1, 15000);
  if (sha) {
    cache.setSha(owner, repo, sha);
    cache.save();
    console.error(`[VERSION] ${cacheKey}: git ls-remote → ${sha.substring(0, 8)}`);
    return { sha, source: 'git-ls-remote' };
  }

  // GitHub API 兜底
  try {
    const apiSha = await getLatestCommitSha(owner, repo, { timeoutMs: 15000, retries: 1 });
    if (apiSha) {
      cache.setSha(owner, repo, apiSha);
      cache.save();
      console.error(`[VERSION] ${cacheKey}: GitHub API → ${apiSha.substring(0, 8)}`);
      return { sha: apiSha, source: 'github-api' };
    }
  } catch (err) {
    console.error(`[VERSION] ${cacheKey}: GitHub API 失败: ${err.message}`);
  }

  return { sha: null, source: 'none' };
}

/**
 * 对比分析：输入解析后的列表 + 已安装状态 + 锁数据，输出分类
 */
async function compareAnalysis(origins, installed, lockSkills, cache, opts) {
  // 展开所有列表技能
  const allListed = [];
  for (const origin of origins) {
    for (const skill of origin.skills) {
      allListed.push({ name: skill.name, originUrl: origin.url, installCmd: skill.installCmd });
    }
  }

  const installedNames = new Set(installed.map(s => s.name));

  // 唯一仓库列表
  const repoKeys = new Map(); // owner/repo(lower) -> { owner, repo, originUrl }
  for (const skill of allListed) {
    const gh = extractGitHubInfo(skill.originUrl);
    if (!gh) continue;
    const key = `${gh.owner}/${gh.repo}`.toLowerCase();
    if (!repoKeys.has(key)) repoKeys.set(key, { owner: gh.owner, repo: gh.repo, originUrl: skill.originUrl });
  }

  // 并发获取每个仓库最新 SHA
  const repoShas = new Map(); // key -> { sha, source }
  const repoList = [...repoKeys.values()];
  const concurrency = opts.compareConcurrency || 4;
  await concurrentMap(repoList, concurrency, async (repo) => {
    const key = `${repo.owner}/${repo.repo}`.toLowerCase();
    const result = await getRepoLatestSha(repo.owner, repo.repo, cache);
    repoShas.set(key, result);
  });

  // 分类
  const missing = [];
  const skippable = [];
  const outdated = [];
  const upToDate = [];
  const unknown = [];

  for (const skill of allListed) {
    if (opts.only && !opts.only.includes(skill.name)) continue;

    if (!installedNames.has(skill.name)) {
      if (skill.installCmd === null) skippable.push(skill);
      else missing.push(skill);
      continue;
    }

    // 已安装：版本对比
    const lockEntry = lockSkills[skill.name];

    if (!lockEntry) {
      unknown.push({ ...skill, reason: '锁文件中无此技能记录，无法比对版本' });
      continue;
    }
    if (!lockEntry.skillFolderHash) {
      unknown.push({ ...skill, reason: '锁文件中无 skillFolderHash，无法对比版本' });
      continue;
    }

    const gh = extractGitHubInfo(skill.originUrl);
    if (!gh) {
      unknown.push({ ...skill, reason: `无法从 URL 解析 GitHub 信息: ${skill.originUrl}` });
      continue;
    }

    const key = `${gh.owner}/${gh.repo}`.toLowerCase();
    const latest = repoShas.get(key) || { sha: null };

    // 锁内 hash 非 40 位 commit SHA（旧版写入的 blob/tree SHA 或 npx 写入的内容 hash）
    if (!/^[0-9a-f]{40}$/i.test(lockEntry.skillFolderHash)) {
      unknown.push({
        ...skill,
        reason: `锁文件 skillFolderHash 非 commit SHA（${lockEntry.skillFolderHash.length} 位，疑似旧版写入的 blob/tree SHA 或内容 hash），无法对比版本`,
        fallback: latest.sha ? { remoteLatest: latest.sha, note: '远程最新 commit 可参考；如需更新请执行 npx skills update 刷新锁记录' } : undefined,
        refreshHint: '执行 npx skills update 刷新锁记录后可正常对比'
      });
      continue;
    }

    if (!latest.sha) {
      unknown.push({ ...skill, reason: '无法获取远程最新 commit SHA（网络不可达）' });
      continue;
    }

    if (lockEntry.skillFolderHash === latest.sha) {
      upToDate.push(skill);
      continue;
    }

    // hash ≠ 远程 HEAD：校验是否为真实 commit，避免把 tree SHA 误报为 outdated
    const isCommit = await isRealCommit(gh.owner, gh.repo, lockEntry.skillFolderHash, { timeoutMs: 10000 });
    if (isCommit === true) {
      outdated.push({ ...skill, currentHash: lockEntry.skillFolderHash, latestHash: latest.sha });
    } else if (isCommit === false) {
      unknown.push({
        ...skill,
        reason: `锁文件 skillFolderHash 是 40 位但非 commit（疑似 npx skills add 写入的 tree SHA），无法对比版本`,
        fallback: { remoteLatest: latest.sha, note: '远程最新 commit 可参考；如需更新请执行 npx skills update' },
        refreshHint: '执行 npx skills update 刷新锁记录后可正常对比'
      });
    } else {
      unknown.push({ ...skill, reason: 'hash 与远程 HEAD 不一致，且无法验证是否为 commit（网络错误）' });
    }
  }

  return {
    allListed,
    repoShas,
    missing,
    skippable,
    outdated,
    upToDate,
    unknown,
    summary: {
      total: allListed.length,
      installed: installed.length,
      missing: missing.length,
      skippable: skippable.length,
      outdated: outdated.length,
      upToDate: upToDate.length,
      unknown: unknown.length
    }
  };
}

// ============================================================
// 步骤⑤.5：依赖预检 → 安装队列
// ============================================================
function resolveDependencies(missing, added, installedNames, origins, depTable, opts) {
  const pendingDeps = [];   // { name, originUrl, installCmd, neededBy }
  const depWarnings = [];   // 依赖不在列表中的提示
  const handled = new Set();

  const originBySkill = new Map();
  for (const origin of origins) {
    for (const skill of origin.skills) {
      originBySkill.set(skill.name, origin);
    }
  }

  const candidates = [...missing, ...added];
  for (const skill of candidates) {
    const deps = getDependenciesFor(skill.name, depTable);
    for (const dep of deps) {
      if (installedNames.has(dep) || handled.has(dep)) continue;
      handled.add(dep);
      const depOrigin = originBySkill.get(dep);
      if (depOrigin && depOrigin.skills.some(s => s.name === dep && s.installCmd !== null)) {
        pendingDeps.push({
          name: dep,
          originUrl: depOrigin.url,
          installCmd: depOrigin.skills.find(s => s.name === dep).installCmd,
          neededBy: [skill.name]
        });
      } else {
        depWarnings.push({ dep, neededBy: skill.name, note: '依赖技能不在列表文件中，无法自动安装' });
      }
    }
  }

  return { pendingDeps, depWarnings };
}

// ============================================================
// 步骤⑥：执行安装队列
// ============================================================
/**
 * 按仓库分组执行安装。
 * 队列: pendingDeps → 🆕 added → missing → outdated
 */
async function runInstallQueue(queue, origins, opts) {
  const results = {
    installed: [],
    updated: [],
    failed: [],
    skipped: []
  };

  if (queue.length === 0) {
    console.error('\n[INSTALL] 无需安装/更新的技能');
    return results;
  }

  // 按 origin URL 分组（同仓库共享下载）
  const groups = new Map(); // originUrl -> { origin, names: string[] }
  for (const item of queue) {
    if (!groups.has(item.originUrl)) {
      const origin = origins.find(o => o.url === item.originUrl) || { url: item.originUrl, skills: [] };
      groups.set(item.originUrl, { origin, names: [] });
    }
    groups.get(item.originUrl).names.push(item.name);
  }

  const groupList = [...groups.values()];
  console.error(`\n[INSTALL] 待处理 ${queue.length} 个技能（${groupList.length} 个仓库，并发 ${opts.concurrency}）`);

  await concurrentMap(groupList, opts.concurrency, async (group) => {
    const names = [...new Set(group.names)];
    console.error(`\n📦 ${group.origin.url} (${names.length} 个技能): ${names.join(', ')}`);

    const result = await installOriginSkills(group.origin, names, {
      agents: opts.agents,
      cdnFirst: opts.cdnFirst,
      dryRun: opts.dryRun,
      lockFile: opts.lockFile,
      cache: opts.cache,
      latestShaByRepo: opts.latestShaByRepo
    });

    for (const s of result.perSkill) {
      if (s.ok) {
        results.installed.push({ name: s.name, method: result.method, originUrl: group.origin.url });
      } else {
        results.failed.push({ name: s.name, reason: s.reason || result.details, originUrl: group.origin.url });
      }
    }
  });

  return results;
}

// ============================================================
// 步骤⑦：报告
// ============================================================
function buildReport(opts, state) {
  return {
    tool: 'skill-install-manager',
    version: '3.0',
    generatedAt: nowIso(),
    options: {
      listFile: state.listFile,
      selfUpdate: opts.selfUpdate,
      cdnFirst: opts.cdnFirst,
      dryRun: opts.dryRun,
      agents: opts.agents,
      concurrency: opts.concurrency
    },
    selfUpdate: state.selfUpdate,
    listDiff: state.listDiff,
    summary: state.analysis.summary,
    deps: {
      pending: state.deps.pendingDeps,
      warnings: state.deps.depWarnings
    },
    install: state.installResults,
    details: {
      missing: state.analysis.missing,
      skippable: state.analysis.skippable,
      outdated: state.analysis.outdated,
      upToDate: state.analysis.upToDate,
      unknown: state.analysis.unknown,
      repoShas: [...state.analysis.repoShas.entries()].map(([k, v]) => ({ repo: k, sha: v.sha ? v.sha.substring(0, 8) : null, source: v.source }))
    }
  };
}

function printConsoleReport(report) {
  const s = report.summary;
  console.log(`\n${'='.repeat(52)}`);
  console.log('  Skill 安装/更新报告');
  console.log(`${'='.repeat(52)}`);
  console.log(`  总计     : ${s.total} 个技能`);
  console.log(`  缺失     : ${s.missing} 个`);
  console.log(`  可更新   : ${s.outdated} 个`);
  console.log(`  已最新   : ${s.upToDate} 个`);
  console.log(`  状态未知 : ${s.unknown} 个`);
  console.log(`  不可安装 : ${s.skippable} 个（_shared 等）`);
  console.log(`  依赖补齐 : ${report.deps.pending.length} 个`);

  if (report.selfUpdate && report.selfUpdate.updated) {
    console.log(`\n⏫ 自更新: 成功 (${report.selfUpdate.method})`);
  } else if (report.selfUpdate) {
    console.log(`\n⏫ 自更新: 失败或跳过 (${report.selfUpdate.method})`);
  }

  if (report.listDiff) {
    console.log(`\n📋 列表变更: 🆕新增 ${report.listDiff.added.length} / 🗑️移除 ${report.listDiff.removed.length} / ➡️延续 ${report.listDiff.continued.length}`);
  }

  if (report.deps.pending.length > 0) {
    console.log(`\n🔗 依赖预检:`);
    for (const d of report.deps.pending) {
      console.log(`   ${d.name} ← 需要者: ${d.neededBy.join(', ')}`);
    }
  }
  if (report.deps.warnings.length > 0) {
    console.log(`\n⚠️ 依赖警告:`);
    for (const w of report.deps.warnings) {
      console.log(`   ${w.dep}（${w.neededBy}）: ${w.note}`);
    }
  }

  if (report.install.installed.length > 0) {
    console.log(`\n✅ 已安装/更新:`);
    for (const i of report.install.installed) {
      console.log(`   ${i.name} (${i.method})`);
    }
  }
  if (report.install.failed.length > 0) {
    console.log(`\n❌ 失败:`);
    for (const f of report.install.failed) {
      console.log(`   ${f.name}: ${f.reason}`);
    }
  }
  console.log(`\n📊 详情见: ${report.options.reportPath || '~/.agents/skill-sync-report.json'}`);
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const opts = parseArgs();

  if (opts.help) {
    console.log(`
sync-skills.js — 技能安装管理器主编排脚本（v3.0）

用法:
  node sync-skills.js [选项]

选项:
  --list <path>       技能列表文件路径（默认自动查找）
  --no-self-update    跳过自更新
  --cdn-first         CDN 优先（codeload zip / jsdelivr 在 npx add 之前）
  --dry-run           只打印将执行的命令，不真正执行
  --concurrency <n>   仓库级安装并发数（默认 3）
  --agents <list>     Agent 列表（默认 reasonix,claude-code,opencode,codex）
  --lock <path>       锁文件路径
  --report <path>     报告输出路径（默认 ~/.agents/skill-sync-report.json）
  --cache-ttl <min>   远端 commit 缓存 TTL 分钟（默认 360）
  --compare           只对比不安装（兼容旧 compare-skills.js 输出）
  --only <list>       只处理指定技能
  --skip-deps         跳过依赖预检
  --help              显示帮助
`);
    return;
  }

  const state = {
    listFile: null,
    selfUpdate: null,
    listDiff: null,
    analysis: null,
    deps: { pendingDeps: [], depWarnings: [] },
    installResults: { installed: [], updated: [], failed: [], skipped: [] }
  };

  const cache = new RemoteCache(undefined, opts.cacheTtlMin * 60 * 1000);
  opts.cache = cache;

  // ---- 步骤⓪：自更新 ----
  let oldListNames = [];
  if (opts.selfUpdate && !opts.compareOnly) {
    // 更新前记录旧列表摘要（如果当前列表文件可读）
    const currentList = resolveListFile(opts);
    if (fs.existsSync(currentList)) {
      oldListNames = parseSkillList(currentList).flatMap(o => o.skills.map(s => s.name));
    }
    state.selfUpdate = await selfUpdate(opts);
  } else {
    state.selfUpdate = { updated: false, method: 'skipped' };
  }

  // ---- 步骤①：定位列表文件 ----
  state.listFile = resolveListFile(opts);
  if (!fs.existsSync(state.listFile)) {
    console.error(`[ERROR] 技能列表文件不存在: ${state.listFile}`);
    process.exit(1);
  }
  console.error(`[LIST] 使用列表文件: ${state.listFile}`);

  // ---- 步骤③：解析列表 ----
  const origins = parseSkillList(state.listFile);
  const totalSkills = origins.reduce((s, o) => s + o.skills.length, 0);
  console.error(`[PARSE] 已解析 ${origins.length} 个来源，共 ${totalSkills} 个技能`);

  // ---- 步骤②：新旧列表对比 ----
  if (oldListNames.length > 0 && state.selfUpdate && state.selfUpdate.updated) {
    const newListNames = origins.flatMap(o => o.skills.map(s => s.name));
    state.listDiff = diffSkillLists(oldListNames, newListNames);
    console.error(`[DIFF] 🆕新增 ${state.listDiff.added.length} / 🗑️移除 ${state.listDiff.removed.length} / ➡️延续 ${state.listDiff.continued.length}`);
  }

  // ---- 步骤④：获取安装状态 ----
  const installed = getInstalledSkills(opts.lockFile);
  console.error(`[STATE] 当前已全局安装 ${installed.length} 个技能`);

  // ---- 步骤⑤：版本对比 ----
  const lockData = getLockData(opts.lockFile);
  const lockSkills = lockData.skills || {};
  const analysis = await compareAnalysis(origins, installed, lockSkills, cache, opts);
  state.analysis = analysis;
  console.error(`\n[SUMMARY] 总计 ${analysis.summary.total} | 缺失 ${analysis.summary.missing} | 可更新 ${analysis.summary.outdated} | 已最新 ${analysis.summary.upToDate} | 未知 ${analysis.summary.unknown}`);

  // ---- compare 模式：只输出对比 JSON ----
  if (opts.compareOnly) {
    const compareOutput = {
      origins,
      installed: installed.map(s => ({ name: s.name, agents: s.agents, path: s.path })),
      missing: analysis.missing,
      skippable: analysis.skippable,
      outdated: analysis.outdated,
      upToDate: analysis.upToDate,
      unknown: analysis.unknown,
      summary: analysis.summary
    };
    console.log(JSON.stringify(compareOutput, null, 2));
    return;
  }

  // ---- 步骤⑤.5：依赖预检 ----
  const depTable = loadDependencyTable(__dirname);
  const addedSkills = (state.listDiff ? state.listDiff.added : []);
  const addedEntries = addedSkills
    .map(name => {
      for (const o of origins) {
        const sk = o.skills.find(s => s.name === name);
        if (sk) return { name, originUrl: o.url, installCmd: sk.installCmd };
      }
      return null;
    })
    .filter(Boolean);

  if (!opts.skipDeps) {
    const installedNames = new Set(installed.map(s => s.name));
    const depResult = resolveDependencies(analysis.missing, addedEntries, installedNames, origins, depTable, opts);
    state.deps = depResult;
    if (depResult.pendingDeps.length > 0) {
      console.error(`[DEPS] 依赖预检: ${depResult.pendingDeps.map(d => d.name).join(', ')} 加入安装队列`);
    }
    for (const w of depResult.depWarnings) {
      console.error(`[DEPS] ⚠ ${w.dep}（${w.neededBy}）: ${w.note}`);
    }
  }

  // ---- 步骤⑥：安装队列（pendingDeps → 🆕 → missing → outdated）----
  const latestShaByRepo = new Map();
  for (const [key, v] of analysis.repoShas) latestShaByRepo.set(key, v.sha);
  opts.latestShaByRepo = latestShaByRepo;

  // 构建队列：依赖 → 新增 → 缺失；outdated 单独走 update
  const installQueue = [];
  for (const dep of state.deps.pendingDeps) {
    installQueue.push({ name: dep.name, originUrl: dep.originUrl, installCmd: dep.installCmd, priority: 'pendingDeps' });
  }
  for (const sk of addedEntries) {
    if (!state.deps.pendingDeps.some(d => d.name === sk.name)) {
      installQueue.push({ name: sk.name, originUrl: sk.originUrl, installCmd: sk.installCmd, priority: 'added' });
    }
  }
  for (const sk of analysis.missing) {
    if (!installQueue.some(q => q.name === sk.name)) {
      installQueue.push({ name: sk.name, originUrl: sk.originUrl, installCmd: sk.installCmd, priority: 'missing' });
    }
  }

  // outdated 技能：逐个 npx skills update，失败入重装队列
  const outdatedToReinstall = [];
  for (const sk of analysis.outdated) {
    if (opts.dryRun) {
      console.error(`[DRY-RUN] 更新 ${sk.name}: npx skills update ${sk.name} -g -y`);
      state.installResults.updated.push({ name: sk.name, method: 'update', originUrl: sk.originUrl });
      continue;
    }
    const upd = await updateViaNpx(sk.name, { agents: opts.agents, dryRun: false, lockFile: opts.lockFile });
    if (upd) {
      state.installResults.updated.push({ name: sk.name, method: 'update', originUrl: sk.originUrl });
    } else {
      outdatedToReinstall.push(sk);
    }
  }
  for (const sk of outdatedToReinstall) {
    if (!installQueue.some(q => q.name === sk.name)) {
      installQueue.push({ name: sk.name, originUrl: sk.originUrl, installCmd: sk.installCmd, priority: 'outdated' });
    }
  }

  const installResults = await runInstallQueue(installQueue, origins, opts);
  state.installResults.installed = installResults.installed;
  state.installResults.failed = installResults.failed;

  // ---- 步骤⑦：报告 ----
  const reportPath = opts.reportPath || path.join(
    process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\MarecGents',
    '.agents', 'skill-sync-report.json'
  );
  opts.reportPath = reportPath;
  const report = buildReport(opts, state);
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.error(`\n[REPORT] 报告已写入 ${reportPath}`);
  } catch (err) {
    console.error(`[REPORT] ⚠ 报告写入失败: ${err.message}`);
  }

  printConsoleReport(report);

  // 供 --compare 之外的程序化调用：导出最后报告
  if (require.main === module) {
    // CLI 模式：输出完整 JSON 到 stdout（脚本可被其他工具链消费）
    console.log('\n' + JSON.stringify(report, null, 2));
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[FATAL] ${err.message}`);
    console.log(JSON.stringify({ status: 'failed', details: err.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  parseSkillList,
  compareAnalysis,
  resolveDependencies,
  diffSkillLists,
  buildReport
};
