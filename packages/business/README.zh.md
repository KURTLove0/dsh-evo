# business/ — 工作台能力

[English](README.md) | 中文

管理可复用工作台智能体和业务工作流的领域服务。工作流澄清需求、组合步骤并验证效果；工作台智能体持有独立的工作成员身份和任务历史。

| Package | Role | ctx key |
|---|---|---|
| [`business-workflow/`](business-workflow/README.zh.md) | 定义运行时契约、阶段流转与事件 | `ctx.businessWorkflows` |
| [`business-workflow-local/`](business-workflow-local/README.zh.md) | 实现进程内运行时 | 注册于 `ctx.businessWorkflows` |
| [`tool-business-workflow/`](tool-business-workflow/README.zh.md) | 向模型暴露 `business_workflow_*` 工具 | 注册于 `ctx.tools` |
| [`workbench-agent/`](workbench-agent/README.zh.md) | 独立身份、原生任务队列和 Remote 管理 | `ctx.workbenchAgents` |
