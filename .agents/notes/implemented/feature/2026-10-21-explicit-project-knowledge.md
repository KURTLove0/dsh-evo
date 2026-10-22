# Agent Note: Explicit project knowledge grants and captured citations

Status: implemented

English | [中文](2026-10-21-explicit-project-knowledge.zh.md)

## Problem

Conversation history and delivery-file registration do not define a project knowledge corpus. Searching every workspace file implicitly would grant access without an operator-selected scope; rereading a path as a citation would silently replace the material a model used when the file changes.

## Decision

`work-knowledge` owns explicit single-file grants, immutable decoded text versions, literal line retrieval, and exact citations. The provider combines a replaceable service, local filesystem/storage implementation, and typed gateway; its optional `tools` entry consumes the same service. The default Web composition mounts the provider, tools, and [knowledge page](../../../../packages/client/ui-work-knowledge/README.md) described by [F11](../../proposed/feature/2026-10-20-outcome-oriented-workbench-product.md#f11-project-knowledge); other compositions may opt in independently.

A grant fixes workspace identity/path and opaque canonical filesystem root/target identities. Registration reads metadata and enables the selected file. Indexing, retrieval, and citation reads check the enabled grant inside the service executor and require a new bounded readable-text observation in the original workspace. Missing, binary, denied, escaped, rebound, and reassigned sources cannot expose retained content. Disabling also blocks old citation reads and successful indexing retries, without erasing material already logged in earlier sessions. This private Host authorization is not a team identity system.

Successful indexing retains decoded UTF-8 text, its SHA-256, byte and line counts, capture time, and a contiguous version. Filesystem decoding owns BOM handling; the digest does not claim raw-byte identity. LF separates lines while a preceding CR remains captured. Failed attempts retain diagnostics independently of the latest successful version. Source revisions serialize changes; successful request receipts remain with captures, and the latest failed receipt remains until another attempt commits. Retries recover the original attempt plus current metadata rather than reread changed content. Capacity rejects without eviction or partial commits.

SQLite FTS5 supplies literal substring matching over the latest enabled, currently readable captures. Shorter-than-three-character queries use a literal scan. Parameters are bound and FTS expressions quoted; order is source identity and line, without semantic-ranking claims. Each explicit bounded search builds and closes a disposable in-memory index from committed captures. Canonical text and grants live only in the storage domain. Search returns complete lines, a further-results flag, exclusions, and independent current-file freshness. Citation reads verify caller workspace, source/version, digest, and inclusive line range before returning complete inert captured text.

The optional model tools derive workspace authority from the executing agent's session directory; a model cannot select another workspace. Ordinary tool calls/results retain the exact retrieved content in the session log. There is no automatic prompt injection, new loop behavior, session event, or model-dependent retrieval. Generic tool presentation is sufficient for inert JSON containing paths, citations, and exact lines; rendered result bounds include content-block wrappers.

The [portable execution-world decision](../architecture/2026-07-28-portable-execution-world-consumers.md) retains filesystem identity/decoding ownership. [Explicit project artifacts](2026-10-21-explicit-project-artifacts.md) retains accepted-delivery bytes and permits independent historical reads; knowledge grants deliberately require current access even for old captures. [Third-party memory MCP examples](2026-07-31-third-party-memory-mcp-examples.md) retain external provider interoperability without becoming knowledge-source providers. These independent decisions remain active; none is superseded or archived.

The page uses existing cyber tokens and page/navigation slots. Metadata, search, and citation replies carry independent generations; workspace and connection changes clear retrieved text. Exact pending command input survives page remounts, and reconnect only reads metadata. Recovered indexing acknowledgments display the original attempt and captured version independently from newer source metadata. Full reload loses local uncertainty while committed grants and captures remain queryable. Clipboard failure preserves selectable inert citation text. No project material is persisted by the page in browser storage.

## Alternatives considered

**Treat conversation search or delivery artifacts as the corpus.** Neither supplies explicit per-file knowledge grants or revocable citation access, and their existing history/provenance obligations remain different.

**Reread current content for every citation.** Current access authorizes reading; it does not change the exact captured evidence identified by a citation. Independent freshness reports changes without replacing that evidence.

**Add embeddings, a provider registry, or a persistent second index.** The confirmed first consumers need local UTF-8 literal inspection. SQLite already exists in the repository; a disposable derivative avoids another durable authority and extra source/provider protocols. Rebuilding each search costs index-construction time and limits this first provider to a bounded explicit corpus.

## Consequences

An enabled source can expose earlier captured text only while its original file remains currently readable. Revocation affects subsequent operations, not prior session logs. No recursive scanning, external formats/services, automatic indexing, source deletion or sharing is implied. Bounds apply to complete stored sources, the corpus, queries, responses, and rendered tool results. Admitted operations drain before storage closes.

## Verification

Focused provider/tool tests exercise real filesystem and JSON storage, literal Chinese/code queries, immutable versions, restart/retry identity, revocation/re-enable, missing/binary/rebound/escaped sources, cross-workspace denial, strict durable decoding, complete limits, serial conflicts, registry disposal, and teardown. A keyless real Web Loader scenario mounts the built provider/tools, runs native workbench agents, checks exact search/read content in durable tool results and later model input, and denies a new execution after revocation. Its expected transcript preserves text digests and line citations. The shipped browser composition verifies source registration/indexing, exact copied citations, inert script text, independent file changes, retained old versions, revocation and keyboard re-enable, lost registration and indexing acknowledgments across remounts, exact retry payloads and original indexed text after a disk edit, and committed metadata after reload. Chinese, light/dark schemes, and 320/375/414/768px layouts are exercised without extra model requests.
