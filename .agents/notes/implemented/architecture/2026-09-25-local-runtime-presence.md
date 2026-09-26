# Agent Note: Local-runtime presence probing and the Models page runtime/API split

Status: implemented

English | [中文](2026-09-25-local-runtime-presence.zh.md)

## Problem

Both settings surfaces listed local-CLI runtimes whether or not the machine could actually run them: the Runtimes page rendered a Claude CLI / Codex CLI row even on a host without the CLI, and the Models page offered an editor card (command, timeout, model catalog) for a runtime that was not there — and, when it was there, duplicated what `settings.yaml` already owns as a second, weaker source of truth. A local runtime is a fact about the machine, not a profile: presence belongs to the host's filesystem, and the catalog it loads is what the runtime itself reports. Neither surface had a presence fact, so "not installed" and "installed but dormant" were indistinguishable rows.

## Decision

Teach the configurable-provider directory to declare locality, and the host to answer presence. `LlmConfigurableProvider` gains an optional `localCommand` — the executable a local-CLI runtime shells out to, tracked to the adapter's current configuration so a settings edit that retargets the command moves the answer with it. The llm-claude-cli bundle declares it for both drivers. `llm.providers` probes each declared command per answer (`which`/`where` for a bare name, the executable bit for a command naming a path) and rides the result as `present`; probing per answer means installing or removing a CLI is visible on the next page load with no restart, and a missing CLI degrades the row, never the listing.

The two surfaces then split on that fact, and activation follows detection. The llm-claude-cli codex driver activates when its section is present OR when a codex CLI resolves on this machine — detection alone activates with the driver defaults, so a usable local runtime never waits on a `settings.yaml` entry; an explicit section only ever overrides the detected runtime's defaults. The Runtimes page lists live routes only: a runtime the host could not find has no row (an absent CLI can never serve from here), and neither does a dormant route — it is a configuration candidate whose home is the Models page, so the "configure this runtime" pointer rows are gone entirely. The Models page regroups into **Runtimes** and **Model APIs**: a probed-present live local runtime renders read-only with the models it loads from the same `llm.models` answer, while API providers keep every configurable behavior unchanged, including the dormant-directory add flow that owns API candidates. The CLI-family editor card is retired outright — its command/timeout/catalog writes were a second source of truth for what the driver's own section already resolves per request.

## Consequences

- Wire: `ConfigurableProviderView` gains optional `localCommand`/`present`; zod schema and the `@deepseek-ai/dsh-api-remotes/client` re-export follow the single host-side declaration. New adapters declare locality with one field and get both surfaces' behavior for free.
- Host: `command-presence.ts` probes with an injectable platform/spawn/access seam (the `native-path-opener` pattern); `api-proxy.ts` answers presence inline. The composer picker and `session.models` are untouched by presence — but detection DOES reach routing for the codex driver, whose activation is exactly "section present or CLI detected"; that is the one adapter that opted into detection-as-activation, and any adapter can follow by probing in its own `apply`.
- Models page: the store joins `llm.models` into a `runtimes` projection beside `rows`, live local routes only; `ProviderEditor` drops the `claude-cli` layout (back to two curated families) and `ModelListEditor` drops the `loadCandidates` override that only it used.
- Runtimes page: dormant rows and the "configure in settings.yaml" hint are gone; every listed row is live with its catalog or its listing failure. Onboarding readiness is unaffected: a live local route still counts as a usable provider, exactly as before the split.

## Alternatives considered

- **Adapter-side probing baked into the directory entries** — rejected: the answer would go stale between settings changes (install a CLI, nothing re-probes), and per-answer host probing is cheap (one `which` spawn per local route) while never lying about the machine as it is right now.
- **Keep the CLI editor but gate it on presence** — rejected: a present runtime's card still duplicated the driver section's per-request resolution with a weaker write path; the settings surfaces report and point, `settings.yaml` owns the local-runtime overrides.
- **Keep dormant rows on the Runtimes page as configuration pointers** — rejected: the page's contract is "runtimes this deployment can call"; a dormant route is a candidate for the Models page's add flow, and a settings.yaml pointer duplicated an affordance that already has a home.
- **Require an explicit settings section for codex activation, with detection only driving display** — rejected: it strands the detected runtime unusable until the user hand-writes YAML for facts the machine already answered; detection activates with defaults, and the section stays the override channel.
- **Extend detection-as-activation to the claude driver** — rejected for now: mounting the package IS the explicit configuration of its primary driver (the top-level shorthand), so claude registration already follows declared intent; codex is the optional secondary driver where machine detection is the right default.
