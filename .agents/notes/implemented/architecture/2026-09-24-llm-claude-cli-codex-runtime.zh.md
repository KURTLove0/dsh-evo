# Agent Note: 本地 CLI 模型运行时（llm-claude-cli）——重新挂载与 codex 加载

Status: implemented

[English](2026-09-24-llm-claude-cli-codex-runtime.md) | 中文

## 问题

`@deepseek-ai/dsh-llm-claude-cli` 包——此前会话构建的双驱动本地 CLI LLM 运行时（claude stream-json + codex app-server）——其源码树在未提交工作区事故中丢失：`src/`、`tests/`、README 与 Agent Notes 均已不在（从未提交过 git；dangling stash 提交也不包含它们）。`packages/llm/llm-claude-cli/` 下幸存的是完整构建产物：`lib/index.js`（191 KB 自包含双驱动完整 bundle）、`lib/invariant.js`、`lib/mcp-server.js` 与完整的 `lib/types/` 声明树。没有 `package.json`，该目录破坏 `check-workspace-constraints`（"expected a package here"），web app 也完全无法解析该包。

## 决策

把包恢复为"产物承载"的 workspace 成员，而非重写丢失的源码：

- **package.json 依声明树重建** —— `.d.ts` 文件携带完整公开契约（驱动配置形状与恢复当时的默认值 `timeoutMs: 300000` / `contextWindow: 200000`；Codex 超时默认值现为 `0`，见[无默认截止时间笔记](../bug-fix/2026-10-14-codex-cli-no-default-deadline.zh.md)），因此 manifest、exports 映射（含 `./mcp-server`）与依赖列表都能忠实重建。后续[原生 CLI 配置决策](../feature/2026-10-14-native-cli-reasoning-and-agent-trajectory.zh.md)把配置归属交给各 CLI，并移除了恢复出的 settings 依赖。
- **`src/invariant.ts` 复活** —— `verify-package-invariants` 对 companion 源码做 AST 校验（注册自身包名、命名导出、空 install 的标记注释）；编译产物 `lib/invariant.js` 正是标准 companion 的逐字投影，因此按该精确形态重建源码。最小 `tsconfig.json` 让 `tsc -b` 与 references 门禁保持满足，而不触碰手工构建的 `lib/index.js`。
- **门禁在丢失源码曾登记处重新登记** —— `check-workspace-constraints.ts` 的 `packageFileExtras` 取回 `lib/mcp-server.js` 条目；knip 得到一个以 `lib/index.js` 为 entry 的 workspace 条目，附产物承载包所需的依赖忽略（`src/` 里已没有任何引用者）。
- **运行时解析走 launcher 维护的 flat fallback** —— `healProfilesModuleFallback` 把 `$DSH_HOME/profiles/node_modules` 维护为 app 闭包内每包一个符号链接；它只增不删，因此手工的 `dsh-llm-cli -> <repo>/packages/llm/llm-claude-cli` 符号链接跨启动稳定（未来若正式恢复提交、app manifest 重新依赖它，则回归常规 heal 路径）。Loader 从 profile 目录的 parent-walk 把裸插件名解析到 `lib/index.js`。

## 结果

- web profile 经 `--patch .tmp-llm-cli.patch.yml` overlay 挂载该插件。后续[原生 CLI 配置决策](../feature/2026-10-14-native-cli-reasoning-and-agent-trajectory.zh.md)让已安装 CLI 的存在性与 CLI 自身运行时状态负责路由行为。
- 本机 codex CLI（0.144.6）现在作为运行时加载：设置「运行时」页显示 **Codex CLI** 活跃且已加载 `gpt-5-codex`，与 Claude CLI（sonnet/opus/haiku）、DeepSeek 并列。
- 一次经 `ctx.llm.stream` 的宿主 Context 冒烟证明了原有协议路径。后续[原生 CLI 配置决策](../feature/2026-10-14-native-cli-reasoning-and-agent-trajectory.zh.md)以已安装 Codex 运行时的正常登录与配置替代了私有 `CODEX_HOME` 姿态。
- README 三件套与本 Note 依声明树契约重建；源码文件在包被彻底重写之前仍处于丢失状态（产物在此期间是唯一权威）。

## 备选方案

- **从零重写丢失的源码（适配器、协议层、224 个测试）**——本次放弃：产物正是那些源码的精确构建输出，自包含且已被验证；重写只是重新推导已经在跑的东西。
- **把构建出的 `lib/` 当作事实源提交并删除包**——放弃：「运行时」页、「模型」页与 codex 运行时加载都以活的工作区包为键；删掉它就删掉了运行时。
- **经 `dsh plugin add` 把符号链接钉进 profile 自己的 `node_modules`**——暂缓：那会把产物复制/安装进 profile，把产物冻结在仓库之外；flat-fallback 符号链接让仓库包对源码树工作保持活跃。
