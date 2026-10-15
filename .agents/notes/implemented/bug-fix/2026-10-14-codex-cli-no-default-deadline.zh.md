# Agent Note: Codex CLI model calls run without a default wall-clock deadline

Status: implemented

[English](2026-10-14-codex-cli-no-default-deadline.md) | 中文

## Problem

artifact 承载的 `@deepseek-ai/dsh-llm-claude-cli` 包中，Codex 驱动为每次调用设置了五分钟截止时间（`CODEX_DEFAULT_TIMEOUT_MS = 300_000`），沿用了 Claude stream-json 驱动的默认值。一次 Codex app-server 请求并不等于一个模型回合：自[原生 CLI 配置决策](../feature/2026-10-14-native-cli-reasoning-and-agent-trajectory.zh.md)起，一次请求把完整的原生 Agent 运行（shell 命令、文件修改、MCP 与动态工具调用、子代理）委托给已安装的 CLI，合法的运行会超过五分钟。截止时间在运行中杀死子进程，以 `TIMEOUT`（`codex CLI call exceeded its 300000ms deadline`）暴露，重试中间件又在每个回合把同一次注定失败的调用重跑五遍，每次重试再烧五分钟，最终回合失败。`settings.yaml` 救不了这条路由：插件刻意不读取任何 settings 段，组合条目也不带 config，这个够不着的默认值是唯一生效的取值。

## Decision

`CODEX_DEFAULT_TIMEOUT_MS` 为 `0`：除非部署在插件组合条目里设置正数 `codex.timeoutMs`，Codex 驱动不为单次调用设置截止时间。Claude 驱动保留 300000 ms 默认值，因为 stream-json print-mode 进程回答的是受提供方约束的一个模型回合。该修改同时落在包的两个 artifact 平面——预打包的 `lib/types/codex-adapter.js` 与发布的 `lib/index.js` 打包产物——因此下一次 tsdown 重打包会保留它；`tests/timeout.spec.ts` 固定该默认值及显式覆盖的校验。

## Alternatives considered

**把默认值提高到更大的有限值。** 否决：任何猜测值都会在更长的 Agent 运行上重现该故障，同时掩盖进程挂起；需要上限的部署仍有 `codex.timeoutMs` 可用。

**保留默认值并让用户通过 `settings.yaml` 覆盖。** 否决：本地 CLI 运行时的配置归属在已安装 CLI 与 Cordis 组合；settings 通道会复制运行时自有的状态（[原生 CLI 配置决策](../feature/2026-10-14-native-cli-reasoning-and-agent-trajectory.zh.md)）。

**对 CLI 驱动禁用 `TIMEOUT` 重试。** 否决：瞬时提供方故障仍应重试；缺陷在于这个达不到的截止时间，而不是重试策略。

## Consequences

长时间的 Codex Agent 运行可以完成，而不是在五分钟处死亡。挂起的 app-server 子进程不再被 harness 强制杀死；调用方中止仍是取消路径，需要硬上限的部署须显式声明 `codex.timeoutMs`（显式 `0` 会被拒绝——无截止是默认状态，不是配置出来的状态）。[artifact 承载的包恢复笔记](../architecture/2026-09-24-llm-claude-cli-codex-runtime.zh.md)按旧默认值记录了恢复出的声明树；声明与打包产物现在携带 `0`。
