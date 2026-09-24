# Agent Note: local CLI model runtimes (llm-claude-cli) — remount and codex load

Status: implemented

English | [中文](2026-09-24-llm-claude-cli-codex-runtime.zh.md)

## Problem

The `@deepseek-ai/dsh-llm-claude-cli` package — the dual-driver local-CLI LLM runtime (claude stream-json + codex app-server) built in earlier sessions — had lost its source tree to an uncommitted-workspace accident: `src/`, `tests/`, README, and the Agent Notes were gone (never committed to git; the dangling stash commits do not contain them). What survived under `packages/llm/llm-claude-cli/` was the complete built artifact: `lib/index.js` (the full 191 KB self-contained dual-driver bundle), `lib/invariant.js`, `lib/mcp-server.js`, and the full `lib/types/` declaration tree. With no `package.json`, the directory broke `check-workspace-constraints` ("expected a package here") and the web app could not resolve the package at all.

## Decision

Restore the package as an artifact-carried workspace member rather than rewriting the lost sources:

- **package.json rebuilt from the declaration tree** — the `.d.ts` files carry the complete public contract (driver config shape, defaults `timeoutMs: 300000` / `contextWindow: 200000`, the yaml example, the settings-section behavior), so the manifest, exports map (`./mcp-server` included), and dependency list could be reconstructed faithfully. Dependencies follow the sibling llm-adapter pattern (`dsh-invariants`/`dsh-llm`/`dsh-settings`/`schemastery` in dependencies; the repo-wide peer-migration drift is pre-existing and out of scope).
- **`src/invariant.ts` rehydrated** — `verify-package-invariants` AST-checks the companion source (register-own-name, named exports, empty-install marker comment); the compiled `lib/invariant.js` is a verbatim projection of the standard companion, so the source is reconstructed in that exact shape. The minimal `tsconfig.json` (references cordis, dsh-llm, dsh-settings, invariants) keeps `tsc -b` and the references gate satisfied without touching the hand-built `lib/index.js`.
- **Gates re-registered where the lost source had registered them** — `check-workspace-constraints.ts` `packageFileExtras` gets back the `lib/mcp-server.js` entry; knip gets a workspace entry keyed on `lib/index.js` with the dependency ignores an artifact-carried package needs (nothing in `src/` references them anymore).
- **Runtime resolution goes through the launcher-maintained flat fallback** — `healProfilesModuleFallback` maintains `$DSH_HOME/profiles/node_modules` as one symlink per app-closure package; it only adds and never prunes, so a manual `dsh-llm-claude-cli -> <repo>/packages/llm/llm-claude-cli` symlink is stable across launches (a future committed restoration would flow through the normal heal once the app manifest depends on it again). The Loader's parent-walk from the profile directory then resolves the bare plugin name to `lib/index.js`.

## Consequences

- The web profile mounts the plugin through the `--patch .tmp-llm-cli.patch.yml` overlay; route activation stays user-owned in `~/.dsh/settings.yaml` under `llm-claude-cli:` (the codex section present ⇒ the codex route registers in place).
- The local codex CLI (0.144.6) now loads as a runtime: the settings Runtimes page shows **Codex CLI** active with `gpt-5-codex` loaded, beside Claude CLI (sonnet/opus/haiku) and DeepSeek.
- A host-Context smoke through `ctx.llm.stream` proved the protocol path: `providers: claude-cli, codex-cli`, `models: gpt-5-codex`, and an unauthenticated call converging to a single `error` finish (`CLI_ERROR`, "stream disconnected ... api.openai.com") — the documented private-`CODEX_HOME` authentication posture, not a wiring failure.
- README trio and this note are rebuilt from the declaration-tree contract; the source files remain lost until the package is re-authored from scratch (the artifact is the only authority in the meantime).

## Alternatives considered

- **Rewriting the lost sources (adapters, protocol layers, 224 tests) from scratch** — rejected for this request: the artifact is the exact built output of those sources, self-contained, and already proven; rewriting would re-derive what already ships.
- **Committing the built `lib/` as a source-of-truth and deleting the package** — rejected: the Runtimes page, Models page, and codex runtime load all key off the live workspace package; removing it removes the runtime.
- **Pinning the symlink into the profile's own `node_modules` via `dsh plugin add`** — rejected for now: that copies/installs into the profile, which would freeze the artifact outside the repo; the flat-fallback symlink keeps the repo package live for source-tree work.
