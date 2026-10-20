# business/ — workbench capabilities

English | [中文](README.zh.md)

Domain services for reusable workbench agents and business workflows. Workflows clarify requirements, compose steps, and verify effects; workbench agents own independent collaborator identities and task histories.

| Package | Role | ctx key |
|---|---|---|
| [`business-workflow/`](business-workflow/README.md) | Defines the runtime contract, stage transitions, and events | `ctx.businessWorkflows` |
| [`business-workflow-local/`](business-workflow-local/README.md) | Implements the process-local runtime | registers on `ctx.businessWorkflows` |
| [`tool-business-workflow/`](tool-business-workflow/README.md) | Exposes the `business_workflow_*` tools to the model | registers on `ctx.tools` |
| [`workbench-agent/`](workbench-agent/README.md) | Independent identities, native task queue, and Remote management | `ctx.workbenchAgents` |
