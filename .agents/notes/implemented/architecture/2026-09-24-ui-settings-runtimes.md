# Agent Note: Runtimes settings section (ui-settings-runtimes)

Status: implemented

English | [中文](2026-09-24-ui-settings-runtimes.zh.md)

## Problem

The settings panel offered no answer to "which model runtimes can this deployment actually call, and what does each one load right now". The Models page owns provider configuration (routes, credentials, model catalogs as *settings*), and the composer's picker owns per-session selection, but neither surface reports runtime liveness with the loaded model list beside it — a dormant route (declared in the directory, no registered adapter) is indistinguishable from a live one until a request fails. multica's dashboard has a Runtimes page for exactly this reading, built around machine instances and daemon heartbeats that a single-machine plugin harness has no counterpart for.

## Decision

Ship a read-only settings section that joins the two wire domains the host already owns, adding no new RPC: `llm.providers` (the configurable-provider directory: every declared route with its live/dormant state) and `llm.models` (the host-scoped catalog: each live route's currently advertised models, or its per-provider listing failure). One shared page store loads both in parallel and joins by route id; rows keep directory declaration order.

The page never writes. Configuration stays with the Models page and selection with the composer's picker; a dormant row points at its configuration surface instead of offering an edit affordance there is no write path behind. Liveness renders as a dot plus a status word — never as provider health, because dormancy is a configuration fact, not a failure. A live route with a failed listing carries the failure text verbatim; the host reports exactly one catalog fact per route, so no degraded-status derivation is invented client-side.

Freshness rides the existing forwarded owner events (`settings/document-updated`, `llm/adapters-updated`) plus `connection/reset`, gated on first load so an unopened page never fetches — the same convergence contract the Models page already obeys.

The nav row registers on the `settings.section` slot at order 15 (after Models at 10, before Agent presets at 20): reading what exists is a lighter act than composing what runs, and the placement keeps the two model-adjacent pages adjacent. The shell's nav glyph needed one new icon (`IconRuntimeOutline16`, a chip contour with a lightning notch) in ui-primitives, keyed by the section id.

## Consequences

- New `@deepseek-ai/dsh-client-ui-settings-runtimes` browser plugin: `RuntimesSettingsStore` (the join), `RuntimesSection` (the view), `settings.runtimes` dictionaries (zh/en), empty host half and invariant companion — the standard client-package pair.
- Every adapter that calls `ctx.llm.registerConfigurableProviders` appears here automatically; dormant-but-editable routes (the `llm-claude-cli` codex driver pattern) show as Inactive with their configuration pointer, exactly as the directory reports them.
- web-app mounts the row beside `ui-settings-models`; `tsconfig.base.json` paths and `tsconfig.client.json` references register the package so source-plane resolution and the coverage gate see it.
- Adding model-runtime facts the directory does not carry (usage, health, machine identity) would require a new wire surface; this section deliberately projects only what `llm.providers`/`llm.models` already answer.

## Alternatives considered

- **Extend the Models page with a per-row models view** — rejected: the Models page is a configuration surface whose rows open editors; mixing a read-only catalog view into it makes every row carry two conflicting affordances.
- **A new `llm.runtimes` RPC shaped like multica's RuntimeDevice (health, last-seen, usage)** — rejected: DSH is a single-machine plugin harness with no daemon registry; inventing a server-shaped fact source that restates two existing domains would add wire surface without adding a fact.
- **Deriving degraded health from catalog failure presence** — rejected: the host reports one catalog fact per route; synthesizing a second, softer status from the same fact is client-side inference the host never promised.
