/** Health copy separates configuration, metadata reads, and real connection observations. */
export const zh = {
  title: '能力检查', intro: '查看配置是否就绪；仅在明确操作后探测 MCP 连接。', scopeHint: '目录可读与凭证已配置不代表认证有效或任务一定成功。执行时仍会再次检查。',
  agent: '执行者', workspace: '工作区', choose: '请选择', globalCheck: '检查提供方配置', selectedCheck: '检查所选执行者', refresh: '刷新执行者列表',
  configure: '配置智能体', noAgents: '尚无已保存的执行者。请先配置智能体。', noReport: '尚未运行配置检查。', observations: '配置检查结果',
  checkedAt: '检查时间', scope: '本次执行者版本', stale: '配置或选择已变化，以下是最后已知结果，请重新检查。', disconnected: '连接已中断，当前结果可能过期；连接恢复后再操作。',
  checking: '正在检查配置与目录…', loading: '正在读取执行者列表…', all: '全部结果', attention: '只看缺失、失败与未验证', noMatch: '当前筛选下没有检查结果。',
  provider: '提供方', catalog: '模型目录', credential: '凭证配置', executor: '执行者配置', runtime: '本地运行时', model: '模型路由', skills: '所选技能', mcp: 'MCP 服务',
  ready: '已确认配置', missing: '缺失或未就绪', failed: '失败', 'not-checked': '未检测', unknown: '未验证', source: '配置来源', count: '数量', noSkills: '未选择技能',
  'provider-registered': '提供方路由已注册。', 'provider-unconfigured': '提供方尚未启用或配置。', 'catalog-readable': '模型目录读取成功；未执行模型请求。', 'catalog-failed': '模型目录读取失败，请检查运行时或模型设置。',
  'catalog-not-checked': '本机命令缺失，未读取其模型目录。', 'runtime-command-present': '本机可找到此可执行文件；未执行任务。', 'runtime-command-missing': '本机找不到此可执行文件。',
  'credential-configured': '凭证已配置；未验证有效性。', 'credential-missing': '所需凭证尚未配置。', 'credential-undeclared': '未声明凭证引用，环境认证状态未知。', 'credential-owner-missing': '此已存凭证没有当前注册的授权所有者。', 'credential-read-failed': '无法读取凭证配置状态。',
  'workspace-ready': '所选工作区可访问。', 'workspace-unavailable': '工作区不可访问，请重新选择或添加。', 'agent-ready': '已保存的执行者处于启用状态。', 'agent-archived': '执行者已归档，请先恢复。',
  'runtime-ready': '本地运行时路由已注册。', 'runtime-unavailable': '所选本地运行时不可用。', 'model-route-ready': '模型路由配置匹配；未进行推理或认证验证。', 'model-route-unavailable': '模型路由缺失或与运行时不匹配。', 'model-route-unchecked': '运行时不可用，尚未确认模型路由。',
  'skills-ready': '所选技能可发现。', 'skills-unavailable': '无法确认所选技能可用，请检查技能与智能体配置。', 'skills-unchecked': '工作区不可访问，尚未检查技能。', 'mcp-not-checked': '尚未探测连接。检测会启动已配置的本地服务或连接其地址，仅进行握手和 ping。', 'source-unavailable': '此来源读取失败，其他成功结果仍可查看。',
  repairAgents: '打开智能体配置', repairRuntimes: '打开运行时设置', repairModels: '打开模型设置', repairSettings: '打开设置', repairWorkspace: '返回选择工作区',
  connections: 'MCP 连接检测', inspectFirst: '选择执行者和工作区，完成配置检查后再检测连接。', noMcp: '此执行者未配置 MCP 服务。', probe: '检测连接', probeAgain: '再次检测连接',
  running: '检测中', connected: '连接已回应', 'timed-out': '检测超时', cancelled: '已取消', closed: '临时连接已关闭', cleanupFailed: '清理未确认；宿主重新加载前不能发起新检测。',
  duration: '检测总耗时（含清理）', history: '本应用发起的连接检测', noProbes: '尚未发起连接检测。', cancel: '取消检测', recover: '读取检测结果', recoverAll: '刷新已有检测结果', startedAt: '开始时间',
  pending: '请求结果尚未确认，读取结果不会再次发起连接。', unavailable: '当前宿主尚无此检测记录。可能仍在准入或宿主已重启；不会自动重新检测。', lastKnown: '显示最后已知记录',
  transient: '检测记录保留在当前宿主中，不跨宿主重启保留。关闭页面不会取消已发起的检测。', archived: '已归档',
}
/** Health dictionary keys include the closed host diagnostic set. */
export type HealthKey = keyof typeof zh
/** English configuration and probe copy. */
export const en: Record<HealthKey, string> = {
  title: 'Capability checks', intro: 'Inspect configuration readiness; probe MCP connections only when requested.', scopeHint: 'Readable catalogs and configured credentials do not prove valid authentication or task success. Execution checks dependencies again.',
  agent: 'Executor', workspace: 'Workspace', choose: 'Choose', globalCheck: 'Check provider configuration', selectedCheck: 'Check selected executor', refresh: 'Refresh executor list',
  configure: 'Configure agents', noAgents: 'No saved executors. Configure an agent first.', noReport: 'No configuration check has run.', observations: 'Configuration observations',
  checkedAt: 'Checked at', scope: 'Checked executor revision', stale: 'Configuration or selection changed. These are last-known results; check again.', disconnected: 'Connection lost. Results may be stale; reconnect before taking action.',
  checking: 'Checking configuration and catalogs…', loading: 'Reading executors…', all: 'All results', attention: 'Only missing, failed, and unverified', noMatch: 'No observations match this filter.',
  provider: 'Provider', catalog: 'Model catalog', credential: 'Credential configuration', executor: 'Executor configuration', runtime: 'Local runtime', model: 'Model route', skills: 'Selected skills', mcp: 'MCP server',
  ready: 'Configuration confirmed', missing: 'Missing or not ready', failed: 'Failed', 'not-checked': 'Not checked', unknown: 'Unverified', source: 'Configuration source', count: 'Count', noSkills: 'No selected skills',
  'provider-registered': 'Provider route is registered.', 'provider-unconfigured': 'Provider is not enabled or configured.', 'catalog-readable': 'Model catalog read successfully; no model input submitted.', 'catalog-failed': 'Model catalog read failed. Inspect runtime or model settings.',
  'catalog-not-checked': 'The local command is missing; its catalog was not read.', 'runtime-command-present': 'The executable resolves on this host; no task executed.', 'runtime-command-missing': 'The executable does not resolve on this host.',
  'credential-configured': 'Credential is configured; validity is unverified.', 'credential-missing': 'The required credential is not configured.', 'credential-undeclared': 'No credential reference declared; ambient authentication is unknown.', 'credential-owner-missing': 'No registered authorization owner claims this stored credential.', 'credential-read-failed': 'Credential configuration could not be read.',
  'workspace-ready': 'Selected workspace is accessible.', 'workspace-unavailable': 'Workspace is inaccessible. Select or add one.', 'agent-ready': 'Saved executor is active.', 'agent-archived': 'Executor is archived. Restore it first.',
  'runtime-ready': 'Local runtime route is registered.', 'runtime-unavailable': 'Selected local runtime is unavailable.', 'model-route-ready': 'Model route configuration matches; inference and authentication are unverified.', 'model-route-unavailable': 'Model route is missing or does not match the runtime.', 'model-route-unchecked': 'Runtime is unavailable; model routing has not been confirmed.',
  'skills-ready': 'Selected skills are discoverable.', 'skills-unavailable': 'Selected skill availability could not be confirmed. Inspect skill and agent configuration.', 'skills-unchecked': 'Workspace is inaccessible; skills were not checked.', 'mcp-not-checked': 'Connection not probed. A probe starts the saved local server or connects to its address, then only initializes and pings.', 'source-unavailable': 'This source could not be read. Successful peers remain visible.',
  repairAgents: 'Open agent configuration', repairRuntimes: 'Open runtime settings', repairModels: 'Open model settings', repairSettings: 'Open settings', repairWorkspace: 'Return to workspace selection',
  connections: 'MCP connection checks', inspectFirst: 'Choose an executor and workspace and check configuration before probing connections.', noMcp: 'This executor has no configured MCP servers.', probe: 'Probe connection', probeAgain: 'Probe connection again',
  running: 'Probing', connected: 'Connection responded', 'timed-out': 'Probe timed out', cancelled: 'Cancelled', closed: 'Temporary connection closed', cleanupFailed: 'Cleanup is unconfirmed. Reload the host before starting another probe.',
  duration: 'Total probe time (including cleanup)', history: 'Connection probes started by this app', noProbes: 'No connection probe has started.', cancel: 'Cancel probe', recover: 'Read probe result', recoverAll: 'Refresh existing probe results', startedAt: 'Started at',
  pending: 'Request outcome is unconfirmed. Reading its result does not start another connection.', unavailable: 'This host has no record yet. Admission may still be pending or the host restarted; no automatic reprobe occurs.', lastKnown: 'Showing last-known record',
  transient: 'Probe records do not survive host restart. Closing this page does not cancel an admitted probe.', archived: 'Archived',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Configuration observations and explicit connection probes. */
    capabilityHealth: HealthKey
  }
}
