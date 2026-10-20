# 工作台智能体

[English](workbench-agent.md) | 中文

独立工作成员身份和执行历史由 [dsh-workbench-agent](../../packages/business/workbench-agent/README.zh.md) 持有；浏览器消费者是 [ui-workbench-agent](../../packages/client/ui-workbench-agent/README.zh.md)。插件预设仍是部署持有的组装，与工作成员身份分开。

`WorkbenchAgents.snapshot()` 读取目录、工作负载、运行时可用性、并发限制和所选历史。`command()` 提供创建、版本校验保存、复制、归档、恢复、任务提交、配置草稿设计、停止与重试。后续编辑不改变执行记录的身份和捕获配置。原生提供方持有持久化、调度、会话日志与卸载过程。

## WorkbenchAgentId

稳定且带品牌类型的工作成员身份，与预设标识分开。

## AgentRunId

单次任务或配置设计请求的品牌标识。

## AgentDefinition

可编辑的名称、头像、仅展示简介、指令、原生运行时、可选模型路由和推理级别、技能名、最多三个带标题开场提示及正数并发上限。

## WorkbenchAgent

在 AgentDefinition 上增加稳定标识、版本、归档标志及创建和更新时间。编辑比较期望版本，复制产生另一身份。

## AgentRun

包含任务文本、所属身份、工作区和会话标识、时间、状态，以及可选配置快照、错误、重试来源、设计用途和生成草稿。状态包括排队、执行中、完成、失败、取消或中断。

## AgentCommand

创建和保存接收配置；复制提供新名称；归档和保存要求版本；执行和设计提供工作区与请求；停止和重试引用既有执行。

## AgentReceipt

已提交的智能体标识和可选执行标识。回执表示持久化完成，不表示执行完成。

## AgentDirectory

已提交身份、所选执行历史、各身份执行中和排队数量、原生运行时可用性，以及实际并发默认值和限制。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkbenchagents--workbenchagents-abstract-seam"></a>

### `ctx.workbenchAgents` — `WorkbenchAgents` (abstract seam)

Providers commit mutations before notifying directory consumers.

```ts cordis-catalog
/**
 * Read identities, workload, and one identity's history.
 * @param id - omit to read only directory and workload.
 * @returns detached committed data.
 */
abstract snapshot(id?: WorkbenchAgentId): Promise<AgentDirectory>

/**
 * Manage identities or submit, retry, or cancel a task.
 * @param command - operation with an expected revision for edits.
 * @returns committed identities; execution remains host-owned.
 */
abstract command(command: AgentCommand): Promise<AgentReceipt>
```

Source: [`packages/business/workbench-agent/src/service.ts`](../../packages/business/workbench-agent/src/service.ts)

<a id="workbench-agent-events"></a>

### `workbench-agent/*` events

<a id="workbench-agentchanged--emit"></a>

#### `workbench-agent/changed` — emit

A directory record or execution status committed.

```ts cordis-catalog
/**
 * A directory record or execution status committed.
 * @mode emit
 * @param id - affected stable agent identity.
 */
'workbench-agent/changed'(id: WorkbenchAgentId): void
```

Source: [`packages/business/workbench-agent/src/types.ts`](../../packages/business/workbench-agent/src/types.ts)
<!-- END GENERATED cordis-surface -->
