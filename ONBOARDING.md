# DeepSeek Harness 技术方案与新人上手指南

> 面向新加入的开发者：建立架构心智模型，跑通开发环境，完成第一个改动。
> 本文是导读与地图，权威细节以各链接文档为准；仓库规范见根目录 [AGENTS.md](AGENTS.md)。

## 1. 项目速览

DeepSeek Harness（`dsh`）是 DeepSeek AI 开源的 agent harness——用于组装、运行和扩展 AI coding agent 的插件化运行时。它的架构原则是**一切皆插件**：模型适配器、工具注册表、会话日志、agent loop 本身都是插件，由 [Cordis](https://github.com/cordiverse/cordis) 框架驱动（设计思想见其论文《A Programming Paradigm for Spatiotemporal Composability》）。仓库内嵌 vendored Cordis 源码（`vendor/`，rescope 为 `@deepseek-ai/cordis`）。

产品形态（同一份插件树的不同入口）：

| 形态 | 入口 | 说明 |
|---|---|---|
| Web UI | `npx @deepseek-ai/dsh web` | 浏览器应用，默认 `http://127.0.0.1:3080` |
| Headless | `pnpm dsh --profile headless "任务"` | 一次性任务 runner，无服务器 |
| ACP server | `pnpm run demo:acp` | 面向自动化的 Agent Client Protocol（JSON-RPC stdio） |
| TypeScript SDK | `packages/sdk/` | JSON-RPC 协议 + 客户端 + server 插件 |
| Python SDK | `python/sdk/` | 同步 API，随 wheel 携带预编译 Node 运行时 |

当前处于 **developer preview**：迭代快、有破坏性变更。仓库采取 pre-release 立场——不维护兼容 shim，重命名/换包自由，但所有引用必须同 PR 更新；SQLite 用单调递增的 `SCHEMA_VERSION`，`dsh-session` 的 `SESSION_FORMAT_VERSION` 保持 `0`、不做兼容承诺。

## 2. 技术栈一览

| 层 | 技术选型 |
|---|---|
| 语言 | TypeScript（`strict` + `noImplicitAny`），全仓 ESM（`"type": "module"`） |
| 运行时 | Node.js `^22.19 \|\| >=24`（CI 覆盖 22.19 / 24 / 26） |
| 插件框架 | Cordis（vendored）：service + typed events + reversible effects |
| 包管理 | pnpm 11.7.0 workspaces（经 Corepack 锁定） |
| 构建 | `tsc -b` 产出声明 + `tsdown` 打包运行时，分 host / client 两个 face |
| 测试 | Vitest（unit / coverage / e2e / snapshot / web 五条泳道），fast-check 属性测试 |
| Web 前端 | React + Vite，CSS 自定义属性 + CSS Modules（DSW 设计系统） |
| 输入校验 | zod / `@deepseek-ai/schemastery`（vendored） |
| Lint / 卫生 | oxlint（+tsgolint）、jscpd 查重、knip、publint |
| Git 钩子 | lefthook（worktree-local 安装） |
| 原生组件 | `native/landlock-run`：约 300 行 C11（musl 静态链接）的 Linux Landlock 沙箱启动器 |
| Python | Hatchling 打包，uv 锁定 |

## 3. 架构核心设计（五个心智模型）

### 3.1 一切皆插件：Cordis 三要素

Cordis 插件向共享上下文 `ctx` 贡献三样东西：**service**（挂到 `ctx.<key>` 的服务）、**typed events**（声明合并进事件地图）、**reversible effects**（`ctx.effect()` 注册，插件卸载时自动回收）。没有"特权核心"可以打补丁：扩展 dsh 就是把一个插件挂到别的插件旁边；注册即 effect，`register()` 返回 disposer。

### 3.2 Profile 与 Bundle：分层组合

一个运行中的 `dsh` 是启动时从有序层叠出的插件树。**Profile** 是存在 Harness home 的命名组合：列出它叠放的 bundle、树外插件和用户自己的 `cordis.patch.yml`；`web` 与 `headless` 是自带模板。**Bundle** 是 Cordis 配置行加所挂代码的分发格式（`packages/bundle/`），保证它插入的内容仍可被上层 patch。层叠顺序：profile 列出的各 bundle → profile 的 patch → home 级 patch → `--patch` overlay。每个包在 `package.json` 的 `dsh` 字段自我声明：`dsh.profile` 列 bundle，`dsh.bundle` 指向 patch 文件。

[`dsh-base`](packages/bundle/base/README.md) 是每个 profile 的第一层：模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测。想看你机器实际启动的树：

```sh
dsh --profile web --dump-config
```

它打印的任何一行都可以被你自己的 patch 替换。

### 3.3 能力 seam：三角色契约

一个**seam**（能力缝）是可替换能力的完整三角色：**Service Definition** 声明接口、**Service Provider** 实现接口、**Consumer** 消费接口（通常是模型侧工具）。只有一个角色不构成 seam；加能力 = 设计全部三个。依赖方向严格为 `Consumer → Definition ← Provider`——扩展插件依赖服务定义，永不依赖具体 provider。

seam 的价值：一次 provider 切换改变整个产品。文件系统与子进程 provider 共享一个执行世界，把它们指向远程沙箱，Bash、PTY、LSP 全部随之迁移，无需 fork 任何 provider。典型例子：`fs`（本地/E2B）、`sandbox`（bwrap/Landlock/Seatbelt/Windows ACL）、`llm`（多模型适配器）、`subagent`（多种委派实现）。

### 3.4 事件溯源 Session：model-visible ⟺ logged

append-only 的 `SessionEvent` 日志是模型所见上下文的唯一来源：`deriveMessages()` 从日志投影模型历史，原始 `assistant/chunk` 事件保留回放与 UI 保真。fork、resume、转录、遥测、持久化全部派生自同一条事件流。

**核心不变量：模型可见 ⟺ 已落日志。** 任何到达模型请求的内容必须能从日志重建，有运行时不变量断言这一点。推论：新增一种模型可见输入 = 新增一个 session 事件（扩展 `SessionEventMap`），渲染与回放都从日志出发。

### 3.5 Turn 执行流与事件三域

一个 **step** 是一次模型请求加它调用的工具；一个 **turn** 是零到多个 step，在首个输入被认领前开启、无欠债时关闭：

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
  -> agent/turn-stopping
turn/end
```

事件分三个域，选对域是多数改动的第一个决策：

- **Session events**：落日志的持久事实，经 `session/event` 广播。事实需要挺过 reload 时用它。
- **Agent events**（`agent/*`）：携带活 `Agent`——inbox、step、status、request、validation、continuation。观察或拦截进行中的工作时用它。
- **Capability events**：把策略和适配器挂到 seam 上（`fs/*`、`tools/*`、`telemetry/*`），无需 import loop。

`agent/pre-step`、`agent/request`、`llm/stream` 与三个 `tools/*` 事件是 **waterfall**：监听器必须调用 `next()` 委托，直接返回会短路整条链。`agent/turn-stopping` 是串行的，没有 `next()`。

## 4. 仓库地图

### 4.1 顶层布局

```
vendor/      内嵌的 Cordis 源码（manifest 与同步流程见 vendor/README.md）
packages/    @deepseek-ai/dsh-* 工作区，按 packages/<group>/<pkg>/ 分组
apps/        CLI 与 Web 两个应用入口
python/      Python SDK 与打包的运行时二进制载体
native/      landlock-run 原生沙箱启动器源码
examples/    基于 cordis.yml 的可运行示例（ACP、headless、JSON-RPC 等）
docs/        架构、46 篇子系统参考、cookbook、postmortem（全部中英双语）
scripts/     仓库质量门与生成器（约 140 个脚本）
website/     VitePress 文档站（投影 docs/ 的选定内容）
.agents/     Agent 工作流与 Agent Notes（设计决策的历史档案）
```

### 4.2 packages 分组导读（按职能归类）

完整分组表见 [packages/README.md](packages/README.md)，这里按职能重新组织便于建立地图：

| 职能 | 分组 | 关键包 |
|---|---|---|
| 产品脊柱 | `core/` | `session`（事件日志）、`system-prompt`、`tools`、`agent`、`agent-loop`、`scope` |
| 对外接口 | `api/`、`sdk/`、`acp/`、`host/`、`client/`、`boot/` | Typert RPC 网关、JSON-RPC SDK、Web GUI 宿主与浏览器端、启动胶水 |
| 模型能力 | `llm/` | 消息/流式词汇表 + 适配器 seam（`ctx.llm`） |
| 执行环境 | `subprocess/`、`shell/`、`terminal/`、`code-runtime/`、`sandbox/`、`e2b/` | 进程树、bash、持久 PTY、worker-thread 代码执行、进程隔离 |
| 模型侧工具 | `fs/`、`lsp/`、`skill/`、`web/`、`todo/`、`plan/`、`workflow/`、`jobs/`、`subagent/`、`compaction/`、`context/` | 文件、语言服务、技能、搜索抓取、待办、计划模式、工作流、后台任务、子代理、压缩、请求上下文 |
| 会话数据平面 | `session/`、`session-query/`、`storage/`、`attachment/`、`spill/` | JSONL/SQLite 持久化、投影、标题、全文检索、KV 存储、附件、溢出 |
| 行为与策略 | `interaction/`、`guard/`、`preset/`、`extensions/`、`hooks/` | 审批/权限/命令、loop 卫生守卫、每会话预设组合、运行时自修改、Claude Code/Codex 钩子桥 |
| 用户域 | `goal/`、`schedule/`、`feedback/`、`identity/`、`settings/`、`credentials/`、`workspace/` | 目标、定时跟进、反馈、匿名身份、设置、凭据引用、工作区实体 |
| 基础设施 | `typert/`、`bundle/`、`examples/`、`test-support/`、`util/` | 类型化 RPC 生成器、可安装 patch 层、演示 bundle、测试基建、零依赖工具 |

### 4.3 核心脊柱包与 `ctx` 键

| 包 | 职责 | `ctx` 键 |
|---|---|---|
| `core/session` | append-only `SessionEvent` 日志与内存存储 | `ctx.sessions` |
| `core/system-prompt` | prompt 分节与工具 schema 装配 | `ctx.systemPrompt` |
| `core/tools` | 作用域工具注册表与受守护的执行管线 | `ctx.tools` |
| `core/agent` | `Agent` 接口、活注册表、`agent/*` 事件 | `ctx.agents` |
| `core/agent-loop` | 实现该接口的默认驱动 | `ctx.agentLoop` |
| `core/scope` | 每 agent 作用域注册原语 | 库，无键 |
| `llm/llm` | 消息与流词汇表 + 适配器 seam | `ctx.llm` |

## 5. 开发环境搭建

前置要求：Node.js 22.19+ 或 24+；Corepack 启用的 pnpm（仓库锁定 11.7.0，`pnpm --version` 不走 Corepack 时执行 `corepack enable`）；Git 2.26+；可选：DeepSeek API key（e2e 与 demo 用）。

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install            # 同时安装 worktree-local lefthook 钩子与翻译合并驱动
pnpm run typecheck      # setup 完成的判定标准：此命令通过
```

可选配置：在仓库根目录建 `.env`（gitignored）放入 `DEEPSEEK_API_KEY=sk-...`，可选 `DEEPSEEK_BASE_URL`。**绝不提交凭据**；无 key 时真实 API 测试自动跳过。

验证安装：

```sh
pnpm run build          # tsc host → tsdown host → tsc client → tsdown client → web 前端
pnpm dsh web            # 启动 Web UI
pnpm dsh --profile headless "summarize this workspace"   # 需要 API key
```

## 6. 日常开发工作流

### 6.1 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm run test` | Vitest 单元测试 |
| `pnpm run test:coverage` | **CI 覆盖率门**：`packages/*/*/src` 每文件 100% |
| `pnpm run test:e2e` | 真实 API 测试；无 `DEEPSEEK_API_KEY` 自动跳过 |
| `pnpm run test:snapshot` | 无 key 的 ACP/headless 回放快照 |
| `pnpm run typecheck` / `pnpm run lint` | 类型检查 / oxlint |
| `pnpm run hygiene` | knip + publint + 工作区约束 + NodeNext 消费方检查 |
| `pnpm run build` | 完整构建（消费 built `lib/` 的检查需要它先跑） |
| `pnpm run doc-sync` | 全部文档门（改 docs/ 时必跑） |
| `pnpm run duplication` | 跨文件 TypeScript 克隆检测 |
| `pnpm run check:all` | 可选的全量本地门（非默认要求） |

**选最小的检查覆盖你的改动面**：行为改动跑聚焦测试，模型/用户可见输出改动跑快照，文档改动跑 `doc-sync`，发布路径跑 build/hygiene 与 built smoke。不要默认跑全量——CI 拥有穷举覆盖和平台矩阵。

### 6.2 测试分层

| 层 | 门？ | 要点 |
|---|---|---|
| Unit（`test`） | 是 | 与被测代码同区；每个 registry 要有 HMR 安全测试（dispose 后断言清理） |
| Coverage（`test:coverage`） | **CI 门** | 每文件 100%；未覆盖行常常是应删除的死代码，而不是缺测试 |
| Real-API e2e（`test:e2e`） | 有 key 时 | 只 mock 昂贵/非确定边界（LLM、网络、时钟），下游全用真实实现 |
| Snapshot（`test:snapshot`） | 是 | 无 key 回放；模型可见行为改动必须在同 PR 更新快照场景 |
| Web 快照（`test:web`） | Linux PR 门 | Chromium 比对回放输出；CI 只读 replay |

关键政策：**验证世界，而不是自报**——e2e 断言要在外部重跑命令或重读文件。**测真实入口路径**——产品可见插件需要经 Loader 启动 test-only `cordis.yml` 的 REAL-composition 测试。测试解析只走 source plane（tsconfig `paths` → `src`），built `lib/` 仅显式消费。

### 6.3 Git 钩子与 CI

lefthook 是快速本地检查点：`pre-commit` 跑配对记录校验、staged oxlint、第三方声明再生成、空白检查、vendor manifest 守卫；`pre-push` 跑 `pnpm run typecheck`。钩子故意不跑测试/快照/文档门/构建。CI 按泳道组织独立门（见 `.github/workflows/ci.yml` 与 `scripts/run-gates.ts`），并覆盖 Node 22.19/24/26 兼容矩阵。

## 7. 代码阅读路线

按此顺序，从心智模型到实现细节：

1. **[README.md](README.md)**：先把产品跑起来（`pnpm dsh web`），建立直观认识。
2. **[docs/cordis-primer.md](docs/cordis-primer.md)**：Cordis 基础——`ctx.effect()`、waterfall 语义、Loader 配置。不懂 Cordis 就读不动这个仓库；需要更系统的教程看 [docs/cordis-tutorial/](docs/cordis-tutorial/)。
3. **[docs/architecture.md](docs/architecture.md)**：架构地图——profile/bundle、事件、turn flow、seam、扩展点表。改 `packages/` 前必读。
4. **三篇最深的子系统文档**：[docs/subsystems/session.md](docs/subsystems/session.md)、[docs/subsystems/core.md](docs/subsystems/core.md)（agent 与 loop）、[docs/subsystems/tools.md](docs/subsystems/tools.md)。
5. **沿一条 seam 走一遍代码**：推荐 `shell/`——从 Service Definition 到 local provider 再到模型侧 bash 工具，一次看完三角色的真实形态；`llm/` 是第二好的样本。
6. **[docs/glossary.md](docs/glossary.md)**：术语表，遇到名词随时查。
7. 按需深入：[docs/subsystems/](docs/subsystems/) 的 46 篇专题、[docs/cookbook/](docs/cookbook/) 的实操指南、[.agents/notes/](.agents/notes/) 的设计决策档案。

## 8. 完成第一个改动

### 8.1 扩展点速查（新行为挂在哪里）

| 目标 | 机制 |
|---|---|
| 加模型 provider | 在 `ctx.llm` 注册适配器 |
| 加模型侧能力 | 在 `ctx.tools` 注册；schema 自动加入 prompt 装配 |
| 加 shell 执行 | 注册 `ctx.shell` 后端；本地实现经 `ctx.subprocess` 派生 |
| 加人类命令 | 在 `ctx.commands` 注册，不经过模型 turn |
| 加后台任务 | 在 `ctx.jobs` 注册；`job_*` 工具负责收集与停止 |
| 拦截请求/工具/turn | 用对应 `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 可停 turn |
| 加模型可见上下文 | 调 `agent.inject()`，进入下一个被采纳的请求 |
| 加持久会话状态 | 扩展 `SessionEventMap`，从日志渲染与回放 |
| 限制派生进程 | 用 `ctx.sandbox` 后端；消费方在 spawn 前包裹 argv |
| 给单会话不同能力集 | 组合 agent preset；其中的服务行需要 `isolate` realm |

完整表格见 [docs/architecture.md](docs/architecture.md#where-new-behavior-goes)。实操步骤指南：[cookbook/extension-cookbook.md](docs/cookbook/extension-cookbook.md) 索引了[加包](docs/cookbook/adding-a-package.md)、[加工具](docs/cookbook/adding-a-tool.md)、[加 LLM 适配器](docs/cookbook/adding-an-llm-adapter.md)、[加 Chat 节点](docs/cookbook/adding-a-conversation-node.md)。

### 8.2 改动随附义务

一个非平凡改动的 PR 需要同时包含：

- **代码 + 测试**：按 §6.2 选择分层；模型/协议/用户可见的行为改动必须同 PR 更新无 key 快照场景。
- **文档**：更新受影响包的 README 与 JSDoc 契约；改 `docs/` 需遵循双语配对规范（[docs/AGENTS.md](docs/AGENTS.md)）并跑 `pnpm run doc-sync`。
- **Agent Note**：非平凡改动必须在同 PR 附带一篇 Agent Note（[范围说明](.agents/notes/README.md)）；仅机械/局部编辑豁免。
- **改 agent-loop 本身**需同步更新 [docs/architecture.md](docs/architecture.md)。

推送前参照 [.agents/skills/dsh-pre-push-checks/SKILL.md](.agents/skills/dsh-pre-push-checks/SKILL.md) 选择与 diff 匹配的检查。

## 9. 硬性约定速览（新人最易踩的坑)

以下来自根 [AGENTS.md](AGENTS.md)，按踩坑频率排序：

1. **ESM everywhere**：跨包用包名导入，本地相对导入带 `.ts` 扩展名；`dsh` CLI 源码启动经 tsx 的 ESM-only hook，所达模块不能有 CJS-only 导出。
2. **waterfall 监听器必须调用 `next()`**，否则短路整条链。
3. **模型可见 ⟺ 已落日志**：新增模型可见输入必须新增 session 事件。
4. **依赖 Service Definition，永不依赖具体 provider**（`dsh-agent-loop` 可替换；UI/钩子/工具插件用 `dsh-agent`）。
5. **源平面与产平面不混用**：静态门与测试经 `paths` 解析到 `src`；消费 built `lib/` 的门要显式声明依赖。
6. **插件内无硬编码可调参数**：随部署变化的取值是校验过的 `Config` 字段，可从 cordis.yml 改；`DEFAULT_*` 常量不算可配置性。
7. **错误配置尽早响亮失败**：自包含的在加载时失败，否则在最早可解析点失败；永不静默跳过缺失的引用。
8. **跨边界不透明 id 用 branded 类型**（`Branded<B>`），不用裸 `string`。
9. **信任类型化的同进程边界**：只在 parser/config、队列、模型/工具 JSON、持久化/文件、worker、进程、wire 边界做运行时校验。
10. **注册即 effect**：一切贡献经 `ctx.effect()`/`ctx.on()`；registry 的 `register()` 返回 disposer。
11. **TODO 标记按紧急度**：`FIXME`（阻塞发布）> `TODO`（尽快修）> `XXX`（也许某天）。
12. **判别联合类型上 switch**：封闭联合以 `assertNever` 收尾；可合并扩展的联合走有文档的 default 分支。
13. 文件以恰好一个 trailing newline 结尾（pre-commit 门控）。
14. 并发、生命周期、子进程、拆除工作前先读 [docs/defensive-patterns.md](docs/defensive-patterns.md)。

## 10. 文档地图（进阶阅读）

| 位置 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 架构总图（改 `packages/` 前必读） |
| [docs/development.md](docs/development.md) | 开发指南：TS 双 aggregate 布局、构建顺序、Git 集成、CI 组织 |
| [docs/testing.md](docs/testing.md) | 测试政策：分层、with-key 政策、真实入口路径 |
| [docs/subsystems/](docs/subsystems/) | 46 篇子系统参考（session、tools、llm-streaming、subagent 等） |
| [docs/cookbook/](docs/cookbook/) | 扩展实操指南（加包/工具/适配器/节点） |
| [docs/config-catalog.md](docs/config-catalog.md)、[docs/tool-catalog.md](docs/tool-catalog.md) | 生成的配置与工具目录 |
| [docs/event-producer-consumer.md](docs/event-producer-consumer.md) | 每个事件的生产者与消费者 |
| [docs/capability-seams.md](docs/capability-seams.md) | 能力缝图 |
| [docs/postmortem/](docs/postmortem/) | 事故复盘（理解设计约束的活教材） |
| [.agents/notes/](.agents/notes/) | Agent Notes：设计决策与实现记录的历史档案（archived 为冻结状态） |
| [docs/api-gateway.md](docs/api-gateway.md)、[docs/agent-lifecycle.md](docs/agent-lifecycle.md)、[docs/tool-execution-pipeline.md](docs/tool-execution-pipeline.md) | API 网关装配、agent 生命周期时序图、工具管线 |
