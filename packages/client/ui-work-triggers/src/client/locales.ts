/** Trigger controls distinguish rule consumption, admission, execution, and notice history. */
export const zh = {
  title: '工作触发', intro: '按时间或原执行结束触发固定任务。宿主进程需要保持运行；关闭浏览器不影响已启用的规则。',
  prepare: '基于此执行创建触发', prepareHint: '复制原任务内容；智能体固定当前版本，工作流固定原发布版本与输入。',
  useTarget: '使用此固定目标', loading: '读取中…', refresh: '刷新状态', disconnected: '连接已断开，保留上次读取结果。重连后不会自动重发操作。',
  stale: '显示上次读取结果，刷新完成前不能修改此记录。', readError: '读取未完成',
  submitted: '已提交筛选', search: '规则名称', workspace: '工作空间', all: '全部', enabledFilter: '启用状态', enabled: '已启用', paused: '已暂停', apply: '应用筛选', directory: '触发规则', empty: '没有符合已提交筛选的规则。',
  create: '创建触发规则', name: '名称', rule: '触发条件', at: '指定时间一次', every: '固定间隔', 'on-settled': '原执行结束后一次',
  utcInput: '首次目标时间（UTC，含 Z 或时区偏移）', utcHint: '例如 2026-10-22T09:00:00+08:00。固定间隔按毫秒运行，不跟随夏令时或日历。',
  minutes: '间隔（分钟）', minimum: '最短间隔 {n} 分钟', interpreted: '解释后的目标时间', invalidTime: '输入有效的 ISO 时间，必须带 Z 或 ±HH:MM 时区。', invalidInterval: '间隔必须达到服务端下限且为安全整数毫秒。',
  past: '新规则的首次目标时间必须在未来。已有暂停规则错过时间后，启用会在下一次宿主轮询时处理。', eventHint: '观察所示原执行的任何结束状态（包括失败、取消）。已结束的执行将在下一次轮询时触发。',
  fixed: '固定任务目标', agent: '智能体', workflow: '工作流', revision: '执行者版本', publication: '发布版本', content: '原任务内容 / 输入', source: '观察的原执行',
  savePaused: '保存为暂停', createEnabled: '创建并启用', immutable: '创建后目标与条件不可编辑；修改需新建规则。任务运行时使用原执行服务的可用配置。',
  choose: '选择规则查看执行与通知，或从工作中心准备一个固定目标。', detail: '规则详情', next: '下一次名义时间', noNext: '没有下一次时间；请同时查看规则与交接状态。',
  armed: '等待条件', consumed: '一次性条件已消耗', capacity: '历史容量已满', capacityHint: '保留的执行达到上限后停止新触发，不删除历史记录。',
  pause: '暂停后续触发', resume: '启用后续触发', pauseHint: '暂停不停止已交接的任务；一次性条件不会重置。间隔错过时合并到最近一次，不补发全部次数。',
  history: '保留的触发记录', due: '名义目标时间', claimed: '保留时间', skipped: '合并跳过次数', attempts: '交接尝试次数',
  pending: '交接待处理', unconfirmed: '交接回执未确认', admitted: '已交接执行', settled: '已观察到执行结束',
  admissionHint: '交接成功只说明执行已登记，不代表任务成功或人工验收。', observed: '状态读取时间', unavailable: '原执行当前不可读取；保留上次观察，不能判定失败。',
  completed: '已完成', succeeded: '已成功', failed: '失败', cancelled: '已取消', interrupted: '已中断', queued: '排队中', running: '执行中', waiting: '等待确认', stopping: '停止中',
  recover: '恢复原交接请求', recoverHint: '恢复使用同一个原任务请求；暂停时需先启用。不会创建独立的重试任务。', openRun: '查看原执行', openWork: '打开工作中心',
  notices: '应用内通知', unread: '未读', read: '已读', acknowledge: '标为已读', historicalUncertain: '曾发生交接回执丢失；当前交接状态请以上方记录为准。', noticeHint: '通知只保留本应用内的事实，不发送外部消息。',
  commandPending: '未确认的操作', uncertain: '服务器可能已经执行。保留原始输入；仅创建请求可按原身份恢复，暂停、启用或交接恢复需先读取权威状态再决定下一步。',
  retryCreate: '恢复原创建请求', clear: '清除本地操作记录', clearHint: '清除不会撤销服务器上的规则或任务。创建请求恢复后会读取当前版本。', workerError: '当前宿主观察到规则处理错误；不代表原任务失败。',
}
/** English trigger vocabulary. */
export const en: typeof zh = {
  title: 'Work triggers', intro: 'Trigger fixed tasks by time or original execution settlement. The host must remain running; closing the browser does not stop enabled rules.',
  prepare: 'Create trigger from this execution', prepareHint: 'Copy original content with the current agent revision, or the original workflow publication and inputs.',
  useTarget: 'Use this fixed target', loading: 'Reading…', refresh: 'Refresh state', disconnected: 'Disconnected. Retaining the last read. Reconnection never automatically resends commands.',
  stale: 'Showing the last read. Refresh before changing this record.', readError: 'Read did not complete',
  submitted: 'Submitted filters', search: 'Rule name', workspace: 'Workspace', all: 'All', enabledFilter: 'Enabled state', enabled: 'Enabled', paused: 'Paused', apply: 'Apply filters', directory: 'Trigger rules', empty: 'No rules match the submitted filters.',
  create: 'Create trigger rule', name: 'Name', rule: 'Condition', at: 'Once at a time', every: 'Fixed interval', 'on-settled': 'Once after original execution settles',
  utcInput: 'First target time (ISO with Z or offset)', utcHint: 'For example 2026-10-22T09:00:00+08:00. Intervals use milliseconds, independently of daylight saving or calendars.',
  minutes: 'Interval (minutes)', minimum: 'Minimum interval: {n} minutes', interpreted: 'Interpreted target time', invalidTime: 'Enter a valid ISO time with Z or an explicit ±HH:MM offset.', invalidInterval: 'The interval must meet the server minimum and resolve to safe integer milliseconds.',
  past: 'A new rule requires a future first target. An existing paused rule may become due at the next host poll when enabled.', eventHint: 'Observe any terminal outcome of this original execution, including failure and cancellation. An already settled execution triggers at the next poll.',
  fixed: 'Fixed task target', agent: 'Agent', workflow: 'Workflow', revision: 'Executor revision', publication: 'Publication', content: 'Original task content / inputs', source: 'Observed original execution',
  savePaused: 'Save paused', createEnabled: 'Create and enable', immutable: 'Targets and conditions are immutable; create a new rule to change them. Native services resolve their available configuration when admitting work.',
  choose: 'Select a rule to inspect executions and notices, or prepare a fixed target from Work Center.', detail: 'Rule detail', next: 'Next nominal time', noNext: 'No next time; inspect both rule and admission states.',
  armed: 'Awaiting condition', consumed: 'One-shot condition consumed', capacity: 'History capacity reached', capacityHint: 'Reaching retained history capacity stops new triggers without deleting history.',
  pause: 'Pause future triggers', resume: 'Enable future triggers', pauseHint: 'Pausing does not stop admitted work or reset one-shot conditions. Missed intervals coalesce to the latest occurrence without a catch-up burst.',
  history: 'Retained occurrences', due: 'Nominal target time', claimed: 'Reserved at', skipped: 'Coalesced intervals skipped', attempts: 'Admission attempts',
  pending: 'Admission pending', unconfirmed: 'Admission acknowledgment unconfirmed', admitted: 'Execution admitted', settled: 'Execution settlement observed',
  admissionHint: 'Admission registers execution; it does not establish task success or human acceptance.', observed: 'Status read at', unavailable: 'Original execution is unavailable. Retaining the last observation without inferring failure.',
  completed: 'Completed', succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', queued: 'Queued', running: 'Running', waiting: 'Awaiting confirmation', stopping: 'Stopping',
  recover: 'Recover original admission', recoverHint: 'Recovery reuses the original task request. Enable a paused rule first. It does not create a separate retry task.', openRun: 'Inspect original execution', openWork: 'Open Work Center',
  notices: 'In-app notices', unread: 'Unread', read: 'Read', acknowledge: 'Mark read', historicalUncertain: 'An admission acknowledgment was lost. See the occurrence above for its current admission state.', noticeHint: 'Notices retain in-app facts without sending external messages.',
  commandPending: 'Unconfirmed command', uncertain: 'The server may have applied this command. Original inputs are retained. Only creation can be recovered by identity; read authoritative state before deciding on another control or recovery.',
  retryCreate: 'Recover original creation', clear: 'Clear local command record', clearHint: 'Clearing does not undo host rules or executions. Creation recovery reads the current version.', workerError: 'This host observed a rule processing error; it does not establish task failure.',
}
/** Trigger namespace key union. */
export type TriggerKey = keyof typeof zh
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Durable trigger controls and in-app notice vocabulary. */ workTriggers: TriggerKey }
}
