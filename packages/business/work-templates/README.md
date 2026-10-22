# @deepseek-ai/dsh-work-templates

English | [中文](README.zh.md)

Private versioned task and workflow templates. The `workTemplates` provider and `workTemplateGateway` Remote consumer retain reusable content separately from execution and human acceptance.

## Content and revisions

Task templates contain a validated structured brief, without an executor, workspace assignment, MCP environment, or connection headers. Workflow templates capture a complete immutable publication and its original workflow/version IDs. Only published definitions are selectable; drafts cannot become workflow templates.

Every content save appends an immutable numbered version. The record revision also counts archive and restore decisions. Writes compare `expectedRevision`; identical `requestId` retries return the original receipt, including after newer saves and host restart. Reusing a request ID for another edit rejects. Archive preserves history and blocks updates or new copies until restored. Task and workflow kinds cannot be exchanged within one history.

`list` returns bounded summaries including archived records; `read` returns detached complete version history without internal mutation hashes. `sources` exposes only workflow names and publication identities. Change notifications occur after durable commits; observer failures do not invalidate acknowledged writes. Teardown drains edits before closing storage.

## Reuse

Task intake loads a selected content version into an editable brief while retaining its explicit template ID/version. Workspace and executor are selected separately. Editing copied content does not rewrite its source version. The agent owner checks dependencies and revision and persists the submitted brief with its run; prompt construction and execution remain with that owner.

`copyWorkflow` delegates an idempotent copy of the pinned publication to the workflow owner. The new independent draft records its source publication and template version and has no publication or run. The operator inspects, edits, publishes, and explicitly starts it through the existing workflow workbench. Edits to the copy do not alter either source. Task examples for code review, document organization, and data-file reports contain editable instructions, not installed capabilities or configured model routes.

## Configuration

Positive integer limits: `maxTemplates` (200 records), `maxVersions` (50 content versions per record), and `maxRecordBytes` (1048576 bytes, minimum 1024, for the complete record, including retained request receipts). Capacity errors reject writes without deleting earlier versions. Storage domain `work_templates` uses format 1 and rejects unrecognized records.

## Model Experience

Indirectly, through [dsh-workbench-agent](../workbench-agent/README.md#model-experience) and [dsh-business-workflow-local](../business-workflow-local/README.md), which log explicitly submitted copied content through their native execution paths.

#### KV Cache effect

Saving, inspecting, archiving, or copying templates does not call a model or change an existing session prefix. Explicit task submission and published workflow execution create their own sessions.

## Known Limitations and Deferred Work

- Private single-host content; no sharing, external imports, secret scanning, automatic capability installation, template export, deletion, or history archival. Expected output paths and task background are user material and can contain sensitive information. Browser task drafts do not survive reload. Workflow reuse creates a draft and requires the original immutable publication to remain available.
