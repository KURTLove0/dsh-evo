# dsh-client-ui-workbench-agent

English | [中文](README.zh.md)

The workbench **Agents** page manages independent collaborators through [dsh-workbench-agent](../../business/workbench-agent/README.md). It does not read, copy, select, or edit Agent presets.

## Interface

Search names and descriptions; filter available, working, or archived identities. Create a blank identity, edit its name, avatar text, description, instructions, native runtime, model, reasoning effort, skills, concurrency, and up to three conversation starters. Drafts preserve their original revision across notifications, so another editor's save produces a conflict rather than an overwrite. Save errors retain the draft.

Create and edit dialogs fit the viewport, with a scrollable form and persistent Save and Cancel actions. Fields use a single column on narrow screens.

Selecting a starter fills the task composer without submitting work. Choose a workspace and submit a task, or describe an agent and request **Build with AI**. AI results open as editable drafts and require Save. The run tab shows actual queued, running, completed, failed, cancelled, and interrupted records, captured revision, errors, transcript links, Stop, and Retry. Duplication creates an independent identity. Archiving confirms cancellation of unfinished work and preserves history; archived identities can be restored.

The React-free directory manager owns host data and coalesces live notifications and reconnect reads. Entry-declared state retains viewing choices and unsaved drafts. Slot registrations, event listeners, and directory publication unwind on plugin disposal.

## Model Experience

Indirectly, through submitted tasks and design requests handled by the independent host workbench-agent service.

#### KV Cache effect

The browser does not assemble model requests; the host service owns each independent task or design session's prefix.

## Known Limitations and Deferred Work

- The shipped runtime is Harness on the current host; unsupported external runtime and multi-user settings are not offered.
- Skill names and model routing fields are edited as text. Execution resolves them against the selected workspace and deployment capabilities.
