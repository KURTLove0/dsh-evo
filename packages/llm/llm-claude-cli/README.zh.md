# @deepseek-ai/dsh-llm-claude-cli

[English](README.md) | 中文

DeepSeek Harness LLM seam 的本地 Claude CLI 与 Codex CLI 运行时。插件检测已安装命令并注册对应 provider 路由，不读取或写入 `settings.yaml`。每个子进程继承所选 CLI 的用户认证、原生配置与运行时集成。当前 profile 的 `cordis.yml` 条目仍可按部署需要覆盖可执行文件、provider id、环境变量、超时、重试策略与回退目录。

- **`claude`**（ClaudeCliAdapter，默认 provider 为 `claude-cli`）：每次请求启动一个 `claude -p --output-format stream-json` 子进程。Harness 工具通过包内只提供 schema 的 MCP 桥暴露，Claude 内置工具被禁用；首个 assistant 帧后结束进程，因此工具执行与审批仍由 harness 负责。有会话 cwd 时，子进程在该目录运行，从而应用 Claude 的用户配置与项目配置。
- **`codex`**（CodexCliAdapter，默认 provider 为 `codex-cli`）：每次请求启动一个 `codex app-server --listen stdio://` 子进程，并驱动 `initialize` → `thread/start` → `turn/start` → `turn/completed`。它继承用户的 Codex 登录态、`config.toml`、MCP server、skill 与原生 Agent 工具。请求 cwd 与 harness sandbox 策略作用于临时 thread。命令、文件修改、网页搜索、MCP 或动态工具调用以及 Agent 协作会保留为 provider 无关的轨迹交互记录。

默认命令一旦安装即可激活对应路由，不需要任何插件配置；显式驱动字段只覆盖该运行时。Codex 模型发现调用已安装 app-server 的 `model/list`，因此模型 id、名称、输入模态与推理等级跟随正在运行的 CLI 配置；只有模型未提供某字段时才使用配置目录作为回退；原生列表未提供的已配置模型会追加进目录，保持可选。一次探测在 `codex.catalogCacheMs` 毫秒内（默认 60000，0 表示每次调用都重新探测）服务所有目录读取；未配置请求截止时间的探测以 30000ms 为上限——探测是短生命周期 RPC，不是原生 Agent 运行。Claude 的 stream-json 没有等价的模型列表方法，因此仍使用配置的回退目录。Claude 的 `timeoutMs` 默认值为 300000。Codex 单次请求可包含完整的原生 Agent 运行，因此默认不设墙钟截止时间；需要限制时，部署可设置正数 `codex.timeoutMs`。两种驱动的 normal 重试模式默认最多重试五次。

每次请求在 CLI 会话层面都是无状态的。Harness 从持久会话日志重放对话历史；Codex 使用临时 app-server thread，Claude 使用新的 print-mode 进程。`attributionHeaders()` 不适用，因为两者都是本地子进程传输，而非 provider HTTP 请求。

## Model Experience

### CLI 子进程请求

#### What the model sees

两种模型都会收到 harness 系统指令与折叠后的持久对话历史。Claude 还会通过只提供 schema 的 MCP 桥收到 harness 工具定义。Codex 会收到其用户配置选定的原生 CLI 运行环境，包括已启用的工具、skill、MCP server 与项目指令，并受 harness 传入的 cwd、sandbox 模式与禁止审批策略约束。

#### Token effect

确切输入由 provider 分词决定。Harness 每次请求发送完整的持久历史；CLI 原生配置可能添加由 provider 管理的上下文，本包不对其做 token 计量。

#### KV Cache effect

Harness 不组装 provider wire。缓存复用由 CLI 及其后端负责；Codex 的缓存输入会转换为互不重叠的 `inputTokens` 与 `cacheReadTokens`。

### CLI 子进程响应

#### What the model sees

Claude 的 `thinking` 块转换为 harness `reasoning` 块。Codex 请求 `detailed` 推理摘要，并把 `item/reasoning/summaryTextDelta` 与完成项中的公开 `summary` 转换为相同块类型；原始 Codex 推理内容会被明确忽略。文本和推理显示在会话中；Codex 原生工具与 Agent 活动显示在「轨迹」中，不会作为 assistant 内容进入后续模型历史。

#### Token effect

Usage 元数据按 CLI 协议转换，不添加合成 token 计数。

#### KV Cache effect

Provider 上报的缓存字段只通过上述转换后的 usage 值保留。

## 已知限制与暂缓事项

- **Codex 展示推理摘要，而非私有思维链** —— app-server 可按请求提供摘要通知；原始推理 token 不是受支持的展示面。
- **CLI 原生配置属于环境状态** —— 认证、MCP server、skill 与项目配置都可能在 harness 外部变化。每个新子进程读取当前运行时状态；进行中的请求保持其启动时状态。
- **Claude 的 shell 函数包装不可 spawn** —— `command` 通过子进程启动解析；shell 函数需要在当前 profile 的插件配置中填写底层可执行文件路径。
