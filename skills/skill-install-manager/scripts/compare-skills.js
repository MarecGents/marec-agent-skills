/**
 * compare-skills.js
 *
 * 技能列表对比脚本（v3.0 薄封装）— 转发到 sync-skills.js 的 --compare 模式
 *
 * 原实现（v2.x 的独立对比逻辑）已合并进 sync-skills.js，本文件保留作为
 * 兼容入口，输出格式与旧版一致（origins / installed / missing / skippable /
 * outdated / upToDate / unknown / summary）。
 *
 * 用法（与原版一致）:
 *   node compare-skills.js --list <path-to-list-file>
 *   node compare-skills.js --list <path-to-list-file> --lock <path-to-skill-lock.json>
 */

const { spawnSync } = require('child_process');
const path = require('path');

function main() {
  const args = process.argv.slice(2);

  // 帮助信息
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
compare-skills.js — 技能列表对比工具（v3.0，转发到 sync-skills.js --compare）

用法:
  node compare-skills.js --list <path-to-list-file>
  node compare-skills.js --list <path-to-list-file> --lock <path-to-skill-lock.json>
  node compare-skills.js --help

参数:
  --list <path>   指向技能列表文件的路径（必需）
  --lock <path>   指向 .skill-lock.json 的路径（可选，默认自动查找）
  --help, -h      显示此帮助信息

输出:
  输出 JSON 到 stdout，包含 origins / installed / missing / skippable / outdated / upToDate / unknown / summary
`);
    return;
  }

  if (!args.includes('--list')) {
    console.error('[ERROR] 请指定 --list <path> 参数指向技能列表文件');
    process.exit(1);
  }

  // 转发到 sync-skills.js --compare（透传 --list / --lock，兼容 --only）
  const syncScript = path.join(__dirname, 'sync-skills.js');
  const forwardArgs = ['--compare'];
  for (const arg of args) {
    // 忽略 --compare 自身（防重复）与 --lock 之外的新参数不做特殊处理
    if (arg === '--compare') continue;
    forwardArgs.push(arg);
  }

  const result = spawnSync(process.execPath, [syncScript, ...forwardArgs], {
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'inherit'],
    timeout: 300000
  });

  // sync-skills.js 在 --compare 模式把 JSON 输出到 stdout
  if (result.status === 0 && result.stdout) {
    process.stdout.write(result.stdout);
  } else {
    process.exit(result.status || 1);
  }
}

main();
