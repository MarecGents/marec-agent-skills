# marec-agent-skills

[![skills.sh](https://skills.sh/b/MarecGents/marec-agent-skills)](https://skills.sh/MarecGents/marec-agent-skills)

A collection of Agent Skills for AI coding agents. Skills are packaged instructions and scripts that extend agent capabilities, following the [Agent Skills](https://agentskills.io/) format.

## Installation

```bash
npx skills add MarecGents/marec-agent-skills
```

## Available Skills

> Skills will be listed here as they are added.

<!--
### example-skill-name

Brief description of what this skill does and when to use it.

**Use when:**
- Scenario 1
- Scenario 2

**Features:**
- Feature 1
- Feature 2
-->

## Creating Your Own Skills

Each skill is a folder under `skills/` containing at minimum a `SKILL.md` file:

```
skills/
└── my-skill/
    ├── SKILL.md          # Required: metadata + instructions
    ├── scripts/          # Optional: executable code
    ├── references/       # Optional: documentation
    └── assets/           # Optional: templates, resources
```

Use the [`template/`](./template/SKILL.md) in this repository as a starting point.

For more details, see the [Agent Skills Specification](https://agentskills.io/specification.md).

## License

MIT
