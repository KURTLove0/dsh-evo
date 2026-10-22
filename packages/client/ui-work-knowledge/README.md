# @deepseek-ai/dsh-client-ui-work-knowledge

English | [中文](README.zh.md)

Knowledge directory page and sidebar entry over the generated `workKnowledgeGateway`. The page uses the existing cyber workbench tokens and shared workspace projection. [Work Knowledge](../../business/work-knowledge/README.md) owns file grants, immutable captures, current access checks, literal retrieval, and citation validation.

## Source management and citations

Select one workspace and enter a project-relative file path. Adding explicitly enables that source; indexing is a separate action. The page shows grant state, successful versions, the latest completed attempt, and failures without replacing earlier captures. Disable/re-enable and indexing pin the source revision. Source selection and metadata refresh do not read file content.

Literal search uses the latest enabled captures and the advertised hit limit. Hits retain exact source/version/digest/line citations; exclusions and current-file differences remain separate. Selecting a version and inclusive line range explicitly reads captured text. HTML and code are inert text nodes. Copying a citation serializes the path and all immutable citation fields; it neither starts a task nor injects material into an existing conversation.

The [runtime manager](../runtime/README.md) owns metadata, search, preview, read generations, and one uncertain command. Workspace, connection, grant commands, and metadata refresh clear retrieved content. Reconnect refreshes metadata without repeating a search, citation read, or command. The page disables new commands until a prior uncertain operation is resolved or locally cleared. Retrying preserves registration/index identity and expected revision; a grant retry can report a revision conflict, requiring an authoritative refresh and inspection. Clearing local uncertainty never revokes server data.

## Lifetime and accessibility

Draft inputs and uncertain commands survive page remounts for the plugin lifetime. Full reload loses local pending input; committed source metadata and captures remain queryable from the Host. No project text or paths are persisted by this package in browser storage. The page is bilingual, uses the existing light/dark schemes, exposes labelled keyboard controls with visible focus, and stacks its source/reader layout on narrow screens. Clipboard failure keeps the selectable citation visible.

The Host entry contributes no behavior. Page/navigation slots, locale dictionaries, connection observers, and manager publication belong to the client plugin and are released on unload. The feature remains optional in other compositions; the Web bundle mounts its provider, tools, and page by default.

## Model Experience

None, as this plugin manages grants and explicitly reads/copies inert source material without registering tools, submitting prompts, or changing session context. The separately mounted knowledge tools own logged model consumption.

#### KV Cache effect

The page does not call a model or rewrite a session prefix. User-pasted citations participate only in a later explicit prompt.

## Known Limitations and Deferred Work

- Private single-Host knowledge sources, with server-owned complete-value bounds. No recursive file selection, document conversion, external knowledge providers, automatic background indexing, semantic ranking, source deletion, or sharing. A current missing/unreadable file prevents historical content reads. Full reload requires inspecting committed state before issuing a new operation whose earlier acknowledgment was lost.
