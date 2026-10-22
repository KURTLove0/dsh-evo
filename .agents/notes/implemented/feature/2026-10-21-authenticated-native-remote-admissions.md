# Agent Note: Authenticated native remote admissions

Status: implemented

English | [中文](2026-10-21-authenticated-native-remote-admissions.zh.md)

## Problem

A reachable runtime catalog cannot authorize a task or prove where its files, credentials, permissions, and execution history belong. Forwarding ordinary browser RPCs would inherit a trust fence designed for browsers rather than machine authentication. A caller losing an admission response also cannot distinguish rejection from a native task already executing.

## Decision

The [Work Remote](../../../../packages/business/work-remote/README.md) capability sends complete tasks to a separately configured receiving deployment. The calling transport exposes a Service Definition, HTTP provider, and generated gateway; the native receiver owns a dedicated authenticated machine route. The [F10 proposal](../../proposed/feature/2026-10-20-outcome-oriented-workbench-product.md#f10-authenticated-remote-work) specifies the browser journey and product scope.

Every request names a pinned receiving Host UUID and principal. The receiver authenticates a current bearer reference, checks the intended identities before mutation, and enforces exact workspace/executor grants in the admitting or controlling operation. Stop and workflow decisions have independent grants. Bearers stay with their credential owners and machine headers; task input, retained records, response data, and model requests contain no transport values. Changed references are resolved per operation, with ambiguous values rejected.

The receiver binds a loopback listener; non-loopback calling origins require HTTPS, while numeric loopback HTTP supports secured forwarding. Redirects and origins with credentials or URL suffixes reject before forwarding credentials. The endpoint's Host/principal checks prevent the wrong deployment from applying a command before the caller notices a mismatched response. The ordinary [browser API trust policy](../architecture/2026-07-28-api-browser-trust-boundary.md) remains independent.

A principal and caller UUID own one immutable target and one namespaced native request in a separate journal. Unconfirmed state commits before native handoff. Equal creation reads retained state without another handoff; conflicting JSON content rejects using canonical property ordering. Explicit recovery compares attempts and reuses the native identity. Native idempotence recovers an already admitted run after response loss or a failed receipt write. Restart never automatically replays uncertainty. The receiver persists its Host UUID independently of history and rejects reassignment against the same domain.

Native agent and workflow services own the complete receiving execution world, credentials, logged task content, permissions, and workflow approvals. This is distinct from the shared filesystem/subprocess providers described by [portable execution-world consumers](../architecture/2026-07-28-portable-execution-world-consumers.md). Remote work dispatches to an existing complete Host rather than assembling remote filesystem and subprocess handles locally.

Observation reads the original native source and recorded textual delivery. Missing source or output evidence remains independently unavailable; observation time is not execution end time. The caller validates complete replies, their Host/principal, operation/result relation, requested identity, and native source relationship. File captures remain remote. Control acknowledgment does not become execution success or human acceptance, and a lost control response requires an authoritative read.

The default Web composition mounts the calling provider with no peers and the [remote execution page](../../../../packages/client/ui-work-remote/README.md). A React-free manager owns independent read generations; shared view state retains drafts and exact uncertain operations across page remounts. Every calling input freezes Host/principal as well as peer id, so reassigning the configured id cannot redirect a retained command. Reconnect only reads. Explicit creation recovery repeats fixed identity/content; uncertain controls require an authoritative read before a fresh decision. Authorized workflow inspection returns original waiting attempt instructions and actual inputs, with independent unavailability. Native decisions, stop and admission recovery require a separate visible confirmation.

## Alternatives considered

**Proxy the existing browser API using catalog reachability.** The browser fence does not establish a machine principal or delegated execution grant. Explicit receiving authority and credentials are required.

**Retry an uncertain admission with another native request.** The original may already exist. A durable native identity makes recovery refer to the same task instead of authorizing another execution.

**Mirror the remote queue and execution lifecycle locally.** That creates two mutable owners. The receiver journal owns handoff identity; existing native queues and logs own execution. Calling Hosts keep only their configured peer and explicit request input.

**Treat remote paths as local files or synchronize every workspace.** Paths, credentials, permissions, and runtime state belong to the receiving world. Recorded text can cross the machine protocol while file bytes remain under the native remote UI.

## Consequences

Operator setup must configure both the receiver's principal/grants and the caller's pinned peer/reference. The transport does not create human accounts, general browser authentication, or team sharing. A single receiving process owns its durable root; no distributed lease or arbitrary exactly-once external-effect guarantee is introduced. Complete request, response, record, history-count, concurrency, and network bounds reject explicitly without evicting evidence. HTTP disconnect stops waiting rather than undoing admitted native work. Unload withdraws the receiver route, drains admitted work, and closes storage; calling-provider unload aborts and awaits HTTP operations.

## Verification

Real HTTP and JSON-storage tests cover credential rotation and ambiguity, scoped authority, intended identities, conflicting/equal requests, restart, concurrent recovery, failed receipt persistence, complete byte limits, caller disconnect, request deadlines, and quiescent teardown. A Loader-composed two-Host scenario uses the real application gateway, authenticated transport, native task/workflow owners, and scripted external model responses. It writes a file only in the remote workspace, recovers one native task after response loss, checks original task input in the remote session log, retains workflow publication/input/approval behavior, and proves no local execution. Keyless result snapshots retain those assembled facts.

The real browser submits a native remote file-writing task, retains an uncertain calling request across page remount, explicitly resubmits the same identity, and approves a workflow using the machine endpoint’s original waiting inputs. Offline/reconnect adds no submission. English/Chinese, both themes, keyboard confirmation, and 320/375/414/768px layouts are verified against the default composition.
