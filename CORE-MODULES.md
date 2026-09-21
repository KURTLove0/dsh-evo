# DeepSeek Harness 核心模块分析

> 本文界定仓库的核心模块并逐一分析其职责、对外契约、协作关系与设计要点。
> 面向需要理解系统骨架的开发者；新人导览见 [ONBOARDING.md](ONBOARDING.md)，权威契约以各包 README 与 [docs/subsystems/](docs/subsystems/) 为准。

## 1. 核心模块的界定

选取标准：构成**控制脊柱**（一次 agent turn 的完整闭环）、**数据平面**（会话事实的持久与派生）、**启动与接口边界**（进程如何装配、能力如何对外暴露）的产品级稳定 API 包。其余包（能力 seam 的工具与 provider、交互插件、示例与测试基建）都是挂在这副骨架上的可替换肌肉。

```text
启动边界          控制脊柱（每 step 闭环）                  数据平面
─────────────   ─────────────────────────────────────   ─────────────────
boot/app-boot   agent ──(AgentFactory)── agent-loop       session/ 持久化 seam
  └─ 装配插件树      │  ctx.agents        │  驱动           ├─ jsonl / sqlite 后端
  └─ profile/       ▼                     │               └─ checkpoint-policy
     bundle 分层   session ◄──────────────┤  append        session/ 投影 seam
                   system-prompt ◄────────┤  每步装配        └─ projection/cache/stats
                   tools ◄────────────────┤  执行管线       session/ 标题
                   llm ◄──────────────────┘  流式调用        └─ title + 3 个 provider
                        ▲                                   session/ 遥测
                   llm-deepseek / llm-pi-ai（适配器）          └─ telemetry + otel
接口边界
─────────────
host/apiproxy（ctx.apiProxy 聚合域） → webserver → client/（浏览器端）
sdk/（JSON-RPC）  acp/（自动化协议）  python/（SDK + 运行时载体）
```

全部模块依赖 `@deepseek-ai/cordis`（peer + dev 双声明，全树共享单例框架），通过 `ctx.effect()` / `ctx.on()` / `ctx.waterfall()` 注入宿主上下文。

## 2. 控制脊柱：`packages/core/`

组定位：产品 API 脊柱（product — stable API），七个包形成默认控制闭环；可运行组合属于 `examples/agent-spine-demo`，本组只拥有可替换的脊柱件。

### 2.1 `core/scope` — 作用域注册原语（库，无 ctx 键）

- **职责**：为一切"每 agent 一份"的注册提供底层原语。`createScope(ctx, key)` 造出带标签的 Cordis context，其背后 fiber 拥有经它做出的全部注册；`scopeOf(ctx)` 读标签；`scopeTarget(base, key)` 构造作用域过滤事件的派发载体。
- **核心机制是双向键链**：注册视图沿父链**向下继承**（子作用域看到祖先的层，就近遮蔽），事件准入沿父链**向上扩展**（祖先标签的监听器收到后代键的事件，反向不行）。agent loop 为每个活 agent 建一个作用域，agent preset 的常驻挂载是其 agent 的父作用域。
- **设计要点**：注册上下文同时决定可见性与所有权——一个注册不可能在 A 作用域可见却随 B 作用域销毁。明确声明**非安全边界**：作用域路由可信的同进程插件，不是沙箱。`ScopedLayers`（一个急切全局层 + 惰性精确作用域层）、`NamedEntries`/`AnonymousEntries` 是 tools、system-prompt 等注册表共享的分层存储。
- **代价（Known Limitation）**：只有 scope-aware 的 API 才能隔离状态——普通 Cordis service 即使经 scoped context 调用仍是全局的；服务可达性来自 scope 的铸造方（交出 `Scope.ctx` 即交出铸造插件的服务解析面）。

### 2.2 `core/session` — 事件溯源会话日志（`ctx.sessions`）

- **职责**：`Session` 是 agent 全部交互历史的 append-only 事实源；LLM 消息历史是从日志**派生**的。日志之上维护 **surface** 层（产消息事件的有序投影），供高效派生与压缩。
- **关键抽象**：
  - `session.append()` 同步提交，快照并深冻结数据，校验 marker 形状、被引 source-event seq、替换覆盖率；重入 append 拒绝。
  - `session.deriveMessages()` 增量投影（每个 surface 条目只投影一次），surface 重写时整体重建。
  - `ctx.sessions.fork(source, boundary?)` 在已闭合 turn 边界切前缀，生成带谱系元数据的子会话。
  - **有序拆除生命周期**：`prepare`（不发布）→ `enter`（碰撞检查、发布不广播、返回条目绑定的幂等 detach）→ `announce`（单次创建边）。agent-loop 用它保证最终 flush 先于 session detach。
