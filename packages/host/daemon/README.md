# @deepseek-ai/dsh-daemon

English | [中文](README.zh.md)

The local-runtime sensing daemon, mirroring the multica daemon's model: a long-lived background process senses which local-CLI runtimes this machine has and publishes the report over a loopback health endpoint, so configuration surfaces answer "is this runtime here" from one owner instead of probing per page load. The daemon probes a fixed catalog (`claude`, `codex` — the local CLIs the harness can route to today) immediately and on an interval, keeps the latest report in memory, and serves it from `GET /health` on 127.0.0.1; `POST /shutdown` asks it out. Route activation stays per-boot inside each app (the llm-claude-cli "detection activates" probe is untouched) — the daemon's report feeds configuration surfaces, never routing.

The process model is the CLI re-invoking itself: `dsh daemon start` spawns the same bin as `daemon start --foreground`, detached, with stdout/stderr appended to `<harness home>/daemon/daemon.log`, and waits for the first healthy answer. The daemon publishes `<harness home>/daemon/daemon.json` (pid, port, version, startedAt, written atomically, owner-only) once it serves; an absent or unreadable document is the only "no daemon" signal — consumers never guess a port. The health answer is validated against a zod schema on read, so a stale document pointing at a foreign service degrades to "not running" rather than to a wrong presence map. Signals and `/shutdown` share one teardown path (loop stopped, listener closed, state swept); a start over a live daemon is refused, and a stop falls back from the graceful endpoint request to a plain SIGTERM.

Configuration follows the multica env table: the bind port defaults to 3081 (`--port` / `DSH_DAEMON_PORT`), the probe interval to 15s (`--interval` seconds / `DSH_DAEMON_INTERVAL_MS`); the background child receives both through its environment so flag and foreground resolution share one path. `probeDaemonHealth` is the single client used by the CLI (`status`/`stop`) and by the API proxy, which prefers the daemon's presence rows for catalog commands and falls back to its own inline probe for custom commands or whenever no daemon runs — page behavior without a daemon is unchanged.

## Model Experience

None, as the daemon only senses local executables and reports them; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **PATH provenance is the launching shell's** — the daemon senses with the PATH it inherited at start; a CLI installed after the daemon started (or visible only to a different shell) shows up only after a daemon restart picks the new PATH, one probe interval later.
- **Presence only** — report rows carry no version or model catalog; richer runtime facts wait for a consumer that needs them.
- **Unauthenticated loopback** — any local process can ask `/health` or POST `/shutdown` (same trust model as the multica daemon); the state directory's owner-only permissions are the boundary.
