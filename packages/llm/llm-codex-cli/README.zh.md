# dsh-llm-codex-cli

[English](README.md) | 中文

将已安装的 Codex app-server 接入本地 LLM 运行时。插件在运行时目录声明 `codex-cli`，当配置的可执行文件可解析时激活路由。它使用共享子进程服务和 JSON-RPC 传输，不下载 CLI 或平台载荷。

## 配置

`command` 默认为 `codex`，`provider` 为 `codex-cli`，`timeoutMs` 为 900000，`catalogTimeoutMs` 为 30000，`catalogCacheMs` 为 60000，`graceMs` 为 3000，`diagnosticMaxBytes` 为 65536。缓存成功读取的原生模型目录，失败后可以重试。参考模型目录和推理级别来自 `model/list`。目录声明 `defaultModel: default`，选择该项时不设置原生线程模型，由 Codex 应用自身配置；显式模型原样传递。

每个请求在任务工作目录中启动临时 app-server 线程，进程继承用户的 Codex 登录与原生集成。沙箱模式遵循 Harness 请求，默认为只读；辅助请求始终只读。审批策略为 `never`，不支持的宿主交互请求以失败结束，不予批准。完成、失败、取消和流消费者提前返回都会终止并等待进程树清理。

## Model Experience

### 原生请求

#### What the model sees

系统指令与持久化会话以 `[system]`、`[user]` 等角色分隔的文本重放。Codex 原生配置可以补充项目指令、技能和 MCP 工具，图片输入被明确拒绝。

#### Token effect

原样报告原生用量，不生成估算值；缓存输入与非缓存输入分开记录。原生命令和工具活动保留为执行轨迹，不进入后续模型上下文。

#### KV Cache effect

每个请求使用临时原生线程，提供方缓存行为由 Codex 决定。Harness 会话日志仍是重放文本的来源。

## Known Limitations and Deferred Work

- 原生轮次拒绝 Harness 的温度、停止序列和最大 token 覆盖。
- 适配器接受文本输入，输出助手文本、用量及公开原生活动，不展示私有推理。
- 原生集成遵循用户的 Codex 配置；此适配器不将 Harness 工具 schema 安装为原生动态工具。
