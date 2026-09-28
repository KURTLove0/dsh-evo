# Agent Note: The runtime-sensing daemon (dsh daemon)

Status: implemented

English | [中文](2026-09-28-runtime-sensing-daemon.zh.md)

## Problem

Local-runtime presence had no owner. The settings surfaces probed it inline — every `llm.providers` answer spawned one `which` per local route inside the web host — so presence existed only while a web host was serving and only as fresh as the latest page load, and there was no multica-style answer to "what has this machine got" that outlives any single app boot. The 2026-09-25 presence note chose per-answer probing because adapter-side answers go stale; the user direction that followed was explicit: runtimes should be sensed by a daemon, like multica's.

## Decision

Build the multica model as a first-class surface. A new package, `@deepseek-ai/dsh-daemon` (`packages/host/daemon`), owns the whole seam: a fixed probe catalog (`claude`, `codex` — the local CLIs the harness can route to today), the `commandPresent` probe migrated out of apiproxy, an interval sensing loop, a loopback-only health endpoint (`GET /health` answers identity plus the report, `POST /shutdown` asks the daemon out), the state document (`$DSH_HOME/daemon/daemon.json`: pid/port/version/startedAt, atomic, owner-only) that is the only rendezvous, the zod-validated health client both consumers share, and the CLI lifecycle helpers. The daemon process is the CLI re-invoked: `dsh daemon start` spawns the same bin as `daemon start --foreground`, detached, logging to `daemon.log`, port/interval carried through the child's environment so flag and foreground resolution share one path. `stop` POSTs `/shutdown` and falls back to a plain SIGTERM; `status`, `logs -f`, and `restart` complete the family, all reading liveness from the health endpoint alone — an absent or unreadable state document means "no daemon", and a validated-foreign answer means the port changed owners.

Consumption is daemon-preferred, never daemon-required. `llm.providers` probes the daemon per answer; catalog-command presence rides the daemon's report when it answers, while custom commands and every no-daemon deployment keep the inline probe — page behavior without a daemon is exactly the pre-daemon behavior. The response gains `daemonRunning`, and the Runtimes settings page renders an instruction card (`dsh daemon start`, copyable) only when no daemon answered, so the daemon's absence is itself actionable. Sensing stays split from activation on purpose: llm-claude-cli's per-boot "detection activates" probe still decides route registration, while the daemon's report feeds configuration surfaces only — a daemon whose PATH differs from the app's must never gate routes.

## Consequences

- New `dsh daemon` command family in apps/cli (nested start/stop/restart/status/logs, `--foreground/--port/--interval`, `DSH_DAEMON_PORT`/`DSH_DAEMON_INTERVAL_MS` env); the background child inherits `process.execArgv`, so source launch (tsx) and built bin both respawn correctly.
- `commandPresent` moved to `dsh-daemon` (apiproxy imports it); the wire gains `daemonRunning` on `llm.providers` (zod schema and client codec follow the single host declaration; client artifacts must be rebuilt for the field to reach the browser).
- PATH provenance is the launching shell's: the daemon senses with the PATH it inherited at start, so a CLI installed later appears only after a daemon restart plus one probe interval. The Runtimes page hint names the start command; nothing auto-starts the daemon.
- The daemon package carries an explained empty invariant companion (it is not a cordis application); its unit coverage is 100% per file, with a process-bound suite spawning a real fixture daemon for the start/status/stop round trip.

## Alternatives considered

- **Plugin-directory-driven sensing (daemon boots a tree and enumerates `listConfigurableProviders()`)** — rejected for now: it means booting a cordis tree inside the sensing process, far heavier than the multica model this mirrors, and the routable local-CLI set changes only with harness releases. The accepted cost is two fact sources for command names (the catalog and each adapter's `localCommand`); a mismatch degrades gracefully because non-catalog commands still answer inline.
- **State file only, no HTTP endpoint** — rejected: a heartbeat timestamp can prove a file fresh but cannot prove the writer alive, and stop/status become signal-and-pidfile plumbing; the endpoint gives liveness, a validated report, and graceful shutdown in one channel, at multica parity.
- **Replace the inline probe outright** — rejected: it strands every no-daemon deployment with stale or absent presence; the inline probe remains the fallback for custom commands and for "no daemon", so the page can never regress below today's behavior.
- **Let the daemon drive route activation too** — rejected: activation belongs to the app's own boot (its PATH, its composition); the daemon reports to configuration surfaces, and a PATH skew between the two processes must not gate what an app can route.
