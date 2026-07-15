# 技能列表文件格式说明

本参考文件说明了技能列表文件（Skill List File）的预期格式。该文件应是从 `Reasonix-skill-list-v2.md` 拷贝而来，或按照以下格式手动创建。

---

## 文件格式

### 基本结构

```
# <标题>

<说明文字>

## Origin URL: <仓库HTTPS地址>

Skill Name and install command

1. <技能名称>: npx skills add <仓库URL> --skill <技能名称>
2. <技能名称>: npx skills add <仓库URL> --skill <技能名称>
...

## Origin URL: <另一个仓库HTTPS地址>

Skill Name and install command

1. <技能名称>: npx skills add <仓库URL> --skill <技能名称>
2. <技能名称>: npx skills add <仓库URL> --skill <技能名称>
...
```

### 格式规则

| 元素 | 规则 | 示例 |
|---|---|---|
| **标题** | 以 `#` 开头，可以是任意文本 | `# Reasonix Skill List` |
| **段落** | 任意文本说明，解析器会跳过 | `自动检查下方列出的所有 Skill 是否已安装...` |
| **Origin URL 节** | 以 `## Origin URL:` 开头，后跟一个 URL | `## Origin URL: https://github.com/anthropics/skills` |
| **子标题** | 行 `Skill Name and install command`（被解析器忽略） | `Skill Name and install command` |
| **技能条目** | 格式：`序号. 技能名称: 完整安装命令` | `1. docx: npx skills add https://github.com/anthropics/skills --skill docx` |

### 解析规则

解析器按以下规则处理文件：

1. **跳过空行** — 所有空白行被忽略
2. **跳过注释** — 所有不是 Origin URL 节或技能条目的行被忽略
3. **Origin URL 节** — 匹配正则 `/^##\s+Origin\s+URL:\s*(.*)/i`，提取 URL
4. **技能条目** — 匹配正则 `/^\d+\.\s*(\S+):\s*(npx skills .*)/`，提取技能名称和安装命令
5. **空 URL 节** — 如果 `Origin URL:` 后没有 URL 或 URL 为空，该节被忽略
6. **`_shared` 条目** — 像 `0. _shared` 这样的特殊条目（不包含安装命令）被保留为技能条目，但不包含安装命令

### 完整示例

```markdown
# Reasonix Skill List

自动检查下方列出的所有 Skill 是否已安装。

## Origin URL: https://github.com/anthropics/skills

Skill Name and install command

1. docx: npx skills add https://github.com/anthropics/skills --skill docx
2. pdf: npx skills add https://github.com/anthropics/skills --skill pdf
3. pptx: npx skills add https://github.com/anthropics/skills --skill pptx

## Origin URL: https://github.com/imbad0202/academic-research-skills

Skill Name and install command

1. academic-paper: npx skills add https://github.com/imbad0202/academic-research-skills --skill academic-paper
2. deep-research: npx skills add https://github.com/imbad0202/academic-research-skills --skill deep-research

## Origin URL: 

Skill Name and install command

1. xxxx: 

## Origin URL: https://github.com/vercel-labs/skills

Skill Name and install command

1. find-skills: npx skills add https://github.com/vercel-labs/skills --skill find-skills
```

### 解析结果示例

对上面的示例进行解析，会得到：

```json
{
  "origins": [
    {
      "url": "https://github.com/anthropics/skills",
      "skills": [
        {"name": "docx", "installCmd": "npx skills add https://github.com/anthropics/skills --skill docx"},
        {"name": "pdf", "installCmd": "npx skills add https://github.com/anthropics/skills --skill pdf"},
        {"name": "pptx", "installCmd": "npx skills add https://github.com/anthropics/skills --skill pptx"}
      ]
    },
    {
      "url": "https://github.com/imbad0202/academic-research-skills",
      "skills": [
        {"name": "academic-paper", "installCmd": "npx skills add https://github.com/imbad0202/academic-research-skills --skill academic-paper"},
        {"name": "deep-research", "installCmd": "npx skills add https://github.com/imbad0202/academic-research-skills --skill deep-research"}
      ]
    },
    {
      "url": "https://github.com/vercel-labs/skills",
      "skills": [
        {"name": "find-skills", "installCmd": "npx skills add https://github.com/vercel-labs/skills --skill find-skills"}
      ]
    }
  ]
}
```

注意 `## Origin URL:` 后无 URL 的节被自动忽略。

---

## 与原始文件的关系

此格式直接对应内置的 `references/Reasonix-skill-list-v2.md` 的结构。该文件已作为 Skill 的内置参考文件，在运行时可直接使用。

推荐存放位置：
- `references/Reasonix-skill-list-v2.md`（Skill 内置列表文件）
- `./skill-list.md`（当前工作目录）
- `./skills/skill-list.md`
- `./sandbox/dev/skill-list.md`
