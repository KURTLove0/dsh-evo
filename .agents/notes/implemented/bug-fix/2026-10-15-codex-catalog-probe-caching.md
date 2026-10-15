# Agent Note: Codex catalog probes are cached per adapter

Status: implemented

English | [中文](2026-10-15-codex-catalog-probe-caching.zh.md)

## Problem

Every codex catalog read spawned a fresh `codex app-server` subprocess. `buildModelCatalog` calls `listModels` once and then `resolveModelInfo` per model, and each `CodexCliAdapter.nativeModels()` call — from `listModels`, from every `resolveModel` (selection validation, per-turn `prepareCall`), from both — ran its own `initialize` → `model/list` → teardown cycle. One `session.models` (one composer-menu open) therefore spawned 1 + N processes: observed as 9 concurrent `codex app-server` children and a 9.6s cold / 5.2s warm menu. `session.selectModel` and each turn's `prepareCall` each paid one more spawn (~2-3s) before the request started. The directory the probe produces is CLI configuration state that is effectively static for minutes at a time, so the per-call spawn storm bought freshness nobody asked for.

## Decision

`CodexCliAdapter` keeps a native-catalog snapshot with a TTL from the new `codex.catalogCacheMs` composition field (60000 default; 0 re-probes per call). Concurrent readers share one in-flight probe; a caller that aborts stops waiting without killing it, and the probe still settles and refreshes the snapshot for the next caller. Failed probes never cache. A probe without a configured request deadline is bounded at 30000ms — a probe is a short-lived RPC, not a native Agent run, so the unbounded-request rationale of the [no-default-deadline decision](2026-10-14-codex-cli-no-default-deadline.md) does not extend to it. The change is carried in both artifact planes of the package — the pre-bundle `lib/types/codex-adapter.js` and `lib/types/index.js`, and the shipped bundle `lib/index.js` — and pinned by `tests/catalog.spec.ts`.

## Alternatives considered

**Cache in `buildModelCatalog` (host layer).** Rejected: the spawn cost is paid by every consumer of the adapter (selection validation, per-turn `prepareCall`), not only the catalog builder; the adapter owns the probe lifecycle.

**Deduplicate the N+1 instead of caching.** Rejected: it removes the storm but leaves one spawn per menu open and per selection — the dominant latencies users felt.

**Serve configured models without any probe.** Rejected: native entries carry live names, descriptions, and reasoning efforts; configured-only fallbacks would degrade every native row.

## Consequences

Within a cache lifetime the composer menu, the `/model` popup, selection validation, and turn preparation all answer from the snapshot (~3ms measured, down from 5-10s), and only one subprocess spawns per lifetime (6.1s cold, down from 9.6s with 12 concurrent spawns). CLI-side model changes surface within `catalogCacheMs`; deployments that need immediate freshness set it to 0. A hung probe can no longer pin the menu forever: it fails at the 30000ms ceiling and the next caller re-probes.
