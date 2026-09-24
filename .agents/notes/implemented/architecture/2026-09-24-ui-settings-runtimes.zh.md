# Agent Note: 运行时设置分区（ui-settings-runtimes）

Status: implemented

[English](2026-09-24-ui-settings-runtimes.md) | 中文

## 问题

设置面板无法回答"当前部署到底能调用哪些模型运行时、每个运行时现在加载了什么"。「模型」页负责提供方配置（路由、凭据、作为 *settings* 的模型目录），输入框选择器负责会话级选择，但两个面都不报告运行时活跃状态及其旁边的已加载模型列表——休眠路由（目录中已声明、无注册适配器）与活跃路由在外观上不可区分，直到请求失败才暴露。multica 的 dashboard 有一个 Runtimes 页面正是做这种阅读，但它围绕机器实例与 daemon 心跳构建，单机插件 harness 没有对应物。

## 决策

交付一个只读设置分区，连接 host 已有的两个 wire 域，不新增任何 RPC：`llm.providers`（可配置提供方目录：每条已声明路由及其活跃/休眠状态）与 `llm.models`（host 侧目录：每条活跃路由当前通告的模型，或其逐提供方的列举失败）。一份共享页面 store 并行加载两者并按路由 id 连接；行保持目录声明顺序。

本页从不写入。配置归「模型」页，选择归输入框的选择器；休眠行指向其配置面，而不是提供一个背后没有写入路径的编辑入口。活跃状态渲染为圆点加状态词——绝不作为提供方健康，因为休眠是配置事实而非故障。列举失败的活跃路由逐字携带失败文本；host 对每条路由只报告一个目录事实，因此客户端不发明降级状态推导。

新鲜度复用现有转发的 owner 事件（`settings/document-updated`、`llm/adapters-updated`）加 `connection/reset`，以首次加载为门——未打开的页面从不抓取，与「模型」页遵守的收敛契约相同。

导航行注册在 `settings.section` slot，order 15（「模型」10 之后、「Agent 预设」20 之前）：阅读已有之物是比组装将跑之物更轻的行为，该位置让两个模型相关页相邻。Shell 导航图标需要在 ui-primitives 新增一个图标（`IconRuntimeOutline16`，带闪电缺口的芯片轮廓），按分区 id 匹配。

## 结果

- 新增 `@deepseek-ai/dsh-client-ui-settings-runtimes` 浏览器插件：`RuntimesSettingsStore`（连接）、`RuntimesSection`（视图）、`settings.runtimes` 词典（中英）、空 host 半体与 invariant companion——标准 client 包对。
- 任何调用 `ctx.llm.registerConfigurableProviders` 的适配器都会自动出现在这里；休眠但可编辑的路由（`llm-claude-cli` codex 驱动模式）显示为未启用并带配置指引，与目录报告的完全一致。
- web-app 在 `ui-settings-models` 旁挂载该行；`tsconfig.base.json` paths 与 `tsconfig.client.json` references 注册该包，使源码面解析与覆盖率门禁都能看到它。
- 目录不携带的模型运行时事实（用量、健康、机器身份）需要新的 wire 面；本节刻意只投影 `llm.providers`/`llm.models` 已回答的内容。

## 备选方案

- **在「模型」页扩展逐行模型视图**——放弃：「模型」页是配置面，其行会打开编辑器；把只读目录视图混入会让每行携带两种冲突的可用性语义。
- **新增形如 multica RuntimeDevice 的 `llm.runtimes` RPC（健康、最后在线、用量）**——放弃：DSH 是单机插件 harness，没有 daemon 注册表；发明一个重述两个既有域的服务器形状事实源，只会增加 wire 面而不增加事实。
- **从目录失败的存在推导降级健康**——放弃：host 对每条路由只报告一个目录事实；从同一事实合成第二个更软的状态是 host 从未承诺的客户端推断。
