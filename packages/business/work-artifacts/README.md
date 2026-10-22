# @deepseek-ai/dsh-work-artifacts

English | [中文](README.zh.md)

Explicit project-file registration through `workArtifacts` and `workArtifactGateway`. The provider retains immutable bytes and execution provenance in storage domain `work_artifacts`, format 1. It does not execute work, write workspace files, or infer outputs from model prose.

## Registration and history

A registration fixes the operator-supplied path and workspace. Each version stores its byte count, SHA-256, encoding, capture time, and source execution metadata. Current-file registration reads a settled execution's workspace through the filesystem provider, checking containment and the raw byte bound. Its execution link does not prove file authorship or human acceptance.

Accepted-review promotion reads the exact committed human review and retains its captured bytes, review revision, delivery version, and review time. It does not reread the current file. Historical previews therefore survive changed or deleted workspace files. UTF-8 previews preserve a leading byte-order mark; invalid UTF-8 or NUL-containing content uses base64. Consumers display text inertly and identify binary content without executing it.

Writes compare `expectedVersion` and retain `requestId` with the original receipt. Identical retries return that receipt before consulting current sources or files, including after a newer version or host restart. Reusing an identity for different inputs rejects. Duplicate workspace/path registration requires explicitly appending to the existing identity. Capacity failures preserve all earlier history; no automatic eviction occurs. Notifications follow durable commit; observer errors do not invalidate the receipt. Teardown drains admitted operations.

## Queries and observations

Queries return content-free latest-version metadata, filtered by text, workspace, source kind, and latest capture origin. Continuations belong to one committed directory generation and filter selection; changes and host restart invalidate them. Reads return one exact snapshot and a content-free version history without internal request hashes. Metadata queries never read live files.

`inspectCurrent` explicitly observes the current file against a selected retained version, recording its timestamp and matching, different, missing, or unavailable state. It does not alter history or transfer an earlier human acceptance decision to a new file.

## Configuration

Positive integer limits: `pageSize` (25), `maxPageSize` (100), `maxArtifacts` (1000), `maxVersions` (20), `maxFileBytes` (131072 raw bytes), `maxRecordBytes` (4194304 UTF-8 bytes for the complete retained record), and `maxResponseBytes` (1048576 UTF-8 bytes for a complete response). `pageSize` cannot exceed `maxPageSize`. Limits reject oversized values rather than truncating evidence. Historical read availability depends on response capacity.

## Model Experience

None, as registration, preview, and current-file inspection do not call a model or modify session input.

#### KV Cache effect

No model request or session-prefix mutation occurs.

## Known Limitations and Deferred Work

- Private single-host registry with bounded file snapshots. No automatic discovery, sharing, deletion, export, executable preview, or full-document rendering. Paths and captured files can contain user material. Path aliases are separate operator identities. Current-file reads require the original workspace and settled source execution; historical reads use retained bytes.
