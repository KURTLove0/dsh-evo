/** Workbench-agent UI copy, separate from plugin-composition preset copy. */
export const zh = {
  design: 'AI 生成配置', designHint: '描述职责和工作方式，生成可检查的配置草稿。', reviewCandidate: '检查生成的配置',
  agents: '智能体', intro: '配置工作成员，分配任务，查看每次执行。', newAgent: '新建智能体',
  back: '返回对话', refresh: '刷新', search: '搜索智能体', active: '可用', working: '执行中', archived: '已归档',
  noAgents: '还没有智能体。新建一个，为它定义职责和工作方式。', noMatches: '没有匹配的智能体',
  overview: '配置', runs: '执行记录', edit: '编辑', copy: '复制', archive: '归档', restore: '恢复',
  archiveHint: '归档将取消排队和执行中的任务，历史记录会保留。', confirmArchive: '确认归档',
  cancel: '取消', save: '保存', saving: '处理中…', name: '名称', avatar: '头像文字', description: '简介',
  descriptionHint: '仅用于展示，不进入模型提示。', instructions: '指令', instructionsHint: '在每次执行时提供给智能体。',
  runtime: '运行时', nativeRuntime: 'Harness · 当前主机', online: '可用', offline: '不可用',
  provider: '模型提供方', model: '模型', effort: '推理级别', defaultModel: '留空使用系统默认模型',
  skills: '技能', skillsHint: '每行一个技能名称；执行时从该工作区的技能目录加载。', concurrency: '并发上限',
  starters: '开场提示', addStarter: '添加开场提示', starterLabel: '提示标题', starterPrompt: '提示内容', remove: '移除',
  starterHint: '最多三个。点击后仅填入任务输入框。', task: '分配任务', prompt: '任务内容',
  workspace: '工作区', noWorkspace: '请先创建工作区', run: '开始执行', noRuns: '还没有执行记录',
  queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
  stop: '停止', retry: '重试', transcript: '查看会话', createdAt: '提交时间', revision: '配置版本',
  newTitle: '创建智能体', editTitle: '编辑智能体', copyName: '副本名称', confirmCopy: '创建副本',
  loading: '正在加载智能体…', noDescription: '未填写简介', unsaved: '放弃未保存的修改？',
} as const
/** Keys selected by the framework locale binding. */
export type AgentKey = keyof typeof zh
/** English copy for the same supported operations. */
export const en: Record<AgentKey, string> = {
  design: 'Build with AI', designHint: 'Describe the responsibilities and working style to generate a configuration draft.', reviewCandidate: 'Review generated configuration',
  agents: 'Agents', intro: 'Configure collaborators, assign tasks, and inspect every execution.', newAgent: 'New agent',
  back: 'Back to chat', refresh: 'Refresh', search: 'Search agents', active: 'Available', working: 'Working', archived: 'Archived',
  noAgents: 'No agents yet. Create one and define its responsibilities and working style.', noMatches: 'No matching agents',
  overview: 'Configuration', runs: 'Run history', edit: 'Edit', copy: 'Duplicate', archive: 'Archive', restore: 'Restore',
  archiveHint: 'Archiving cancels queued and running tasks. History is preserved.', confirmArchive: 'Confirm archive',
  cancel: 'Cancel', save: 'Save', saving: 'Working…', name: 'Name', avatar: 'Avatar text', description: 'Description',
  descriptionHint: 'Display only; never enters the model prompt.', instructions: 'Instructions', instructionsHint: 'Provided to the agent on every execution.',
  runtime: 'Runtime', nativeRuntime: 'Harness · This host', online: 'Available', offline: 'Unavailable',
  provider: 'Model provider', model: 'Model', effort: 'Reasoning effort', defaultModel: 'Leave blank for the system default model',
  skills: 'Skills', skillsHint: 'One skill name per line; loaded from the selected workspace at execution.', concurrency: 'Concurrency limit',
  starters: 'Conversation starters', addStarter: 'Add starter', starterLabel: 'Starter label', starterPrompt: 'Starter prompt', remove: 'Remove',
  starterHint: 'Up to three. Selecting one only fills the task composer.', task: 'Assign a task', prompt: 'Task',
  workspace: 'Workspace', noWorkspace: 'Create a workspace first', run: 'Start run', noRuns: 'No runs yet',
  queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted',
  stop: 'Stop', retry: 'Retry', transcript: 'View conversation', createdAt: 'Submitted', revision: 'Configuration revision',
  newTitle: 'Create agent', editTitle: 'Edit agent', copyName: 'Copy name', confirmCopy: 'Create copy',
  loading: 'Loading agents…', noDescription: 'No description', unsaved: 'Discard unsaved changes?',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Independent collaborators and their execution queue. */
    workbenchAgent: AgentKey
  }
}
