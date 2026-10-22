# Agent Note: Explicit immutable project artifacts

Status: implemented

English | [中文](2026-10-21-explicit-project-artifacts.zh.md)

## Problem

Workspace files can change after human acceptance. A path or a model's final response cannot preserve the bytes that were reviewed, and a lost registration acknowledgment can cause a repeated capture to retain different content.

## Decision

A separate Work Artifacts provider owns explicit file registrations and immutable numbered captures. Current-file registration uses the filesystem service in the source execution's workspace and enforces containment and byte bounds. An execution link records operator-selected provenance without asserting file authorship or acceptance. Accepted-review promotion reads the exact immutable review and copies its retained bytes without rereading the current file. The artifact domain owns no execution or session-log state.

Registration compares the expected version and persists the request identity with its original receipt. Identical retries recover that receipt before reading current sources or files, including after newer versions and restart. Complete record and response limits reject rather than truncate or evict evidence. Directory continuations bind to committed generations and submitted filters. Historical reads depend only on retained bytes; live-file observations are separate explicit, timestamped reads.

The browser uses an optional Work Center child slot and a separate artifact page. Metadata refresh never reads files. Source and connection changes mark current observations stale. Independent read epochs prevent delayed replies from replacing newer selections. Uncertain registrations retain their exact input across page remounts and require an explicit retry or local discard; full reload reconstructs committed history rather than persisting file paths in browser storage. HTML remains a text node and binary files are not executed.

The [work intake and review decision](2026-10-20-work-center-intake-and-review.md) retains human assessment and revision ownership. [Archived-session recovery](2026-10-21-archived-session-recovery.md) retains session visibility ownership. Neither is superseded: artifact captures preserve independently selected evidence without replacing review decisions or session accounts.

## Alternatives considered

**Index every model response or terminal log.** Mentioned paths do not establish file production, bytes, or acceptance; explicit operator registration records the intended file.

**Reread a reviewed path during promotion.** The file may have changed or disappeared; this would attach acceptance to bytes that were never reviewed.

**Retry by reading the file again.** A lost acknowledgment does not establish whether the first commit failed; persistent request receipts recover the original operation.

## Consequences

Historical evidence survives workspace changes without executable previews. Files and paths remain private host material subject to explicit capacity limits. Path aliases are separate registrations; sharing, automatic discovery, export, deletion, and full-document rendering remain deferred.

## Verification

Provider tests cover byte encoding, retained-review promotion, restart and retry identity, version conflicts, containment, current-file states, generation-bound paging, exact response limits, strict durable decoding, and teardown. Runtime and component tests cover selection ownership, explicit inspection, stale observations, retained retry inputs, inert previews, and disposal. The assembled browser scenario uses terminal-created files, human acceptance, original-file removal, independent current-file versions, lost-response recovery, binary previews, bilingual controls, themes, and narrow layouts without extra model requests.
