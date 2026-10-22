# @deepseek-ai/dsh-client-ui-work-remote

English | [中文](README.zh.md)

Remote execution page over [Work Remote](../../business/work-remote/README.md), composed through the existing sidebar and page slots. The default Web application mounts the calling provider with an empty peer list; operators configure authenticated peers and an independent remote receiver. Runtime-directory entries do not authorize execution.

## Interface

Choose a configured machine, inspect its pinned Host/principal and credential reference/presence, then choose an authorized remote workspace and executor. Agent submissions freeze the selected revision and structured task. Workflows freeze a formal publication and explicit JSON inputs. Workspace paths, runtime, skills and MCP names describe the remote execution world; model credentials remain remote. Catalog, history and original-submission detail retain independent freshness and errors.

The React-free runtime manager owns observations and read generations. The declared view store retains drafts and authority-pinned uncertain commands across page remounts. Reconnect reads state without repeating writes. An equal in-flight command coalesces; explicit submit recovery reuses its original UUID and content. Original-admission recovery compares the retained attempt. Reassigning a peer id cannot redirect retained commands to a different Host or principal. Clearing local uncertainty does not undo remote work.

Inspect native status, session/run identities, observation time and recorded text independently of admission and acceptance. Files and ordinary tool approvals remain in the remote native application. Workflow decision context includes original waiting attempt, instruction and actual inputs; stop, recovery and approval/rejection require explicit confirmation. Missing control acknowledgments require a fresh authoritative read before another decision. The UI consumes semantic cyber theme tokens, paired labels, visible focus and narrow stacked layouts.

## Model Experience

Indirectly, through [dsh-work-remote](../../business/work-remote/README.md#model-experience), whose remote native owners log submitted task content.

#### KV Cache effect

Rendering and inspection create no model request. Native execution owners determine prompts and prefixes.

## Known Limitations and Deferred Work

- Drafts and unconfirmed local commands last for the loading plugin lifetime; a full reload loses them. Committed remote history remains discoverable. No offline writes, automatic polling/retry, file transfer, ordinary remote tool-approval proxy, or multi-user identity system.
