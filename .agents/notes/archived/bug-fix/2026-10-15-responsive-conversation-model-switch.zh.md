# Agent Note: 对话中的模型切换即时反馈

Status: implemented
Archived: 2026-10-15

[English](2026-10-15-responsive-conversation-model-switch.md) | 中文

## Problem

选择原生 CLI 模型时，Host 需要先向运行时查询确切模型元数据，再接受该选择，这可能耗时数秒。在此期间，composer 菜单一直保持打开并显示原模型，因此一次有效点击看起来像没有生效。Host 此时仍持有原选择，但提示词提交仍然可用，导致校验期间发送的消息可能使用界面正准备替换的模型。

## Decision

`ModelDirectory.select()` 在调用 `session.selectModel` 之前，以 `status: selecting` 发布请求的选择。因此 composer 触发器会立即响应点击，菜单也会关闭。`ModelDirectoryResolver` 针对 selecting 状态注册本地化的 composer 阻塞信息，在 Host 响应确定下一次请求所用模型之前禁止提交提示词。

接受响应会以 Host 返回的完整选择替换乐观值，其中包括解析后的默认推理强度。拒绝响应会先恢复原先的当前值与可路由状态，再暴露错误。现有代次规则仍保证较新的加载或选择优先于迟到响应。

## Alternatives considered

**保留旧模型并增加加载动画。** 放弃该方案，因为它仍把一次已完成的点击呈现为未变化状态，也没有消除提示词提交竞态。

**在确切模型校验前由 Host 接受选择。** 放弃该方案，因为无效的推理强度与模型能力必须在会话报告已选择目标之前失败。

## Consequences

即使本地运行时响应缓慢，模型变更也会立即可见；校验期间，提示词不会进入旧路由。失败的变更会短暂显示请求的模型，随后恢复原选择并报告 Host 诊断。组件测试固定菜单即时关闭行为，目录测试固定响应对齐与失败回滚，浏览器插件测试固定临时 composer 阻塞。
