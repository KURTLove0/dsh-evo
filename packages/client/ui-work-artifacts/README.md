# @deepseek-ai/dsh-client-ui-work-artifacts

English | [中文](README.zh.md)

Project artifact directory and optional Work Center registration controls over [dsh-work-artifacts](../../business/work-artifacts/README.md). The sidebar opens workspace/source/origin filters and inert historical previews.

## Interface

The `work-center.delivery.artifacts` slot belongs to Work Center. Its optional contribution registers a current file from the selected settled execution or promotes a captured file from an explicitly selected accepted review. Registration preserves source provenance and requires an explicit action. The directory shows bounded registered metadata, the submitted filters, version history, byte count, digest, timestamps, and the source-session link when that session remains listed.

Current-file comparisons run only when requested. Refreshing metadata and reconnecting never inspect files. Source or connection changes retain observations as stale. A new current-file capture does not inherit historical human acceptance. Text is rendered in a React text node, including HTML source; binary content is identified without execution.

The React-free runtime manager owns directory, preview, observation, and mutation lifecycles independently. Late responses cannot replace a newer selection. Read errors preserve the previous submitted scope and rows. Unacknowledged registrations keep their original source, path, expected version, and request identity in the declared view store across page remounts. Explicit retry recovers the original receipt; discarding local inputs does not cancel a committed host write. Full browser reload discards unsubmitted controls and uncertain requests, while committed history remains on the host. The plugin disposes all contributions, subscriptions, and its manager.

## Model Experience

None, as page rendering, registration, preview, and explicit file comparison do not change model input.

#### KV Cache effect

No model request or session-prefix mutation occurs.

## Known Limitations and Deferred Work

- Private single-host files; no sharing, export, automatic discovery, live HTML, document execution, offline writes, or durable browser drafts. The host owns all capacity limits. A missing original session disables its navigation link without hiding retained provenance.
