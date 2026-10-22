# @deepseek-ai/dsh-capability-health

English | [中文](README.zh.md)

Configuration observations and explicit temporary MCP connection probes. This package combines the `capabilityHealth` Service Definition, native provider, and generated Remote consumer; the [browser plugin](../../client/ui-capability-health/README.md) owns presentation.

## Configuration observations

`choices` reads sanitized saved executors. `check` reads either global provider configuration or one explicit executor revision and workspace. Registered routes, local executable presence, model-catalog reads, selected task dependencies, and credential configuration remain separate facts. Catalog reads may contact their existing metadata providers but never submit model input. Command presence reuses the daemon package's current host probe; remote directories do not establish remote execution.

Provider settings addresses select the same `apiKeyEnv` references used by the Models page. Credential descriptions expose presence and source, never values or validity. Registered authorization flows and stored records are joined without reading record payloads; unowned records and ambient authentication remain unverified. Individual catalog and credential failures preserve independent successful results. Reports contain closed diagnostic keys, not raw external errors, URLs, arguments, environment values, or headers.

Selected checks delegate admission facts to the executor's preflight. Inaccessible workspaces leave dependent skill checks unverified; unavailable runtimes leave model routing unverified. MCP servers remain untested until an explicit probe. Every report includes its observation time and optional captured executor revision/workspace.

## Temporary MCP probes

`startProbe` admits a saved server by executor revision, workspace, server name, and nonempty `HealthProbeId`. It validates archive/workspace/capacity before starting a temporary connection through [dsh-mcp-client](../../mcp/mcp-client/README.md). Initialization and ping do not list, register, or call tools, create task sessions, or send business input. Stdio uses the selected workspace and saved explicit environment over the normal scrubbed parent environment.

An identical request id returns its retained admission or result; conflicting fields reject. `readProbe` recovers the result without repeating connection work and returns null for unknown ids, including after host restart. `cancelProbe` aborts and awaits cleanup. The browser distinguishes an explicit admission refusal from a lost response and never automatically repeats an uncertain admission.

`HealthProbeRecord` distinguishes running from settled observations. Connection outcome, completion time, and cleanup outcome remain independent; a responsive server with failed cleanup is not treated as ready. Failed cleanup blocks new probes until this host service reloads. Unloading aborts and awaits owned probes and pending reads. Post-admission listener failures are contained; synchronous invariant failures remain visible after dispatch.

## Bounds

Positive integer fields are `maxItems` (1000), `maxReportBytes` (262144), `maxActiveProbes` (2), and `maxProbeRecords` (200). Item and UTF-8 byte limits apply to the complete report or directory; overflow rejects without truncation. Active capacity cannot exceed retained record capacity. Positive finite `probeTimeoutMs` (10000) bounds initialization/ping; `probeCloseTimeoutMs` (5000) bounds the close-event wait after the SDK shutdown sequence settles. Both are bounded by Node timer limits. Probe records remain in memory until service reload; capacity rejects further admission instead of evicting recovery identities.

## Model Experience

None, as checks read configuration and metadata without submitting model input or modifying session history.

#### KV Cache effect

No model request prefix is changed; MCP probes register no tools.

## Known Limitations and Deferred Work

- Observations are timestamped local facts, not continuous monitoring, credential-validity proof, tool-call validation, or remote execution. Credential-reference discovery follows the existing provider `apiKeyEnv` convention; undeclared authentication remains unknown. Probe records do not survive host restart and configuration reads use each source's existing deadlines. Detailed failure evidence and cross-host diagnostics remain separate work.
