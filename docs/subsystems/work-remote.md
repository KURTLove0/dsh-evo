# Authenticated remote work

English | [中文](work-remote.zh.md)

[Work Remote](../../packages/business/work-remote/README.md) owns the typed calling transport and separate authenticated native receiver. [The F10 proposal](../../.agents/notes/proposed/feature/2026-10-20-outcome-oriented-workbench-product.md#f10-authenticated-remote-work) retains the complete user interface; this capability is explicitly composed.

## Identity and data

`RemotePeerId` selects a local execution peer. `RemoteHostId` and `RemotePrincipalId` qualify receiving authority; `RemoteSubmissionId` is the caller's UUID within that authority. `RemotePeer` describes configured origin, pinned identities, transport credential reference/presence, and separate local transport versus remote model-credential ownership. Runtime-directory reachability does not supply this authority.

`RemoteTarget` selects an original native structured-task input or formal workflow publication/input set. All native identities belong to the receiving Host. `RemoteOperation` selects catalog, filtered retained list, fixed submission, inspection, attempt-compared recovery, stop, or exact waiting-attempt workflow decision. `RemoteEnvelope` carries version 1, intended Host/principal, and the operation. The receiver checks identity and current grants before dispatch. `RemoteReply` repeats authenticated identity and carries `RemoteWorkResult`; client decoding also checks operation/result kinds, requested identities, and native source relationships.

`RemoteSubmission` retains target input, creation time, attempt count, and independent admission uncertainty or a native source reference. `RemoteSubmissionSummary` omits content. `RemoteCatalog` exposes only granted workspace paths, executor revisions/runtime/skills/MCP names, workflow publications and input descriptions, and explicit native-control authority. Inspection retains the exact target and returns sourced status, observation time, recorded textual output, or independent unavailability. File captures and transport values never appear in these results.

## Persistence and ownership

One receiver domain records its Host UUID independently of history. Each principal/submission key binds immutable input and canonical digest to one namespaced native request. Equal creation returns retained state; recovery reuses the request and compares attempts. A lost response does not establish rejection, and no restart or client reconnect repeats uncertainty automatically. Native agent and workflow owners retain sessions, permissions, logs, and approval behavior. Stop and workflow decisions require separate current authorization.

The machine route is separate from browser API trust. It accepts only authenticated JSON machine POSTs on a loopback listener, with external transport secured by a tunnel or TLS proxy. Per-operation credential resolution observes rotation and rejects ambiguous configured values. Caller redirects and unsupported origins reject without forwarding credentials. Complete wire/record limits, capacity, timeout ownership, and opt-in composition live in the [package contract](../../packages/business/work-remote/README.md).

The [remote execution page](../../packages/client/ui-work-remote/README.md) owns user selection and retained uncertain input. `RemoteCallRequest` freezes the selected peer, expected Host/principal, and operation. The calling provider rejects reassigned authority before network dispatch. Authorized workflow inspection exposes waiting attempts, original instructions and actual inputs separately from delivery availability.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxremotework--remotework-abstract-seam"></a>

### `ctx.remoteWork` — `RemoteWork` (abstract seam)

A disconnected caller cannot infer whether a native command committed.

```ts cordis-catalog
/**
 * Describe explicitly configured execution peers without exposing credentials.
 * @returns identities and current credential-presence observations, without network probes.
 */
abstract peers(): Promise<RemotePeer[]>

/**
 * Invoke one explicit operation without automatic transport retries.
 * @param request - fixed peer identity and operation input.
 * @returns a validated, Host/principal-qualified remote result; unavailable responses leave writes uncertain.
 */
abstract call(request: RemoteCallRequest): Promise<RemoteWorkResult>
```

Source: [`packages/business/work-remote/src/service.ts`](../../packages/business/work-remote/src/service.ts)
<!-- END GENERATED cordis-surface -->
