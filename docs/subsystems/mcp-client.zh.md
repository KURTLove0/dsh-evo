# MCP 客户端

[English](mcp-client.md) | 中文

[MCP 客户端](../../packages/mcp/mcp-client/README.zh.md)通过官方 SDK 桥接工具。工具桥接及重连由插件负责；临时 `probeMcp` 仅初始化并 ping，不发现、注册或调用工具。stdio 使用显式工作目录和已配置环境，并隐藏诊断输出。

检测返回开始及完成时间、连接结果和独立的清理结果，不转发服务端错误。调用方提供检测时限、SDK 关闭完成后的关闭事件等待时限及可选取消信号。清理未确认时，调用方必须拒绝重叠重试。

```ts type-equiv
/** Explicit deployment bounds and caller cancellation for one probe. */
interface McpProbeOptions {
  /** Positive total initialization/ping deadline, bounded by Node timer limits. */
  timeoutMs: number
  /** Positive close-event wait after the SDK shutdown sequence has settled. */
  closeTimeoutMs: number
  signal?: AbortSignal
}
```

```ts type-equiv
/** Safe connection observations; protocol failures never return server text or secrets. */
interface McpProbeOutcome {
  startedAt: number
  checkedAt: number
  status: 'connected' | 'failed' | 'timed-out' | 'cancelled'
  /** A caller must refuse overlapping retries after failed cleanup. */
  cleanup: 'closed' | 'failed'
}
```
