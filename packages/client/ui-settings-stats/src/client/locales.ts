/** Copy dictionaries for the Statistics settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Statistics',
  title: 'Statistics',
  intro: 'Usage aggregated over every persisted session on this host.',
  retry: 'Retry',
  refresh: 'Refresh statistics',
  loading: 'Loading statistics…',
  loadFailed: 'Loading statistics failed',
  sessionsCard: 'Sessions',
  sessionsStarted: '{count} conversation(s) started',
  tokensCard: 'Token usage',
  tokensDetail: 'Input {input} · Output {output} · Cache read {cacheRead}',
  costCard: 'Cost',
  costUnavailable: 'No billing data source — cost cannot be computed yet.',
}

/** The settings.stats namespace key union. */
export type StatsKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  nav: '统计',
  title: '统计',
  intro: '本机全部持久会话的用量汇总。',
  retry: '重试',
  refresh: '刷新统计',
  loading: '正在加载统计…',
  loadFailed: '加载统计失败',
  sessionsCard: '会话数',
  sessionsStarted: '{count} 个已开始对话',
  tokensCard: 'Token 用量',
  tokensDetail: '输入 {input} · 输出 {output} · 缓存读 {cacheRead}',
  costCard: '费用',
  costUnavailable: '暂无计费数据源，暂无法统计费用。',
}
