# @deepseek-ai/dsh-client-ui-work-triggers

English | [中文](README.zh.md)

Work trigger directory and optional `work-center.delivery.triggers` preparation control over [dsh-work-triggers](../../business/work-triggers/README.md). Uses existing cyber theme tokens, bilingual labels, visible focus, and stacked narrow layouts.

## Interface

Prepare a target from an original execution in Work Center, inspect its fixed content, and explicitly choose it for a new rule. Agents use original task content and the current executor revision; formal workflows use their original publication and inputs. Time inputs require a valid ISO date and explicit UTC offset. Fixed intervals use milliseconds rather than calendar recurrence. Saving paused and creating enabled are separate actions.

The directory filters names, workspaces, and enabled state. Detail separates rule consumption, native admission, terminal observations, and retained notices. Original execution links open native transcripts. Pause affects future admissions without canceling existing work. Recovery uses the original occurrence identity and attempt; notice acknowledgment remains independent of human delivery acceptance.

The React-free manager owns read generations and mutation lifecycles. Errors retain last-known observations. Connection changes invalidate reads; reconnect never retries commands. The declared view store retains drafts and exact uncertain commands across page remounts. Creation recovery reuses its identity and content, then reads current state. Uncertain controls require authoritative reads and explicit local clearing before another decision. Clearing does not undo host work. Plugin disposal removes subscriptions, slots, and read publication.

## Model Experience

Indirectly, through [dsh-work-triggers](../../business/work-triggers/README.md#model-experience), whose native execution owners log the explicitly authorized task content.

#### KV Cache effect

Rendering and management make no model request. Native execution owners determine admitted tasks' prompts and prefixes.

## Known Limitations and Deferred Work

- The host must remain running. No browser-persistent drafts, offline writes, target editing, deletion, external notifications, or operating-system wake. A full reload discards local unconfirmed inputs; committed host records remain available.
