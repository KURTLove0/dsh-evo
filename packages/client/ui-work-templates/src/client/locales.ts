/** Private library copy; task example contents remain editable user material. */
export const zh = {
  advanced: '完整定义（高级）', goal: '任务目标', background: '背景与输入材料', deliverables: '期望文件', criteria: '验收标准', constraints: '限制',
  objectives: '交付目标', inputs: '输入字段', steps: '执行步骤', agent: '智能体执行', approval: '人工确认', notSpecified: '未填写',
  discardRetry: '放弃重试并刷新', retryHint: '未修改内容时，重试保留原请求。放弃重试不会撤回已提交的操作。',
  title: '模板库', intro: '保存可复用的任务与已发布工作流；每次复用保留来源版本。',
  intake: '任务模板', select: '选择模板', version: '内容版本', name: '模板名称', save: '另存为新模板', update: '保存为新版本',
  load: '载入所选版本', refresh: '刷新', empty: '尚未保存模板。可从工作中心的任务表单保存，或保存一个已发布工作流。',
  task: '任务', workflow: '工作流', archived: '已归档', archive: '归档模板', restore: '恢复模板',
  source: '已发布工作流', publication: '发布版本', saveWorkflow: '保存工作流模板',
  workspace: '副本工作区', copyName: '工作流副本名称', copy: '创建独立工作流草稿', openWorkflow: '打开工作流', openWork: '打开工作中心',
  draftOnly: '此操作只创建可编辑草稿。检查配置后，再发布并明确启动。',
  taskHint: '从工作中心的新建任务表单载入模板，再选择工作区与执行者，检查并提交。',
  hint: '载入会替换当前任务内容，保留所选工作区和执行者。模板和样例不代表执行能力就绪。',
  disconnected: '连接已断开，暂时无法读取或保存模板。', saved: '已保存', copied: '已创建独立草稿', loading: '读取中…',
  examples: '任务样例', 'code-review': '代码审查', documents: '文档整理', 'data-report': '数据文件报告',
  history: '模板内容', provenance: '模板来源', archivedHint: '已归档模板可查看历史，恢复后才能复用或更新。',
}
/** English application locale. */
export const en: typeof zh = {
  advanced: 'Full definition (advanced)', goal: 'Task goal', background: 'Background and inputs', deliverables: 'Expected files', criteria: 'Acceptance criteria', constraints: 'Constraints',
  objectives: 'Delivery objectives', inputs: 'Input fields', steps: 'Execution steps', agent: 'Agent execution', approval: 'Human confirmation', notSpecified: 'Not specified',
  discardRetry: 'Discard retry and refresh', retryHint: 'Retrying unchanged content keeps the original request. Discarding a retry does not undo a submitted operation.',
  title: 'Templates', intro: 'Reuse saved task content and published workflows with pinned source versions.',
  intake: 'Task templates', select: 'Choose a template', version: 'Content version', name: 'Template name', save: 'Save as new template', update: 'Save new version',
  load: 'Load selected version', refresh: 'Refresh', empty: 'No saved templates. Save a task from Work Center or a published workflow.',
  task: 'Task', workflow: 'Workflow', archived: 'Archived', archive: 'Archive template', restore: 'Restore template',
  source: 'Published workflow', publication: 'Published version', saveWorkflow: 'Save workflow template',
  workspace: 'Copy workspace', copyName: 'Workflow copy name', copy: 'Create independent workflow draft', openWorkflow: 'Open workflows', openWork: 'Open Work Center',
  draftOnly: 'This creates an editable draft. Inspect its configuration, then publish and explicitly start it.',
  taskHint: 'Load a template from the new-task form in Work Center, choose a workspace and executor, then check and submit.',
  hint: 'Loading replaces task content and keeps the selected workspace and executor. Templates and examples do not establish execution readiness.',
  disconnected: 'Disconnected. Template reads and writes are unavailable.', saved: 'Saved', copied: 'Independent draft created', loading: 'Loading…',
  examples: 'Task examples', 'code-review': 'Code review', documents: 'Document organization', 'data-report': 'Data-file report',
  history: 'Template content', provenance: 'Template source', archivedHint: 'Archived history remains inspectable. Restore before reusing or editing.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Private task and workflow template content. */
    workTemplates: keyof typeof zh
  }
}
