# Agent Note: codex 通知泵在流关闭时终止

Status: implemented

[English](2026-10-12-codex-pump-terminal-on-closed-stream.md) | 中文

## 问题

走 codex CLI adapter 的 web 会话永久停在 running 状态：没有产出，也无法停止。`CodexClient.nextNotification` 用 `state.closed && notifications.length === 0` 判定流已死亡，而它的检索（`findIndex`）只找匹配 adapter 谓词的帧（`turn/completed`、`error`、`item/*`、`thread/tokenUsage/updated`）。当 app-server 进程死亡时队列里还留着一条不匹配谓词的通知——例如 codex 在桥启动前后发出的 `mcpServer/startupStatus/updated` 帧——关闭判定读到 `notifications.length === 1`，永远为假，泵挂死在一个没有句柄、没有定时器、也没有错误的 promise 上。turn 永不结束（日志缺 `turn/end`，会话卡在 `running` 且 turn 统计全为零——「无结果」）。

取消同样到不了它。`session.cancel` 正确 abort 了 agent signal，adapter 的 `onAbort` 也执行了，但它只做销毁 stdout 与杀进程树：进程已死、流已关，两者都是 no-op，再也不会有 `close` 事件来 resolve 挂起的等待。每次调用的 deadline 同样失效——五分钟到期毫无效果。两个症状共用这一个根因。

## 决策

`CodexClient` 两处、adapter 一处，全部落在维护入口 `lib/types/`（按产物承载包规则用 tsdown 重打 `lib/index.js`）：

- `nextNotification` 在流已关闭且队列无匹配帧时立即 reject。`findIndex` 已经跑过，流关闭意味着再也不会有新帧；残留的不匹配帧不得掩盖关闭状态。匹配帧仍优先交付，正常 `turn/completed` 恰好在流关闭前到达时，turn 仍照常完成。
- 新增 `CodexClient.end()`：置传输为关闭并唤醒挂起的通知等待，让等待者立即观测到终止态。`onAbort` 在销毁 stdout、杀进程树之前先调 `client.end()`，即使流早已关闭也能解锁 abort 路径。`dispose()` 复用 `end()` 获得同样的唤醒。

## 备选方案

**只修关闭判定，不动 `onAbort`。** 否决：流到达 EOF 之后，`child.stdout.destroy()` 不会再触发 `close` 事件，已经挂起的等待继续挂着——「无法停止」那一半症状原样存活。两条腿缺一不可。

**把不匹配通知直接过滤出队列。** 否决：谓词决定 adapter 消费哪些帧，不决定线上存在哪些帧；队列内容是传输事实。为躲开某一类帧而放宽或收紧谓词，下一个没见过的方法照样死锁。

**把 abort signal 融进挂起等待（`AbortSignal.any`）。** 否决：泵不持有 signal，而宿主已经有生命周期出口——`dispose`/abort 都属于宿主。一个 `end()` 同时覆盖两者，比教会队列理解 signal 更小。

## 后果

流关闭且队列只剩不匹配帧时，调用在一个 microtask 内以 `TRANSPORT` `LlmError` 结束，经 adapter 的 `pumpExitError` 分类（caller 取消为 `ABORTED`，deadline 获胜为 `TIMEOUT`）和 agent-loop 的 request-error waterfall 流转——可见的失败带 code，而不是无形的挂死。迟到的取消同样收敛：卡死一小时后发出的停止仍以 `turn/end: aborted` 结束 turn。正常 turn、流中取消、无残留帧的进程死亡行为与之前完全一致。

## 测试

本包没有单测缝（产物承载），验证通过独立探针直接驱动真实 adapter，配一个假 app-server 可执行文件：握手、两个流式 item，然后四种形态的死亡——普通退出、SIGKILL、存活但关闭 stdout、带一条尾部 `mcpServer/startupStatus/updated` 帧的退出。修复前后两种形态永久挂起流（watchdog 证实），挂死发生后发出的取消毫无效果；修复后每种形态都终止——尾部帧死亡为 `TRANSPORT`，迟到取消为 `ABORTED`——普通退出与 SIGKILL 仍以传输错误结束。重启后的 web 实例端到端验证：全新 codex 会话正常完成（`turn/end: completed`，回复送达）；长任务会话在第 12 秒取消后写入 `turn/end: {"kind":"aborted","reason":{"kind":"user"}}`，会话回到 idle，无孤儿 codex 进程。
