# dsh-client-ui-workbench-agent

English | [中文](README.zh.md)

The workbench **Agents** page manages independent collaborators through [dsh-workbench-agent](../../business/workbench-agent/README.md). It does not read, copy, select, or edit Agent presets.

## Interface

Search names, descriptions, and skills; filter available, working, queued, or archived identities, and sort by name or latest edit. The workload summary shows available identities, running and queued tasks, and host availability. Each identity displays running tasks against its concurrency limit. Create a blank identity, edit its name, avatar text, description, instructions, local runtime service, its model override, reasoning effort, skills, concurrency, and up to three conversation starters. Drafts preserve their original revision across notifications, so another editor's save produces a conflict rather than an overwrite. Save errors retain the draft. Closing an edited form asks whether to discard changes or continue editing.

Selecting an identity opens a full-width profile; the Agents breadcrumb returns to the filtered directory. The header shows its name, description, availability, model selection, runtime, and concurrency, with assignment, edit, duplicate, and archive actions. Overview separates current work from the ten most recent settled records. Work, instructions, Skills, MCP, and settings have separate keyboard-accessible tabs. The sidebar summarizes the saved configuration and selected capabilities.

Create and edit dialogs group identity, instructions, Skills, MCP, and runtime settings in one form. Section navigation scrolls to the relevant fields; all fields remain mounted for native validation and one atomic Save. A live identity preview, sticky title, scrollable content, and persistent Save and Cancel actions fit the viewport. Navigation and fields stack on narrow screens.

The thirty-day summary uses retained runs created during the current and preceding 29 local calendar days. Success rate divides completed runs by settled runs, including failed, cancelled, and interrupted runs; active and queued runs are excluded from the denominator. Average duration uses settled runs with nonnegative start/end measurements. Unavailable rates and durations display a dash. The activity chart counts retained submissions by local day; it does not claim executions omitted from retained history.

The skill picker discovers user-invocable project and runtime skills for the selected source workspace, supports search and refresh, and retains selections missing from that workspace for explicit removal. The source workspace selects the discovery catalog; each task still chooses its execution workspace. Explicit skill-name entry remains available. The MCP editor adds named stdio or Streamable HTTP services, argument arrays, environment variables, and headers. Values are masked in inputs and persisted only on Save. These capabilities are available during initial creation and later editing.

Task text and workspace selection stay with each identity across navigation and page remounts within one loaded application. A successful task submission clears only that identity’s task text; a rejected submission preserves it. Selecting a starter fills the task composer without submitting work. Choose a workspace and submit a task, or describe an agent and request **Build with AI**. AI results open as editable drafts and require Save. The run tab sorts newest first, filters by work type and execution status, and searches task text, errors, or workspace names. Records distinguish tasks from configuration design, display workspace and submitted/start/end timestamps, and expose captured configuration, errors, transcript links, Stop, and Retry. Captured instructions, model selection, skills, and concurrency remain independent of later identity edits. Retry is disabled while the runtime is unavailable. New submissions clear history filters so the submitted record stays visible. Duplication creates an independent identity. Archiving confirms cancellation of unfinished work and preserves history; archived identities can be restored.

The React-free directory manager owns host data and coalesces live notifications and reconnect reads. Entry-declared state retains viewing choices and unsaved drafts. Slot registrations, event listeners, and directory publication unwind on plugin disposal.

The execution card pairs a local runtime selector with its model selector. Local services and native defaults come from the same provider directory as Runtimes. Changing services clears the model override, and an unavailable or removed service cannot silently fall back to a global provider. Catalog loading, failure, retry, and empty states remain explicit.

## Model Experience

Indirectly, through submitted tasks and design requests handled by the independent host workbench-agent service.

#### KV Cache effect

The browser does not assemble model requests; the host service owns each independent task or design session's prefix.

## Known Limitations and Deferred Work

- Runtime selection is limited to registered local services on the current host; remote machine execution and multi-user settings are not offered.
- Optional explicit skill names and reasoning effort are edited as text. Models are selected from the chosen local service’s advisory catalog.
