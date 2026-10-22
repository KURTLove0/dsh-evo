/** Authority, observation and admission have independent user-facing states. */
export const zh = {
  title: '远程执行', intro: '选择已授权机器，在它的工作目录中执行。模型密钥、工具权限和文件保留在远端。',
  machine: '执行机器', choose: '请选择', refresh: '刷新状态', loading: '读取中…', disconnected: '连接已断开。保留最后读取的状态；重连不会重复提交。',
  emptyPeers: '尚未配置执行机器。在宿主 Cordis 配置中添加已认证机器后即可选择；运行时目录中的机器不提供执行授权。',
  scope: '目标与权限', endpoint: '机器端点', host: '接收 Host', principal: '授权主体', transport: '本机传输凭据', configured: '已配置', missing: '未配置',
  ownership: '模型凭据与工具权限：远端宿主', stale: '显示上次读取的记录，操作前需刷新。', readError: '读取未完成',
  workspace: '远程工作目录', executor: '执行器', agent: '智能体任务', workflow: '业务工作流', kind: '任务类型', publication: '已发布版本', revision: '智能体修订',
  runtime: '运行时', skills: '技能', mcp: 'MCP 服务', draft: '提交任务', goal: '任务目标', background: '背景材料', deliverables: '交付项（每行一项）',
  criteria: '验收条件（每行一项）', constraints: '约束', inputs: '原始输入（JSON 对象）', invalidInputs: '填写合法的 JSON 对象，包含所列输入字段。',
  requiredInputs: '发布版本的输入', submit: '提交到远端', history: '已保留提交', empty: '这台机器没有当前主体可读取的提交。', detail: '原提交详情',
  select: '选择一条提交查看原输入与执行状态。', fixed: '固定输入', submission: '提交标识', attempts: '交接次数', created: '创建时间', observed: '读取时间',
  unconfirmed: '原生交接未确认', admitted: '远端已接纳', admissionHint: '接纳回执不代表执行成功，也不代表交付已验收。',
  recover: '恢复原交接', recoverHint: '使用同一原生请求和当前交接次数恢复；不会新建另一个任务。', native: '原生执行', session: '原始会话',
  sessionHint: '文件与普通工具审批需在远端原生应用中查看；此处仅返回已记录文本。', output: '已记录文本', unavailable: '结果证据暂不可读取。',
  decisionUnavailable: '待审批节点暂不可读取。', decisions: '原生工作流审批', approve: '批准', reject: '拒绝', confirm: '确认此操作', cancel: '返回', stop: '停止原执行',
  decisionHint: '核对节点说明和实际输入后决定。状态可能变化；服务器会再次校验原等待节点。',
  pending: '未确认的操作', uncertain: '远端可能已执行。保留原机器身份与输入；不要用新标识重复任务。', inspect: '读取原提交',
  retry: '按原身份重新提交', clear: '清除本地操作记录', clearHint: '清除只影响本页记录，不会撤销远端任务。停止、恢复或审批回执丢失时，请先读取原提交再决定。',
  authorityChanged: '机器配置的 Host 或主体已变化。保留原请求；禁止发送到新的身份。',
  queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', waiting: '等待确认', stopping: '停止中', succeeded: '已成功',
}
/** Paired English labels for the same explicit operations. */
export const en: typeof zh = {
  title: 'Remote execution', intro: 'Choose an authorized machine and execute in its workspace. Model credentials, tool permissions and files stay remote.',
  machine: 'Execution machine', choose: 'Choose', refresh: 'Refresh state', loading: 'Reading…', disconnected: 'Disconnected. Keeping the last read; reconnect never repeats a submission.',
  emptyPeers: 'No execution peers configured. Add an authenticated peer in the host Cordis configuration. Runtime-directory entries do not authorize execution.',
  scope: 'Target and authority', endpoint: 'Machine endpoint', host: 'Receiving Host', principal: 'Principal', transport: 'Local transport credential', configured: 'Configured', missing: 'Missing',
  ownership: 'Model credentials and tool permissions: remote host', stale: 'Showing the last read. Refresh before acting.', readError: 'Read did not complete',
  workspace: 'Remote workspace', executor: 'Executor', agent: 'Agent task', workflow: 'Business workflow', kind: 'Task type', publication: 'Published version', revision: 'Agent revision',
  runtime: 'Runtime', skills: 'Skills', mcp: 'MCP services', draft: 'Submit work', goal: 'Task goal', background: 'Background', deliverables: 'Deliverables (one per line)',
  criteria: 'Acceptance criteria (one per line)', constraints: 'Constraints', inputs: 'Original inputs (JSON object)', invalidInputs: 'Enter a valid JSON object containing the listed input fields.',
  requiredInputs: 'Publication inputs', submit: 'Submit remotely', history: 'Retained submissions', empty: 'No retained submissions are readable by this principal on this machine.', detail: 'Original submission',
  select: 'Select a submission to inspect its original input and execution.', fixed: 'Fixed input', submission: 'Submission id', attempts: 'Admission attempts', created: 'Created', observed: 'Observed',
  unconfirmed: 'Native admission unconfirmed', admitted: 'Admitted remotely', admissionHint: 'Admission does not establish execution success or human acceptance.',
  recover: 'Recover original admission', recoverHint: 'Reuse the same native request and current admission attempt; no separate task is created.', native: 'Native execution', session: 'Original session',
  sessionHint: 'Use the remote native application for files and ordinary tool approvals. Only recorded text is returned here.', output: 'Recorded text', unavailable: 'Delivery evidence is unavailable.',
  decisionUnavailable: 'Waiting attempts are unavailable.', decisions: 'Native workflow decisions', approve: 'Approve', reject: 'Reject', confirm: 'Confirm operation', cancel: 'Back', stop: 'Stop original execution',
  decisionHint: 'Review node instructions and actual inputs. State can change; the server checks the original waiting attempt again.',
  pending: 'Unconfirmed operation', uncertain: 'The remote may have executed this command. Keep the original machine identity and input; do not repeat the task with a new id.', inspect: 'Read original submission',
  retry: 'Resubmit original identity', clear: 'Clear local command record', clearHint: 'Clearing affects this page only; it does not undo remote work. Read the original submission after a lost stop, recovery or decision acknowledgment.',
  authorityChanged: 'The configured Host or principal changed. Keep the original request; sending it to another identity is blocked.',
  queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', waiting: 'Waiting', stopping: 'Stopping', succeeded: 'Succeeded',
}
/** Remote execution namespace keys. */
export type RemoteKey = keyof typeof zh
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Authenticated native remote execution controls. */ remoteWork: RemoteKey }
}
