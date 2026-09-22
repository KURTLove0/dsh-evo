# business/ — 业务工作流能力族

[English](README.md) | 中文

本能力族通过一条记录上的三大能力，把业务诉求变成经过验证的步骤编排：需求澄清、工作流编排、效果验证。

| Package | Role | ctx key |
|---|---|---|
| [`business-workflow/`](business-workflow/README.zh.md) | 定义运行时契约、阶段流转与事件 | `ctx.businessWorkflows` |
| [`business-workflow-local/`](business-workflow-local/README.zh.md) | 实现进程内运行时 | 注册于 `ctx.businessWorkflows` |
| [`tool-business-workflow/`](tool-business-workflow/README.zh.md) | 向模型暴露 `business_workflow_*` 工具 | 注册于 `ctx.tools` |
