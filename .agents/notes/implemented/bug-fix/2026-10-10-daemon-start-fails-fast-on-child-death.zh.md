# Agent Note: `dsh daemon start` fails fast when the spawned daemon dies

Status: implemented

[English](2026-10-10-daemon-start-fails-fast-on-child-death.md) | 中文

## 问题

`dsh daemon start` 拉起后台 daemon 后最多轮询健康端点十秒，却从不看子进程本身。当默认端口 3081 被其他进程占住——另一个 harness home 下的 daemon，或任何外来监听者；日志里留有更早年代 19527 撞 openclaw 的记录——子进程在毫秒内死于 bind 拒绝，拒绝原因写进了 daemon 日志，而父进程仍等满整个启动预算，才回一句含糊的 "Daemon may not have started. Check logs: …"。用户先付十秒停顿、再翻一遍日志，才能拿到父进程本可直接引用的事实。组装版生命周期快照放大了同一弱点：它在机器级默认端口上启动 daemon，于是真实 harness home 下只要跑着 daemon，整套测试就失败。

## 决策

`startDaemon` 的启动轮询在每次健康探测前先检查子进程的 `exitCode`/`signalCode`：应答前死掉的子进程立即返回新增的 `child-exited` 失败，其 `message` 引用 daemon 日志最后一个非空行——bind 拒绝行写明端口与占用者的错误——日志没有可引用行时回落到退出码或信号描述。CLI 把它映射为 `Daemon failed to start: <行>` 加日志路径，与启动成功的两行形状对齐。沉默但存活的子进程维持 supervisor 立场：等满预算、保持运行、由日志指明原因。生命周期快照改为全部以 `--port 0` 启动，对齐进程级测试已有的封闭模式，并新增跨 home 的 bind 冲突快照钉住新的用户可见输出。

## 备选方案

**监听子进程的 `exit` 事件而非轮询退出事实。** 否决：事件送达依赖父进程事件循环在 unref、detached 子进程周围保持存活，这是既有 200ms 轮询循环本已避开的时序假设；退出事实是同一循环可直接读取的普通属性，spawn 测试缝也仍是一个普通对象。

**默认端口被拒时自动回落 `--port 0`。** 否决：默认端口冲突是用户应当看见的部署事实，不是该绕开的障碍；带上被拒端口的大声失败同时点名两条出路（`--port 0`、显式 `--port`），静默换端口会掩盖冲突并让多个 home 各自孵化 daemon。

**用子进程退出码协议区分 bind 拒绝与其他死亡。** 否决：把「bind 失败」编码成魔法退出码，为一条消息的收益增加跨进程契约；日志最后一行已携带完整拒绝信息，含端口与 OS 错误。

## 后果

夭折的 daemon 启动在一个轮询节拍内失败（进程级测试端到端约 0.7 秒），真实原因连同日志路径直接落在 stderr，取代十秒停顿加「去看日志」。`StartDaemonResult` 新增 `child-exited` 成员，失败联合的穷尽消费方必须处理它；CLI 分发已处理。快照与进程级测试不再依赖机器端口状态，开发机或 CI 邻居上跑着的 daemon 不会再拖垮无关的 daemon 套件。

## 测试

`lifecycle.spec.ts` 经 spawn 缝钉住三条消息路径：引用日志最后一行，以及日志消失与日志全空白时的退出码/信号回落。`lifecycle-process.spec.ts` 复现真实冲突——一个 fixture daemon 占住端口、第二个 home 的启动死于 bind——并断言 `EADDRINUSE` 拒绝浮出水面（fixture 现在像真实 daemon 一样记录 bind 拒绝并以退出码 1 结束）。`daemon.spec.ts` 钉住 CLI 映射。组装版快照套件覆盖停止姿态、port-0 往返、启动日志行，以及跨 home 的 bind 冲突 stderr。
