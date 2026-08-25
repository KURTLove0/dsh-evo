# Agent Note: tui-agent 在终端中渲染 SDK 运行时

Status: implemented

[English](2026-08-25-tui-agent-terminal-ui.md) | 中文

## 问题

仓库已有三种驱动 harness 的方式——Web GUI、ACP 自动化服务器，以及由 Python/TypeScript SDK 消费的 JSON-RPC 运行时——但没有终端前端。若无指引，TUI 的作者很容易在新组合中挂载交互插件（重复 agent spine），或在事后从磁盘读取会话日志（没有实时流）。两条路径都绕开了所有外部消费者已共享的唯一表面：newline-delimited JSON-RPC 运行时协议。

## 决策

`examples/tui-agent` 是一个示例 leaf 而非 package：TUI 是客户端进程程序，不持有 Cordis 上下文，与它消费的 SDK 客户端完全一致。它以本 leaf 自己的 `cordis.yml` 启动既有的 `dsh-jsonrpc-agent` bin（`packages/examples/jsonrpc-demo/src/bin.ts`）——插件集与 [jsonrpc-agent](../../../../examples/jsonrpc-agent/README.zh.md) 相同，因为部署差异只在谁驱动轮次——并通过 `@deepseek-ai/dsh-sdk-client` 的低层 `HarnessClient` 说话。

低层客户端而非 `DeepSeekHarness.run()` 是关键承载：`run()` 拥有一次收集完成的 activity interval 并在 agent 空闲时返回，而 UI 是长期订阅，逐条渲染通知并跨轮次持续接受输入。TUI 全局订阅，把 `session.event` 过滤到当前根会话，并以 `session.status` 决定提示符可见性：`running` 隐藏输入行（readline 暂停，用一条 ANSI 擦除清掉当前行），`idle` 结束流、打印轮次摘要（结束原因、从 `assistant/message` 事件累计的 token 计量、reasoning 字符数），并恢复提示符且保留已缓冲的输入。

属于本 note 契约的渲染决策：流式 `text-delta` 逐字写出；`assistant/message` 仅作为未收到任何 delta 的 step 的兜底（从不分块的 adapter）；`reasoning-delta` 文本只计数不回显；`tool/call` 与 `tool/result` 各渲染一行带截断参数/结果摘要的行；`todo/write` 渲染整表快照。所有模型或工具产出的文本都经过清洗器，剥离 ANSI 转义、OSC 回复及除制表符与换行外的控制字符，因此流式内容无法重设样式或移动光标。事件表是 merge-extensible 的，渲染 switch 落入文档化的 default——未知插件事件不占行。样式遵循 `NO_COLOR` 并在非 TTY stdout 上禁用，这也正是 keyless 冒烟可以在管道上断言的原因。

TUI 与其运行时子进程都在 `node --import tsx` 下运行且 cwd 固定为仓库根目录，workspace 导入经根 tsconfig paths 解析（与 `dsh` 相同的源码启动契约）。`Ctrl+C` 与 `/exit` 是经 `HarnessClient.close()` 的干净关停——协议没有 prompt-cancel 方法，进行中的轮次从不被取消，只随运行时一起放弃。

## 验证

keyless 冒烟（`examples/tui-agent/tests/keyless-smoke.e2e.ts`）通过管道以 mock SSE 模型端点启动真实 TUI：断言横幅、回显的 prompt、流式回复、`completed` 轮次摘要、到达提供方请求的模型路由与工具清单，以及 `/exit` 后的退出码 0。真终端验证经 node-pty 在伪终端中运行同一流程：颜色启用、工具调用与工具结果行渲染、真实 `bash` 工具往返执行（`echo` 输出显示为结果行）、token 摘要存在、干净退出——七项检查全部通过。

## 考虑过的替代方案

| 替代方案 | 不采纳原因 |
|---|---|
| 带交互插件的 `dsh-tui` package | 重复 agent spine，并在任何消费者提出需求前增加产品表面；示例只负责组合接线。 |
| 把 TUI 作为插件挂进运行时 | 运行时的 stdout 为 JSON-RPC 保留；UI 必须住在客户端进程。 |
| 每行输入调用一次 `DeepSeekHarness.run()` | owned-run API 收集一次到空闲的 interval；它无法实时渲染通知或在收集中接受输入。 |
| 从持久化 JSONL 日志渲染 | 没有实时流；持久化读取与进行中的轮次竞争。 |
| TUI 框架依赖（Ink、blessed） | 渲染面只是一份滚动转录加输入行；`node:readline` 加转义序列不带任何依赖或 React 运行时。 |

## 后果

该 leaf 把低层 SDK 客户端展示为交互式前端的支持 seam，其冒烟测试兼作 TUI 渲染契约的管道模式消费者检查。会话恢复被有意省略：JSON-RPC 服务器按 id 惰性创建会话且不回放历史，因此 `/new` 开启全新会话，持久化日志仅服务审计。当协议落地 prompt-cancel 方法后，`Ctrl+C` 应增加轮中取消路径，该后续由本 note 负责。
