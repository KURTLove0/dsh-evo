# @deepseek-ai/dsh-client-ui-work-center

English | [中文](README.zh.md)

Work Center page and sidebar entry over [dsh-work-center](../../business/work-center/README.md). Independent agents and published workflows retain their existing owners.


Work Center declares the optional `work-center.delivery.triggers` list slot beside delivery. A trigger plugin receives the selected original execution and disabled state; its explicit preparation action opens the trigger page without adding another intake form.

## Interface

The page groups pending conversation approvals, questions, plan reviews, and paged workflow confirmations. Conversation items open their original session; workflow decisions use the selected waiting attempt. The inbox describes the currently connected sessions and loaded workflow page, not a global complete count. Disconnection and source errors stay visible.

Source, workspace, and execution-state filters apply before directory pagination. Pending tasks and workflow confirmations precede other execution updates. Each row labels creation and committed execution-update times; last-read time describes the directory observation only. Changes in the known pending-session set refresh pagination. Execution and human-review states appear separately. Opening a run shows recorded output, submitted criteria, workflow assertions, inspection-time file snapshots, and saved assessment evidence. Content renders as text; binary evidence is not executed or embedded.

New tasks choose an explicit executor and workspace, then collect goal, background, expected file paths, acceptance criteria, and constraints. Check and preview reads dependencies and the exact canonical task prompt without execution. MCP connections remain unchecked until execution. Changes invalidate the preview; submission requires its executor revision. Drafts survive page remounts within the application but not reload. Closing retains the draft; clearing is explicit. Idempotent request IDs survive transport retries until the draft changes or submission is acknowledged.

Acceptance and requested changes save independent human decisions. Requested changes require feedback. Saving does not run anything. An agent revision opens an editable brief and displays original versus current sanitized executor configuration. A workflow revision has a separate confirmation and reruns its original publication and inputs. Review-time evidence remains inspectable after files change. Operations require a live connection.

The page uses shared semantic theme tokens, visible keyboard focus, coarse-pointer targets, and stacked narrow-screen layouts. There are no package configuration fields; paging settings come from the host.

Work Center declares the optional `work-center.intake.templates` list slot. A separately mounted template plugin can save and load briefs; loading invalidates preview and preserves the explicit executor and workspace choices. Recorded task briefs can be copied into the new-task form without executing them.

Diagnosis is read explicitly for the selected execution. The report displays original evidence, exact codes, source sessions, node intervals, and unavailable sources. Refreshes, source changes, and reconnect mark retained reports stale without automatically reading evidence. Repair buttons open existing model, runtime, capability-check, or workflow pages. Full retry previews the captured and current sanitized configuration and warns about side effects. Confirmation retains its request across page remounts and selection changes. A lost acknowledgment requires explicit recovery of that exact request; reconnect never resubmits it. Drafts do not survive a full application reload.

Work Center also declares `work-center.delivery.artifacts`: optional registrants receive the selected execution, its committed reviews, and the disabled state. [Project Artifacts](../ui-work-artifacts/README.md) owns the capture controls and directory; absent contributions leave delivery inspection available.

## Model Experience

Indirectly, through [dsh-workbench-agent](../../business/workbench-agent/README.md#model-experience) and [dsh-work-center](../../business/work-center/README.md#model-experience), which own task prompt construction and explicit revision execution. Rendering, filtering, and saving reviews do not call a model.

#### KV Cache effect

The host execution owners determine new-session prompts. Browser viewing state does not modify existing request prefixes.

## Known Limitations and Deferred Work

- No offline submission, cross-host directory, team identity, export, or durable browser drafts. Conversation pending items depend on the current connection. File evidence is captured at inspection time rather than execution time. The host's evidence and history bounds apply.