- **事件词汇**：`SessionEventMap` 声明合并扩展（compaction、hook 桥等插件合入自己的事件）；每个事件可带 `sourceEventSeqs`（溯源引用）、`surfaceOp`（如何进入 surface）、`ignorable: true`（未知类型可安全跳过，否则拒绝重建）。`SESSION_FORMAT_VERSION` 锁定为 `0`，不做兼容承诺。
- **本包刻意不做持久化**：持久化插件订阅 `session/event`（写后）、在 `session/flush` 排空。
- **配套件**：`request/header` 事件完整记录非历史请求信封，使请求可从日志重建；`chunk-rows.ts` 是持久化后端共享的无损压缩编解码。

### 2.3 `core/system-prompt` — 提示词装配注册表（`ctx.systemPrompt`）

- **职责**：插件贡献有序分节（`section`）、工具 schema（`tools` provider）、命名变量（`variable`）与动态上下文（`context`）；loop 每个 step 装配一次，渲染为完整模型提示。
- **关键机制**：
  - 分节按 `order` 升序拼接，约定秩序带：`-100` harness 身份、`0` 部署人格（`persona` config）、`100–199` 工具指导。`complete: true` 的分节在 waterfall 后成为唯一提示（多于一个即装配失败）。
  - `renderPrompt` 严格插值 `{{variable}}`：未知引用、无值引用、畸形组一律抛出——宁可响亮失败也不发畸形 prompt。
  - `toolOrder` config 显式定序模型侧工具（含一个 `'<unlisted-tools>'` 兜底位），在 `system-prompt/assemble` waterfall **之前**应用，把注册顺序（插件加载产物）规范化；拼写错误在首次装配时响亮失败。
  - 作用域感知：`agent.ctx` 贡献的分节/变量遮蔽同名全局项，仅影响该 agent。
- **设计取舍**：工具 schema 是装配产物的一部分——"模型被告知它能做什么"是一个连贯整体，尽管适配器在线路上分开传输。

### 2.4 `core/tools` — 工具注册表与执行管线（`ctx.tools`）

- **职责**：工具插件注册 schema 与执行器；loop 经固定管线执行每次调用：
  `tools/pre-execute`（可重排的 allow/deny/ask 闸门）→ 单调 guard → `tools/execute`（around 包装：超时/重试/指标）→ `tools/post-execute`（检视/替换结果、附加上下文）→ 定义方 `finalizeContent` → 仅观察的 `tools/result`。
- **关键抽象**：
  - `ToolDefinition = ToolSchema + 强制 output 声明（schema + render）+ execute()`；`finalizeContent` 对每种归一化结果（含管线失败）恰跑一次，只可替换 content。
  - `ToolExecutionToken` 是 registry 签发的 branded Symbol，只做相等性关联，永不跨越模型/日志/worker 边界。
  - `defineTool()` 提供类型化参数 DSL（`ParameterSchemaSpec`），编译/校验用显式工作栈（内存有界而非调用栈有界），`InferArgs` 让 execute 拿到强类型参数。
  - 并发分类：`isConcurrencySafe(args)` 返回精确 `true` 才进入有界滚动并发池，exclusive 调用充当顺序屏障；策略、持久结果、结果上下文保持模型顺序。
  - 取消语义：协作式。body 调用前取消 = `ABORTED_BEFORE_DISPATCH`；调用后只可把成功替换为 `ABORTED`；registry 在 body 前重新融合原始调用方 signal。
- **呈现模式**：`mode: native | code | both` 与 agent 级 `presentAs()` 遮蔽。Code Mode 暴露保留的 `run_code` 传输 + 按运行时语言生成的精确类型 SDK（`ToolArgsMap`/`ToolOutputMap`），子调用经同一管线回环（携带父 token），`code` 模式下模型直呼其他工具名在执行创建前即解析为 `UNKNOWN_TOOL`。
- **可见性组合**：`restrict(filter)` 施加 agent 作用域的 allow/deny 遮罩（多遮罩取交），是活性可见性组合而非权限边界。

### 2.5 `core/agent` — Agent 接口与注册表（`ctx.agents`）

