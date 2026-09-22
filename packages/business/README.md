# business/ — business-workflow capability family

English | [中文](README.zh.md)

This family turns a stated business need into a verified step orchestration through three capabilities over one record: requirement clarification, workflow composition, and effect verification.

| Package | Role | ctx key |
|---|---|---|
| [`business-workflow/`](business-workflow/README.md) | Defines the runtime contract, stage transitions, and events | `ctx.businessWorkflows` |
| [`business-workflow-local/`](business-workflow-local/README.md) | Implements the process-local runtime | registers on `ctx.businessWorkflows` |
| [`tool-business-workflow/`](tool-business-workflow/README.md) | Exposes the `business_workflow_*` tools to the model | registers on `ctx.tools` |
