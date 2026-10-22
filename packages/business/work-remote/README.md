# @deepseek-ai/dsh-work-remote

English | [中文](README.zh.md)

Authenticated whole-task transport and opt-in native receiver. `remoteWork` and `remoteWorkGateway` dispatch to explicitly configured execution peers; `./receiver` exposes the machine-only `/remote-work/v1` route. Directory-only runtime peers do not authorize execution. The [subsystem reference](../../../docs/subsystems/work-remote.md) owns wire types; [F10](../../../.agents/notes/proposed/feature/2026-10-20-outcome-oriented-workbench-product.md#f10-authenticated-remote-work) specifies the browser journey.

## Composition and credentials

Mount the root plugin on the calling Host with explicit `peers`: local id/name, canonical origin, pinned receiver Host UUID, pinned principal id, and a credential reference. Non-loopback origins require HTTPS; numeric loopback HTTP supports a secured tunnel. Credentials, paths, queries, and fragments in origins reject; redirects never receive another request. The caller resolves its transport bearer on each operation. Peer descriptions expose its reference/presence and ownership, never its value. Configure peers through Cordis; the runtime-machine directory remains independent.

Mount `./receiver` explicitly on the remote Host with `hostId` and `principals`. Each principal names its credential reference, exact workspace/agent/workflow grants, and separate required `allowStop`/`allowWorkflowDecisions` flags. Native referents and unique principal/reference assignments are checked at startup. Every request authenticates against current resolved values; missing, malformed, or duplicate rotated secrets fail. Bearers require at least 32 header-safe characters. The receiver requires a loopback Web listener. Use SSH forwarding or a TLS proxy exposing only the machine endpoint; ordinary browser API trust is a separate policy.

All target and source identities belong to the receiving Host. Its native agent/workflow services own model credentials, tools, permissions, task logs, and original sessions. Grants are enforced again inside admission, inspection, recovery, and control operations. Workflow targets retain the exact publication and JSON inputs. Inspect returns recorded text, independently unavailable evidence, and read time; file bytes stay remote. Native Work Center inspection may read bounded delivery evidence, but file captures never cross this protocol.

## Durability and lifecycle

A principal and caller UUID identify one submission. Before native handoff, one record retains fixed input, its canonical digest, a namespaced native request, and unconfirmed state. Equal creation returns that record without another handoff; conflicting reuse rejects. Explicit recovery compares attempts and reuses the frozen native request. Native idempotency recovers an existing run after a lost response or failed acknowledgment write. An admitted receipt is independent of execution status and human acceptance.

The receiver persists its Host identity even while empty; changing it against the same domain rejects. A principal sees only its currently authorized retained submissions. Revoking a grant denies access without deleting history. HTTP disconnect does not undo queued native work. Restart never automatically retries uncertainty. Calling requests also pin Host/principal so peer-id reassignment rejects before forwarding. Authorized workflow inspection returns original waiting attempts, instructions and inputs with independent unavailable state. Stop and exact-attempt workflow decisions require their independent grants; missing acknowledgments require an authoritative read. Ordinary agent tool approvals remain with the remote application's native interaction owner.

Receiver unload withdraws the route, destroys incomplete requests, drains admitted handlers/native commands, and closes its journal. Calling-provider unload aborts and awaits network operations. A network deadline ends waiting, not remote execution. Complete JSON is bounded before retention or transmission; oversized responses fail without truncating or evicting evidence. Transport failures and arbitrary remote exceptions expose no native diagnostic text.

## Limits

Calling configuration provides `timeoutMs` (10000), `maxRequestBytes` (262144), `maxResponseBytes` (1048576), and `maxInFlight` (16). Receiver configuration provides `maxRequestBytes` (262144), `maxResponseBytes` (1048576), `maxRecordBytes` (262144), `maxSubmissions` (100), `maxInFlight` (16), and `bodyTimeoutMs` (10000). Limits are positive safe integers; timer values also fit Node's timer range. Bounds include their complete machine envelope or retained private record. Capacity blocks new work without deleting evidence. A response cap unable to represent the minimal configured reply rejects at startup.

## Model Experience

Indirectly, through [dsh-workbench-agent](../workbench-agent/README.md#model-experience) and [dsh-business-workflow-local](../business-workflow-local/README.md#model-experience), which log fixed task content on the receiving Host.

#### KV Cache effect

Transport, catalogs, and inspection add no model messages. Native receivers create ordinary remote sessions; their execution owners determine prompts and prefixes.

## Known Limitations and Deferred Work

- Single receiving process per durable root; no distributed lease, automatic uncertain-command retry, node checkpoint resume, file synchronization/download, arbitrary filesystem proxy, or human/team identity model. No exactly-once guarantee applies to external effects inside native tasks. The default Web application mounts the calling provider with no peers and the [remote execution page](../../client/ui-work-remote/README.md); receiving authority is explicitly configured.
