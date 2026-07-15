# 沙盒 / tests

此目录用于**执行和验证** `沙盒/dev/` 中开发的 Agent Skill。

## 使用方式

1. 在 `沙盒/dev/` 中创建或复制你的 skill（遵循 `skills/` 下的规范结构）
2. 在此目录中编写测试脚本或执行命令来验证 skill 的效果
3. 测试通过后，将 skill 移动到项目根 `skills/` 目录下正式发布

## 目录结构建议

```
tests/
├── README.md          # 本文件
├── fixtures/          # 测试用 fixture / 模拟数据（可选）
└── run.ps1            # 批量测试脚本（可选）
```
