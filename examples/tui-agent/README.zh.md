# tui-agent

[English](README.md) | 中文

基于 SDK JSON-RPC 运行时的交互式终端 UI。TUI 以子进程方式启动 [`dsh-jsonrpc-agent`](../../packages/examples/jsonrpc-demo/README.zh.md) bin 并加载本 leaf 的 [`cordis.yml`](cordis.yml)，实时渲染会话事件流（流式 assistant 文本、工具调用与结果、todo 快照、subagent 行、每轮 token 摘要），并把键盘输入转为排队的 prompt。它没有 UI 依赖：`node:readline` 加 ANSI 转义序列，在 TTY 上带样式，在 `NO_COLOR` 或管道下输出纯文本。

## 运行

在仓库根目录运行（tsx 通过根 tsconfig 解析 workspace 导入）：

```sh
DEEPSEEK_API_KEY=... node --import tsx examples/tui-agent/src/tui.ts
```

运行时子进程继承环境变量：

| 变量 | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | 传给 OpenAI 兼容宿主端点的凭据 |
| `DEEPSEEK_BASE_URL` | `dsh-llm-deepseek` 使用的宿主端点 |
| `DSH_CWD` | bash 和文件系统工具使用的 agent workspace（默认：TUI 的 cwd） |
| `DSH_MODEL` | 每个会话的模型路由（默认 `deepseek-v4-flash`） |
| `DSH_SESSION_ROOT` | JSONL 会话目录（默认 `<workspace>/.dsh-tui-sessions`） |
| `DSH_SYSTEM_PROMPT` | 由部署提供的编码人格 |
| `DSH_TUI_SESSION_ID` | 固定 session id 覆盖（测试钩子） |
| `NO_COLOR` | 禁用样式 |

每行输入一个 prompt；`/new` 开启新会话，`/clear` 重置屏幕，`/exit`（或 Ctrl+C）通过 SDK 客户端的 shutdown 回收阶梯关闭运行时并以 0 退出。`Ctrl+C` 是干净关停而不是轮中取消——协议没有 prompt-cancel 方法（[协议限制](../../packages/sdk/protocol/README.zh.md)）。

该组合与 [jsonrpc-agent](../jsonrpc-agent/README.zh.md) 一致：`bash`、`read`/`write`/`edit`、前台 `subagent` 与 `todo_write`，外加 JSONL 持久化和自动上下文压缩。TUI 消费低层 [`HarnessClient`](../../packages/sdk/client/README.zh.md) 而非 owned-run API，因为渲染是跨轮次的长期订阅，而不是一次收集完成的 activity interval。轮次摘要的 token 计量来自 `assistant/message` 事件；reasoning 文本只计数，不回显。
