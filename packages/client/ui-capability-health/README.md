# @deepseek-ai/dsh-client-ui-capability-health

English | [中文](README.zh.md)

Timestamped configuration observations and explicit connection checks over [dsh-capability-health](../../business/capability-health/README.md). The footer entry opens a shell page using shared cyber theme tokens, labeled controls, visible focus, and narrow-screen card layouts.

## Interaction

Opening the page reads executor choices only. Global and selected-executor checks require explicit actions; the selected scope requires a saved executor and workspace. The page separates route registration, command presence, catalogs, credential presence, and task dependencies. It does not show configured credentials or readable catalogs as valid authentication or successful execution. Source changes mark held reports stale; disconnected views retain last-known observations and their times.

MCP connections remain untested until requested. A fresh probe uses the checked executor revision and workspace; admission validates both again. Connection and cleanup outcomes appear independently. The React-free runtime manager retains submitted identities across page remounts, drops stale configuration reads, and prevents an older running acknowledgment from replacing a completed result. Reconnect reads existing ids without resubmitting probes; an unknown id does not start work. Host refusal and unconfirmed transport failure are distinct. The history keeps cancellation and result recovery available after selecting another scope.

Repair actions open the existing Agents page, workspace selection, or the settings shell's registered Models/Runtimes/General section through `settingsPanel.open`. They do not modify configuration. Selection and display-filter drafts use a declared view store and do not survive reload. Authoritative reports and operation observations stay in the runtime manager and host owner. Plugin teardown releases registrations and listeners; closing the page does not cancel host-owned probes.

## Model Experience

None, as the page displays configuration and connection observations without submitting model input.

#### KV Cache effect

Rendering and probes do not change model history or register tools.

## Known Limitations and Deferred Work

- No background monitoring, automatic probe retries, browser-persistent history, or authentication-validity claims. Host probe retention and capacity limits come from the service. Pending outcomes remain recoverable only while the host retains their identities.
