# Agent Note: dsh-desktop hosts the Web GUI as a child process under an Electron shell

Status: implemented

English | [中文](2026-08-25-desktop-shell-subprocess.zh.md)

## Problem

The repository ships the Web GUI behind `dsh web` — a loopback HTTP server plus a browser tab — but no desktop application. The webserver package's own documentation names the eventual desktop shapes: this shell (the browser composition behind a window) and the `file://` + IPC-bridge carrier that would let the renderer skip the HTTP transport entirely. A desktop shell built the naive way would either duplicate the agent spine as native code or patch the shipped composition, both of which fork the product surface the moment the Web GUI changes.

## Decision

`apps/desktop` is an app package, not a plugin: one Electron main process ([`src/main.ts`](../../../../apps/desktop/src/main.ts)) that spawns the existing `dsh web` composition with the exact source-launch vector of the root `dsh` script — `--import tsx/esm apps/cli/src/bin.ts web --no-open --port 0` — and loads the settled-ready URL line (`dsh web: http://127.0.0.1:<port>`, printed only after the Loader tree settles) into a BrowserWindow. The composition, the transport, and the renderer are untouched: the window is the ordinary Web GUI, every `webPreferences` default stands, and there is no preload because the shell has no native surface to expose.

Load-bearing details:

- **The Electron binary is the child's Node runtime.** The vector runs under `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so the host child's Node rides the pinned Electron (24.x, satisfying the repository's `^22.19 || >=24` engines) instead of depending on a system Node.
- **`--expose-internals` belongs to the vector.** The vendored Loader reaches Node's internal module loader through `node-addon-require-builtin`, whose native addon needs an embedder slot plain Node provides and Electron node mode does not (probe: `Unsupported/no-realm`). The loader already carries the `--expose-internals` fallback branch ([`vendor/loader/src/internal.ts`](../../../../vendor/loader/src/internal.ts)); without it, bare plugin names stop resolving and the tree fails to load with `ERR_MODULE_NOT_FOUND`.
- **Lifecycle ownership sits in three hooks.** `window-all-closed` and `before-quit` route through one memoized stop (SIGTERM, the shipped launcher's quiescent drain, SIGKILL after ten seconds); a host that dies unrequested fails the shell with a dialog carrying the child's stderr tail. A second instance focuses the existing window. Verified end to end: `open` of the packed `.app` boots five Electron processes plus the host child, and `quit` leaves zero processes behind.
- **Packing is a marker, not a build of the harness.** `scripts/pack.ts` (`@electron/packager`) bundles only the main-process build — the shell has no runtime dependencies — and records the hosted checkout as one extra resource. At launch the checkout resolves from `DSH_REPO_ROOT`, the marker, or the module location, each validated against `apps/cli/src/bin.ts` so a moved checkout fails loud rather than launching from a stale path. `scripts/dist.ts` (electron-builder over `electron-builder.yml`) builds the same contract into the DMG distribution image — branded icon, drag-to-Applications layout, asar archive — with code signing environment-driven: no Developer ID certificate means an unsigned bundle, `CSC_NAME` plus the Apple notarization variables mean a signed and notarized release.

## Verification

`tests/launcher.spec.ts` (keyless unit) pins the launch vector, the URL-line parser (including the display-only LAN suffix), repo-root resolution across all three sources plus both failure shapes, and the stop escalation decisions over a stub child. `tests/web-launch.e2e.ts` (keyless assembled) boots the real composition with the exact vector, asserts the served page carries `__DSH_BOOT__`, and stops with exit code 0. Manual matrix: dev run (`pnpm run desktop`), host-death path, SIGTERM to the main process, `open` of the packed bundle, and AppleScript `quit` — all exit with zero surviving processes. The distribution image was verified the same way: `hdiutil` attach of the built DMG, `open` of the app from the mounted volume (host child boots), `quit` (zero survivors), detach.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Main-process embedded boot (`runProfile` in the Electron main) | Electron's pinned Node and the engines range must be kept in lockstep forever; a composition crash takes the window down with it; the process-shutdown contract of the CLI launcher would be re-implemented inside the shell. |
| `file://` dist + IPC bridge for fetch/WebSockets (the webserver README's named eventual shape) | Requires a new Electron carrier pair in `client/connection` and a boot-manifest injection path — a capability-seam change an order larger than the subprocess shell, before any user has asked the renderer to leave the HTTP transport. It remains the documented follow-up when the shell wants to stop binding a port. |
| Tauri | The host tree would need a Node sidecar anyway (the Cordis composition is Node), so the shell would carry two runtimes and a Rust toolchain to reach the same subprocess contract. |
| Built-CLI launch vector (`apps/cli/lib/bin.js` under plain node) | Would couple every desktop run to a prior full build; the source vector keeps the shell the zero-build path and matches the root `dsh` script exactly. |

## Consequences

The desktop surface inherits every Web composition change for free and adds one maintenance fact: the launch vector must keep matching the root `dsh` script plus `--expose-internals` (the unit test pins it). Distribution ships as the DMG image (`desktop:dist`) with environment-driven signing; Windows/Linux installers (nsis/AppImage), auto-update wiring, and notarization credentials remain release engineering's to add when a release wants them. The `file://` + IPC carrier stays the documented endpoint for a future shell that drops the loopback server.
