# 能力检查

[English](capability-health.md) | 中文

[能力检查服务](../../packages/business/capability-health/README.zh.md)提供配置观察和显式临时 MCP 检测；[浏览器页面](../../packages/client/ui-capability-health/README.zh.md)负责展示结果与打开既有修复入口。配置存在、目录可读、认证有效和任务成功是不同事实。

报告包含观察时间及所选执行者版本和工作区。来源变更会使持有的报告过期。检测以调用方提供的标识保留到宿主重新加载；读取未知标识不启动连接。连接结果与清理结果分别记录，清理失败会阻止新检测。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
