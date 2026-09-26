# @deepseek-ai/dsh-client-ui-settings-runtimes

English | [中文](README.zh.md)

Runtimes settings plugin: a read-only settings page that lists the model runtimes this deployment can call, over the two wire domains the Models page already owns — `llm.providers` (the configurable-provider directory with each route's live/dormant state) and `llm.models` (the host-scoped model catalog). One shared snapshot joins them by route id over the live routes only: every row renders its runtime's loaded models as mono chips with a count caption, or the catalog failure text when that listing failed. A dormant route renders nowhere — it is a configuration candidate whose home is the Models page, not a runtime this deployment can call. A local-CLI runtime — one the adapter declares with a `localCommand` — earns a row only when the host finds that executable on this machine: a CLI that is not installed is no runtime here and simply never appears, and an adapter that detects its CLI activates the route on its own (the `llm-claude-cli` codex driver pattern), so a usable local runtime never waits on a `settings.yaml` entry.

The page never writes. API-provider configuration stays with the Models page (`settings.mutate` / `credentials.set`), a local runtime's overrides stay in `settings.yaml`, and model selection stays with the composer's picker — this section reports and points, it never routes. Once loaded, it subscribes to the forwarded `settings/document-updated` and `llm/adapters-updated` owner events plus local `connection/reset`, so a settings-born route coming or going converges without polling; an unopened page never fetches. Rows keep directory declaration order, every row is live by construction, and an empty directory renders the empty-deployment notice rather than an error.

## Model Experience

None, as the section renders a read-only browser view; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The page is a view, not a manager** — it never writes: API-provider configuration stays with the Models page, a local runtime's overrides with `settings.yaml`, and model selection with the composer's picker, so there is no edit/delete/create affordance here to build or misuse. A runtime that needs changing is pointed at its configuration surface instead.
- **Only live routes are listed** — a dormant route is a configuration candidate for the Models page, not a runtime here, so there is no inactive-row state to read either way; a live route whose model listing failed carries that failure text rather than a degraded-status chip, because the host reports only one catalog fact per route.
