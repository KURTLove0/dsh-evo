# Agent Note: Archived-session recovery without reactivation

Status: implemented

English | [中文](2026-10-21-archived-session-recovery.zh.md)

## Problem

Archived sessions retain their logs and workspace accounts, but a hidden session needs a discoverable recovery operation. Opening a session to browse the archive would load history and may activate an agent. A delayed archive response can also overwrite a more recent membership frame from another page.

## Decision

The workspace registry owns `restoreSession` on its existing serialized write queue. It removes archive membership only, preserving logs, workspace accounting, and manual order. Known already restored sessions succeed without another write; definite missing sessions reject, and storage lookup failures propagate. Restoration neither selects a conversation nor starts execution. The existing domain version and stored fields remain sufficient.

The Host API answers the complete committed archive set and broadcasts the existing archive-change frame. The client serializes its own archive/restore writes and ignores a unary membership echo superseded by another complete Host observation. A failed write retains the last known membership; a failed request does not prevent a later retry. A frame or accepted echo arriving during baseline hydration continues to supersede that baseline's older archive set.

The workspace UI owns a separate archive page using the existing session and workspace feeds. Metadata filtering does not read transcripts. Rows retain unknown session IDs instead of presenting missing metadata as an empty archive. The deployment's existing search-result bound limits the rendered prefix, with a refinement message. Disconnection and unavailable baselines disable restoration. Successful restoration moves keyboard focus to a status message after the removed row loses its button. Filter controls survive page remounts; browser reload reconstructs membership from the Host.

The [global archive decision](2026-07-31-session-archive-global-set.md) retains archive storage and filtering ownership. [Workspace sidebar order](2026-08-11-workspace-sidebar-order-and-folding.md) retains the separate browser presentation preferences; restoration does not rewrite those preferences or the durable account.

## Alternatives considered

**Open each archived session to build its row.** History reads and agent activation are unnecessary for archive membership and metadata.

**Restore by attaching the session again.** Attaching can change position and loses the distinction between account membership and archive visibility.

**Trust the last unary response to arrive.** Arrival order does not establish commit order across pages; an older response can erase a newer full-set frame.

## Consequences

Archived sessions remain discoverable without loading their contents. Missing session metadata is visible, but metadata alone does not prove that a log is readable. Recovery preserves data and selection rather than acting as a run-retry operation. The product artifact directory remains a separate capability.

## Verification

Registry tests cover durable restoration, no-op repeats, unknown IDs, storage lookup failures, serialization, and unchanged accounting across restart. Transport and runtime tests cover complete-set RPCs, frames, retained errors, and delayed-response precedence. Component tests cover filtering, bounds, missing metadata, disposal, retained controls, and completion focus. The real-composition browser scenario covers multiple archived sessions, another connected page, reconnection, Chinese controls, both color schemes, and narrow widths without another model request.
