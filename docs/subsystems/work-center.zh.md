# 工作中心

[English](work-center.md) | 中文

[work-center 提供方](../../packages/business/work-center/README.zh.md)聚合由不同服务持有的智能体和工作流执行，并持久化人工验收。[浏览器消费方](../../packages/client/ui-work-center/README.zh.md)提供结构化任务提交与待处理导航。执行与人工验收是独立事实。

## 来源目录

`WorkReference` 用 `agent` 或 `workflow` 区分品牌化运行标识。`WorkQuery` 要求分页数量，提供可选工作区／来源／状态筛选与当前连接观察到的 `attentionSessionIds`，以及属于同一查询和来源代次的 `WorkCursor`。`WorkItem` 连接脱敏来源摘要、`needsAttention` 和可选验收摘要。待处理优先，其余按执行更新时间倒序；变更会使旧续页失效。`WorkPage` 返回已加载记录、观察时间、明确来源失败和可选续页。`WorkExecutor` 提供修改任务预览所需配置，不包含 MCP 环境变量或请求头的值。

[智能体服务](workbench-agent.zh.md)拥有 `TaskBrief`、`TaskRequestId`、`TaskPreflight`、`AgentRunQuery` 和 `AgentRunPage`。[工作流服务](business-workflow.zh.md)拥有 `WorkflowRequestId`、`WorkflowRunQuery` 和 `WorkflowRunPage`。两者均在分页前筛选，并提供单次运行检查。

## 交付验收

`WorkDetail` 连接来源身份、执行状态、可选提交简报与脱敏配置、已记录交付的可用性，以及最新验收。`DeliverySnapshot` 包含由内容计算的 `DeliveryVersion`、已记录文本输出、提交标准、可选工作流断言和 `DeliveryArtifact` 记录。已捕获文件保存检查时的字节与指纹；不可用文件保存错误。

`DeliveryReview` 保存来源、精确交付、单调递增修订号、幂等 `ReviewDecisionId`、决策、意见、操作者归属和时间。原子存储记录保留该运行的全部决策。执行成功与人工验收通过不能互相替代。

`WorkCommand` 区分验收、明确创建智能体／工作流修改任务和完整重试，以及针对精确尝试的工作流决策。`WorkReceipt` 返回被验收或新提交的来源及可选验收修订号。只保存验收的命令不会执行新任务。证据、持久化、容量、冲突和修改任务提示词准备详见[提供方 README](../../packages/business/work-center/README.zh.md)。

## 失败证据

`WorkDiagnosis` 包含带类型来源、状态、观察时间、`DiagnosticSource` 可用性、`DiagnosticFinding` 观察及 `WorkRetryPreview`。`DiagnosticCategory` 根据已记录机器码或结束原因分类，未知文字保持未知。条目区分终止运行／轮次证据与工具、模型尝试、节点及断言的失败观察。来源引用保留精确会话／事件或节点区间信息。完整重试命令保留调用方请求标识，由执行所有者验证准入。容量限制与完整重试语义见[提供方](../../packages/business/work-center/README.zh.md#diagnosis-and-full-retry)。

## 运行范围

`WorkStatisticsQuery` 选择提交时间范围、IANA 时区、工作区、来源、带来源类型的 `WorkStatisticsExecutor` 及显式用量读取方式。`WorkStatisticsReport` 保留已提交查询、独立可用来源、汇总 `WorkStatisticsCounts`、三个 `WorkStatisticsGroup` 维度，以及尝试读取会话的上限。`WorkDurationSamples` 在时长总和之外保留样本数；`WorkUsageCoverage` 将已读取、不可用及未完整检查的运行与提供方报告分开。`WorkStatisticsChoices` 提供安全执行者标识。范围、时间及完整性语义见[提供方](../../packages/business/work-center/README.zh.md#run-statistics)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkcenter--workcenter-abstract-seam"></a>

### `ctx.workCenter` — `WorkCenter` (abstract seam)

Execution facts remain owned by their source services.

```ts cordis-catalog
/**
 * Aggregate a bounded submission-time cohort across execution owners.
 * @param request - date/time zone, workspace, executor, and explicit usage-read choice.
 * @returns counts and measurement coverage, with independent source failures.
 */
abstract statistics(request: WorkStatisticsQuery): Promise<WorkStatisticsReport>

/**
 * Read safe executor filter choices without loading their history or credentials.
 * @returns source-qualified identities and explicit directory failures.
 */
abstract statisticsChoices(): Promise<WorkStatisticsChoices>

/**
 * Merge bounded source pages with attention first, then latest execution updates.
 * @param request - explicit page limit and optional source/workspace scope.
 * @returns detached records, source failures, and an owned continuation.
 */
abstract query(request: WorkQuery): Promise<WorkPage>

/**
 * Read captured delivery evidence for one execution.
 * @param ref - typed original execution identity.
 * @returns detail, optional delivery, and review; unavailable evidence stays explicit.
 */
abstract detail(ref: WorkReference): Promise<WorkDetail>

/**
 * Read source execution metadata without inspecting transcripts or files.
 * @param ref - typed source execution.
 * @returns original execution identity, workspace, session, name, and status.
 */
abstract source(ref: WorkReference): Promise<WorkSource>

/**
 * Read one immutable committed human assessment without rereading its source.
 * @param ref - reviewed execution identity.
 * @param revision - exact committed review revision.
 * @returns detached retained assessment and its original captured bytes.
 */
abstract review(ref: WorkReference, revision: number): Promise<DeliveryReview>

/**
 * Inspect stable failure codes and original recorded evidence without executing work.
 * @param ref - original typed execution identity.
 * @returns bounded timestamped findings and explicit unavailable sources.
 */
abstract diagnose(ref: WorkReference): Promise<WorkDiagnosis>

/**
 * Record an assessment or explicitly request subsequent work.
 * @param command - revisioned decision or explicit source action.
 * @returns the committed reviewed or newly created execution identity.
 */
abstract command(command: WorkCommand): Promise<WorkReceipt>

/**
 * Read executor choices and configuration without connection credentials.
 * @returns committed identity names, revisions, archive flags, and runtime IDs.
 */
abstract executors(): Promise<WorkExecutor[]>

/**
 * Read deployment-selected directory paging settings.
 * @returns the explicit page size used by browser consumers.
 */
abstract options(): { pageSize: number }

/**
 * Prepare the exact revision brief including committed feedback and original output.
 * @param request - source assessment revision and editable task fields.
 * @returns the brief used by the subsequent explicit revision command.
 */
abstract revisionBrief(request: Pick<Extract<WorkCommand, { kind: 'revise-agent' }>, 'ref' | 'reviewRevision' | 'brief'>): Promise<TaskBrief>
```

Types: [TaskBrief](workbench-agent.zh.md)

Source: [`packages/business/work-center/src/service.ts`](../../packages/business/work-center/src/service.ts)

<a id="work-center-events"></a>

### `work-center/*` events

<a id="work-centerchanged--emit"></a>

#### `work-center/changed` — emit

A human delivery assessment committed.

```ts cordis-catalog
/**
 * A human delivery assessment committed.
 * @mode emit
 * @param ref - reviewed source execution.
 */
'work-center/changed'(ref: WorkReference): void
```

Source: [`packages/business/work-center/src/types.ts`](../../packages/business/work-center/src/types.ts)
<!-- END GENERATED cordis-surface -->
