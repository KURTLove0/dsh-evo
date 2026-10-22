# 持久工作触发

[English](work-triggers.md) | 中文

[Work Triggers](../../packages/business/work-triggers/README.zh.md) 负责主机持久规则、保留的原生交接、来源观察及应用内通知确认。会话内 [Schedule](schedule.zh.md) 保留独立的对话提醒所有权。

默认 Web 组合挂载提供方、生成的 Remote 及[浏览器控件](../../packages/client/ui-work-triggers/README.zh.md)。原生智能体及工作流服务负责执行、权限、日志及人工审批。[F09 产品提案](../../.agents/notes/proposed/feature/2026-10-20-outcome-oriented-workbench-product.zh.md#f09-durable-work-triggers) 负责产品范围。

准备操作返回原任务内容及当前智能体版本，或原正式工作流的发布版本及输入。它不接纳执行；创建时重新检查就绪状态。

## 数据类型

`WorkTriggerId`、`TriggerOccurrenceId` 及 `TriggerNoticeId` 是独立的品牌化身份。`TriggerDefinition` 组合名称、`TriggerRule` 及 `TriggerTarget`。规则选择 `at`、带明确首次时刻和间隔的 `every`，或带来源类型执行引用的 `on-settled`。目标指定工作空间，以及执行者／修订／任务说明，或工作流／发布版本／JSON 输入。

`WorkTrigger` 保留固定定义、控制修订、启用标志、创建与更新时间、可选下一名义时刻及 `TriggerOccurrence` 历史。每次触发记录到期及保留时间、跳过间隔、尝试次数、`TriggerAdmission` 及通知。交接分为待处理、未确认、带原生执行的已接纳，以及带 `TriggerTerminalStatus` 的已结束。`TriggerObservation` 为来源读取加时间；元数据不可用不以虚构终态替代它。`TriggerNotice` 记录历史不确定性或终态，并可保留首次读取时间。

`TriggerQuery` 选择文本、工作空间及启用状态。`TriggerSummary` 排除完整输入及历史，保留控制状态、最近触发及未读数；消耗状态描述单次规则，与触发结果独立。`TriggerDirectory` 增加观察时间和当前进程工作器失败。`TriggerOptions` 公布轮询、最短间隔及历史条数。`TriggerCommand` 与 `TriggerReceipt` 携带各操作需要的创建身份、控制修订、触发尝试或通知身份。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworktriggers--worktriggers-abstract-seam"></a>

### `ctx.workTriggers` — `WorkTriggers` (abstract seam)

Durable triggers require a running host, independently of browser and session lifetime.

```ts cordis-catalog
/**
 * Read deployment-selected polling and interval bounds.
 * @returns limits without observing files, sessions, or execution state.
 */
abstract options(): TriggerOptions

/**
 * Prepare a fixed target from an original execution without starting work.
 * @param source - exact original agent or formal workflow execution.
 * @returns original content and current agent revision, or the original workflow publication.
 */
abstract prepare(source: WorkReference): Promise<Pick<TriggerDefinition, 'name' | 'target'>>

/**
 * Query retained metadata and process-local worker failures.
 * @param request - explicit text and optional workspace/enabled filters.
 * @returns bounded detached metadata; no source reads occur.
 */
abstract query(request: TriggerQuery): Promise<TriggerDirectory>

/**
 * Inspect one immutable definition, occurrences, and in-app notices.
 * @param id - trigger identity.
 * @returns detached committed state, excluding private native submission identities.
 */
abstract read(id: WorkTriggerId): Promise<WorkTrigger>

/**
 * Create, pause/resume, recover an uncertain handoff, or acknowledge one notice.
 * @param request - caller identity, control revision, or exact occurrence attempt.
 * @returns a committed receipt; stale revisions reject without another admission.
 */
abstract command(request: TriggerCommand): Promise<TriggerReceipt>
```

Types: [WorkReference](work-center.zh.md)

Source: [`packages/business/work-triggers/src/service.ts`](../../packages/business/work-triggers/src/service.ts)

<a id="work-trigger-events"></a>

### `work-trigger/*` events

<a id="work-triggerchanged--emit"></a>

#### `work-trigger/changed` — emit

A trigger, occurrence, or notice has committed.

```ts cordis-catalog
/**
 * A trigger, occurrence, or notice has committed.
 * @mode emit
 * @param id - trigger whose retained data changed.
 */
'work-trigger/changed'(id: WorkTriggerId): void
```

Source: [`packages/business/work-triggers/src/types.ts`](../../packages/business/work-triggers/src/types.ts)
<!-- END GENERATED cordis-surface -->
