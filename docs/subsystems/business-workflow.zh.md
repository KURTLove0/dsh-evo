# Business workflow

[English](business-workflow.md) | 中文

业务工作流 seam 通过一条记录上的三大能力，把业务诉求变成经过验证的步骤编排：需求澄清、工作流编排、效果验证。与 [workflow](workflow.zh.md) 一样，它是**一个可选能力**而非 agent loop 的一部分；不同之处在于模型从不编写可执行代码 —— 它提交草稿（需求、编排），而记录标识、阶段流转、结构有效性、执行顺序与验收完全由运行时裁判。

Service Definition：[dsh-business-workflow](../../packages/business/business-workflow)（`ctx.businessWorkflows` + 以下词汇）。Service Provider 是 [dsh-business-workflow-local](../../packages/business/business-workflow-local)（内存记录）；面向模型的 Consumer 是 [dsh-tool-business-workflow](../../packages/business/tool-business-workflow)。决策与理由见[业务工作流 Agent Note](../../.agents/notes/implemented/feature/2026-09-21-business-workflow-seam.zh.md)。

来源：seam 词汇位于 [`packages/business/business-workflow/src/types.ts`](../../packages/business/business-workflow/src/types.ts)。

## 阶段联合

一条记录在封闭阶段联合中流转；阶段事件只在变化时发出：

```ts type-equiv
/**
 * Lifecycle stage of one business-workflow record. CLOSED union:
 * `clarifying` = the requirement draft still has gaps; `ready` = the
 * requirement is complete but no composition is accepted; `composed` = a
 * composition passed structural checks; `verified` = verification passed.
 * A requirement revision discards the composition and returns to
 * `clarifying` or `ready`.
 */
type BusinessWorkflowStage = 'clarifying' | 'ready' | 'composed' | 'verified'
```

流转：完整需求 `clarifying`→`ready`；被接受的编排 `ready`→`composed`；通过的验证 `composed`→`verified`；需求修订丢弃编排并回到 `ready`/`clarifying`；失败的再验证将 `verified` 降级为 `composed`。提交是整值替换 —— 需求提交总是替换上一份草稿，被拒绝的编排草稿不替换任何内容。

## 需求词汇

模型每轮澄清提交的内容；缺口分析检查的就是各要素的存在性：

```ts type-equiv
/**
 * A model-authored requirement draft, submitted in full each round (a
 * submission replaces the previous draft, so clarification rounds are
 * idempotent resubmissions rather than patches).
 */
interface RequirementSubmission {
  /** One-sentence summary of the business need. */
  summary: string
  /** The objectives the workflow must achieve. */
  objectives: RequirementObjective[]
  /** The named input fields the workflow consumes. */
  inputs: RequirementDataItem[]
  /** The named output fields the workflow produces. */
  outputs: RequirementDataItem[]
  /** Optional business constraints carried into prompts and reports. */
  constraints?: string[]
  /** The acceptance cases verification runs. */
  acceptanceCases: AcceptanceCase[]
}
```

缺口分析基于存在性且确定性：每个缺失要素（目标、输入、输出、验收用例）一个可执行问题。记录下的规格是可选字段已解析的提交；修订使记录的版本号递增。

## 编排词汇

模型作为编排提交的内容；校验是结构化且确定性的：

```ts type-equiv
/** A model-authored orchestration: steps plus final output bindings. */
interface WorkflowComposition {
  /** The steps, in any order (execution order is the dependency topology). */
  steps: WorkflowStep[]
  /** One binding per requirement output field. */
  finalOutputs: FinalOutputBinding[]
}
```

校验报告封闭联合的缺陷码 —— `STEPS_EMPTY`、`STEP_ID_EMPTY`、`STEP_ID_DUPLICATE`、`DEPENDENCY_UNKNOWN`、`DEPENDENCY_CYCLE`、`IMPLICIT_DEPENDENCY`、`INPUT_NAME_DUPLICATE`、`INPUT_SOURCE_UNKNOWN`、`OBJECTIVE_UNKNOWN`、`OBJECTIVE_UNCOVERED`、`OUTPUT_UNBOUND`、`OUTPUT_NAME_UNKNOWN`、`OUTPUT_DUPLICATE`、`OUTPUT_SOURCE_UNKNOWN` —— 每条携位置与具体整改建议。被拒绝的草稿不改变任何状态。

## 验证报告

静态用例检查门控试运行：按依赖顺序经调用方提供的 runner 对每个验收用例执行全部步骤，再断言绑定的最终输出：

```ts type-equiv
/** The full verification report. */
interface VerificationReport {
  /** The verified record. */
  id: BusinessWorkflowId
  /** Whether every static check and every case passed. */
  passed: boolean
  /** The static checks that ran. */
  staticChecks: StaticCheck[]
  /** One result per acceptance case, in requirement order. */
  caseResults: CaseResult[]
  /** Deterministic repair guidance for every failure. */
  fixHints: string[]
  /** Whether the dry-run executed (static checks passed); a static failure skips it. */
  dryRun: boolean
}
```

通过的报告把记录提升为 `verified`；失败的报告保持或降级为 `composed` 并附修复提示。

## 事件

两个事件都只携带身份数据而非活记录，并以逐监听器隔离派发：