- **职责**：定义每个插件（UI、钩子、编排器）编程所针对的 `Agent` 句柄——**零 loop 依赖**，使 loop 可替换。拥有 `agent/*` 实时事件词汇。
- **关键抽象**：
  - `AgentRegistry`：活 agent 表。`register()` 记录已构造的 agent；高级分裂生命周期 `enter()`（强制 `agent.id === agent.session.id`、权威 ID 碰撞检查）+ `announce()`（恰好一次 `agent/created`）。同步创建通知期间请求的 detach 延迟到派发结束，每次 detach 校验捕获的条目对象（旧 disposer 删不掉同 ID 替代者）。
  - **Initiator 边界**：基于 `AsyncLocalStorage` 的进程内传播（`currentInitiator`/`requireInitiator`/`withInitiator`/`withoutInitiator`），并发驱动相互隔离；teardown 拒绝新边界、排空已注入的依赖，然后禁用底层 ALS。环境存在既非存活证明也非授权——显式 Agent 字段在服务/worker/进程/持久化/wire 边界才是权威的。
  - **AgentFactory**：创建/恢复由实现方（`agent-loop`）经 `setFactory` 注册，消费方对 `ctx.agents.create()/resume()` 编程而不依赖具体 loop 包。`AgentHandle.dispose()` 是**消费方能力**——持有裸注册条目的观察者无法拆除 agent。调用方 fiber 与 factory provider 是结构共主，汇聚于一个 memoized 静默边界：停 loop → 等退出 → 注销 agent → 移除 session → 解开作用域。
  - `Agent` 接口：`inbox`（durable `agent/inbox/spliced` 事件的 agent 自有投影；`append/prepend/replace/remove/clear/claim`）、`followup()`（入队 next-turn 并唤醒）、`steer()`（入队唤醒型 next-step）、`inject()`（入队非唤醒上下文）、`cancel(cause, { keepInbox? })`、`whenIdle()`。
  - 拦截点：`agent/pre-step`（拒绝或改写被认领批次）、`agent/request-error`（失败模型请求的恢复 waterfall，返回 `{ kind: 'retry' }` 即接管）、`agent/turn-stopping`（turn 收尾前的串行闸）。
  - `foldConsumedWork(events)`：从日志回读"被消费的工作下落如何"——两个 owner 谁发取消都读到同一答案。

### 2.6 `core/agent-loop` — 默认具体驱动（`ctx.agentLoop`）

- **定位**：全仓**唯一**包含具体 loop 逻辑的包。其余一切是抽象服务或挂在扩展点上的插件——新行为进插件，不进这里。包内 `ReactLoopAgent`、inbox、运行控制均为私有；exports map 不留 `./src/*` 逃逸口。
- **职责**：驱动 session/turn/step 生命周期，注入五个接口服务（`agents`、`sessions`、`llm`、`tools`、`systemPrompt`）。
- **关键机制**：
  - 创建/恢复是**一次回滚覆盖的事务**：构造私有 session + 具体 agent + 作用域 → 等待未发布的 setup → 双注册表 enter → `session/created` + `agent/created` → `agent/session-start` → 启动驱动。同 ID 并发创建可并行准备，最终 `enter()` 仲裁唯一发布者，败者回滚。
  - 统一 `send()` 原语按 (`target` × `wakeup`) 路由，`followup`/`steer`/`inject` 是其固定预设别名。turn 边界开启持久 turn 后，原子认领 next-step 输入 + 一条排队 prompt；step 之间只认领 next-step 输入。
  - **完成锚点**：每次成功结束的 provider 调用恰好追加一个 `assistant/message`（含无内容与 max-tokens 收尾），记录 `sourceEventSeqs` 引用的 chunk 序列；流式被 turn 取消打断时，若用户已见非空文本则追加 `interrupted: true` 锚点，使下次请求包含用户所见前缀。
  - `prepareCall()` 在一次精确模型查找中物化适配器默认（reasoningEffort/maxTokens），并跨异步解析、header 落日志、终末派发**保留确切的适配器注册**——HMR 不可能把 A 适配器的能力结果配给 B 适配器的请求。
  - 插件失败结束当前 turn，**不结束 loop**。`cancel()` 协作式中止当前 turn 信号；在 abort 触发后、收敛到 idle 前到达的唤醒输入被闩锁（`wakeRequested`）并在驱动自己的收敛边界重放。
  - 并发池：`maxParallelToolCalls`（默认 10，`1` 即串行）约束每个 agent 的滚动池；该字段同时构成 loop 的 Settings 节，用户层改它无需重启即约束下一组工具。
