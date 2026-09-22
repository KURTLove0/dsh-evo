# @deepseek-ai/dsh-tool-business-workflow

English | [中文](README.zh.md)

The model-facing business-workflow tools over `ctx.businessWorkflows` (`@deepseek-ai/dsh-business-workflow`): `business_workflow_clarify` (requirement clarification), `business_workflow_compose` (orchestration generation), and `business_workflow_verify` (effect verification). The tools own the model-facing schemas, descriptions, and result rendering; record identity, gap analysis, structural validation, execution ordering, and acceptance assertion live behind the seam, so a different runtime swaps in without touching what the model sees. The verification dry-run delegates each step to a fresh subagent through `ctx.subagents` (provider configurable, default `spawn`).

## Tools

- `business_workflow_clarify` — submit the complete requirement draft; the result carries the record's id, stage, revision, remaining gaps as actionable questions, and the recorded spec once complete. Provide `workflow_id` to update a record (a revision discards its composition).
- `business_workflow_compose` — submit the step orchestration; the result either reports acceptance (stage and step count) or every structural issue with its remedy, replacing nothing.
- `business_workflow_verify` — run the acceptance-case dry-run; the result carries static checks, each case's outcome with a step-by-step trace, and fix hints. A failing verification is an ordinary result, not a tool error.

## Config

- `toolNamePrefix` (default `business_workflow`) — the prefix for the three tool names; an empty string fails at load.
- `subagentProvider` (default `spawn`) — the subagent provider the dry-run delegates steps to; an empty or untrimmed string fails at load.
- `maxResultChars` (default 50000) — rendered-result ceiling; longer text is truncated with a notice.

Presentation is an args-only generic card per tool (title plus the requirement summary, step count, or workflow id).

## Usage policy

The tool registers one prompt section (`tool:<prefix>`, order 116): use the three tools when the user wants a business workflow built or changed, resolve reported gaps with the user, fix reported structural issues, and only present the workflow as done once verification passes.

## Model Experience

### Tool schemas (clarify, compose, verify)

#### What the model sees

Three tool schemas registered on `ctx.tools` under the configured prefix, with the verbatim descriptions in the source (`CLARIFY_DESCRIPTION`, `COMPOSE_DESCRIPTION`, `VERIFY_DESCRIPTION`); the anchored [`business_workflow_clarify`/`_compose`/`_verify` entries](../../../docs/tool-catalog.md#deepseek-aidsh-tool-business-workflow) in the generated [tool catalog](../../../docs/tool-catalog.md) carry the complete schemas and metadata contract. `toolNamePrefix` renames the definitions without changing them.

#### Token effect

Conditional: the three schemas and the prompt section join prompt assembly only while this plugin is loaded; they are fixed-size, independent of record count.

#### KV Cache effect

Append-only: schema and section text are stable per process lifetime; changing `toolNamePrefix`, `subagentProvider`, or a description invalidates the assembled prefix for every subsequent request.

### Verification results

#### What the model sees

Each tool result's rendered text: the stage line and gap list (clarify), the acceptance or issue list (compose), and the full verification report with traces and fix hints (verify), each capped at `maxResultChars`.

#### Token effect

Bounded per call by `maxResultChars`; step trace details are additionally capped at the runtime's `maxTraceChars`.

#### KV Cache effect

Replacing: each tool result appends to the turn, and a verification report replaces nothing earlier but grows the log by its capped size.

## Known Limitations and Deferred Work

- **No durable session record** — the tools project results through the tool pipeline only; unlike `dsh-tool-workflow`, no `tool-workflow/*` session events are written, so a UI cannot replay a business-workflow history from the session log yet.
- **Dry-run delegation is synchronous per step** — each step awaits its subagent to completion inside the tool call; background or parallelized verification execution is deferred.