- `business-workflow/stage(info)` —— 一条记录的阶段发生变化，在记录提交之后。
- `business-workflow/verification(info, summary)` —— 一次验证落定，在报告记录完毕且相关阶段流转发布之后。

载荷类型：`BusinessWorkflowInfo`（标识加流转后阶段）与 `VerificationSummary`（passed、caseCount、dryRun）。invariant companion 在事件流上断言流转合法性与验证-阶段一致性。

## 错误码

失败是携带机器可路由错误码的 `BusinessWorkflowError` —— `REQUIREMENT_INVALID`（畸形提交）、`COMPOSITION_INVALID`、`UNKNOWN_WORKFLOW`、`STAGE_VIOLATION`（记录当前阶段不接纳的操作）、`CAPACITY`、`ABORTED` —— 而结构缺陷与验证失败是普通结果，从不是错误。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbusinessworkflows--businessworkflowruntime-abstract-seam"></a>

### `ctx.businessWorkflows` — `BusinessWorkflowRuntime` (abstract seam)

Business-workflow Service Definition contract. Implementations must honor these semantics:

- Submissions are whole-value replacements: a requirement submission replaces the previous draft (revision increments) and discards any accepted composition; a composition submission replaces the accepted composition only when it passes validation. No call mutates a record partially.
- Invalid input throws before any state change; a rejected composition draft leaves the previously accepted composition and stage untouched.
- Stage transitions are exactly: `clarifying`→`ready` (a complete requirement), `ready`→`composed` (an accepted composition), `composed`/`verified`→`ready` (a requirement revision discarding the composition), and `composed`→`verified` (a passing verification). A passing verification of an already-`verified` record records the new report without a stage event.
- Verification awaits its dry-run work, observes the caller signal between steps, and settles a report (never a throw) for assertion and execution failures; only invalid input and cancellation throw.
- Snapshots are fresh objects; events carry identity data, never live records.

```ts cordis-catalog
/**
 * Submit a requirement draft (clarification round) and return the fresh
 * gap analysis. Creating a record and updating one take the same request;
 * the analysis states whether the requirement is complete.
 * @param request - the full replacement draft and, for an update, the record id.
 * @returns the record's stage, revision, remaining gaps, and recorded spec.
 */
abstract submitRequirement(request: RequirementSubmissionRequest): RequirementAnalysis

/**
 * Submit a composition draft and validate its structure. Validation is
 * deterministic (identity, dependency, source, binding, and coverage
 * rules); a rejected draft returns its issues and changes nothing.
 * @param request - the record id and the orchestration draft.
 * @returns the record's stage, the draft's issues, and its step count.
 */
abstract compose(request: CompositionRequest): CompositionOutcome

/**
 * Verify the accepted composition: static case checks always, plus a
 * dry-run through the supplied runner that executes every step per
 * acceptance case and asserts the bound final outputs. Assertion and
 * execution failures settle into the report; only invalid input and
 * cancellation throw.
 * @param request - the record id, an optional step runner, and an optional
 *   cancellation signal.
 * @returns the complete verification report.
 */
abstract verify(request: VerificationRequest): Promise<VerificationReport>

/**
 * Return one record's snapshot.
 * @param id - the record to look up.
 * @returns a fresh snapshot.
 */
abstract get(id: BusinessWorkflowId): BusinessWorkflowSnapshot

/**
 * List every record's snapshot in creation order.
 * @returns fresh snapshots.
 */
abstract list(): BusinessWorkflowSnapshot[]
```

Source: [`packages/business/business-workflow/src/index.ts`](../../packages/business/business-workflow/src/index.ts)

<a id="business-workflow-events"></a>

### `business-workflow/*` events

<a id="business-workflowstage--emit"></a>

#### `business-workflow/stage` — emit

One record's stage changed — clarification closed or reopened, a composition accepted, or verification promoted the record. Paired events carry the same BusinessWorkflowInfo#id; the stage is the value after the transition.

```ts cordis-catalog
/**
 * One record's stage changed — clarification closed or reopened, a
 * composition accepted, or verification promoted the record. Paired
 * events carry the same {@link BusinessWorkflowInfo#id}; the stage is the
 * value after the transition.
 * @param info - the record's identity and post-transition stage.
 * @mode emit
 */
'business-workflow/stage'(info: BusinessWorkflowInfo): void
```

Source: [`packages/business/business-workflow/src/index.ts`](../../packages/business/business-workflow/src/index.ts)

<a id="business-workflowverification--emit"></a>

#### `business-workflow/verification` — emit

One verification settled (pass or fail). Emitted after the report is recorded and any stage transition for it has been published, so an observer reading `stage` sees the promoted state. Paired with the record's earlier stage events by id.

```ts cordis-catalog
/**
 * One verification settled (pass or fail). Emitted after the report is
 * recorded and any stage transition for it has been published, so an
 * observer reading `stage` sees the promoted state. Paired with the
 * record's earlier stage events by id.
 * @param info - the record's identity and current stage.
 * @param summary - the report's headline.
 * @mode emit
 */
'business-workflow/verification'(info: BusinessWorkflowInfo, summary: VerificationSummary): void
```

Source: [`packages/business/business-workflow/src/index.ts`](../../packages/business/business-workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
