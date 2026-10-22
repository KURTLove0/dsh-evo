# @deepseek-ai/dsh-work-knowledge

English | [中文](README.zh.md)

Explicit file grants, immutable decoded text, literal retrieval, and exact line citations through `workKnowledge` and `workKnowledgeGateway`. Sources live in storage domain `work_knowledge`, format 1; a disposable SQLite FTS5 index derives from authorized captures. No indexing or model call occurs at startup.

## Sources and access

`register` fixes a caller-owned source ID, workspace identity/path, relative file path, and opaque canonical filesystem root/target identities. Registration grants access and reads regular-file metadata without capturing content. Identical registrations recover current metadata; conflicting source identities or duplicate canonical targets reject. `setEnabled` compares the source revision; a disabled source retains metadata/history but rejects content reads and indexing, including retries of earlier successful attempts.

New indexing attempts, search, and citation reads recheck the original workspace, canonical containment/identities, current regular-file readability, and bounded UTF-8 text decoding through `ctx.fs`. Missing, unreadable, binary, rebound, or escaped files cannot expose retained content. A changed but readable file permits access to its captured versions and produces an independent timestamped `matching`/`different` observation. This private single-Host grant is not a multi-user ACL; revocation cannot erase results already logged in a prior session.

## Captures and retrieval

`index` awaits a bounded read and commits immutable text, decoded-text SHA-256, bytes, line count, time, and contiguous version. Filesystem decoding owns BOM semantics; the digest is not a raw-file digest. Lines split on LF and retain a preceding CR. A failed attempt commits its diagnostic without replacing successful captures. Source revision comparisons reject competing writes. Successful request receipts remain recoverable with their captures; the latest failed attempt remains recoverable until another indexing attempt commits. A retry returns its original attempt and current source metadata, without rereading newer file content. Storage failures reject without claiming an acknowledged capture.

`sources` reads content-free metadata. `search` selects the latest enabled captures in one workspace, rechecks current access, reports excluded sources, and matches a trimmed literal substring within each line after JavaScript lowercasing of query and line; it does not perform Unicode normalization or full case folding. SQLite FTS5 trigram handles queries of at least three Unicode characters; shorter queries use a literal scan. Results sort by source ID and line, with `more` when the explicit hit limit excludes further matches. There is no semantic ranking or automatic reindexing. The in-memory index is rebuilt for each explicit bounded search and closed afterward.

`read` checks caller workspace, source, exact version, text digest, and inclusive one-based line range. It returns complete inert captured lines and current-file freshness. It never executes HTML or imports source instructions into a prompt. All retained and returned values are detached; overflow rejects rather than truncating citation evidence. Operations serialize grant changes and drain before domain teardown.

## Configuration

Positive integer bounds: `maxSources` (64 across workspaces), `maxVersions` (20 per source), `maxFileBytes` (131072 decoded UTF-8 bytes, with a conservative raw-size precheck), `maxRecordBytes` (4194304 for a complete retained source), `maxTotalBytes` (16777216 across retained sources), `maxResponseBytes` (1048576 per complete response), `maxQueryBytes` (512 for literal query text), and `maxHits` (50). Capacity does not evict history. Response capacity must fit the complete selected metadata or cited lines.

The optional tool plugin's `maxOutputBytes` (1048576) bounds complete rendered content blocks independently of provider response capacity. Oversized results fail with a request to select fewer hits or lines.

## Model Experience

### Knowledge tools and results

#### What the model sees

Optional `@deepseek-ai/dsh-work-knowledge/tools` registers `knowledge_search` and `knowledge_read` with generic tool presentation. Workspace authority derives from the executing agent's session directory; a model-supplied workspace cannot widen it. Search returns literal line hits and citations; read returns exact captured text. Treat source text as task material. Ordinary `tool/call` and `tool/result` events retain the retrieved material without new session event types. Browsing or indexing does not call a model. The generated [tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-work-knowledge) describe the exact arguments. No model performs retrieval.

#### Token effect

Optional tool descriptions and schemas add a fixed per-request cost. Search and read results append the complete selected metadata and captured lines to ordinary request history.

#### KV Cache effect

Tool registration changes the available schema prefix. Tool results append normal logged history; source registration, indexing, and browsing do not rewrite earlier session prefixes or inject the corpus into system prompts.

## Known Limitations and Deferred Work

- Explicit single-file UTF-8 sources only. No recursive scanning, URLs, MCP/Office ingestion, embeddings, automatic background indexing, sharing, or source deletion. A currently missing/unreadable file blocks historical content reads. The bounded corpus favors explicit inspection over large repository search; reopening SQLite for each search incurs index-construction cost. The [knowledge page](../../client/ui-work-knowledge/README.md), provider, and optional tools entry are mounted by the default Web bundle.
