# Agent Note: the local-CLI provider editor family (ui-settings-models)

Status: implemented

English | [中文](2026-09-24-cli-family-provider-editor.zh.md)

## Problem

The Models page hand-writes one editor card per adapter family, and `layoutOf` curating knew exactly two namespaces: `llm-deepseek` and `llm-pi-ai`. Every other namespace fell to the `unknown` layout — a hint pointing at `settings.yaml` with Apply disabled. The `llm-claude-cli` dual-driver package registers its routes in the configurable-provider directory exactly like the curated adapters, so Claude CLI and Codex CLI rows appeared and opened an editor, but the card was an inert text hint: no fields, no model list, no write path. The composer's model picker already offered the codex runtime's models (`session.models` carries the same catalog), yet the page that names itself the configuration surface could not configure the one runtime family a local machine actually runs.

## Decision

Curate a third family with a different spine rather than stretching the two existing ones:

- **No API key field.** Neither CLI driver authenticates through a credentials reference — the claude driver rides the CLI's own login, the codex driver takes deployment credentials in its `env`. The write-only key input the other families lead with has no referent here; `credentialOnly` is ignored for the same reason (it asks for a field this family does not have).
- **Connection facts lead.** The card's top fields are the driver's **CLI command** and **timeout (ms)** — the two facts a local runtime's identity actually rests on. The timeout edits as text into a buffer; a value that cannot parse as a positive integer stays on screen and disables Apply instead of reaching `settings.mutate` with something the schema would refuse, and a cleared field unsets the stored override.
- **The fetch action loads the runtime catalog, not an endpoint.** `ModelListEditor` gained an optional `loadCandidates` override: when provided, the fetch button asks it instead of `llm.discoverModels`. The CLI card supplies the route's group out of `llm.models` — the same host catalog the Runtimes page renders — because the CLI drivers register no model discovery; the models a live runtime loads are exactly the list to offer. A route whose section has not been saved into an active registration has no group, and the button says so (not active yet) instead of implying an empty provider.

The model rows, capacities, reset-to-inheritance, and the candidate picker are the existing `ModelListEditor` contract unchanged; writes land as the same minimal path ops (`['claude'|'codex', field]`) every family uses, so the settings-section hot reload the driver package already owns reaches the very next request.

## Consequences

- Claude CLI and Codex CLI rows open a real editor: command, timeout, and the driver's model catalog, editing `settings.yaml` through path ops under the driver section.
- The fetch button on a CLI card converges with the Runtimes page: what it offers is what the live runtime loads; adopting a pick writes it into the driver's `models`, which is the same advisory catalog `session.models` serves the composer's picker.
- `ModelListEditor`'s probe/discovery path is untouched; pi-ai endpoint interrogation behaves exactly as before.
- The `unknown` hint now names genuinely unknown namespaces only; a future adapter family repeats this pattern (curate `layoutOf`, decide the key field's meaning, choose a candidate source).

## Alternatives considered

- **Registering model discovery on the CLI adapter so the standard fetch applies** — rejected: the adapter is artifact-carried (its source is lost; the bundle registers nothing), and interrogating a local CLI for "what do you serve" has no endpoint semantics anyway — the runtime-loaded catalog is a host fact, not a probe.
- **Rendering the CLI sections through the deepseek layout (baseURL + models)** — rejected: `baseURL` is meaningless for a subprocess transport, and the API-key input would promise a credential path neither driver reads.
- **Leaving CLI configuration to hand-edited `settings.yaml`** — rejected: that is exactly the gap the directory entry's presence on the Models page already contradicts; a row that opens a dead card is worse than no row.
