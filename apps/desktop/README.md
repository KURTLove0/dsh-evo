# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The desktop shell for the dsh Web GUI: an Electron main process that boots the real `dsh web` composition as a child process and loads its settled loopback URL into a BrowserWindow. The renderer is the ordinary Web GUI on its ordinary transport — every `webPreferences` default stands (sandbox, context isolation, no node integration, no preload); the shell adds no native surface.

## Run from a checkout

```sh
pnpm run desktop        # build the main process, then electron .
```

The shell spawns the source-launch vector of the root `dsh` script (`node --import tsx/esm apps/cli/src/bin.ts web --no-open --port 0`) with the Electron binary as its Node runtime (`ELECTRON_RUN_AS_NODE=1`), so the child's Node version rides the pinned Electron instead of a system Node. `--expose-internals` is part of the vector: the vendored Loader's native addon cannot attach under the Electron binary, and without the internal loader bare plugin names stop resolving.

## Pack an application bundle

```sh
pnpm run desktop:pack   # build, then apps/desktop/scripts/pack.ts
```

Produces `apps/desktop/dist/DSH Desktop-darwin-arm64/DSH Desktop.app` (platform directory trees on Windows/Linux). The bundle carries only the main-process build — the shell has no runtime dependencies — plus one resource recording the checkout it hosts. Double-click the `.app`, or copy it to `/Applications`.

## Build the distribution image

```sh
pnpm run desktop:dist   # build, then apps/desktop/scripts/dist.ts (macOS)
```

Produces the installer image `apps/desktop/dist/dsh-desktop-<version>-<arch>.dmg` through electron-builder (`electron-builder.yml`): the branded icon, the stock drag-to-Applications layout, the same hosted-checkout marker, and the app code in an asar archive. Attach the image, drag the app into `Applications`, launch — the run/quit lifecycle is the shell's own.

Code signing is environment-driven: without a Developer ID certificate the builder warns and skips signing (launch a downloaded image's app with the Finder right-click open, or clear the quarantine attribute), while a releaser exports `CSC_NAME` to sign and `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (with `notarize: true` on the mac target) to notarize.

The hosted checkout resolves at launch, in order: the `DSH_REPO_ROOT` environment variable (absolute path), the marker recorded at pack time, or — in a checkout run — the module location itself. Every accepted path is validated against `apps/cli/src/bin.ts`, so a moved checkout fails loud instead of launching from a stale path. Re-pack after moving the repository, or point `DSH_REPO_ROOT` at the new location.

## Lifecycle

One shell lifetime boots one host child. Closing the window or quitting the app stops the child through SIGTERM (the shipped launcher drains its fiber tree and exits 0) with SIGKILL escalation after ten seconds; a host that dies on its own fails the shell with a dialog carrying its stderr tail. A second instance focuses the existing window.

The keyless coverage: `tests/launcher.spec.ts` pins the launch vector, the URL-line parser, repo-root resolution, and the stop escalation decisions over a stub child; `tests/web-launch.e2e.ts` boots the real composition with the exact vector, asserts the page serves, and stops with a quiescent exit.
