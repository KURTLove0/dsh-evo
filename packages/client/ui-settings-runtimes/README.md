# @deepseek-ai/dsh-client-ui-settings-runtimes

English | [中文](README.zh.md)

The Runtimes settings page groups local and saved remote dsh deployments into a machine directory. Search matches machine names, origins, provider names, commands, and model IDs; status filters distinguish successful directory reads from connection or catalog failures. Selecting a machine shows its runtime catalog, loaded models, and diagnostics. The local catalog joins `llm.providers` with `llm.models`; live routes with missing local executables remain excluded from that catalog.

The directory adapts to its available width: narrow panels stack the machine list above the catalog, and compact header actions retain accessible names. Each runtime initially shows up to three models and the total model count; **Expand** reveals the full list, and **Collapse** restores the preview. Search can be cleared in place, and an empty filtered view offers a reset action. Local daemon setup instructions expand below the runtime catalog.

**Connect remote** checks a dsh HTTP origin through `llm.runtimePeers` before saving its name and origin. Run `dsh web` on the remote host and make its web port reachable from the current host, usually through an SSH tunnel. Origins cannot contain credentials, paths, queries, or fragments. An unreachable saved machine remains visible with its connection error. **Open remote** opens that deployment's application, which owns its sessions. **Disconnect** requires confirmation and removes only the saved connection.

**Manage runtimes** creates, edits, enables, disables, and deletes Cursor CLI-compatible executable profiles. Each profile records a display name, a unique `runtime-` provider ID, an executable name or absolute path, and a JSON argument array. The host validates commands and rejects adapter-owned protocol and permission flags. Enabled profiles load through the existing Cursor adapter; profiles with missing executables remain editable and show an unavailable status. Built-in providers remain deployment-owned. Native CLI login and configuration remain with the executable.

Management writes use `settings.mutate` on the host's `runtime-management` namespace with the last observed revision. Conflicts and validation failures stay in the dialog without discarding the draft; read-only or unavailable settings disable management. Removal requires confirmation. Native modal dialogs contain focus and restore it on close; Escape closes the active management dialog. Clipboard confirmation appears only after a successful write.

Once opened, the page refreshes after local `settings/document-updated`, `llm/adapters-updated`, and `connection/reset` notifications. Remote deployments refresh on the same reads and the **Refresh** action. The settings slot remains at order 15 under the sidebar configuration group.

## Model Experience

The view sends no model request. Saving or removing a custom profile changes the available provider routes; the composer still owns model selection. A request through such a route uses the [Cursor adapter](../../llm/llm-cursor-cli/README.md), including its native runtime configuration and history handling.

#### KV Cache effect

Viewing and refreshing the directory have no effect. Selecting a different runtime changes the provider serving subsequent model requests.

## Known Limitations and Deferred Work

- Custom executable profiles support the Cursor CLI stream-json protocol. Other native CLI protocols need a corresponding managed adapter integration.
- Remote connections provide directory snapshots and open the remote application; they do not proxy remote sessions or edit the remote host's configuration. No remote heartbeat or usage telemetry is inferred.
- Connection records carry no credentials. Use an SSH tunnel or an already reachable trusted deployment; configuration operations on the current host remain loopback-only.
