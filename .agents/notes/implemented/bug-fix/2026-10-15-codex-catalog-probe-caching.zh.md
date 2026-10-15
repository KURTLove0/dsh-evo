# Agent Note: Codex 目录探测按 adapter 缓存

Status: implemented

[English](2026-10-15-codex-catalog-probe-caching.md) | 中文

## Problem

每次 codex 目录读取都新起一个 `codex app-server` 子进程。`buildModelCatalog` 先调一次 `listModels`、再逐模型调 `resolveModelInfo`,而 `CodexCliAdapter.nativeModels()` 的每次调用 —— 来自 `listModels`、来自每个 `resolveModel`(选择校验、每 turn 的 `prepareCall`)—— 都各自跑一遍 `initialize` → `model/list` → 销毁。一次 `session.models`(一次输入框菜单打开)因此拉起 1 + N 个进程:实测同时出现 9 个 `codex app-server` 子进程,菜单冷开 9.6s、热开 5.2s。`session.selectModel` 与每 turn 的 `prepareCall` 还要各付一次 spawn(约 2-3s)才能开始请求。探测产出的目录是 CLI 配置状态,几分钟内实质不变,按调用 spawn 的风暴换来的是没人要的实时性。

## Decision

`CodexCliAdapter` 维护原生目录快照,TTL 来自新增的 `codex.catalogCacheMs` 组合字段(默认 60000;0 表示每次调用重新探测)。并发读者共享一个 in-flight 探测;调用方 abort 只是停止等待、不杀探测,探测仍会完成并为下一个调用方刷新快照。失败的探测永不缓存。未配置请求截止时间的探测以 30000ms 为上限 —— 探测是短生命周期 RPC,不是原生 Agent 运行,[无默认截止时间的决策](2026-10-14-codex-cli-no-default-deadline.zh.md)的理由不延伸到它。该修改携带在包的两个 artifact 平面 —— 预打包的 `lib/types/codex-adapter.js` 与 `lib/types/index.js`,以及发布的 `lib/index.js` —— 并由 `tests/catalog.spec.ts` 钉住。

## Alternatives considered

**在 `buildModelCatalog`(host 层)缓存。** 否决:spawn 成本由 adapter 的所有消费方支付(选择校验、每 turn 的 `prepareCall`),不只目录构建方;探测生命周期归 adapter 所有。

**只消除 N+1 而不缓存。** 否决:去掉风暴但每次开菜单、每次选择仍各付一次 spawn —— 用户感知的主要延时仍在。

**不探测,直接服务配置模型。** 否决:原生条目携带实时的名称、描述与推理等级;只用配置兜底会退化所有原生行。

## Consequences

缓存生命周期内,输入框菜单、`/model` 弹窗、选择校验与 turn 准备都从快照应答(实测约 3ms,从 5-10s 降低),每个生命周期只 spawn 一个子进程(冷 6.1s,从 12 个并发 spawn 的 9.6s 降低)。CLI 侧模型变化在 `catalogCacheMs` 内浮现;需要即时新鲜度的部署将其设为 0。挂死的探测不再能永久卡住菜单:在 30000ms 上限失败,下一个调用方重新探测。
