# Agent Note: 本地 CLI 提供方编辑器家族（ui-settings-models）

Status: implemented

[English](2026-09-24-cli-family-provider-editor.md) | 中文

## 问题

「模型」页为每个适配器家族手写一张编辑卡，而 `layoutOf` 的策展只认识两个 namespace：`llm-deepseek` 与 `llm-pi-ai`。其余 namespace 全部落入 `unknown` 布局——一段指向 `settings.yaml` 的提示，保存按钮禁用。`llm-claude-cli` 双驱动包与被策展的适配器一样把自己的路由注册进可配置提供方目录，于是 Claude CLI 与 Codex CLI 行会出现并打开编辑器，但卡片只是一段无作为的文本提示：没有字段、没有模型列表、没有写入路径。输入框的模型选择器早已提供 codex 运行时的模型（`session.models` 携带同一份目录），而自命为配置面的这一页却配不了本机真正在跑的那一族运行时。

## 决策

策展第三个家族，用不同的主干，而不是把两个既有家族撑大：

- **没有 API 密钥字段。** 两个 CLI 驱动都不经凭据引用鉴权——claude 驱动骑乘 CLI 自己的登录态，codex 驱动的部署凭据走它的 `env`。其他家族打头的那个只写密钥输入框在这里没有所指；`credentialOnly` 出于同一理由被忽略（它索要的是这个家族没有的字段）。
- **连接事实打头。** 卡片顶层字段是驱动的 **CLI 命令**与**超时（毫秒）**——本地运行时的身份真正依靠的两件事。超时以文本编辑进缓冲；无法解析为正整数的值留在屏幕上并禁用保存，而不是带着 schema 会拒绝的东西去 `settings.mutate`；清空字段则取消已存的覆盖。
- **获取动作加载运行时目录，而非端点。** `ModelListEditor` 增加可选的 `loadCandidates` 覆盖源：提供时，获取按钮改问它而不是 `llm.discoverModels`。CLI 卡片从 `llm.models` 取本路由的组——与运行时页渲染的同一份 host 目录——因为 CLI 驱动不注册模型发现；活跃运行时加载的模型恰好就是要提供的列表。其段尚未保存为活跃注册的路由没有组，按钮会如实说明（尚未激活），而不是暗示提供方为空。

模型行、容量、恢复继承与候选选择器沿用 `ModelListEditor` 既有契约，一字未改；写入走每个家族都在用的同一套最小 path ops（`['claude'|'codex', 字段]`），因此驱动包已拥有的 settings-section 热重载直达下一次请求。

## 结果

- Claude CLI 与 Codex CLI 行打开的是真编辑器：命令、超时与驱动的模型目录，经驱动段下的 path ops 编辑 `settings.yaml`。
- CLI 卡上的获取按钮与运行时页收敛：它提供的就是活跃运行时加载的内容；勾选采纳即写入驱动的 `models`——正是 `session.models` 服务给输入框选择器的同一份 advisory 目录。
- `ModelListEditor` 的 probe/discovery 路径未动；pi-ai 的端点询问行为与从前完全一致。
- `unknown` 提示从此只点名真正未知的 namespace；未来的适配器家族复用这个模式（策展 `layoutOf`、想清密钥字段的含义、选定候选源）。

## 备选方案

- **在 CLI 适配器上注册模型发现，让标准获取流程适用**——放弃：适配器是产物承载的（源码已丢；bundle 什么都没注册），而且向本地 CLI 询问“你提供什么”本就没有端点语义——运行时已加载目录是 host 事实，不是探测。
- **让 CLI 段走 deepseek 布局（baseURL + models）**——放弃：`baseURL` 对子进程传输没有意义，API 密钥输入框会承诺一条两个驱动都不读的凭据路径。
- **把 CLI 配置留给手工编辑 `settings.yaml`**——放弃：这正是目录条目出现在「模型」页上所否定的缺口；打开一张死卡的行比没有行更糟。
