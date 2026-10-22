# Agent Note: Private versioned work templates

Status: implemented

English | [中文](2026-10-21-private-work-templates.zh.md)

## Problem

Accepted deliveries and successful workflow publications are reusable approaches, but copying their current editor state loses the exact source and can silently reuse a changed definition. Template edits must not rewrite submitted task briefs or immutable workflow runs.

## Decision

[Work Templates](../../../../packages/business/work-templates/README.md) owns a separate bounded storage domain containing complete immutable content versions and revisioned archive state. Task templates retain structured briefs without executor connection settings. Workflow templates retain complete publications and their source IDs. The [browser plugin](../../../../packages/client/ui-work-templates/README.md) owns library presentation and contributes optional task controls through a Work Center declared slot.

Content versions and record revisions differ: saving appends content; archive and restore advance revision without changing earlier content. Retained request hashes and receipts make identical writes replayable after later edits and restart. Capacity errors preserve history. Commit observers cannot invalidate an acknowledged write.

Task loading copies content into an editable draft, retains its template/version reference, and invalidates readiness. Workspace and executor remain explicit choices. The native agent owner persists this source with the brief and checks actual submission. Sharing a public brief decoder avoids competing submission and template validation rules.

Workflow reuse creates an independent unpublished draft through its execution owner. One durable write retains the exact source publication, template version, creation name, and request identity. Editing the copy does not invalidate a retry of the original creation request. Publication and execution remain explicit existing operations. Saving feedback, saving templates, loading drafts, and creating workflow copies perform no model work.

## Consequences

Captured browser retry requests retain their original revision across commit notifications and page remounts. Only an acknowledgment for that request clears it; explicit discard begins a new edit without cancelling host work.

The source services retain execution authority. Template examples are editable instructions and cannot claim that a runtime, skill, or filesystem capability is ready. Private template history contains user material and follows the same local access assumptions as task briefs. Original immutable workflow publications remain required for workflow copying; external imports, sharing, secret scanning, and automatic capability installation are separate capabilities.

The [outcome-oriented product proposal](../../proposed/feature/2026-10-20-outcome-oriented-workbench-product.md) retains later health, diagnostics, statistics, delivery, scheduling, remote, and team proposals. The [Work Center decision](2026-10-20-work-center-intake-and-review.md) continues to own submission and independent acceptance; template storage does not supersede it.

## Verification

Storage tests pin immutable versions, concurrent edit rejection, global request identity conflicts, replay after restart, archive/restore behavior, publication-only sources, complete record limits, and observer containment. Native workflow tests pin independently editable drafts, source references, and creation replay after editing and restart. Component and browser cases verify a committed write with a lost response, a prior commit notification, remount, and exact retry without an additional content version. Browser snapshots run the shipped composition through old-version task loading and checked submission, workflow copy creation without execution, then explicit publication and confirmed execution.

## Alternatives considered

- Saving a live agent definition would copy connection values and conflate task content with executor configuration.
- Mutating a template in place would remove the source needed to explain earlier work.
- Running a workflow during template loading would make a content operation execute external side effects.
- Creating a workflow through several browser-owned writes would leave partial copies after disconnects.
