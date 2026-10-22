/** Knowledge grants and immutable citation vocabulary; freshness is a separate observation. */
export const zh = {
  title: '知识目录', intro: '选择项目文件，捕获资料版本，检索并引用精确原文。',
  workspace: '工作空间', selectWorkspace: '选择工作空间', refresh: '刷新来源', sources: '资料来源', empty: '还没有资料来源。添加一个项目文件并显式索引后，即可检索。',
  path: '项目内文件路径', pathHint: '支持 UTF-8 文本、Markdown 和代码。添加即授予知识访问；不会递归扫描其他文件。', register: '添加并启用来源',
  enabled: '已启用', disabled: '已停用', enable: '启用来源', disable: '停用来源', grantHint: '停用后，后续检索与历史引用读取均被拒绝；已有会话日志不会被擦除。',
  index: '索引当前文件', unindexed: '尚无成功捕获', captured: '已捕获版本', attempt: '最近索引尝试', ready: '已保存捕获', failed: '索引失败', versions: '不可变文本版本',
  search: '检索资料', query: '字面子串', hitLimit: '最多命中行数', queryHint: '检索最新已启用版本；不会自动改用当前文件内容。中文短词和代码符号均可按原文查找。',
  results: '检索结果', noResults: '没有匹配行。可尝试更短的原文片段，并确认来源已启用且已成功索引。', more: '还有匹配行。缩小查询或提高命中上限后重新检索。',
  submitted: '本次查询', exclusions: '本次排除的来源', current: '当前文件观察', matching: '与索引版本相同', different: '与索引版本不同', observed: '观察时间',
  choose: '选择资料来源后查看其版本和索引状态。', preview: '精确引用预览', version: '捕获版本', start: '起始行', end: '结束行', read: '读取捕获原文',
  citation: '版本化行引用', digest: '解码文本 SHA-256', inert: '预览仅展示捕获文本，不执行脚本。读取时仍会核对来源授权和当前文件可读性。',
  copy: '复制引用', copied: '已复制引用', copyFailed: '复制失败，可手动选中下方引用。',
  pending: '结果尚未确认的操作', retry: '重试同一操作', discard: '清除本地待确认操作',
  uncertain: '服务端可能已经提交。重试复用固定输入；启停操作若提示修订冲突，请先刷新核对，再清除本地待确认操作。清除不会撤销服务端数据。',
  registerCommand: '添加来源', indexCommand: '索引资料', grantCommand: '更改来源授权', receipt: '本次操作回执', acknowledged: '服务端已确认操作。',
  offline: '连接已断开，内容预览已清除。保留上次来源元数据；重连不会自动重复检索或写操作。', stale: '来源元数据待刷新。', loading: '读取中…', writing: '正在提交…',
  limit: '文件上限 {n} 字节；最多 {s} 个来源，每来源保留 {v} 个成功版本。', bytes: '字节', lines: '行',
}
/** English counterpart uses the exact same typed key set. */
export const en: Record<keyof typeof zh, string> = {
  title: 'Knowledge directory', intro: 'Select project files, capture material versions, and cite exact source lines.',
  workspace: 'Workspace', selectWorkspace: 'Select a workspace', refresh: 'Refresh sources', sources: 'Material sources', empty: 'No sources yet. Add a project file and explicitly index it before searching.',
  path: 'Project file path', pathHint: 'UTF-8 text, Markdown, and code. Adding grants knowledge access; other files are not scanned.', register: 'Add and enable source',
  enabled: 'Enabled', disabled: 'Disabled', enable: 'Enable source', disable: 'Disable source', grantHint: 'Disabling rejects future searches and historical citation reads. Existing session logs remain.',
  index: 'Index current file', unindexed: 'No successful capture', captured: 'Captured versions', attempt: 'Latest indexing attempt', ready: 'Capture saved', failed: 'Indexing failed', versions: 'Immutable text versions',
  search: 'Search materials', query: 'Literal substring', hitLimit: 'Maximum matching lines', queryHint: 'Search latest enabled captures. Current file content never silently replaces captured evidence; short Chinese phrases and code symbols match literally.',
  results: 'Search results', noResults: 'No matching lines. Try a shorter source fragment and confirm the source is enabled and indexed.', more: 'More lines match. Narrow the query or raise the hit limit and search again.',
  submitted: 'Submitted query', exclusions: 'Excluded sources', current: 'Current file observation', matching: 'Matches indexed capture', different: 'Differs from indexed capture', observed: 'Observed at',
  choose: 'Select a material source to inspect its versions and indexing state.', preview: 'Exact citation preview', version: 'Capture version', start: 'First line', end: 'Last line', read: 'Read captured text',
  citation: 'Versioned line citation', digest: 'Decoded-text SHA-256', inert: 'Preview shows inert captured text. Reads still check the source grant and current file readability.',
  copy: 'Copy citation', copied: 'Citation copied', copyFailed: 'Copy failed. Select and copy the citation below.',
  pending: 'Unconfirmed operation', retry: 'Retry the same operation', discard: 'Clear local request',
  uncertain: 'The server may have committed. Retry uses fixed input. If a grant change reports a revision conflict, refresh and inspect before clearing this local operation. Clearing does not revoke server data.',
  registerCommand: 'Add source', indexCommand: 'Index material', grantCommand: 'Change source grant', receipt: 'Operation receipt', acknowledged: 'The server acknowledged the operation.',
  offline: 'Disconnected. Content previews were cleared; last-known metadata remains. Reconnect never repeats searches or writes.', stale: 'Source metadata needs a refresh.', loading: 'Reading…', writing: 'Submitting…',
  limit: 'File limit {n} bytes; up to {s} sources and {v} successful versions per source.', bytes: 'bytes', lines: 'lines',
}
/** Knowledge locale key union. */
export type KnowledgeKey = keyof typeof zh
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** File grants and captured line citations. */ workKnowledge: KnowledgeKey }
}
