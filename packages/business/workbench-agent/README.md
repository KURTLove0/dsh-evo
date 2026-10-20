# dsh-workbench-agent

English | [中文](README.zh.md)

Independent workbench collaborators, with a replaceable service, native Harness provider, and typed Remote consumer. Agent identities, editable configuration, and run history live in the versioned `workbench_agents` storage domain. Plugin-composition [presets](../../preset/agent-presets/README.md) remain a separate feature.

## Configuration and execution

`runtimePreset` is required: it provisions the deployment's native tools, never identifies a workbench agent. Capacity defaults are 200 identities, 10,000 runs, eight active runs, six concurrent tasks per new identity, and 1 MiB per serialized record. All are configurable. The directory exposes the effective concurrency defaults and ceiling.

Names are unique, including archived identities. Edits compare the captured revision; conflicts reject without overwriting another editor. Copies receive new identities and empty histories. Archive preserves history, rejects new tasks, and cancels unfinished work; restore re-enables assignment.

Each submitted task receives a durable queued record and an independently owned session. The scheduler enforces global and per-agent concurrency and serializes tasks sharing a workspace directory. It captures configuration when starting execution; edits affect subsequent starts. A run covers its submitted message through whole-agent idle, including any follow-up or steering delivered during that interval. Stop marks the run cancelled and requests cancellation; its capacity remains occupied until cleanup completes. Retry creates a new record using the current configuration.

Instructions and selected skill bodies enter the session through logged context messages. Description and avatar are display-only. Missing or non-user-invocable skills fail execution explicitly. The runtime uses the selected model or resolves the deployment default at execution. Transcript persistence must succeed before completion is reported. Host restart marks running records interrupted; queued tasks remain eligible. Provider teardown cancels and drains live sessions before closing storage.

AI design tasks run with no tools, request a complete configuration as strict JSON, and retain the validated candidate in history. Only an explicit subsequent Save changes the identity; malformed candidates fail the design run. The Remote API uses the same service operations as other consumers.

## Model Experience

### Task context

#### What the model sees

A logged user-role context begins with `Agent: {name}`, `Identity: {id}`, and `Revision: {revision}`, followed by instructions and each selected `Skill: {name}` body. The submitted task follows as its own message. Display descriptions are excluded.

#### Token effect

One context message per task session; its token cost grows with the instructions and loaded skill bodies. Transcript replay preserves the captured text.

#### KV Cache effect

Each task establishes an independent request prefix. Instructions, skills, model, or runtime composition changes affect new starts; they do not rewrite existing transcripts.

### Configuration design

#### What the model sees

The builder receives the following instruction, followed by the generated configuration JSON Schema and the user's design request.

##### Builder instruction

```markdown
Design an agent configuration from the user's request. Return ONLY a JSON object matching this schema. Use runtime harness. Suggest no skills unless the user names them. Do not execute tasks. The result is a draft for human review.
```

#### Token effect

An independent design request adds the builder instruction, configuration JSON Schema, and user request. Its tool allowlist is empty.

#### KV Cache effect

Design uses an independent session and does not alter a task session's reusable prefix.

## Known Limitations and Deferred Work

- The shipped provider runs on the current Harness host. External CLI runtimes, runtime environment/argument/MCP management, multi-user Access rules, issues, mentions, squads, and scheduled triggers require their own providers and product capabilities.
- Identity creation is manual; AI design operates on a saved identity and returns a reviewable candidate.
- Queued and interrupted records retain task text and snapshots; capacity rejects new tasks rather than deleting history automatically.
