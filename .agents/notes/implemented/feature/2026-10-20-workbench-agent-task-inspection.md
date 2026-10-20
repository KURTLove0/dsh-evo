# Agent Note: Workbench agent task inspection and draft ownership

Status: implemented

English | [中文](2026-10-20-workbench-agent-task-inspection.zh.md)

## Problem

Assigning work among independent identities requires visibility into queued work and a reliable association between the selected identity and unsent task text. Inspecting an older run against the identity's current instructions can also misrepresent what executed.

## Decision

The workbench-agent browser plugin owns task text and workspace selections keyed by stable agent id in its remount-surviving view store. Submission clears only the submitted identity's text after the host acknowledges persistence. Failed submission retains it. Inputs are disabled during an operation, so a late acknowledgement cannot clear newly typed text. Application reload discards these browser drafts. Configuration edits retain their opening definition for dirty-state comparison; closing a modified editor requires explicit discard or returns to the same draft.

Directory workload derives from committed host counts, including queued-only identities. Status and text filters operate on recorded runs. Configuration disclosure reads the definition captured on the run, including its revision and instructions, independently of later edits. The browser displays the captured model selection; a system-default selection does not claim to identify the resolved execution model. New submissions reset history filters to expose the new record. These views reuse the existing service without adding durable data or changing execution policy.

Directory selection opens an independent profile with capability panels and a configuration sidebar. The breadcrumb returns to the preserved directory filters. Overview separates active work from ten recent settled records; the work panel exposes the complete retained history. Thirty-day statistics derive from retained submissions in local calendar days, rather than a second metrics store. Missing measurements remain unavailable, and the interface does not invent ownership, permissions, provider connectivity, or external runtime support.

The creation form keeps all capability fields mounted under section navigation. Native validation can focus any invalid field, and one Save commits the complete definition. Navigation scrolls within the form instead of introducing partial saves or a second draft owner.

## Alternatives considered

**One shared task composer.** Keeping text while changing the recipient makes accidental assignment possible and cannot retain different workspace selections for different collaborators.

**Current configuration in history.** Looking up the latest identity configuration is convenient but gives incorrect context when instructions or skills change after execution.

**Persist browser drafts on the host.** Durable drafts require storage, synchronization, and conflict semantics for text that has not been submitted. The current consumer needs navigation retention within one loaded application, which the view store already provides.

**Independent saves for capability tabs.** Saving instructions, skills, and MCP separately exposes intermediate configurations and complicates revision conflicts. One draft and one Save preserve atomic configuration updates while section navigation makes the complete form manageable.

## Consequences

Users can find collaborators by skill and inspect workload and historical configuration without opening each transcript. Drafts remain local to the loaded application. History search includes only the selected identity's retained runs; resolved model details and full execution output remain in the transcript.

## Verification

Component tests cover queued-only discovery, sorting, skill search, isolated task/workspace drafts, failed submissions, captured instructions, and history filters. The keyless workbench browser scenario boots the shipped composition, creates and copies identities, submits a task with an unavailable skill, and snapshots directory output, captured configuration, and filtered history. The unavailable skill fails before a model request; this scenario does not validate model execution.

Profile tests cover keyboard panel navigation, task focus, editor section navigation, work-type filters, recent-history limits, and measured statistics. The business-agent browser scenario checks the profile header and MCP panel, traverses capabilities, and verifies narrow-screen overflow through the shipped application.
