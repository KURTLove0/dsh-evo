/** Copy dictionaries for the Runtimes settings section. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Runtimes',
  title: 'Runtimes',
  intro: 'Model runtimes this deployment can call, with the models each one currently loads.',
  retry: 'Retry',
  loadFailed: 'Loading runtimes failed',
  empty: 'No model runtimes are active in this deployment.',
  statusActive: 'Active',
  modelsHeading: 'Loaded models',
  modelsEmpty: 'No models listed. Unlisted IDs can still be requested directly.',
  modelsFailure: 'Model listing failed',
  modelsCount: '{count} model(s)',
  daemonHintTitle: 'Runtime sensing daemon is not running',
  daemonHintBody: 'Start it to sense the local CLI runtimes on this machine; presence on this page then follows the daemon’s report.',
  daemonHintCopy: 'Copy',
  daemonHintCopied: 'Copied',
  daemonHintStatus: 'Check what it sensed anytime with: dsh daemon status',
}

/** The settings.runtimes namespace key union. */
export type RuntimesKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  nav: '运行时',
  title: '运行时',
  intro: '当前部署可调用的模型运行时，以及各自当前加载的模型。',
  retry: '重试',
  loadFailed: '加载运行时失败',
  empty: '当前部署没有活跃的模型运行时。',
  statusActive: '活跃',
  modelsHeading: '已加载模型',
  modelsEmpty: '未列出任何模型；目录外 ID 仍可直接请求。',
  modelsFailure: '模型列表获取失败',
  modelsCount: '{count} 个模型',
  daemonHintTitle: '运行时感知守护进程未运行',
  daemonHintBody: '启动守护进程以感知本机的本地 CLI 运行时；此后本页的存在性将跟随守护进程的报告。',
  daemonHintCopy: '复制',
  daemonHintCopied: '已复制',
  daemonHintStatus: '随时可用以下命令查看感知结果：dsh daemon status',
}
