# Agent Note: Codex CLI model calls run without a default wall-clock deadline

Status: implemented

English | [中文](2026-10-14-codex-cli-no-default-deadline.zh.md)

## Problem

The Codex driver of the artifact-carried `@deepseek-ai/dsh-llm-claude-cli` package armed a five-minute per-call deadline (`CODEX_DEFAULT_TIMEOUT_MS = 300_000`), mirroring the Claude stream-json driver's default. One Codex app-server request is not one model turn: since [the native CLI configuration decision](../feature/2026-10-14-native-cli-reasoning-and-agent-trajectory.md), a request delegates a complete native Agent run (shell commands, file changes, MCP and dynamic tool calls, child agents) to the installed CLI, and legitimate runs exceed five minutes. The deadline killed the subprocess mid-run, surfaced as `TIMEOUT` (`codex CLI call exceeded its 300000ms deadline`), and the retry middleware re-ran the same doomed call five times per turn, each retry burning another five minutes before the turn failed. `settings.yaml` cannot rescue the route: the plugin deliberately reads no settings section, and the composition entry ships without config, so the unreachable default was the only value in play.

## Decision

`CODEX_DEFAULT_TIMEOUT_MS` is `0`: the Codex driver arms no per-call deadline unless a deployment sets a positive `codex.timeoutMs` in the plugin's composition entry. The Claude driver keeps its 300000 ms default, because a stream-json print-mode process answers one model turn bounded by the provider. The change is carried in both artifact planes of the package — the pre-bundle `lib/types/codex-adapter.js` and the shipped bundle `lib/index.js` — so the next tsdown re-bundle preserves it, and `tests/timeout.spec.ts` pins the default together with the explicit-override validation.

## Alternatives considered

**Raise the default to a larger finite value.** Rejected: any guess re-introduces the failure for longer Agent runs while hiding process hangs; deployments that need a bound still have `codex.timeoutMs`.

**Keep the default and let users override it through `settings.yaml`.** Rejected: local CLI runtimes own their configuration through the installed CLI and Cordis composition; a settings channel would duplicate runtime-owned state ([the native CLI configuration decision](../feature/2026-10-14-native-cli-reasoning-and-agent-trajectory.md)).

**Disable retries on `TIMEOUT` for CLI drivers.** Rejected: transient provider failures still deserve retries; the defect was the unattainable deadline, not the retry policy.

## Consequences

Long Codex Agent runs complete instead of dying at five minutes. A hung app-server subprocess is no longer force-killed by the harness; the caller abort remains the cancellation path, and a deployment that requires a hard bound states `codex.timeoutMs` explicitly (an explicit `0` is rejected — unbounded is the default state, not a configured one). The [artifact-carried package recovery note](../architecture/2026-09-24-llm-claude-cli-codex-runtime.md) recorded the recovered declaration tree with the old default; the declaration and bundle now carry `0`.
