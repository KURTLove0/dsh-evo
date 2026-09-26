# @deepseek-ai/dsh-llm-claude-cli

[English](README.md) | 中文

DeepSeek Harness LLM seam 的本地 CLI 运行时。一个插件、两个 CLI 驱动、一份共同契约：CLI 进程只是模型传输层——工具执行、审批与日志留在 harness 侧；CLI 自身的 agentic 循环从不运行；每次调用都从会话日志重放历史（不做 CLI 侧会话续接）。

- **`claude`**（ClaudeCliAdapter，默认 provider `claude-cli`）：每次调用一个 `claude -p --output-format stream-json` 子进程。对话折叠为单条 stdin user 帧；读到首个 assistant 帧即 kill 整个进程树（单轮截断），它发出的工具调用由 harness 执行而非 CLI 自身。工具经包内只分发 schema 的 MCP 桥（`./mcp-server`）暴露，`--tools ""` 从存在性上移除 CLI 的内置工具。
- **`codex`**（CodexCliAdapter，默认 provider `codex-cli`）：每次调用一个 `codex app-server --listen stdio://` JSON-RPC 子进程，走 initialize → thread/start → turn/start → turn/completed 生命周期。每次调用私有的 `CODEX_HOME`（渲染 `config.toml` 的 `[mcp_servers.dsh]`）把受管会话与用户的 `~/.codex` 隔离，认证也随之隔离：部署凭据必须经驱动配置的 `env`（API key）或 `extraArgs`（`-c provider` 覆盖）提供——交互式 ChatGPT 登录态不可用。

插件把 `cordis.yml` 条目配置叠在可选的 `llm-claude-cli` 用户设置段（`ctx.settings`）之下：command、目录或超时的变化直达下一次请求而无需重启；`codex:` 段的出现（或消失）原地激活（或停用）codex 路由，进行中的流保持它启动时的事实。claude 路由挂载即注册（含休眠目录项）；codex 路由在其段存在或本机探测到 codex CLI 时注册——仅凭探测即以驱动默认值激活，`codex:` 显式段只做覆盖（command、目录、超时），因此可用的 codex 运行时不要求任何 `settings.yaml` 条目。`retryPolicy` 默认 normal 模式五次重试；两驱动默认 `timeoutMs` 300000、`contextWindow` 200000。可选 `models` 目录（codex 如 `gpt-5-codex`，claude 如 `sonnet`/`opus`/`haiku`）供发现侧消费；请求本身不受限制。

`attributionHeaders()` 不适用于任一驱动：传输层是本地子进程，不是提供方 HTTP 请求。

## Model Experience

### CLI 子进程请求

#### What the model sees

所选 CLI 驱动的模型接收 harness 系统提示词、折叠后的消息历史（每次调用一条 stdin user 帧）与 MCP schema 桥的工具 schema，不含适配器自挥的提示词文本。claude 驱动禁用 CLI 内置工具（`--tools ""`），因此唯一存在的工具就是 harness 自己的；codex 驱动的私有 `CODEX_HOME` 把用户全局 MCP server 挡在外面，同样成立。

#### Token effect

提供方分词在 CLI 进程内决定确切输入。harness 每次调用发送一条折叠 user 帧、下次调用重新折叠全部历史，因此 CLI 侧提示词 token 只由会话日志决定。

#### KV Cache effect

harness 不组装提供方线上流量；usage 以不重叠的 input/output 口径送达（codex 上报时 input 侧为 `inputTokens` 减 `cachedInputTokens`）。提供方侧缓存复用是 CLI 自身行为，本适配器既不可观测也不可控。

### CLI 子进程响应

#### What the model sees

claude stream-json 帧与 codex app-server item 事件转换为 harness 的 reasoning、text、tool-call、usage 与 finish 块；工具参数以原始 JSON 字符串到达。claude 进程树在首个 assistant 帧即被 kill，codex turn 在 `turn/completed` 结束——CLI 自身的 agentic 循环从不越过一turn。

#### Token effect

usage 元数据逐驱动折算（同上 codex 的 cached-input 相减）；不发明任何合成 token 计数。

#### KV Cache effect

与请求侧相同：提供方上报的缓存字段仅以折算后的形式随 CLI usage 到达。

## 已知限制与暂缓事项

- **Codex 认证随会话隔离** —— 私有 `CODEX_HOME` 把用户全局 MCP server 挡在受管会话之外，交互登录态也随之不可用；未认证主机上每次调用收敛为单个 `error` finish 而非无限重试。请在驱动段提供 `env`/`extraArgs` 凭据。
- **Claude 的 shell 函数包装不可 spawn** —— `command` 走子进程 spawn 路径解析；shell 函数（如被环境包装的 `claude`）需要其底层二进制路径。