- **配置**：`agents[]` 声明式 agent（id 必填，provider/model/maxTokens/cwd/resumeSessionId 可选）启动即建。

### 2.7 `core/agent-default-model` / `core/agent-tool-presentation`

两个小角色补齐脊柱：前者拥有"会话自身无选择时，Agent 入口使用的部署默认模型"（`ctx.agentDefaultModel`）；后者让 agent preset 为自己选择工具呈现模式（`presentAs` 的配置侧通道）。

## 3. 模型能力：`packages/llm/`

### 3.1 `llm/llm` — provider 中立词汇与抽象服务（`ctx.llm`）

- **职责**：定义 agent loop、会话日志与每个插件所说的规范语言；`LlmRuntime` 是**适配器注册表 + 单一流式调用 API**，经 `llm/stream` waterfall 可拦截。
- **关键抽象**：
  - `LlmAdapter` 抽象基类（唯一必需方法 `stream()`）；`registerAdapter(providers, adapter)` 全有或全无注册，返回句柄的 `replace()` 把路由集校验前置、切换压成一个同步区段（无可观察空窗）。
  - **消息与内容块词汇**：`Message` 从创建起携带 `MessageId`、角色、内容、类型化 source；内容为 `text`/`reasoning`/`tool-call`/`tool-result` 块数组，`ContentBlockMap` 声明合并扩展。流式是裸 chunk 协议（`block-start`/`text-delta`/`reasoning-delta`/`tool-call-delta`/`block-end`/`usage`/`finish`）；**一切适配器结局以一个终末 `finish` 抵达**——运营失败走 `error`/`aborted` 而非跨 API 抛出。
  - `BlockAssembler` 是唯一的 chunk→块/消息装配实现；`max-tokens` 收尾丢弃可能被截断的 tool call，ReplayEnvelope 同步丢弃对应位置——**存储的元数据永远描述存储的内容**。
  - `prepareCall()`：一次性、可取消、绑定确切适配器注册与不可变重试政策；复用句柄或改动字段以 `INVALID_PREPARED_CALL` 失败。
  - **错误体系基座**：`HarnessError`（稳定 `code` + `cause` 链）住在这个叶子包，使全树共享单一基类而不新增依赖边；provider 中立码（`CONTEXT_WINDOW_EXCEEDED`、`QUOTA_EXCEEDED`、`EMPTY_RESPONSE`、`INVALID_CREDENTIAL`…）与保守分类器同驻。
  - 重试政策在适配器注册时捕获存储，**本服务不执行重试**——执行者是可选的 `dsh-llm-retry`（监听 `agent/request-error`）。
- **真实适配器**：`llm-deepseek`（直接 fetch + `eventsource-parser` SSE，`deepseek-official` 路由）与 `llm-pi-ai`（经 `@earendil-works/pi-ai` 动态解析配置的 provider/model 对）。同组还有 `token-meter`（per-step `assistant/chunk{usage}` 记账）。

## 4. 启动边界：`packages/boot/`

### 4.1 `boot/app-boot` — 应用 bin 共享启动胶水

- **职责**：让 `dsh` CLI 与 `dsh-acp-demo` 等 bin 成为这些助手之上的薄自执行组合，loader 失败行为只有一个属主。
- **`boot()` 时序**：建根 context（暴露 `dshHomePath()` 给 `!!js` 配置表达式）→ 装 Loader → 可选 `prepare`（宿主挂钩，config 树条目录挂载前）→ 挂载并 await include 树 → `assertEntriesLoaded/Activated` 审计（启用的条目无 fiber、fiber 失败、服务未解析分别转成带原始栈的启动拒绝）→ 返回根 context；失败则 dispose 半成品并带 bin 名拒绝。
- **profile 机器**：profile = `$DSH_HOME/profiles/<name>/`（`package.json` 含 `dsh.profile.bundles` 有序层表 + 用户 `cordis.patch.yml`）；bundle 经 `dsh.bundle.patch` 声明。`composeEntries` 用 include 自己的 `applyEntryPatches` 应用层叠，使组合、flag 推导、`--dump-config` 与真实启动不漂移。`healProfilesModuleFallback` 维护 `$DSH_HOME/profiles/node_modules` 平铺 symlink，让 profile 内裸包名走 Node 普通父链解析。
- **补丁层与 HMR**：`watchUserPatches` 把用户 patch 文件接入 Cordis HMR——每次变更经调用方的 `compose` 闭包事务性重组完整补丁列表；坏输入保留最后可用的树并广播 `hmr/config-update-failed`。
- **fail loud**：`installFailLoud` 把未处理拒绝变成一行带标签的 stderr + `exit(1)`，中间 await 可选 `release`（有终端的表面先恢复终端再退出；`FAIL_LOUD_RELEASE_TIMEOUT_MS` 上界）。 Loader 并发挂载意味着某个表面可能已持有终端——直接退出会把 raw mode、bracketed paste 留给用户 shell，这是该设计的直接动因。
- `boot/cmdline` 注入 `ctx.cmdlineArgs` 与 `ctx.appExit`，让每个 app 自行用 commander 解析参数。

