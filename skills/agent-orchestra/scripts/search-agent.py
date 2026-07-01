#!/usr/bin/env python3
"""
Agent 搜索脚本 — 在 agent-registry.md 中按关键词搜索 Agent。

用法:
    python scripts/search-agent.py <关键词>
    python scripts/search-agent.py 前端         # 搜索名称/描述中含"前端"的 Agent
    python scripts/search-agent.py 微信 营销     # 多关键词 AND 搜索
    python scripts/search-agent.py --list-all   # 列出所有 Agent ID

输出: Agent ID | 中文名 | 描述 | 部门
"""

import sys
import re
import os
from pathlib import Path

# 脚本所在目录的上级（即 skill 根目录）
SKILL_DIR = Path(__file__).resolve().parent.parent
REGISTRY_PATH = SKILL_DIR / "references" / "agent-registry.md"


def load_agents():
    """从 agent-registry.md 中解析所有 Agent 条目"""
    if not REGISTRY_PATH.exists():
        print(f"错误: 未找到 {REGISTRY_PATH}")
        print("请确保 agent-registry.md 存在于 references/ 目录中。")
        sys.exit(1)

    content = REGISTRY_PATH.read_text(encoding="utf-8")
    agents = []
    current_dept = "未知部门"

    for line in content.split("\n"):
        # 识别部门标题行
        dept_match = re.match(r'^###?\s+(.+?)\s*\((\d+)\)', line)
        if dept_match:
            current_dept = dept_match.group(1).strip()

        # 识别 Agent 条目行: | `id` | 名称 | 描述 |
        agent_match = re.match(r'^\|\s*`([^`]+)`\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|', line)
        if agent_match and not line.startswith("| Agent ID"):
            agent_id = agent_match.group(1).strip()
            name = agent_match.group(2).strip()
            desc = agent_match.group(3).strip()
            agents.append({
                "id": agent_id,
                "name": name,
                "desc": desc,
                "dept": current_dept,
            })

    return agents


def search_agents(agents, keywords):
    """按关键词搜索（AND 逻辑：所有关键词都必须匹配）"""
    results = []
    for agent in agents:
        search_text = f"{agent['id']} {agent['name']} {agent['desc']}"
        if all(kw.lower() in search_text.lower() for kw in keywords):
            results.append(agent)
    return results


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    agents = load_agents()

    if sys.argv[1] == "--list-all":
        print(f"\n共加载 {len(agents)} 个 Agent\n")
        print(f"{'Agent ID':<50} {'中文名':<20} {'部门':<20}")
        print("-" * 90)
        for a in agents:
            print(f"{a['id']:<50} {a['name']:<20} {a['dept']:<20}")
        return

    keywords = sys.argv[1:]
    results = search_agents(agents, keywords)

    if not results:
        print(f"未找到匹配「{' '.join(keywords)}」的 Agent。")
        sys.exit(0)

    print(f"\n找到 {len(results)} 个匹配 Agent（关键词: {' '.join(keywords)}）\n")
    print(f"{'Agent ID':<50} {'中文名':<20} {'描述':<50} {'部门':<20}")
    print("-" * 140)
    for a in results:
        desc_short = a['desc'][:48] + "..." if len(a['desc']) > 48 else a['desc']
        print(f"{a['id']:<50} {a['name']:<20} {desc_short:<50} {a['dept']:<20}")


if __name__ == "__main__":
    main()
