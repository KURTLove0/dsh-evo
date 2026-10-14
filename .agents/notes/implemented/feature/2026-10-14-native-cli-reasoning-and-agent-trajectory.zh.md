# Agent Note：原生 CLI 配置、推理摘要与 Agent 轨迹记录

Status: implemented

[English](2026-10-14-native-cli-reasoning-and-agent-trajectory.md) | 中文

## 问题

本地 CLI 适配器曾把 Harness `settings.yaml` 当成第二个控制面，而这些运行时已经自行管理登录、模型选择、MCP server、skill 与项目配置。Codex 适配器还通过单轮桥接转换 Harness 工具，导致 Codex 原生 Agent 工作既不由自身运行时执行，也无法在轨迹中查看。会话日志与聊天本已能表达 reasoning 文本，但 Codex 桥接没有请求或转换产品允许展示的 app-server reasoning summary。

## 决策

本地 CLI 提供方使用已安装运行时的环境配置。挂载 `@deepseek-ai/dsh-llm-claude-cli` 后注册所有已安装且受支持的 CLI；其可配置提供方条目使用空 settings namespace 与 path，Cordis profile 配置仍可承担部署组合。Claude 在请求工作目录中运行。Codex app-server 继承启动环境与正常 Codex home，通过 `model/list` 读取模型目录，在请求工作目录中启动临时 thread，并使用请求的 sandbox 与 `approvalPolicy: never`。客户端拒绝意外的 server request，不再伪造通用批准响应。

Codex 请求 detailed reasoning summary，只把 `item/reasoning/summaryTextDelta` 以及 reasoning 完成项的 `summary` 映射为 Harness reasoning block，忽略 raw reasoning content。这样遵循提供方的披露规则：聊天可以展示 Codex 实际发出的摘要文本，但适配器不会声称能取得隐藏的思维链。

Codex 原生命令、文件变更、网页搜索、MCP/动态工具、协作与 subagent 项目会在终止 `StreamChunk` 上投影为提供方无关的 `AgentInteraction` 记录。会话日志随 finish chunk 保留这些记录；会话投影把它们放在已完成 Assistant 节点旁；轨迹将其展开成含状态、详情与时序的 Agent 行。这些是诊断记录，不是 Assistant 消息内容，也不会进入后续模型请求。

本 Note 局部替代[产物承载 Codex 运行时 Note](../architecture/2026-09-24-llm-claude-cli-codex-runtime.zh.md)中的 `settings.yaml` 与私有 `CODEX_HOME` 归属，以及[运行时存在性 Note](../architecture/2026-09-25-local-runtime-presence.zh.md)中的本地运行时覆盖通道。旧 Note 仍分别作为包恢复与存在性探测的有效依据。既有[轨迹检查账本](2026-07-27-trajectory-inspection-ledger.zh.md)继续负责展示设计；本决策只是增加提供方侧 Agent 记录来源。

## 已考虑的替代方案

- **继续用 `settings.yaml` 覆盖 command、模型目录与 CLI home。** 否决，因为它复制运行时自身状态，并让项目级配置无法跟随请求工作目录。
- **继续通过合成 MCP bridge 向 Codex 暴露 Harness 工具。** 否决，因为这样一次模型调用只能表达一个委托工具步骤，而 app-server 已经拥有 shell、MCP、skill 与子 Agent 执行能力，并提供更完整的生命周期事件。
- **把 Codex 完成项中的 reasoning content 当成原始思维链展示。** 否决，因为 app-server 的可展示表面是 reasoning summary；未披露的原始 reasoning 不是产品表面。
- **把原生 Agent 活动压平到 Assistant 文本。** 否决，因为命令、文件变更、工具与子 Agent 交互需要独立的状态与时序，同时不应成为模型可见历史。

## 后果

本地 CLI 行为跟随对应 CLI 的登录与配置，不再要求 settings section。Codex 模型发现与回合执行使用同一份原生运行时状态。会话会保留可展示的 Codex reasoning summary 与提供方侧 Agent 活动，轨迹则把每次交互呈现为可检查的行。不发出 interactions 的提供方保持不变。由于该包仍由产物承载，在源码重建替换这一包级流程之前，其运行时实现继续维护在 `lib/types/` 并重新打包进 `lib/index.js`。
