# Agent Note: Config module nav (runtimes / statistics / settings)

Status: implemented

English | [中文](2026-10-15-ui-config-module.zh.md)

## Problem

The settings panel was one flat list of sections (General, Models, Runtimes, Agent presets, Plugins) behind a "Settings" trigger, with no configuration-module concept above them. The product asked for one Config module whose nav splits into three functions — runtimes, statistics, and settings — while keeping every settings page unchanged. The Runtimes page also rendered as a stack of cards: whole-deployment figures (how many runtimes, how many online, daemon presence) were derivable but nowhere shown, and per-row facts the directory already carries (origin tag, local command) were dropped. Nothing anywhere aggregated usage across sessions: the conversation stats strip is per-session, and no surface answered "how many sessions exist and what did they consume".

## Decision

Upgrade the existing settings shell into the Config module rather than adding a parallel entry: the sidebar's `sidebar.config` seat carries the whole module entry — one "配置" title over three module rows (`runtimes`, `stats` each claim a row; the Settings row stands for the first section the shell does not claim) — and the foot's old "配置" trigger is gone: the module rows are the only way in, so the sidebar never names the same entry twice. The Workbench's Runtimes side panel (`SidebarRuntimeAction`) is gone with it — one surface per fact, the panel is the runtimes surface — leaving the Workbench to the business-workflow module. A module row exists only while its section is on the ledger; its click reaches the panel as a pending open request through a one-slot snapshot store the apply layer owns, and the panel consumes the request on the render that acts, so a later render never re-opens on a stale one.

The panel shows one module at a time. A single-page module (runtimes, stats) fills the whole column with its own section heading — no rail, and the dialog's accessible name rides a visually-hidden title node; the Settings module renders its section rail (the pages the shell does not claim as modules) to switch pages within it. The panel never lists sections outside the module it was opened on, so opening Runtimes answers with the runtimes page alone.

The three sidebar group titles (工作台 Workbench, the workspace section label, 配置 Config) share one rhythm — 14/400/20 on the tertiary label color, each an h2 — so the column reads as one set of sections.

Module placement is claimed by section id, not by a new register option. `KindOptions` for list slots is a closed set (id/order/label/priority) and `StoredEntry.options` whitelists exactly those at storage; extending the slot core for one shell's nav structure would put a presentation concept into the dispatch contract. The id claim also matches the shell's existing `navIcon` precedent (glyph by section id, unknown ids fall back to the gear), and it keeps declaration rights coherent: a registrant that declared its own module could never localize the module label anyway. The `sidebar.config` seat itself is shell chrome in ui-sidebar's contract — geometry only, no settings state crosses it.

The Runtimes page keeps its data pipeline (the `llm.providers` × `llm.models` join, daemon hint, pushed invalidations) and re-renders as a summary strip plus a table. The strip carries only facts the rows already prove — runtime and online counts (a row is online exactly when it carries no catalog failure) and daemon presence. The table's columns are the facts the wire answers: service identity with the `declared` origin tag, health (online or the failure text verbatim), loaded models, and the `localCommand` the route shells out to. Columns the reference design draws (load, agents, cost, CLI version) have no fact source here and are not invented; the store now passes `declared`/`localCommand` through so the view can show them.

A new `@deepseek-ai/dsh-client-ui-settings-stats` browser plugin registers the Statistics page: one `session.list` call aggregated client-side — session and started-conversation counts from the rows, token usage summed over each row's `tokenUsage` projection baseline (the same durable four-bucket accounting the conversation strip shows per session). Session listing carries no push event, so the page loads on mount and refreshes on the user's gesture. The cost card renders an explicit no-billing-source placeholder: the host records no pricing and the usage aggregate is not bucketed per model, so no number is invented.

## Consequences

- ui-settings-general owns the module chrome: the `ConfigNav` occupant (`sidebar.config`), the `sidebar.group`/`sidebar.settings` dictionary keys, the panel-request store, and the shared section-ledger projection serving both the panel rail and the sidebar rows; section registration options are unchanged, so no feature package had to move for the restructure.
- ui-sidebar gains one seat (`sidebar.config`, geometry-only owner props) rendered between the browsing region and the foot; every sidebar-width state passes the same `wide` flag it already passes the other seats. The `settings.trigger` slot and its occupant are gone from the settings contract — no dead seat stays declared.
- Every e2e anchored on the foot trigger's name moved to the sidebar module rows (nine scenario files), and the dialog goldens re-recorded; the runtimes/stats pages pin the rail-free module form.
- Runtimes rows now expose `declared` and `localCommand`; the section always renders its own heading (the side-panel `showTitle` seam went with its only consumer, in both this package and ui-settings-stats).
- The Workbench keeps the business-workflow module alone; `sidebar.session.action` still serves its remaining occupant, and ui-settings-runtimes no longer depends on ui-sidebar at all.
- ui-settings-stats follows the standard client-package pair (host-half no-op, invariant companion, zh/en dictionaries, README pair); web-app mounts it beside ui-settings-runtimes, and the coverage gate sees it through the tsconfig path/reference registrations.
- A pricing source added later replaces the cost card's placeholder content; the sessions/tokens cards already compute from real data.

## Alternatives considered

- **A `group` register option on `settings.section`** — rejected: list-slot options are a closed dispatch vocabulary in the slot core; module order and the localized Settings label are shell chrome, so the registrant would hold half the concept and the shell the other half.
- **The module structure inside the panel's nav rail** — the first revision's reading, replaced after the product pointed at the sidebar: module rows duplicated the panel rail's switching duty while the sidebar kept only a flat trigger, so the title-over-modules hierarchy belongs where the arrow pointed, between the workspace list and the foot.
- **A foot trigger beside the module rows** — removed after the product flagged the duplicate: the sidebar named "配置" twice (foot row plus group title) while the module rows already carry every entry path, so the foot row carried no path of its own.
- **The Workbench's Runtimes side panel beside the module row** — removed after the product flagged the second runtimes entry: the same section behind a second chrome (trigger, portaled panel, its own focus dance) doubled the surface for one fact while the config module row already opens the panel on it.
- **One flat panel rail for every module** — replaced by the module-scoped form after the product asked each module to show only its own block: a Runtimes open answering with a Models nav is the panel speaking for modules it was not asked about.
- **A second, parallel Config entry beside Settings** — rejected: the two panels would overlap on every settings page; "设置沿用之前的实现" pins the settings group as the Config module's third function rather than a sibling surface.
- **Built-in price table estimating the cost card** — rejected: the aggregate is not bucketed per model or provider, so any estimate is untraceable approximation, and model prices are deployment-varying facts a plugin must not hardcode. The explicit placeholder keeps the card honest until a real billing source exists.
- **A `stats` host RPC aggregating server-side** — rejected: `session.list` already ships every row with its `tokenUsage` projection baseline; a new wire surface would restate one existing answer without adding a fact.
