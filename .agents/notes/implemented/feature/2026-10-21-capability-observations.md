# Agent Note: Capability observations and temporary MCP probes

Status: implemented

English | [中文](2026-10-21-capability-observations.zh.md)

## Problem

A registered runtime, readable model catalog, configured credential, and successful task are different observations. Combining them into one healthy badge gives users unsupported confidence. Connection testing can start processes and contact saved addresses; repeating a request after a lost response can duplicate that work.

## Decision

[Capability Health](../../../../packages/business/capability-health/README.md) owns configuration observations and temporary MCP probes as a Service Definition, native provider, and generated Remote consumer. The [browser page](../../../../packages/client/ui-capability-health/README.md) opens existing repair destinations rather than editing configuration. It reuses the cyber theme and declares only view drafts in its slot store; [HealthManager](../../../../packages/client/runtime/README.md) retains reports and submitted identities across page remounts.

Configuration checks keep independent source results, use closed diagnostic keys, and expose credential presence/source without resolving secrets or claiming authentication validity. Selected checks capture an executor revision and workspace and delegate task dependencies to the existing preflight. Unavailable prerequisites leave their dependent checks unverified. Catalog reads remain metadata operations; checks create no execution sessions or model inputs.

The [MCP helper](../../../../packages/mcp/mcp-client/README.md) performs initialization and ping through the existing SDK transports without tool discovery, registration, execution, or reconnect supervision. Each explicit probe captures the saved server selection and has its own id, cancellation, deadline, and cleanup observation. Retained ids make identical admission replayable; conflicting requests reject. A lost acknowledgment leads to reads of that id, never automatic resubmission. Host restart leaves old identities unknown.

Cleanup observes actual transport closure after the SDK shutdown sequence. A failed cleanup blocks new probes until the host service reloads, because starting another process would compound an unresolved resource leak. Admission, retention, report size, and concurrency are bounded without evicting recoverable identities. Unload cancels and awaits owned probes and reads. Notifications carry the authoritative identity as their payload; listener errors cannot turn admitted work into an apparent refusal, while synchronous invariant failures remain visible.

## Consequences

Configuration changes invalidate held reports without running checks. Explicit source reads can contact existing catalog providers, and explicit stdio probes execute the saved command in the selected workspace. Results include observation time and separate connection/cleanup outcomes. Missing host records preserve last-known browser evidence. Browser reload loses that app's pending identity inventory; records are transient host state, not an audit log.

The [MCP bridge](2026-07-07-mcp-client-plugin.md) and [reconnection decision](2026-08-06-mcp-client-auto-reconnect.md) continue to govern execution-owned tool connections. [Work Center](2026-10-20-work-center-intake-and-review.md) continues to own task submission and acceptance. Neither tool supervision nor task execution is superseded by configuration observations. The [product proposal](../../proposed/feature/2026-10-20-outcome-oriented-workbench-product.md) retains subsequent diagnostics and other unimplemented capabilities.

## Verification

Unit and real SDK process cases cover safe error results, cancellation, timeout, SDK termination escalation, actual exit, cleanup failure, capacity, revision checks, source-local failures, and observer lifetime. Runtime and component cases cover invalidated reads, late acknowledgments, independent probe errors, and remount recovery without resubmission. Keyless browser snapshots exercise the shipped composition with explicit probes, a lost response, cancellation, repair navigation, and narrow-screen layouts without business model calls.

## Alternatives considered

- A combined readiness boolean would hide which claim the available evidence supports.
- A browser-owned connection would disappear on navigation and bypass host process ownership.
- Automatic retry after a lost acknowledgment could start a second server before the first operation is recovered.
- Reusing the tool bridge for checks would discover and expose tools and activate execution reconnection behavior.
