# @deepseek-ai/dsh-llm-cursor-cli

[English](README.md) | 中文

将 Cursor CLI 作为本地 agentic 模型运行时接入 `ctx.llm`。当 `cursor-agent` 可执行时，插件注册 `cursor-cli` provider；否则保留休眠的可配置 provider 条目，让运行时设置页说明 Host 依赖缺失。每次请求都会启动新的 `cursor-agent --print --output-format stream-json --stream-partial-output` 进程，并通过 stdin 回放完整的 Harness 对话。Cursor 原生执行的命令、文件、搜索和 agent 活动会转成 provider 无关的轨迹交互，而不是 Harness 工具调用。

## 配置

```yaml
- id: llm-cursor-cli
  name: '@deepseek-ai/dsh-llm-cursor-cli'
  config:
    command: cursor-agent
    provider: cursor-cli
    timeoutMs: 900000
    catalogTimeoutMs: 30000
    extraArgs: []
    env: {}
    models:
      - id: auto
        name: Auto
```

适配器通过 `cursor-agent models` 探测选择器模型，并追加 CLI 未报告的配置回退项。目录仅供提示；任何已选模型 id 都会原样传给 `--model`。原生登录状态和 Cursor 配置仍是权威来源。子进程接收共享 subprocess 服务清除凭据后的父进程环境；如需传入 `CURSOR_API_KEY` 或其他凭据，必须通过 `env` 显式配置。

Harness 的 `read-only` 映射为 Cursor 的 `--mode ask --sandbox enabled --trust`，`workspace-write` 映射为 `--force --sandbox enabled`，`danger-full-access` 映射为 `--force --sandbox disabled`。辅助标题和压缩请求始终使用已信任、启用 sandbox 的 ask mode。请求未携带 sandbox mode 时，适配器会安全收紧到相同的只读模式，因为 headless 进程无法回答 Cursor 的 workspace trust 提示。`--trust` 只确认所选 cwd，在 ask mode 下不会授予写入权限。适配器不会恢复 Cursor 会话，也不会持久化 Cursor 侧对话状态。

`temperature`、`maxTokens`、停止序列、推理强度选择和图片输入会在启动进程前失败，因为 Cursor headless CLI 没有对应的逐请求控制项。Harness 工具 schema 不会转发：Cursor 自主管理原生工具循环和权限决策，Harness Session 只记录 Cursor 返回的答案、用量和活动轨迹。

## 模型体验

### 请求

#### 模型看到什么

`cursor-agent` 接收单个确定性的角色分隔 stdin prompt，其中包含 Harness system prompt 和持久消息历史。文本、推理、工具调用参数和工具结果仍然可见；图片输入会被拒绝。

#### Token 影响

每次请求都会回放完整对话。Cursor 可提供时，适配器报告其原生输入、输出和缓存 token 计数。

#### KV Cache 影响

稳定历史会生成稳定的 prompt 前缀，但缓存的所有权与复用仍由所选 Cursor 模型运行时管理。

### 响应

#### 模型看到什么

Cursor 先执行自身的原生 agent 循环，再返回最终答案。原生工具活动不会成为后续模型消息。

#### Token 影响

取得成功的终止结果后，适配器才把最终助手文本和推理作为持久 Harness 内容发出；原生活动属于轨迹元数据，不增加回放 token。响应内容会先缓冲，避免 Cursor 连接重试重复内容或保留已放弃的尝试。

#### KV Cache 影响

只有保留的响应内容会追加到下一次回放 prompt；轨迹交互不会改变下一次缓存前缀。

## 已知限制与后续工作

- Cursor CLI 是 Host 依赖；本包既不安装它，也不负责登录。
- Cursor 自主管理工具执行和权限。Harness 工具 schema、审批与文件 sandbox 不会介入原生 agent 循环。
- 每次请求在 Cursor 侧均为无状态。较长的 Harness 历史会折叠为一个 prompt，而不是通过 Cursor Session id 恢复。
- 助手文本与推理会在 Cursor 发出终止结果后一次性输出，而非逐 token 输出，因为 stream-json 可能在连接重试前再次发送已完成的尝试。
- 原生模型探测需要解析当前的人类可读 `cursor-agent models` 输出，因为 CLI 没有提供 JSON 目录格式。
