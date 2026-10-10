# Agent Note: `dsh daemon start` fails fast when the spawned daemon dies

Status: implemented

English | [中文](2026-10-10-daemon-start-fails-fast-on-child-death.zh.md)

## Problem

`dsh daemon start` spawns the background daemon and polls its health endpoint for up to ten seconds, but never looks at the child itself. When the default port 3081 is owned by another process — a daemon under a different harness home, or any foreign listener; the log carries an earlier era where 19527 collided with openclaw — the child dies on the bind within milliseconds, its refusal written to the daemon log, and the parent still waits out the whole startup budget before answering with the vague "Daemon may not have started. Check logs: …". The user pays a ten-second stall and then a log-reading detour to learn a fact the parent could have quoted directly. The assembled lifecycle snapshot amplified the same weakness: it started the daemon on the machine-global default port, so any daemon running under the real harness home failed the suite.

## Decision

`startDaemon`'s startup poll checks the spawned child's `exitCode`/`signalCode` before each health probe: a child that died before answering returns the new `child-exited` failure at once, its `message` quoting the daemon log's last non-empty line — a bind refusal names the port and the occupying listener's error — and falling back to the exit code or signal when the log holds no line. The CLI maps it to `Daemon failed to start: <line>` plus the log path, mirroring the successful start's two-line shape. A child that stays silent but alive keeps the supervisor stance: it runs out the budget, is left running, and the log names the failure. The lifecycle snapshot now starts every daemon with `--port 0`, matching the process-bound suite's existing hermetic pattern, and adds a cross-home bind-conflict snapshot pinning the new user-visible output.

## Alternatives considered

**Listen for the child's `exit` event instead of polling the exit facts.** Rejected: delivering the event relies on the parent's event loop staying alive around an unref'd, detached child, a timing assumption the existing 200ms poll loop already avoids; the exit facts are plain properties the same loop can read, and the spawn test seam stays a plain object.

**Fall back to `--port 0` automatically when the default port is refused.** Rejected: a default-port collision is a deployment fact the user should see, not one to route around silently; the loud failure with the refused port in the message names both remedies (`--port 0`, an explicit `--port`), and quiet relocation would hide the conflict and multiply daemons across homes.

**Distinguish bind refusals from other deaths through a child exit-code protocol.** Rejected: encoding "bind failed" as a magic exit code adds a cross-process contract for one message's benefit; the log's last line already carries the full refusal, including the port and the OS error.

## Consequences

A dead-on-arrival daemon start fails within one poll tick (the process-bound suite sees ~0.7s end to end) with the real reason on stderr and the log path beside it, instead of a ten-second stall ending in "check the logs". `StartDaemonResult` gains the `child-exited` member, so exhaustive consumers of the failure union must handle it; the CLI dispatch does. Snapshots and process-bound tests no longer depend on machine port state, so a running daemon on the dev machine or CI neighbor no longer fails unrelated daemon suites.

## Testing

`lifecycle.spec.ts` pins the three message paths over the spawn seam: quoting the log's last line, and the exit-code/signal fallbacks for a vanished and a blank log. `lifecycle-process.spec.ts` reproduces the real conflict — one fixture daemon owns a port, a second home's start dies on the bind — and asserts the `EADDRINUSE` refusal surfaces (the fixture now logs its bind refusal and exits 1 like the real daemon). `daemon.spec.ts` pins the CLI mapping. The assembled snapshot suite covers the stopped posture, the port-0 round trip, the startup log line, and the cross-home bind-conflict stderr.
