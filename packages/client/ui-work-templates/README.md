# @deepseek-ai/dsh-client-ui-work-templates

English | [中文](README.zh.md)

Private template page and optional task-intake controls over [dsh-work-templates](../../business/work-templates/README.md). The sidebar opens saved histories, archive/restore controls, and immutable workflow publication choices.

## Interface

The library displays task and workflow templates separately by kind, including archived history. Selecting an explicit content version preserves its original name and content. Workflow copies require a destination workspace and name; copying creates only an editable draft, with a separate action to open the existing workflow workbench for publication and execution.

Inspection presents task fields and workflow objectives, inputs, and steps before copy controls. The complete JSON definition is available in a collapsed advanced section.

The `work-center.intake.templates` slot belongs to Work Center. This plugin contributes task-template selection, explicit loading into the current brief, saving as a new template or version, and editable code-review/document/data-report examples. Loading replaces task content while retaining the selected executor and workspace and invalidating any preflight preview. Submitted runs retain the source template version. Archive and restore use revision checks; transport retries reuse the same mutation identity.

Authoritative data lives in the React-free runtime manager. Selection controls and unsubmitted labels use a declared view store; they do not survive reload. Host events and reconnect refresh committed data. Disconnects and read/write failures remain visible; loading and failed reads do not claim an empty directory. Successful template reads remain available when workflow choices or examples fail. Execution requires the normal intake checks. The plugin disposes its registrations, listeners, and manager with its fiber.

Unacknowledged mutation and copy requests survive page remounts in the declared view store. Retries of unchanged content retain the original revision and request body even when a commit notification arrives first. An older acknowledgment cannot clear a newer request. Discard-and-refresh starts a new edit intent and does not cancel a submitted host operation.

## Model Experience

Indirectly, through [dsh-work-templates](../../business/work-templates/README.md#model-experience), which retains content for explicitly submitted tasks and independently published workflow copies.

#### KV Cache effect

Rendering, loading draft fields, and template edits do not change model history. Execution owners determine prompts after explicit submission.

## Known Limitations and Deferred Work

- No sharing, offline edits, durable browser drafts, import/export, or automatic execution. Template readiness is checked only after selecting a workspace and executor in task intake; workflow copies use the existing publish/run controls. All content and history capacity limits come from the host.
