/** Project artifact vocabulary; historical acceptance remains distinct from current files. */
export const zh = {
  title: '项目产物', intro: '显式登记文件快照，保留来源执行与版本。当前文件的变化不会改写历史快照。',
  directory: '已登记文件', refresh: '刷新目录', filters: '筛选项目产物', search: '文件路径或执行者', workspace: '工作空间', source: '执行来源', origin: '最新版本登记方式',
  all: '全部', agent: '智能体', workflow: '工作流', 'current-file': '当前文件登记', 'accepted-review': '已验收评审快照', apply: '应用筛选',
  stale: '目录或连接已变化，当前显示上次读取结果。请刷新后继续分页。', submitted: '已提交筛选', loading: '读取中…', empty: '没有符合已提交筛选的登记产物。',
  choose: '选择文件后查看其历史版本。', more: '读取下一页', shown: '已显示 {n} 条登记记录',
  disconnected: '连接已断开，保留上次读取的快照与目录；重连后才能登记或检查当前文件。',
  history: '不可变捕获版本', latest: '最新版本', newer: '目录中存在较新版本；重新选择文件可读取新历史。',
  preview: '已保存快照预览', inert: '此处展示保存的字节，不执行 HTML、脚本或文档。它不证明当前文件仍然相同。', binary: '二进制文件：保留原字节，此处不执行或渲染。',
  captured: '快照登记时间', bytes: '字节', sourceRun: '来源执行', sourceSession: '打开原始会话', path: '登记文件路径',
  acceptedHint: '来自指定评审当时保留的已接受版本，不代表当前文件或之后的评审状态。',
  manualHint: '操作人员登记时读取的当前文件。与来源执行关联不证明文件由该执行生成，也不构成人工验收。',
  check: '检查当前文件', checking: '正在检查当前文件…', observed: '当前文件观察时间', observationHint: '观察只反映本次读取，之后文件仍可能变化。',
  'state-matching': '本次读取与所选快照相同', 'state-different': '本次读取与所选快照不同', 'state-missing': '当前文件不存在', 'state-unavailable': '当前文件不可用',
  observationStale: '当前文件观察已过期，请显式重新检查。', append: '将当前文件登记为新版本', appendHint: '新版本是一次当前文件登记，不继承所选快照的验收结论。',
  captureTitle: '登记到项目产物', captureIntro: '关联此来源执行，登记一个当前文件，或保存已验收评审中的原始快照。', mode: '登记方式',
  reviewFile: '已接受的评审文件', noReview: '此执行没有带文件快照的已接受评审。', selectReview: '选择评审及文件', register: '登记文件快照',
  limit: '单文件读取上限：{n} 字节', unsettled: '来源执行结束后才能登记文件。',
  pending: '未确认的登记请求', retry: '恢复原登记请求', discard: '放弃本地请求', uncertain: '回执丢失时服务器可能已保存。恢复会使用原请求；放弃只清除本地请求，不撤销已提交版本。',
  registering: '正在登记…', registered: '上次登记', openRegistered: '查看已登记版本', openWork: '从工作中心登记文件', readError: '读取未完成，保留上次已知结果。',
}
/** English application vocabulary. */
export const en: typeof zh = {
  title: 'Project artifacts', intro: 'Register explicit file snapshots with source executions and immutable versions. Current file changes never rewrite saved captures.',
  directory: 'Registered files', refresh: 'Refresh directory', filters: 'Project artifact filters', search: 'File path or executor', workspace: 'Workspace', source: 'Execution source', origin: 'Latest capture origin',
  all: 'All', agent: 'Agent', workflow: 'Workflow', 'current-file': 'Current-file registration', 'accepted-review': 'Accepted review snapshot', apply: 'Apply filters',
  stale: 'The directory or connection changed. Showing the last read; refresh before continuing pagination.', submitted: 'Submitted filters', loading: 'Reading…', empty: 'No registered artifacts match the submitted filters.',
  choose: 'Select a file to inspect its retained versions.', more: 'Read next page', shown: 'Showing {n} registered files',
  disconnected: 'Disconnected. Retaining the last snapshots and directory; reconnect before registering or inspecting current files.',
  history: 'Immutable capture version', latest: 'Latest version', newer: 'The directory has a newer version. Select the file again to read the updated history.',
  preview: 'Saved snapshot preview', inert: 'This displays retained bytes without executing HTML, scripts, or documents. It does not prove the current file is unchanged.', binary: 'Binary file: original bytes are retained without execution or rendering here.',
  captured: 'Capture registered at', bytes: 'bytes', sourceRun: 'Source execution', sourceSession: 'Open original session', path: 'Registered file path',
  acceptedHint: 'Retained from the accepted version of the named review, independently of current files or later review decisions.',
  manualHint: 'Current file read when the operator registered it. Linking an execution does not prove that execution produced the file or establish human acceptance.',
  check: 'Inspect current file', checking: 'Inspecting current file…', observed: 'Current file observed at', observationHint: 'An observation describes this read only; the file can change afterward.',
  'state-matching': 'This read matches the selected snapshot', 'state-different': 'This read differs from the selected snapshot', 'state-missing': 'Current file is missing', 'state-unavailable': 'Current file is unavailable',
  observationStale: 'The current-file observation is stale. Inspect explicitly again.', append: 'Register current file as a new version', appendHint: 'The new version captures the current file and does not inherit acceptance from this snapshot.',
  captureTitle: 'Register project artifact', captureIntro: 'Link this execution and register a current file, or retain the original file from an accepted review.', mode: 'Capture origin',
  reviewFile: 'Accepted review file', noReview: 'This execution has no accepted review containing a file snapshot.', selectReview: 'Select a review and file', register: 'Register file snapshot',
  limit: 'Per-file read limit: {n} bytes', unsettled: 'The source execution must settle before registering files.',
  pending: 'Unconfirmed registration request', retry: 'Recover original registration', discard: 'Discard local request', uncertain: 'The server may have saved a request whose acknowledgment was lost. Recovery reuses the request; discarding only clears local inputs and does not revoke a committed version.',
  registering: 'Registering…', registered: 'Last registration', openRegistered: 'View registered version', openWork: 'Register from Work Center', readError: 'The read did not complete. Retaining the last known result.',
}
/** Artifact namespace key union. */
export type ArtifactKey = keyof typeof zh
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Project file registration and retained-preview vocabulary. */ workArtifacts: ArtifactKey }
}
