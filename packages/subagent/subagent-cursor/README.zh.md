# @deepseek-ai/dsh-subagent-cursor

[English](README.md) | 中文

这个可选 Profile 组合包将共享的 [ACP subagent provider](../subagent-acp/README.zh.md) 注册为 `cursor`。每次委派都会在父 Session 的工作目录中启动 `cursor-agent acp`，创建新的 Cursor 会话，发送一次任务，并通过共享 subagent 结果返回累计的助手回答。组合包不包含 Cursor 可执行文件：需单独安装 Cursor CLI，并让 Host 的 `PATH` 能找到 `cursor-agent`。

## 安装与配置

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-cursor
dsh --profile <name>
```

安装后重启 Profile。其 patch 只注册休眠的 Host provider，不会启动 Cursor 进程。复制一份完整 Agent Preset，删除其中 `tool-subagent-cursor` 行的 `disabled: true`，即可向新 Session 暴露 `subagent_cursor`。该行绑定 `provider: cursor`，使用 `backgroundMode: one-shot` 和 `maxDepth: provider-managed`；显式后台运行由通用 Job 工具收集或取消。

组合包将 ACP provider 配置为 `command: cursor-agent`、`args: [acp]` 和 `permission: reject`。可在 Profile patch 中完整覆盖 `subagent-cursor` Host 行，指定其他可执行文件路径、不同的 `providerName`、`permission: allow` 或显式子进程 `env`。其余配置由 [ACP provider](../subagent-acp/README.zh.md) 校验。子进程环境会清除继承的凭据变量；若 Cursor 通过 API key 认证，须在 `env` 中显式提供 `CURSOR_API_KEY`。其他登录、模型、规则和项目设置由 Cursor 自身决定。

`reject` 会取消 Cursor 的 ACP 权限请求，不会向人发起审批。`allow` 会选择一个提供的允许选项；仅在允许子进程执行这些操作的 Profile 中使用。Cursor 也可能按自身设置执行无需 ACP 权限请求的操作。Host 的工作区沙箱与审批策略不约束 Cursor 子进程；Cursor CLI 自行管理操作权限。

## Model Experience

### 子任务

#### 模型可见内容

Cursor 在新的 ACP 会话中收到独立委派的文本和工作目录，不会收到父会话的对话、persona、工具筛选、结构化输出请求或深度策略。模型和工具由 Cursor 原生配置决定。

#### Token 影响

Cursor 使用独立的模型上下文，其 token 不进入父会话上下文。

#### KV Cache 影响

缓存复用取决于 Cursor 的独立请求及其原生配置。

### 父会话结果

#### 模型可见内容

前台调用时，`subagent_cursor` 返回累计的最终助手文本；运行未完成时返回共享 subagent 错误。后台运行先返回 Job id，之后由通用 Job 工具取得完成或失败结果。Cursor 的推理、工具更新和 stderr 不进入父会话模型输入。

#### Token 影响

只有返回的文本或错误，以及可能的后台 Job 消息，会增加父会话上下文。

#### KV Cache 影响

新结果和 Job 消息追加在现有父会话前缀之后。

## Known Limitations and Deferred Work

- **依赖 Host CLI** — 安装组合包不会捆绑 Cursor CLI、完成登录或固定其版本；找不到 `cursor-agent` 时首次委派失败。
- **每次运行使用新进程和会话** — 不支持恢复 Cursor 会话、进程池或向父会话推送进度。
- **仅处理 ACP 权限请求** — provider 只应答 ACP 权限请求；Cursor 原生设置可能允许无需请求的操作，本组合包也没有人工审批通道。
- **不支持父会话强制的可选能力** — ACP provider 不支持输出 schema、子 persona、工具筛选或深度限制。
