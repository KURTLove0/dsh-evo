# Agent Note: the codex notification pump terminates on a closed stream

Status: implemented

English | [中文](2026-10-12-codex-pump-terminal-on-closed-stream.zh.md)

## Problem

A web session over the codex CLI adapter stalled forever in the running state with no output and no way to stop it. `CodexClient.nextNotification` decided the stream was dead only when `state.closed && notifications.length === 0`, while its search (`findIndex`) looked only for frames matching the adapter's predicate (`turn/completed`, `error`, `item/*`, `thread/tokenUsage/updated`). When the app-server process died with a non-matching notification still queued — for example the `mcpServer/startupStatus/updated` frames codex emits around bridge startup — the closed check read `notifications.length === 1` and stayed false forever, so the pump hung on a promise with no handles, no timer, and no error. The turn never ended (`turn/end` missing, session stuck at `running` with zero turn statistics — "no result").

Cancellation could not reach it either. `session.cancel` correctly aborted the agent signal, and the adapter's `onAbort` ran, but it only destroyed stdout and killed the process tree: the process was already dead and the stream already closed, so both were no-ops, and no `close` event ever fired again to resolve the pending wait. The per-call deadline failed the same way — five minutes elapsed with no effect. Both symptoms shared this one root cause.

## Decision

Two changes in `CodexClient` and one in the adapter, all in the maintenance entry `lib/types/` (rebuilt into `lib/index.js` with tsdown, per the artifact-carried-package rule):

- `nextNotification` rejects as soon as the stream is closed and no matching frame is queued. `findIndex` has already run, so a closed stream means no future frame can arrive; leftover non-matching frames must not mask the closed state. Matching frames still deliver first, so a normal `turn/completed` arriving just before the stream closes completes the turn as before.
- `CodexClient.end()` marks the transport closed and wakes a pending notification wait, so the waiter observes the terminal state immediately. `onAbort` calls `client.end()` before destroying stdout and killing the tree, which unblocks the abort path even when the stream closed long ago. `dispose()` reuses `end()` for the same wake-up.

## Alternatives considered

**Fix only the closed check, leave `onAbort` untouched.** Rejected: after the stream reached EOF, `child.stdout.destroy()` fires no further `close` event, so a wait that was already parked stays parked — the "cannot stop" half of the bug survives. Both legs are required.

**Filter non-matching notifications out of the queue entirely.** Rejected: the predicate decides which frames the adapter consumes, not which frames exist on the wire; queue contents are transport facts. Widening or narrowing the predicate to dodge one frame class would leave the same deadlock for the next unseen method.

**Fuse an abort signal into the pending wait (`AbortSignal.any`).** Rejected: the pump does not own a signal, and the owner already has a lifecycle mouth — `dispose`/abort both belong to the host. One `end()` covering both is smaller than teaching the queue about signals.

## Consequences

A closed stream with only non-matching frames queued now ends the call within one microtask with a `TRANSPORT` `LlmError`, which flows through the adapter's `pumpExitError` classification (`ABORTED` when the caller cancelled, `TIMEOUT` when the deadline won) and the agent-loop's request-error waterfall — visible failure with a code, not an invisible hang. Late cancellation converges the same way: a stop issued an hour after the stall still ends the turn with `turn/end: aborted`. Normal turns, mid-stream cancellation, and process death without queued frames behave exactly as before.

## Testing

The package has no unit-test seam (artifact-carried), so verification ran through a standalone probe against the real adapter with a fake app-server executable: handshake, two streamed items, then death in four shapes — plain exit, SIGKILL, stdout-close-while-alive, and exit with a trailing `mcpServer/startupStatus/updated` frame. Before the fix the last two hung the stream forever (watchdog) and a cancel issued after the hang changed nothing; after the fix every shape terminates — `TRANSPORT` for the trailing-frame death, `ABORTED` for the late cancel — while plain exit and SIGKILL still end with the transport error. End-to-end on the restarted web instance: a fresh codex session completed (`turn/end: completed`, reply delivered), and a long-running session cancelled twelve seconds in wrote `turn/end: {"kind":"aborted","reason":{"kind":"user"}}` with the session back to idle and no orphaned codex process.
