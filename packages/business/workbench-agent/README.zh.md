# dsh-workbench-agent

[English](README.md) | 中文

独立的工作台智能体，包含可替换服务、原生 Harness 提供方和类型化 Remote 消费方。稳定身份、可编辑配置和执行历史保存在带版本的 `workbench_agents` 存储域中。[插件预设](../../preset/agent-presets/README.zh.md)仍是独立功能。

## 配置与执行

必须配置 `runtimePreset`，它仅提供部署的原生工具组装，不代表工作台智能体身份。默认容量为 200 个身份、10,000 条执行记录、八个全局并发执行、每个新智能体六个并发任务，以及每条序列化记录 1 MiB。以上均可配置，目录接口返回实际并发默认值与上限。

名称在已归档身份中也必须唯一。编辑以开始时的版本比较，冲突会拒绝写入。副本获得新身份和空历史。归档保留历史、拒绝新任务并取消未完成任务；恢复后可重新分配任务。

每个任务先持久化排队记录，再创建由服务独立持有的会话。调度器限制全局和逐智能体并发，同一工作区目录内的任务串行执行。配置在开始执行时捕获，编辑影响此后开始的任务。执行区间从提交消息开始到整个智能体空闲为止，包含期间收到的追加消息和引导。停止先记录取消并请求中止，资源清理完成前仍占用容量。重试创建新记录并使用当前配置。

指令与所选技能正文通过已记录的上下文消息进入会话；简介和头像仅供展示。技能缺失或不允许用户调用会明确失败。执行使用指定模型，未指定时解析部署默认值。会话持久化成功后才报告完成。宿主重启将执行中记录标记为中断，排队任务仍可执行。提供方卸载时先取消并等待所有会话退出，再关闭存储。

AI 配置设计不提供任何工具，要求模型返回严格 JSON，并将校验通过的草稿保存在历史中。只有后续明确保存才会修改智能体；无效草稿会使设计执行失败。Remote API 与其他消费者使用相同的服务操作。

## Model Experience

### 任务上下文

#### What the model sees

已记录的用户角色上下文以 `Agent: {name}`、`Identity: {id}` 和 `Revision: {revision}` 开头，随后是指令和各个 `Skill: {name}` 正文。任务作为独立消息提供，不包含展示简介。

#### Token effect

每个任务会话加入一条上下文消息，其 token 开销随指令和所加载技能正文增长。回放保留捕获的文本。

#### KV Cache effect

每个任务建立独立请求前缀。指令、技能、模型或运行时组装变更影响新执行，不改写既有会话。

### 配置设计

#### What the model sees

构建器收到以下指令，后接生成的配置 JSON Schema 和用户的设计请求。

##### 构建器指令

```markdown
Design an agent configuration from the user's request. Return ONLY a JSON object matching this schema. Use runtime harness. Suggest no skills unless the user names them. Do not execute tasks. The result is a draft for human review.
```

#### Token effect

独立的设计请求加入构建器指令、配置 JSON Schema 和用户请求，其工具允许名单为空。

#### KV Cache effect

设计使用独立会话，不改变任务会话的可复用前缀。

## Known Limitations and Deferred Work

- 内置提供方在当前 Harness 宿主执行。外部 CLI 运行时、运行时环境变量/参数/MCP 管理、多用户访问规则、事项、提及、小队及定时触发需要对应提供方和产品能力。
- 身份由用户手动创建；AI 设计针对已保存身份返回可检查的草稿。
- 排队和中断记录保留任务文本与快照；达到容量时拒绝新任务，不自动删除历史。
