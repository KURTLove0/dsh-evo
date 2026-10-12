# @deepseek-ai/dsh-subagent-cursor

English | [中文](README.zh.md)

This optional Profile Bundle registers the shared [ACP subagent provider](../subagent-acp/README.md) as `cursor`. Each delegation starts `cursor-agent acp` in the parent Session's workspace, creates a fresh Cursor session, sends one task, and returns the assistant's accumulated answer through the shared subagent result. The Bundle has no executable of its own: install Cursor CLI separately and make `cursor-agent` available on the Host's `PATH`.

## Installation and configuration

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-cursor
dsh --profile <name>
```

Restart the Profile after installation. Its patch registers a dormant Host provider and starts no Cursor process. Copy a full Agent Preset, then remove `disabled: true` from its `tool-subagent-cursor` row to expose `subagent_cursor` to new Sessions. The row binds `provider: cursor`, uses `backgroundMode: one-shot`, and sets `maxDepth: provider-managed`; the generic Job tools collect or cancel an explicit background run.

The Bundle configures the ACP provider with `command: cursor-agent`, `args: [acp]`, and `permission: reject`. Override the complete `subagent-cursor` Host row in a Profile patch to set another executable path, a distinct `providerName`, `permission: allow`, or explicit child `env`. The ACP provider validates the remaining [configuration](../subagent-acp/README.md). Its subprocess scrub removes ambient credential variables; supply `CURSOR_API_KEY` explicitly in `env` if Cursor must authenticate by API key. Cursor's own login, model, rules, and project settings otherwise remain authoritative.

`reject` cancels Cursor ACP permission requests without presenting them to a human. `allow` selects an offered allow option; choose it only for a Profile whose child may perform those actions. Cursor may run actions governed by its own settings without sending an ACP permission request. The Host's workspace sandbox and approval policy do not confine the Cursor child; Cursor CLI owns its action policy.

## Model Experience

### Child task

#### What the model sees

Cursor receives the standalone delegated text and workspace path in a fresh ACP session. It does not receive the parent conversation, persona, tool filter, structured output request, or depth policy. Cursor's native configuration determines its model and tools.

#### Token effect

Cursor uses a separate model context; its tokens do not enter the parent context.

#### KV Cache effect

Cursor's independent request and native configuration determine cache reuse.

### Parent result

#### What the model sees

In a foreground call, `subagent_cursor` returns the final accumulated assistant text, or the shared subagent error for a non-completed run. With background execution, it first returns a Job id and later delivers completion or failure through the generic Job controls. Cursor reasoning, tool updates, and stderr do not become parent model input.

#### Token effect

Only the returned text or error, and any background Job messages, extend the parent's context.

#### KV Cache effect

The new result and Job messages append after the existing parent prefix.

## Known Limitations and Deferred Work

- **Host CLI dependency** — installation does not bundle Cursor CLI, authenticate it, or pin its version; a missing `cursor-agent` fails on the first delegation.
- **One fresh process and session per run** — no Cursor session resume, process pool, or progress stream is exposed to the parent.
- **ACP permission policy only** — the provider answers ACP permission requests; Cursor's native settings may authorize actions without one, and there is no human approval channel through this Bundle.
- **No parent-enforced optional capabilities** — output schemas, child personas, tool filters, and depth limits are unavailable through the ACP provider.
