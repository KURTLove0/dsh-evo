# @deepseek-ai/dsh-client-ui-business-workflow

English | [中文](README.zh.md)

Business-workflow surface for dsh web, in two parts. The first-level sidebar entry sits beside New Session: its right-flying panel starts a workflow from one requirement sentence — with no session open, the prompt is staged and flushed into the session the start surfaces — and lists the current session's records with their next click step (continue clarifying, compose, verify, re-verify); the same panel is also reachable from the session header. Every click sends one guided prompt into the session, so the model keeps driving the `business_workflow_*` tools while the durable keyed Chat card — folded from the four `tool-business-workflow/*` session events that [`dsh-tool-business-workflow`](../../business/tool-business-workflow/README.md) records — keeps projecting the outcome: the collapsed row shows the requirement summary, stage, and step count, and expanding it lists the open clarification questions, structural issues, the step board, and the verification report with every case's outcome. The step board renders the accepted composition as a left-to-right node-edge canvas (dependency layers, arrowed edges), with each node's dot showing its standing in the latest verification's dry-run trace. Replay rebuilds both from the log alone.

## Model Experience

None, as this package renders durable session records for a human and touches no prompt, message, schema, stream, or tool result. The model's own view of the same workflows stays with `dsh-tool-business-workflow`.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Clicks drive through guided prompts** — the panel never calls the runtime directly; it sends one user message per click, and the model issues the tool call, so a click queued behind a running turn takes effect when that turn settles.
- **The board is read-only** — no drag, zoom, or inline editing; layout is a deterministic dependency layering, so the same log always draws the same canvas.
- **`ready` reads as `composed` on the card** — the two-stage distinction between "requirement complete" and "composition accepted" collapses to one node status there; the header panel's list keeps the exact four-stage word.
