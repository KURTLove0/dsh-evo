# @deepseek-ai/dsh-business-workflow

[English](README.md) | 中文

业务工作流能力 seam（`ctx.businessWorkflows`）的 Service Definition：通过三大能力 —— 需求澄清、工作流编排、效果验证 —— 把一条业务诉求变成一份经过验证的步骤编排的契约。本包只持有契约；请以插件形式加载 Service Provider（如 [`@deepseek-ai/dsh-business-workflow-local`](../business-workflow-local/README.zh.md)），模型经由 [`@deepseek-ai/dsh-tool-business-workflow`](../tool-business-workflow/README.zh.md) 访问该 seam。

## 三大能力

一条记录在封闭的阶段联合类型 —— `clarifying`、`ready`、`composed`、`verified` —— 中流转：

- **需求澄清**（`submitRequirement`）：模型提交完整需求草稿（摘要、目标、输入、输出、可选约束、验收用例）；运行时校验草稿、以可执行问题列表报告确定性的澄清缺口，并在缺口清零后记录需求规格（`clarifying` → `ready`）。重新提交是整值替换：版本号递增并丢弃已接受的编排，因为那份编排是针对旧需求校验的。
- **工作流编排**（`compose`）：模型提交编排草稿（带依赖、输入与目标覆盖的步骤，加上最终输出绑定）；运行时确定性地校验其结构（标识唯一性、依赖闭包与无环、来源可解析且依赖显式、目标覆盖、输出绑定完整），要么接受（`ready` → `composed`），要么携整改建议返回全部缺陷且不替换任何内容。
- **效果验证**（`verify`）：静态用例检查先行，随后由调用方提供的 `runStep` runner 按依赖顺序对每个验收用例执行全部步骤，再对绑定的最终输出断言其期望（`nonEmpty` 或 `contains`）。断言与执行失败沉淀为带修复提示的报告；通过的报告将记录提升为 `verified`，失败的报告保持或降级为 `composed`。

模型与运行时按一条线分工：模型负责撰写内容（草稿，以及经委托 runner 产出的每个步骤输出），运行时负责记录标识、阶段流转与全部确定性检查。

## API

`BusinessWorkflowRuntime` 继承 Cordis `Service` 并挂载为 `ctx.businessWorkflows`：

- `submitRequirement(request): RequirementAnalysis` —— 校验草稿、分析缺口、创建或更新一条记录。
- `compose(request): CompositionOutcome` —— 校验并记录编排，或报告其缺陷。
- `verify(request): Promise<VerificationReport>` —— 静态检查加用例试运行与验收断言。
- `get(id): BusinessWorkflowSnapshot` / `list(): BusinessWorkflowSnapshot[]` —— 全新的只读投影。

错误是 `BusinessWorkflowError`（继承 `HarnessError`），携带机器可路由的错误码：`REQUIREMENT_INVALID`、`COMPOSITION_INVALID`、`UNKNOWN_WORKFLOW`、`STAGE_VIOLATION`、`CAPACITY`、`ABORTED`。结构性编排缺陷与验证失败是普通结果（`issues`、失败报告），不是错误。

## 事件

两个事件都只携带身份数据而非活记录，并以逐监听器隔离派发：

- `business-workflow/stage(info)` —— 一条记录的阶段发生变化；`info.stage` 为流转后的值。
- `business-workflow/verification(info, summary)` —— 一次验证落定，在报告记录完毕且相关阶段流转发布之后。

`isBusinessWorkflowStageTransition(from, to)` 是导出的流转判定函数，invariant companion 与消费者都可复用。

## 扩展点

- Service Provider 实现五个抽象方法，并遵守类上声明的阶段流转、整值提交与报告落定语义。
- 消费者观察两个事件；仅凭阶段事件与验证摘要，UI 就能渲染完整流水线。
- 直接挂载本抽象包会在加载时大声失败 —— 过期的组合行会得到指向 Service Provider 的提示，而不是一个只注册了一半的 `ctx.businessWorkflows`。

## Model Experience

间接生效：经由 [`dsh-tool-business-workflow`](../tool-business-workflow/README.zh.md)，它持有面向模型的 schema、工具描述与渲染后的报告。

#### KV Cache effect

无直接失效；请求前缀变化由上述消费者持有。

## Known Limitations and Deferred Work

- **记录仅存于调用方** —— seam 未定义持久化或跨重启标识；耐久后端需要自行设计，且可能要求扩展契约。
- **验证试运行由调用方提供** —— seam 自身不执行任何工作；想要 worker 侧执行的 provider 必须包装自己的 runner，`signal` 取消之外的每步资源上限尚未进入契约。
