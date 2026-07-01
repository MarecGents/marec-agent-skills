# Agent Orchestra — Agent 目录与部门总览

> **按需加载文件**：此文件仅在「任务评估」判断需要调度 Agent 时才加载查阅。
> 日常使用 SKILL.md 主文件即可。

---

## Agents 目录结构

```
agent-orchestra/
├── SKILL.md                         ← 主技能定义
└── agents/                          ← 251 个 Agent 定义文件
    ├── dispatcher/
    │   └── 总调度.md                 ← 总调度 Agent（中央调度官）
    ├── reviewer/
    │   └── 审查官.md                 ← 审查 Agent（质量门禁）
    ├── engineering/                 ← 工程部（41 角色）
    ├── design/                      ← 设计部（9 角色）
    ├── marketing/                   ← 营销部（42 角色）
    ├── finance/                     ← 金融部（8 角色）
    ├── security/                    ← 安全部（10 角色）
    ├── testing/                     ← 测试部（9 角色）
    ├── game-development/            ← 游戏开发部（5 角色）
    ├── gis/                         ← GIS 部（13 角色）
    ├── specialized/                 ← 专项部（58 角色）
    ├── academic/                    ← 学术部（6 角色）
    ├── design/ ...                  ← 共 19 个部门
    └── supply-chain/                ← 供应链部（5 角色）
```

---

## Agent 部门总览

本系统包含 **251 个专业 Agent**，按 19 个部门组织。每个部门下有多个专业 Agent，每个 Agent 一个独立的 `.md` 文件。如需查找特定 Agent 的完整能力描述和文件路径，请查阅 `agents/dispatcher/总调度.md` 中的 Agent 注册表。

### 🏗️ 研发与工程 (85 角色)

| 部门 | 数量 | 路径 | 代表 Agent |
|------|------|------|-----------|
| **工程部** | 41 | `agents/engineering/` | 前端开发者、后端架构师、AI工程师、安全工程师、DevOps自动化师、SRE、嵌入式、FPGA、微信小程序、钉钉/飞书集成等 |
| **设计部** | 9 | `agents/design/` | UI设计师、UX架构师、品牌守护者、视觉叙事师、趣味注入师等 |
| **测试部** | 9 | `agents/testing/` | 无障碍审计、API测试、性能基准、现实检查、工作流优化等 |
| **游戏开发部** | 5 | `agents/game-development/` | 游戏设计师、音频工程师、关卡设计师、叙事设计师、技术美术 |
| **空间计算部** | 6 | `agents/spatial-computing/` | visionOS工程师、XR沉浸式开发者、XR界面架构师等 |

### 📈 市场与增长 (77 角色)

| 部门 | 数量 | 路径 | 代表 Agent |
|------|------|------|-----------|
| **营销部** | 42 | `agents/marketing/` | 小红书运营、抖音策略师、B站策略师、跨境电商、私域流量、百度SEO、TikTok等（含 40+ 中国原创） |
| **付费媒体部** | 7 | `agents/paid-media/` | PPC策略师、程序化买家、搜索查询分析师等 |
| **销售部** | 9 | `agents/sales/` | 销售教练、交易策略师、提案策略师等 |
| **产品部** | 5 | `agents/product/` | 产品经理、Sprint优先级师、趋势研究员等 |
| **项目管理部** | 7 | `agents/project-management/` | Jira工作流管家、会议纪要专家、项目引导师等 |
| **支持部** | 7 | `agents/support/` | 财务追踪师、法务合规师、客服响应师等 |

### 🔒 数据与风控 (41 角色)

| 部门 | 数量 | 路径 | 代表 Agent |
|------|------|------|-----------|
| **金融部** | 8 | `agents/finance/` | 财务分析师、投资研究员、税务策略师、风控分析师等 |
| **安全部** | 10 | `agents/security/` | 应用安全工程师、渗透测试师、威胁检测工程师、合规审计师等 |
| **GIS部** | 13 | `agents/gis/` | GIS分析师、3D场景开发者、GeoAI/ML工程师、Web GIS开发者等 |
| **学术部** | 6 | `agents/academic/` | 人类学家、历史学家、心理学家、学习规划师等 |
| **法务部** ⭐ | 2 | `agents/legal/` | 合同审查专家、制度文件撰写专家 |
| **人力资源部** ⭐ | 2 | `agents/hr/` | 招聘专家、绩效管理专家 |

### 🏭 行业专项 (63 角色)

| 部门 | 数量 | 路径 | 代表 Agent |
|------|------|------|-----------|
| **专项部** | 58 | `agents/specialized/` | 高考志愿规划师 ⭐、政务ToG ⭐、养殖档案核对员 ⭐、医疗合规、Prompt工程师、MCP构建师、留学规划顾问 ⭐、工作流架构师等 |
| **供应链部** ⭐ | 5 | `agents/supply-chain/` | 库存预测师、物流路线优化师、供应商评估专家等 |

> ⭐ = 中国市场原创 Agent / 部门

---

### 核心调度 Agent

| Agent | 路径 | 职责 |
|-------|------|------|
| **总调度** 🧠 | `agents/dispatcher/总调度.md` | 任务评估、Agent 匹配、分配调度、跨 Agent 协调 |
| **审查官** 🛡️ | `agents/reviewer/审查官.md` | 质量门禁：功能/代码/安全/架构/合规五维审查 |
