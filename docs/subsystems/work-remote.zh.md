# 已认证的远程工作

[English](work-remote.md) | 中文

[Work Remote](../../packages/business/work-remote/README.zh.md) 拥有有类型的调用传输及独立认证原生接收端。[F10 提案](../../.agents/notes/proposed/feature/2026-10-20-outcome-oriented-workbench-product.zh.md#f10-authenticated-remote-work) 保留完整用户界面；此能力需要显式组合。

## 身份与数据

`RemotePeerId` 选择本地执行机器配置。`RemoteHostId` 及 `RemotePrincipalId` 限定接收权限；`RemoteSubmissionId` 是该权限范围内的调用方 UUID。`RemotePeer` 描述配置的源地址、固定身份、传输凭据引用／存在性，以及本地传输和远程模型凭据的独立所有权。运行时目录可达不提供此权限。

`RemoteTarget` 选择原生结构化任务输入或正式工作流发布版本／输入集合。所有原生身份属于接收主机。`RemoteOperation` 选择目录、筛选保留列表、固定提交、检查、比较尝试次数的恢复、停止，或精确等待尝试的工作流决定。`RemoteEnvelope` 携带版本 1、预期主机／主体及操作。接收端在派发前检查身份及当前授权。`RemoteReply` 重复认证身份并携带 `RemoteWorkResult`；客户端解码还核对操作／结果类型、请求身份及原生来源关系。

`RemoteSubmission` 保留目标输入、创建时间、尝试次数，以及独立的接纳不确定状态或原生来源引用。`RemoteSubmissionSummary` 省略内容。`RemoteCatalog` 只展示获授权的工作空间路径、执行者版本／运行时／技能／MCP 名称、工作流发布版本及输入说明，以及显式原生控制权限。检查保留精确目标，并返回有来源的状态、观察时间、已记录文本输出或独立不可用状态。这些结果不包含文件捕获内容及传输凭据值。

## 持久化与所有权

接收端域独立于历史记录主机 UUID。每个主体／提交键将不可变输入及规范摘要，绑定到一个带命名空间的原生请求。相同创建返回保留状态；恢复复用请求并比较尝试次数。响应丢失不证明拒绝，重启及客户端重连不自动重复不确定操作。原生智能体及工作流所有者保留会话、权限、日志及审批行为。停止及工作流决定需要独立的当前授权。

机器路由与浏览器 API 信任分开。它只接受回环监听上的已认证 JSON 机器 POST，外部传输由隧道或 TLS 代理保护。每次操作解析凭据，观察轮换并拒绝配置值歧义。调用端拒绝重定向及不支持的源地址，不转发凭据。完整协议／记录上限、容量、超时所有权及显式组合由[包说明](../../packages/business/work-remote/README.zh.md)负责。

[远程执行页面](../../packages/client/ui-work-remote/README.zh.md) 拥有用户选择与保留的未确认输入。`RemoteCallRequest` 固定所选机器、预期 Host／主体及操作；调用提供方在网络分发前拒绝被重新分配的权限身份。获授权工作流查看独立于交付可用性返回等待节点、原说明与实际输入。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxremotework--remotework-abstract-seam"></a>

### `ctx.remoteWork` — `RemoteWork` (abstract seam)

A disconnected caller cannot infer whether a native command committed.

```ts cordis-catalog
/**
 * Describe explicitly configured execution peers without exposing credentials.
 * @returns identities and current credential-presence observations, without network probes.
 */
abstract peers(): Promise<RemotePeer[]>

/**
 * Invoke one explicit operation without automatic transport retries.
 * @param request - fixed peer identity and operation input.
 * @returns a validated, Host/principal-qualified remote result; unavailable responses leave writes uncertain.
 */
abstract call(request: RemoteCallRequest): Promise<RemoteWorkResult>
```

Source: [`packages/business/work-remote/src/service.ts`](../../packages/business/work-remote/src/service.ts)
<!-- END GENERATED cordis-surface -->