## 5. 会话数据平面：`packages/session/`

围绕 `core/session` 的内存服务，把事件流变成耐久与可读的形态（全部 product 包）：

| 子族 | 包 | 契约 |
|---|---|---|
| 持久化 | `session-persistence` | 定义持久化服务与共享写协调（`ctx.sessionPersistence`）；`session/event` 写后 + `session/flush` 排空屏障 |
| 持久化后端 | `session-persistence-jsonl` / `-sqlite` | JSONL（zstd 压缩）/ 可选 SQLite（packed chunk rows，`SCHEMA_VERSION` 单调递增） |
| 检查点 | `session-checkpoint-policy` | 语义耐久检查点，包装 `ctx.llm` 与 `ctx.tools` |
| 投影 | `session-projection` / `-cache` / `session-stats` | 整日志派生状态服务到 client 载体（`ctx.sessionProjections`）；checkpoint 持久化恢复；会话统计 unit |
| 标题 | `session-title` + 三个 provider | `ctx.sessionTitle` 单 provider 槽；`first-prompt`/`all-prompts` 两种 LLM 策略；无 provider 时确定性 fallback |
| 遥测 | `session-telemetry` / `-otel` | 捕获、脱敏、投影；OTel 投递；`FULL`/`FEEDBACK_ONLY`/`DISABLED` 三模式 |

设计要点：**读侧与写侧解耦**——`session-query/` 组（检索/全文搜索）独立于持久化内部消费；`core/session` 对持久化零依赖，resume 在无持久化后端时清晰报错而非静默不可用。

## 6. 接口边界：`packages/host/` 及对外三通道

- **`host/apiproxy`（`ctx.apiProxy`）**：传输无关的 API 网关，`createApiProxy(ctx, …)` 把 `sessions|subagents|workspace|host|goals|skills|agentPresets|settings|credentials|llm|events|downloads|respond` 域聚合为单一契约；`api/` 下按域拆 schema+handler 对，`fetch/handler.ts`/`fetch/client.ts` 提供 fetch 桥接。浏览器载体由 `client/connection` 提供，业务服务用 `@Remote`/`@RemoteScope` 声明可调用方法，Typert 在 Host 构建期生成 Host-for-Client 投影。
- 同组支撑件：`webserver`（HTTP 路由载体）、`frontend-static`（SPA dist）、`directory-picker` 三实现互换、`plugin-inventory`（Loader 条目只读投影）。
- 对外三通道全部消费同一脊柱：`sdk/`（JSON-RPC 协议 + TS 客户端 + server 插件）、`acp/`（自动化 ACP server）、`python/`（同步 SDK 懒启动 JSON-RPC stdio 子进程 + wheel 携带的预编译运行时）。

## 7. 横切协作机制

### 7.1 依赖方向（严格单向）

```text
boot → core（仅类型声明与 scoped events 解耦）
host → core（apiproxy 消费 agent/session/tools）
agent-loop ──implements──▶ agent（AgentFactory 注册，接口包零 loop 依赖）
tools ──auto-feeds──▶ system-prompt（schema 流入装配）
tools ──opportunistic──▶ approval（ctx.get，无静态 inject，缺席降级 ask→deny）
session/ 数据平面 ──subscribe──▶ core/session 事件（写后 + flush 屏障）
一切包 ──peer+dev──▶ @deepseek-ai/cordis
```

扩展插件依赖 Service Definition 而非具体 provider；组合 bundle 才被允许依赖脊柱插件。

### 7.2 生命周期共性与不变量

