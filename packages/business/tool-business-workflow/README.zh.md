# @deepseek-ai/dsh-tool-business-workflow

[English](README.md) | 中文

基于 `ctx.businessWorkflows`（`@deepseek-ai/dsh-business-workflow`）的面向模型业务工作流工具：`business_workflow_clarify`（需求澄清）、`business_workflow_compose`（编排生成）、`business_workflow_verify`（效果验证）。工具持有面向模型的 schema、描述与结果渲染；记录标识、缺口分析、结构校验、执行排序与验收断言都在 seam 之后，因此更换运行时不影响模型所见。验证试运行经 `ctx.subagents` 将每个步骤委托给全新子代理（provider 可配置，默认 `spawn`）。

## 工具

- `business_workflow_clarify` —— 提交完整需求草稿；结果携带记录标识、阶段、版本号、以可执行问题呈现的剩余缺口，以及完整后记录下的需求规格。提供 `workflow_id` 即更新记录（一次修订会丢弃其编排）。
- `business_workflow_compose` —— 提交步骤编排；结果要么报告接受（阶段与步骤数），要么携整改建议返回全部结构缺陷，且不替换任何内容。
- `business_workflow_verify` —— 运行验收用例试运行；结果携带静态检查、每个用例的结论与逐步 trace、修复提示。失败的验证是普通结果，不是工具错误。

## 配置

- `toolNamePrefix`（默认 `business_workflow`）—— 三个工具名的前缀；空字符串在加载时失败。
- `subagentProvider`（默认 `spawn`）—— 试运行委托步骤所用的 subagent provider；空串或带首尾空白的串在加载时失败。
- `maxResultChars`（默认 50000）—— 渲染结果上限；超长文本以截断提示收尾。

呈现是逐工具的 args-only 通用卡片（标题加需求摘要、步骤数或工作流标识）。

## 使用策略

工具注册一个 prompt section（`tool:<prefix>`，order 116）：当用户需要构建或变更业务工作流时使用这三个工具，与用户一起解决报告的缺口，修复报告的结构问题，并且只在验证通过后才把工作流呈现为完成。

## Model Experience

### 工具 schema（clarify、compose、verify）

#### What the model sees

在配置前缀下注册到 `ctx.tools` 的三个工具 schema，描述即源码中的逐字文本（`CLARIFY_DESCRIPTION`、`COMPOSE_DESCRIPTION`、`VERIFY_DESCRIPTION`）；锚定的 [`business_workflow_clarify`/`_compose`/`_verify` 条目](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-business-workflow)携完整 schema 与元数据契约，见生成的[工具目录](../../../docs/tool-catalog.zh.md)；`toolNamePrefix` 重命名定义而不改变它们。

#### Token effect

条件性：三个 schema 与 prompt section 仅在本插件加载期间加入 prompt 装配；尺寸固定，与记录数无关。

#### KV Cache effect

Append-only：schema 与 section 文本在进程生命周期内稳定；更改 `toolNamePrefix`、`subagentProvider` 或任一描述会使后续请求的已装配前缀失效。

### 验证结果

#### What the model sees

每个工具结果渲染出的文本：阶段行与缺口列表（clarify）、接受或缺陷列表（compose）、带 trace 与修复提示的完整验证报告（verify），各自以 `maxResultChars` 封顶。

#### Token effect

每次调用以 `maxResultChars` 有界；步骤 trace 详情另受运行时 `maxTraceChars` 封顶。

#### KV Cache effect

Replacing：每个工具结果追加到当前 turn，验证报告不替换更早内容，但按封顶尺寸增长日志。

## Known Limitations and Deferred Work

- **无耐久会话记录** —— 工具只经 tool pipeline 投影结果；与 `dsh-tool-workflow` 不同，未写入 `tool-workflow/*` 会话事件，UI 尚无法从会话日志回放业务工作流历史。
- **试运行按步骤同步委托** —— 每个步骤在工具调用内等待其子代理完成；后台化或并行化的验证执行已推迟。
