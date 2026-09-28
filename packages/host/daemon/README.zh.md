# @deepseek-ai/dsh-daemon

[English](README.md) | 中文

本机运行时感知守护进程，对齐 multica daemon 的模型：一个长驻后台进程感知本机安装了哪些本地 CLI 运行时，并通过 loopback 健康端点发布报告，使各配置面由同一个属主回答「这个运行时在不在」，而不是每次页面加载各自探测。daemon 按固定清单（`claude`、`codex`——harness 目前可路由的本地 CLI）启动即探、随后按周期探测，最新报告保存在内存中，由 127.0.0.1 上的 `GET /health` 提供；`POST /shutdown` 请求其退出。路由激活仍由各应用 boot 时的探测负责（llm-claude-cli 的「识别即激活」不受影响）——daemon 的报告只喂配置面，绝不参与路由。

进程模型是 CLI 自重生：`dsh daemon start` 把同一个 bin 以 `daemon start --foreground` 重新拉起，detached 运行，stdout/stderr 追加到 `<harness home>/daemon/daemon.log`，并等待首个健康应答。daemon 开始服务后以原子写、owner-only 权限发布 `<harness home>/daemon/daemon.json`（pid、port、version、startedAt）；文档缺失或不可读是唯一的「无 daemon」信号——消费方绝不猜端口。健康应答在读取时经 zod schema 校验，因此指向外来服务的陈旧文档会降级为「未运行」，而不是错误的存在性答案。信号与 `/shutdown` 共享同一条拆卸路径（停循环、关监听、清状态）；在已有 daemon 存活时重复 start 会被拒绝，stop 则从优雅端点请求回落为普通 SIGTERM。

配置沿用 multica 的环境变量表：绑定端口默认 3081（`--port` / `DSH_DAEMON_PORT`），探测周期默认 15 秒（`--interval` 秒 / `DSH_DAEMON_INTERVAL_MS`）；后台子进程通过环境接收这两项，使 flag 与前台解析共享同一条路径。`probeDaemonHealth` 是 CLI（`status`/`stop`）与 API 代理共用的唯一客户端：API 代理对清单内命令优先采用 daemon 的存在性答案，对自定义命令或 daemon 不在场时回落到自身的内联探测——无 daemon 时的页面行为保持不变。

## 模型体验

无。daemon 只感知本地可执行文件并上报；这里没有任何内容进入模型请求。

#### KV Cache 影响

无。本包不组装也不发送任何 provider 请求。

## 已知限制与暂缓事项

- **PATH 以启动 shell 为准**——daemon 以启动时继承的 PATH 感知；daemon 启动后才安装的 CLI（或只对另一个 shell 可见的 CLI）要等 daemon 重启继承新 PATH 后，再过一个探测周期才会出现。
- **仅存在性**——报告行不带版本号或模型目录；更丰富的运行时事实等需要它们的消费方出现时再加。
- **无鉴权 loopback**——本机任何进程都可以请求 `/health` 或 POST `/shutdown`（与 multica daemon 同一信任模型）；状态目录的 owner-only 权限即是边界。
