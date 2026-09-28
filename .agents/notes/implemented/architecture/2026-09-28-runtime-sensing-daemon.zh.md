# Agent Note：运行时感知守护进程（dsh daemon）

状态：已实现

[English](2026-09-28-runtime-sensing-daemon.md) | 中文

## 问题

本地运行时的存在性没有属主。各配置面以内联方式探测——`llm.providers` 每次应答都在 web 宿主进程里为每条本地路由 spawn 一次 `which`——因此存在性只在 web 宿主服务期间存在、只新鲜到最近一次页面加载，并且没有一个像 multica 那样能活得比任何单次应用启动更久的「这台机器有什么」的答案。2026-09-25 的存在性笔记选择按应答探测，是因为 adapter 侧的答案会变陈旧；随后用户的方向很明确：运行时应像 multica 一样由守护进程感知。

## 决策

把 multica 模型建成一等表面。新包 `@deepseek-ai/dsh-daemon`（`packages/host/daemon`）拥有整条 seam：固定探测清单（`claude`、`codex`——harness 目前可路由的本地 CLI）、从 apiproxy 迁入的 `commandPresent` 探测、周期感知循环、仅 loopback 的健康端点（`GET /health` 应答身份信息与报告，`POST /shutdown` 请求退出）、作为唯一会合点的状态文档（`$DSH_HOME/daemon/daemon.json`：pid/port/version/startedAt，原子写、owner-only）、两个消费方共享的 zod 校验健康客户端，以及 CLI 生命周期助手。daemon 进程即 CLI 自重生：`dsh daemon start` 把同一个 bin 以 `daemon start --foreground` 重新拉起，detached 运行，日志写入 `daemon.log`，端口与周期经子进程环境传递，使 flag 与前台解析共享同一条路径。`stop` 先 POST `/shutdown`，失败回落为普通 SIGTERM；`status`、`logs -f`、`restart` 构成完整命令族，存活判断一律只读健康端点——状态文档缺失或不可读即「无 daemon」，校验不通过的应答即端口已易主。

消费是 daemon 优先、但绝不要求 daemon 在场。`llm.providers` 每次应答先探测 daemon：清单内命令的存在性在 daemon 应答时采用其报告；自定义命令与一切无 daemon 部署保留内联探测——无 daemon 时的页面行为与引入 daemon 前完全一致。响应新增 `daemonRunning`；仅当 daemon 无应答时，「运行时」设置页渲染指令卡片（可复制的 `dsh daemon start`），使「daemon 不在场」本身也可操作。感知与激活刻意分离：llm-claude-cli 在每次 boot 时的「识别即激活」探测仍决定路由注册，daemon 的报告只喂配置面——PATH 与应用不一致的 daemon 绝不能门控路由。

## 影响

- apps/cli 新增 `dsh daemon` 命令族（嵌套 start/stop/restart/status/logs，`--foreground/--port/--interval`，`DSH_DAEMON_PORT`/`DSH_DAEMON_INTERVAL_MS` 环境变量）；后台子进程继承 `process.execArgv`，源码启动（tsx）与构建产物均可正确自重生。
- `commandPresent` 迁至 `dsh-daemon`（apiproxy 改为导入）；线协议在 `llm.providers` 上新增 `daemonRunning`（zod schema 与客户端 codec 跟随宿主单一声明；client 产物必须重建，该字段才能到达浏览器）。
- PATH 以启动 shell 为准：daemon 以启动时继承的 PATH 感知，之后安装的 CLI 要等 daemon 重启并再过一个探测周期才会出现。「运行时」页的提示给出启动命令；没有任何机制自动启动 daemon。
- daemon 包携带 explained empty invariant companion（它不是 cordis 应用）；单元覆盖率每文件 100%，另有一个 spawn 真实 fixture daemon 的 process-bound 套件覆盖 start/status/stop 全往返。

## 已否方案

- **插件目录驱动的感知（daemon 启动插件树并枚举 `listConfigurableProviders()`）**——暂否：这意味着在感知进程里 boot 一棵 cordis 树，远比其镜像的 multica 模型重，而可路由的本地 CLI 集合只随 harness 发布变化。被接受的代价是命令名存在两处事实源（清单与各 adapter 的 `localCommand`）；不一致会优雅降级，因为清单外命令仍走内联应答。
- **仅状态文件、不要 HTTP 端点**——已否：心跳时间戳能证明文件新鲜，却无法证明写入者存活，且 stop/status 退化为信号加 pidfile 管道；端点用一条通道同时给出存活、经校验的报告与优雅退出，与 multica 对齐。
- **彻底取代内联探测**——已否：这会让一切无 daemon 部署的存在性变陈旧或缺失；内联探测保留为自定义命令与「无 daemon」情形的回落，页面行为绝不回退到低于今天的水平。
- **让 daemon 也驱动路由激活**——已否：激活属于应用自身的 boot（它自己的 PATH 与组合）；daemon 向配置面报告，两个进程间的 PATH 偏差绝不能门控应用可路由的对象。
