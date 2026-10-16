# @deepseek-ai/dsh-client-ui-settings-stats

English | [中文](README.zh.md)

Statistics settings plugin: a read-only settings page that answers "how many sessions exist on this host and what did they consume" with one `session.list` call. The rows themselves count sessions and started conversations; each row's `tokenUsage` projection baseline — the durable four-bucket provider accounting the conversation stats strip shows per session — is summed client-side into a whole-host aggregate. The page renders three metric cards: sessions, token usage (billed input + output total with the bucket breakdown), and cost. The cost card is an explicit no-billing-source placeholder: the host records no pricing and the aggregate is not bucketed per model, so no number is invented.

The page never writes and subscribes to nothing: session listing carries no push event, so it loads on mount and refreshes only on the user's own gesture. A session whose listing row carries no usage projection (never reported usage, or a degraded projection baseline) contributes nothing rather than zero-with-a-warning — absence is the host's answer, not an error. The nav row registers on the `settings.section` slot as the shell-claimed top-level Statistics module row, so the panel reads as the Config module's Statistics function.

## Model Experience

None, as the section renders a read-only browser view; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Cost is a placeholder until a billing source exists** — the card shows an explicit no-billing-source dash; computing a real figure needs a pricing surface the host does not own, and the usage aggregate is not bucketed per model or provider, so no estimate is offered.
- **No time windows** — `session.list` has no date filter, so every figure is whole-host over all persisted sessions; a "last 7 days" scope needs a listing parameter first.
- **Freshness is gesture-scoped** — a session created after the page loaded appears only after the refresh control or a re-entry; there is no session-list push event to converge on.
