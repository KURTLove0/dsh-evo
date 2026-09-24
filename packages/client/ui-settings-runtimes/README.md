# @deepseek-ai/dsh-client-ui-settings-runtimes

English | [中文](README.zh.md)

Runtimes settings plugin: a read-only settings page that lists the model runtimes this deployment can call, over the two wire domains the Models page already owns — `llm.providers` (the configurable-provider directory with each route's live/dormant state) and `llm.models` (the host-scoped model catalog). One shared snapshot joins them by route id: a live runtime renders its loaded models as mono chips with a count caption, or the catalog failure text when that runtime's listing failed; a dormant runtime renders where it is configured instead (the Models page), because a route with no registered adapter has nothing to load.

The page never writes. Runtime configuration stays with the Models page (`settings.mutate` / `credentials.set`), and model selection stays with the composer's picker — this section reports and points, it never routes. Once loaded, it subscribes to the forwarded `settings/document-updated` and `llm/adapters-updated` owner events plus local `connection/reset`, so a settings-born route coming or going converges without polling; an unopened page never fetches. Rows keep directory declaration order, liveness is shown as a dot plus a status word (never as provider health — a dormant route is a configuration fact, not a failure), and an empty directory renders the empty-deployment notice rather than an error.

## Model Experience

None, as the section renders a read-only browser view; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The page is a view, not a manager** — it never writes: runtime configuration stays with the Models page and model selection with the composer's picker, so there is no edit/delete/create affordance here to build or misuse. A runtime that needs changing is pointed at its configuration surface instead.
- **Liveness is directory state, not health** — a dormant row means the route is not registered (a configuration fact), not that anything is broken; a live route whose model listing failed carries that failure text rather than a degraded-status chip, because the host reports only one catalog fact per route.
