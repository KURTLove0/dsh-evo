# Capability checks

English | [中文](capability-health.zh.md)

[Capability Health](../../packages/business/capability-health/README.md) provides configuration observations and explicit temporary MCP probes; the [browser page](../../packages/client/ui-capability-health/README.md) displays evidence and opens existing repair destinations. Configuration presence, readable catalogs, valid authentication, and successful execution are separate facts.

Reports capture observation time and the selected executor revision/workspace. Source changes invalidate held observations. Probe identities remain readable until host reload; reading an unknown identity does not start a connection. Connection and cleanup outcomes are independent, and cleanup failure blocks further probes.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcapabilityhealth--capabilityhealth-abstract-seam"></a>

### `ctx.capabilityHealth` — `CapabilityHealth` (abstract seam)

Observations do not establish task success, credential validity, or MCP tool-call readiness.

```ts cordis-catalog
/**
 * Read saved executors without inspecting their dependencies.
 * @returns bounded saved executor choices, excluding connection secrets.
 */
abstract choices(): Promise<HealthAgent[]>

/**
 * Read current configuration and model catalogs without submitting model input.
 * @param request - global scope or explicit saved executor revision and workspace.
 * @returns timestamped source-local observations without secret values or raw provider errors.
 */
abstract check(request: HealthCheckRequest): Promise<HealthReport>

/**
 * Admit one explicit initialization/ping operation; exact request retries reuse it.
 * @param request - client-owned identity and saved server selection.
 * @returns the admitted or already retained record, without waiting for connection completion.
 */
abstract startProbe(request: HealthProbeRequest): Promise<HealthProbeRecord>

/**
 * Recover an admitted probe without repeating network or process work.
 * @param id - previously supplied probe identity.
 * @returns its current record, or null when this host has no retained record.
 */
abstract readProbe(id: HealthProbeId): HealthProbeRecord | null

/**
 * Cancel and await an owned probe, including transport cleanup.
 * @param id - retained probe identity.
 * @returns its settled record; unknown identities reject.
 */
abstract cancelProbe(id: HealthProbeId): Promise<HealthProbeRecord>
```

Source: [`packages/business/capability-health/src/service.ts`](../../packages/business/capability-health/src/service.ts)

<a id="capability-health-events"></a>

### `capability-health/*` events

<a id="capability-healthprobe-changed--emit"></a>

#### `capability-health/probe-changed` — emit

A temporary probe was admitted or finished; read its authoritative record.

```ts cordis-catalog
/**
 * A temporary probe was admitted or finished; read its authoritative record.
 * @mode emit
 * @param id - retained probe identity.
 */
'capability-health/probe-changed'(id: HealthProbeId): void
```

Source: [`packages/business/capability-health/src/types.ts`](../../packages/business/capability-health/src/types.ts)
<!-- END GENERATED cordis-surface -->
