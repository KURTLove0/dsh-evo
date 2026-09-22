# Agent Note: 业务工作流能力族（`dsh-business-workflow` / `-local` / `tool-`）

Status: implemented

[English](2026-09-21-business-workflow-seam.md) | 中文

## Problem

Harness 已有两个编排能力 —— 面向后台工作的 `ctx.jobs` 与面向模型自写扇出脚本的 `ctx.workflowEngine` —— 但没有一个能把「一条业务诉求」变成「经过验证的」编排。今天让模型"构建一个线索排序工作流"，它只能即兴发挥：以对话方式收集需求却没有记录任何完整性判据，凭空发明一个步骤计划却没有结构校验，最后不对照任何标准就把结果呈现为完成。会话中没有任何东西记录需求是什么、编排是否真正覆盖了需求、或在样例输入上是否产出承诺的效果。业务需要什么、工作如何组织、组织是否有效 —— 这三件事需要一条在每个边界都有确定性闸门的完整流水线，否则"工作流"始终是一个未经验证的承诺。

## Decision

`packages/business/` 是 jobs 三包形态的能力族，一条记录在封闭阶段联合 —— `clarifying` → `ready` → `composed` → `verified` —— 中流转：

- **`@deepseek-ai/dsh-business-workflow`（Service Definition）** —— 抽象 `BusinessWorkflowRuntime` 持有 `ctx.businessWorkflows`、五方法契约（`submitRequirement`、`compose`、`verify`、`get`、`list`）、全部词汇（`BusinessWorkflowId`、阶段联合、`RequirementSpec`、`WorkflowComposition`、`VerificationReport`、14 个错误码的 `CompositionIssueCode` 联合）、两个隔离事件（`business-workflow/stage`、`business-workflow/verification`）、流转判定函数 `isBusinessWorkflowStageTransition`，以及事件 invariant companion（流转合法性、验证与阶段的一致性）。
- **`@deepseek-ai/dsh-business-workflow-local`（Service Provider）** —— `LocalBusinessWorkflowRuntime`：内存存储、`bw-N` 标识、确定性缺口分析（对目标/输入/输出/验收用例做存在性检查，每个缺口一个可执行问题）、结构化编排校验（标识唯一性、经 Kahn 剥离的依赖闭包与无环、带显式依赖规则的输入来源可解析性、目标覆盖、输出绑定完整），以及用例门控验证：静态 `case-input-coverage` 检查先行门控试运行，后者按依赖顺序经调用方提供的 `runStep` runner 执行步骤，并对绑定的最终输出断言各用例的 `nonEmpty`/`contains` 期望。
- **`@deepseek-ai/dsh-tool-business-workflow`（Consumer）** —— `business_workflow_clarify` / `_compose` / `_verify` 三个工具：面向模型的 schema、逐字描述即撰写规范、确定性结果渲染、一个使用策略 prompt section，以及经 `ctx.subagents` 将每个步骤委托给全新子代理的 `runStep` runner（`subagentProvider` 配置，默认 `spawn`）。

承重线是**模型撰写内容，运行时持有裁判权**。模型写需求草稿、编排草稿和每个步骤的输出；运行时独自决定记录标识、阶段流转、缺口分析、结构有效性、执行顺序与验收。这条分工线正是闸门可信的原因：任何提交都无法通过自我断言来通过。提交是整值替换 —— 需求修订丢弃已接受的编排（它针对旧需求校验过）、被拒绝的编排草稿不替换任何内容、失败的再验证把 `verified` 降级回 `composed`。

## Alternatives considered

**扩展 `ctx.workflowEngine` 增加需求/验证钩子。** 否决：该 seam 的契约是"执行这段脚本"，其 meta 块是不带执行语义的展示词汇。需求完整性与验收断言是完全不同的生命周期、不同的数据；硬加会让脚本引擎成为一个它从不执行的阶段机的所有者。

**单包合并定义与实现（seam 化之前的 `dsh-jobs` 形态）。** 与 job registry 拆分同理否决：更换存储或执行后端会连带改动每个消费者都要 import 的那个包；仓库约定默认把可替换能力按三包处理。抽象构造器护栏（直接挂载定义会大声失败）避免过期组合行注册出一半的 `ctx.businessWorkflows`。

**LLM 评判式澄清与验证（模型给自己的草稿打分）。** 作为闸门否决：流水线要检查的恰恰是模型判断本身。缺口分析基于存在性、编排校验基于结构，正是为了让"通过"意味着机器核验过的事实；模型判断留在它该在的位置 —— 撰写草稿、经委托 runner 产出步骤输出。

**为每次阶段流转写耐久会话事件（`tool-workflow/*` 形态）。** 推迟，并记录为消费者的 Known Limitation：工具仅经 tool pipeline 投影结果。记录通过结果对模型可见、通过两个 live 事件可渲染；当 UI 需要日志回放时再落地耐久 `business-workflow/*` SessionEventMap 扩展，且可以只改 Consumer 而不动 seam 契约。

## Consequences

收获：一条业务工作流只有通过机器核验的闸门才能到达"完成" —— 每个需求目标都有步骤覆盖、每个输出都有绑定、每个验收用例都在已记录的编排上执行并断言 —— 而且修订循环代价很低（重新提交、重新编排、重新验证），因为被拒绝的草稿不替换任何内容。seam 可替换 Provider：耐久或 worker 执行后端只需实现五个方法，工具与事件都不变。步骤执行也是 runner 注入的，验证今天跑在子代理委托上、明天可以跑在沙箱执行器上而不动流水线。

代价：多出三个带完整 manifest/tsconfig/README/invariant-companion 负担的包；多一个 `ctx` 键（`businessWorkflows`）；阶段机是消费者要学的新词汇。试运行按用例、按步骤串行，记录仅存于进程内 —— 两者都记录为 Provider 的 Known Limitations 而非预先设计掉。

## Testing

seam 的 stub-subclass 套件钉住 `ctx.businessWorkflows` 注册、重复服务拒绝与抽象挂载护栏；基于探针的 invariant 套件钉住每条流转与报告的拒绝路径。Provider 行为套件覆盖完整流水线 —— 缺口迭代、修订丢弃、全部编排缺陷码、拓扑序、验证升降级、静态检查跳过、步骤失败落定、步前与步中中止、容量与销毁 —— 外加经真实 Loader 组合应用 Provider 配置的组合测试。消费者套件经 `ctx.tools.execute` 以脚本化 subagent provider 驱动三个工具，覆盖委托 prompt 内容、渲染报告、两个加载期配置护栏以及缺 agent/缺 provider 的失败。三个包都满足逐文件 100% 覆盖率门槛。