- **创建事务化 + 分裂发布**：`prepare → enter → announce` 三分裂在 session 与 agent 两注册表同构出现；同 ID 并发只允许一个 enter 成功，败者回滚私有资源；detach 绑定确切条目对象，旧 disposer 无法误删替代者。
- **拆除有序化**：调用方 unload、handle dispose、provider unload 三边汇聚于一个 memoized 静默边界；agent-loop 内 stop/drain → unwind scope → detach agent → detach session。
- **运行时不变量断言自有关系**：各核心包挂可选 `/invariant` 伴生件（`ctx.invariants`）——session 的单调 seq/turn 包含/tool 配对、agent-loop 的请求重建（从日志独立重建消息边界与 header）、scope 的载体-主题同一性。**模型可见 ⟺ 已落日志**由 agent-loop 的不变量件强制。
- **失败边界分级**：插件失败结束 turn 而非 loop；LLM 运营失败归一为终末 `finish` 而非 throw；配置自包含错误加载期炸，引用缺失在最早可解析点炸。

### 7.3 作用域与事件的两个方向

`scope` 原语支撑了 tools/system-prompt 的"每 agent 一份"：注册可见性向下继承（子见祖先层、就近遮蔽）、事件准入向上扩展（祖先监听器收后代事件）。事件三域分工——session events 记耐久事实、`agent/*` 携带活句柄做实时协调、capability events（`tools/*`、`llm/stream`、`fs/*`…）在 seam 上挂策略与适配器——waterfall 监听器必须 `next()` 委托，否则短路。

## 8. 设计决策解读（为什么这样拆）

1. **接口包与实现包分离**（`agent` vs `agent-loop`）：让 UI、ACP 桥、subagent 后端对稳定接口编程，loop 可整体替换；全仓只有一个包含具体 loop 逻辑的包，使"新行为进插件"成为可执行的纪律而非口号。
2. **日志为唯一事实源**：持久化、fork、resume、转录、遥测、不变量检查全部从同一事件流派生——没有第二份需要保持一致的状态。`deriveMessages()` 的增量投影 + surface 替换（压缩）在不破坏 append-only 的前提下支持历史改写效果。
3. **每步重装配提示词**（而非启动时装配一次）：配合作用域遮蔽与 `system-prompt/assemble` waterfall，使每 agent、每 step 的提示都是活体组合；`toolOrder` 与确定性 SDK 生成保住 KV-cache 前缀稳定性。
4. **管线化工具执行 + branded token**：五段 waterfall 让策略（审批、沙箱、超时、spill）全部以插件形式挂入而不改 registry；`ToolExecutionToken` 不跨边界，日志侧用 `callId` 关联——活性与耐久各有身份体系。
5. **创建/恢复的同事务形状**：create 与 resume 共享最终发布序列（enter 仲裁 + 回滚覆盖），使"config 声明"与"编程创建"两条路径在并发与失败语义上完全一致。
6. **适配器注册绑定到 prepared call**：在一次精确模型查找中物化默认并锁住注册，消除 HMR 期间"A 适配器能力 + B 适配器请求"的混配窗口——这是热更新场景特有的正确性问题。

## 9. 深入阅读入口

| 模块 | 子系统参考 | 包 README |
|---|---|---|
| agent / agent-loop | [docs/subsystems/core.md](docs/subsystems/core.md) | [agent](packages/core/agent/README.md)、[agent-loop](packages/core/agent-loop/README.md) |
| session | [docs/subsystems/session.md](docs/subsystems/session.md) | [core/session](packages/core/session/README.md) |
| tools | [docs/subsystems/tools.md](docs/subsystems/tools.md)、[tool-execution-pipeline](docs/tool-execution-pipeline.md) | [core/tools](packages/core/tools/README.md) |
| system-prompt | [docs/subsystems/system-prompt.md](docs/subsystems/system-prompt.md) | [core/system-prompt](packages/core/system-prompt/README.md) |
| scope | [docs/subsystems/scope.md](docs/subsystems/scope.md) | [core/scope](packages/core/scope/README.md) |
| llm | [docs/subsystems/llm-streaming.md](docs/subsystems/llm-streaming.md) | [llm](packages/llm/llm/README.md) |
| 数据平面 | [persistence](docs/subsystems/persistence.md)、[projection](docs/subsystems/session-projection.md)、[title](docs/subsystems/session-title.md)、[telemetry](docs/subsystems/session-telemetry.md) | [session/](packages/session/README.md) |
| 启动 | [architecture#profiles](docs/architecture.md) | [app-boot](packages/boot/app-boot/README.md) |
| 接口 | [api-gateway](docs/api-gateway.md) | [host/](packages/host/README.md) |
