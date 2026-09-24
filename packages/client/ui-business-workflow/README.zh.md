# @deepseek-ai/dsh-client-ui-business-workflow

[English](README.md) | 中文

dsh web 的业务工作流界面，由两部分组成。左侧边栏的一级入口与「新会话」并列：其右弹面板可从一句需求描述新建工作流——无会话打开时，引导消息会暂存并在新会话出现时自动发送——并列出当前会话的记录及其下一步点击操作（继续澄清、生成编排、验证、重新验证）；同一面板也可从会话头部打开。每次点击都会向会话发送一条引导消息，模型继续驱动 `business_workflow_*` 工具，而耐久 keyed Chat 卡片——由 [`dsh-tool-business-workflow`](../../business/tool-business-workflow/README.md) 记录的四个 `tool-business-workflow/*` 会话事件折叠而成——持续投影结果：折叠行显示需求摘要、阶段与步骤数，展开后列出待澄清问题、结构问题、编排看板与验证报告（含每个用例的结论）。编排看板把被接受的编排渲染为从左到右的节点-连线画布（按依赖分层、带箭头连线），每个节点的状态点展示其在最近一次验证试运行轨迹中的结论。回放时仅凭日志即可重建二者。

## Model Experience

无：本包为人类渲染耐久会话记录，不触碰任何 prompt、消息、schema、流或工具结果。模型侧对同一工作流的视图由 `dsh-tool-business-workflow` 持有。

#### KV Cache effect

无；本包从不组装或发送 provider 请求。

## Known Limitations and Deferred Work

- **点击经引导消息驱动** —— 面板从不直接调用运行时；每次点击发送一条用户消息、由模型发起工具调用，因此在运行中的回合后排队的点击会随回合落定而生效。
- **看板只读** —— 不支持拖拽、缩放或内联编辑；布局是确定性的依赖分层，同一日志总是绘制同一画布。
- **卡片上 `ready` 显示为 `composed`** —— 「需求完整」与「编排已接受」两个阶段在卡片节点状态上合并；头部面板的列表保留四阶段的精确文案。
