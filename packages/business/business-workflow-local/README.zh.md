# @deepseek-ai/dsh-business-workflow-local

[English](README.md) | 中文

[`@deepseek-ai/dsh-business-workflow`](../business-workflow/README.zh.md) 运行时契约的进程内实现：`LocalBusinessWorkflowRuntime` 把全部记录保存在内存中，签发 `bw-N` 标识，并驱动三能力流水线 —— 基于确定性缺口分析的需求澄清、基于结构校验的编排生成、基于用例门控试运行与验收断言的效果验证。以插件形式加载后注册为 `ctx.businessWorkflows`。

## 持久化工作台入口

工作空间工作流加载 `@deepseek-ai/dsh-business-workflow-local/workbench`，挂载持久化 `workflowWorkbench` 服务与生成的 `workflowGateway` Remote Consumer。Web bundle 使用 `standard` 预设加载此入口。包根入口提供下文的会话工具流水线。

必填配置：`presets` 是服务端允许的执行预设，`generatorPreset` 必须属于该列表，`subagentProvider` 指定已注册的委派提供方。正整数限制为 `maxWorkflows`（200）、`maxRecordBytes`（4194304）、`maxActiveRuns`（8）、`nodeTimeoutMs`（300000）。运行时依赖 storageDomain、会话持久化、工作空间注册表、Agent 工厂、默认模型配置、预设注册表、工具和 subagents。

`business_workflows` 数据域使用格式 1，通过部署选定的存储后端保存草稿与发布版本聚合、运行预留记录和生成操作。修订号检查在串行写队列中执行。每次执行拥有独立审计会话；检查点落盘成功后才启动后续节点或通知客户端。预留记录连接审计创建和索引发布。重启将未完成执行标记为中断，保留已提交的人工等待，并中断未完成的生成操作。审计日志落盘失败后拒绝后续修改，直到 Host 重启；已提交快照仍可查看。不支持的存储格式在打开时拒绝。

节点与验收用例串行执行。同一工作空间同时只允许一个未结束的工作流，包括人工等待；不同工作空间共享 `maxActiveRuns` 限制。人工决策必须指明当前等待的节点执行身份。取消先记录正在停止，终止并清理子任务后再记录已取消。离开页面不取消运行。AI 生成禁用工具，只保留带来源修订号的有效候选，不覆盖草稿。

## 准入

`maxWorkflows` 是正安全整数，默认 `200`。超出上限的创建在分配标识之前以指明上限的 `CAPACITY` 错误失败；对已有记录的更新不占用容量。`maxTraceChars`（默认 `2000`）封顶验证报告中每步 trace 的详情长度。

## 生命周期

提交是整值替换。需求提交替换上一份草稿（版本号递增）、丢弃已接受的编排与已验证时间戳 —— 那份编排是针对旧需求校验的 —— 并重新执行缺口分析。编排提交只有在草稿通过全部结构检查后才替换已接受的编排；被拒绝的草稿返回缺陷列表且不改变任何状态，因此 `verified` 记录在评判其下一份修订草稿时保持 `verified`。

阶段流转严格遵循 Service Definition：`clarifying`→`ready`、`ready`→`composed`、`composed`→`verified`、需求修订回退到 `ready`/`clarifying`，以及失败的再验证将 `verified` 降级为 `composed`。对已是 `verified` 的记录的通过型再验证只记录新报告，不发阶段事件。每次流转都在记录提交之后发出 `business-workflow/stage`；`business-workflow/verification` 在报告记录完毕且任何提升发布之后发出。

验证在每一步之前观察调用方信号，且经由方法边界使中止检查在整个运行期间保持有效。步骤失败将所在用例落定为失败 trace 加修复提示；只有非法输入与取消才会抛出。服务销毁清空全部记录 —— 验证不持有需要清理的 owned 资源。

## Model Experience

间接生效：经由 [`dsh-tool-business-workflow`](../tool-business-workflow/README.zh.md)，它渲染澄清缺口、编排缺陷与验证报告。

#### KV Cache effect

无直接失效；请求前缀变化由上述消费者持有。

## Known Limitations and Deferred Work

- **记录仅存在于进程内** —— harness 重启会丢失全部业务工作流记录；耐久记录需要实现该 seam 的独立后端。
- **每次验证内用例串行执行** —— 验收用例逐个执行，用例内的步骤沿依赖拓扑推进；独立用例并发推迟到有消费者需要时再实现。

工作台按单 Host 运行，不支持自动重放节点、单节点重试、条件分支、循环或分布式锁。完整输出随检查点保存，超过 `maxRecordBytes` 的结果会失败；大输出分页查看尚未提供。
