# @deepseek-ai/dsh-business-workflow-local

[English](README.md) | 中文

[`@deepseek-ai/dsh-business-workflow`](../business-workflow/README.zh.md) 运行时契约的进程内实现：`LocalBusinessWorkflowRuntime` 把全部记录保存在内存中，签发 `bw-N` 标识，并驱动三能力流水线 —— 基于确定性缺口分析的需求澄清、基于结构校验的编排生成、基于用例门控试运行与验收断言的效果验证。以插件形式加载后注册为 `ctx.businessWorkflows`。

<a id="durable-workbench-entry"></a>

## 持久化工作台入口

工作空间工作流加载 `@deepseek-ai/dsh-business-workflow-local/workbench`，挂载持久化 `workflowWorkbench` 服务与生成的 `workflowGateway` Remote Consumer。Web bundle 使用 `standard` 预设加载此入口。包根入口提供下文的会话工具流水线。

必填配置：`presets` 是服务端允许的执行预设，`generatorPreset` 必须属于该列表，`subagentProvider` 指定已注册的委派提供方。正整数限制为 `maxWorkflows`（200）、`maxRecordBytes`（4194304）、`maxActiveRuns`（8）、`nodeTimeoutMs`（300000）。运行时依赖 storageDomain、会话持久化、工作空间注册表、Agent 工厂、默认模型配置、预设注册表、工具和 subagents。

`business_workflows` 数据域使用格式 3，通过部署选定的存储后端保存草稿与发布版本聚合、运行预留记录和生成操作。修订号检查在串行写队列中执行。每次执行拥有独立审计会话；检查点落盘成功后才启动后续节点或通知客户端。预留记录连接审计创建和索引发布。重启将未完成执行标记为中断，保留已提交的人工等待，并中断未完成的生成操作。审计日志落盘失败后拒绝后续修改，直到 Host 重启；已提交快照仍可查看。不支持的存储格式在打开时拒绝。

节点与验收用例串行执行。同一工作空间同时只允许一个未结束的工作流，包括人工等待；不同工作空间共享 `maxActiveRuns` 限制。人工决策必须指明当前等待的节点执行身份。取消先记录正在停止，终止并清理子任务后再记录已取消。离开页面不取消运行。AI 生成禁用工具，只保留带来源修订号的有效候选，不覆盖草稿。

`queryRuns` 在有界分页前筛选已提交摘要；`maxRunPageSize` 默认 100。等待中的运行优先，其余按检查点 `updatedAt` 和标识倒序排列。每页及续页携带 `WorkflowRunRevision`；已提交运行变更与宿主重启会使旧续页失效，要求刷新。摘要包含精确等待尝试，不包含完整发布定义、输入或输出。`inspectRun` 返回单次已捕获执行。启动命令可以携带非空 `requestId`；相同发布版本、输入、重跑来源和意见在重启后返回已有回执，冲突复用会拒绝。重跑来源必须是相同发布版本的已结束运行。可选 `feedback` 以 `Requested changes for this new execution:` 标题进入每个新节点的已记录输入，不修改原发布版本或原运行。

`retry` 要求非空请求标识及已结束来源，也允许执行成功但断言失败的验证运行。重试保留原发布版本、输入、反馈和执行路由，不读取已改变的默认模型。验证重试保留用例与断言，使用新验证批次，仍属于验证运行。新尝试获得独立标识并完整执行。提交前检查当前预设、归档状态、工作区独占及容量。已提交的 `retryRequest` 与 `rerunOf` 在并发命令和重启后恢复同一回执；冲突请求标识会拒绝。成功执行及通过断言的验证不可重试。

`catalog` 仅读取工作流标识、名称、工作区归属和归档状态。`queryRuns` 还在分页前按工作流标识，以及包含起点的 `createdFrom`／不包含终点的 `createdBefore` 提交时间筛选。摘要提供首次已记录节点开始时间；已结束运行还提供终止检查点时间，因此总耗时包含排队和人工等待。这些均为派生字段，存储格式不变。

## 准入

`maxWorkflows` 是正安全整数，默认 `200`。超出上限的创建在分配标识之前以指明上限的 `CAPACITY` 错误失败；对已有记录的更新不占用容量。`maxTraceChars`（默认 `2000`）封顶验证报告中每步 trace 的详情长度。

## 生命周期

提交是整值替换。需求提交替换上一份草稿（版本号递增）、丢弃已接受的编排与已验证时间戳 —— 那份编排是针对旧需求校验的 —— 并重新执行缺口分析。编排提交只有在草稿通过全部结构检查后才替换已接受的编排；被拒绝的草稿返回缺陷列表且不改变任何状态，因此 `verified` 记录在评判其下一份修订草稿时保持 `verified`。

阶段流转严格遵循 Service Definition：`clarifying`→`ready`、`ready`→`composed`、`composed`→`verified`、需求修订回退到 `ready`/`clarifying`，以及失败的再验证将 `verified` 降级为 `composed`。对已是 `verified` 的记录的通过型再验证只记录新报告，不发阶段事件。每次流转都在记录提交之后发出 `business-workflow/stage`；`business-workflow/verification` 在报告记录完毕且任何提升发布之后发出。

验证在每一步之前观察调用方信号，且经由方法边界使中止检查在整个运行期间保持有效。步骤失败将所在用例落定为失败 trace 加修复提示；只有非法输入与取消才会抛出。服务销毁清空全部记录 —— 验证不持有需要清理的 owned 资源。

`copy` 命令通过一次持久化写入，从不可变发布创建独立、未发布的草稿。它保留来源发布及可选模板／版本信息。复制请求标识与原创建名称使重试在新草稿编辑后仍稳定。复制不发布、不执行，也不改变来源。

## Model Experience

间接生效：经由 [`dsh-tool-business-workflow`](../tool-business-workflow/README.zh.md)，它渲染澄清缺口、编排缺陷与验证报告。

#### KV Cache effect

无直接失效；请求前缀变化由上述消费者持有。

## Known Limitations and Deferred Work

- 包根入口的会话流水线记录仅存在于进程内。工作区持久化工作流使用工作台入口。
- 工作流执行按单 Host 运行，不支持自动重放节点、单节点重试、条件分支、循环或分布式锁。
- 完整输出随检查点保存，超过 `maxRecordBytes` 的结果会失败；大输出分页查看尚未提供。
- **每次验证内用例串行执行** —— 验收用例逐个执行，用例内的步骤沿依赖拓扑推进；独立用例并发推迟到有消费者需要时再实现。
