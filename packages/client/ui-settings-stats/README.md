# @deepseek-ai/dsh-client-ui-settings-stats

English | [中文](README.zh.md)

Read-only Statistics module in the existing Config panel. Run cohorts and whole-host session totals remain independent scopes. The page uses shared cyber theme tokens, native labelled date controls, visible keyboard focus, and a contained, keyboard-focusable table scroller on narrow screens.

## Run cohorts

An optional work-service child fiber contributes to the declared `settings.stats.runs` slot; without that service the whole-host session summary remains available. The child renders [Work Center statistics](../../business/work-center/README.md#run-statistics). Controls select inclusive local start/end dates, workspace, execution source, and a source-qualified agent or workflow, including archived identities. Submission resolves the end date to the following local midnight and retains the browser's IANA time zone. Only an explicit read applies changed controls. Grouping switches among executor, workspace, and submission date without another query.

Counts read source directories without inspecting logs. A separate explicit action reads recorded token evidence within host limits. Missing reports and timing samples remain unavailable rather than zero; reported usage includes its source coverage and attempted session-read limit. Execution success, verification assertions, and human acceptance remain separate facts. Dates identify submission cohorts; elapsed time includes queueing and human waiting. Full semantics and resource limits belong to the provider.

The React-free `WorkStatisticsManager` owns host observations, safe choices, independent failures, and stale-read rejection. Declared view state retains date and dimension controls across page remounts within the application. Source changes, canonical connection attention changes, changed filters, and reconnect invalidate held results without automatically re-reading logs. Disconnected or failed reads preserve the last report under its original submitted filters. Application reload discards the local view draft.

## Whole-host sessions

An independent `session.list` read counts persisted and started sessions, sums available `tokenUsage` projection baselines, and displays a cost placeholder. The summary includes every persisted session and has no date or run filter. Missing projection values contribute nothing to the observed sum. It loads on mount and refreshes on the user's gesture because session listing has no push event. A failure in this summary does not hide the run-cohort section.

## Model Experience

None, as the section renders read-only execution and session observations without creating model requests.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Cost has no authoritative pricing source; no monetary estimate is offered. Reported tokens can omit requests and nested delegation and are not billing totals.
- Ordinary conversations participate in the whole-host session summary, not fabricated agent/workflow runs. Current agent attention is connection-scoped, not historical waiting duration.
- Run-cohort reads are capacity bounded. Whole-host session totals retain the session listing's independent all-time scope; source changes mark run observations stale rather than continuously polling logs.
