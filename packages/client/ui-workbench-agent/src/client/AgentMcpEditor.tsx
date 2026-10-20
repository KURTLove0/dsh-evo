/** Controlled MCP transports and explicit runtime variables for a business agent. */
import type { AgentDefinition, AgentMcpServer, AgentMcpVariable } from '@deepseek-ai/dsh-api-remotes/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

interface McpEditorProps {
  servers: AgentDefinition['mcpServers']
  change: (servers: AgentDefinition['mcpServers']) => void
  t: (key: AgentKey) => string
}

/**
 * Configure connections installed only for this identity's task executions.
 * @param props - controlled server definitions and localized labels.
 * @returns stdio and HTTP configuration fields with explicit environment/header values.
 */
export function AgentMcpEditor({ servers, change, t }: McpEditorProps) {
  const update = (index: number, server: AgentMcpServer) => { change(servers.map((item, i) => i === index ? server : item)) }
  return <section className={css.capability} aria-label={t('mcpServers')}>
    <h3>{t('mcpServers')}</h3><p className={css.hint}>{t('mcpHint')}</p>
    {servers.map((server, index) => {
      const variables = server.transport === 'stdio' ? server.env : server.headers
      const setVariables = (values: AgentMcpVariable[]) => {
        update(index, server.transport === 'stdio' ? { ...server, env: values } : { ...server, headers: values })
      }
      return <fieldset key={index} className={css.mcpServer}>
        <legend>{t('mcpServer')} {index + 1}</legend>
        <div className={css.identityFields}>
          <label>{t('mcpName')} {index + 1}<input required pattern="[A-Za-z0-9_-]{1,32}" maxLength={32} value={server.name} onChange={(event) => { update(index, { ...server, name: event.target.value }) }} /></label>
          <label>{t('mcpTransport')} {index + 1}<select value={server.transport} onChange={(event) => {
            update(index, event.target.value === 'stdio'
              ? { name: server.name, transport: 'stdio', command: '', args: [], env: [] }
              : { name: server.name, transport: 'streamable-http', url: '', headers: [] })
          }}><option value="stdio">{t('mcpStdio')}</option><option value="streamable-http">{t('mcpHttp')}</option></select></label>
        </div>
        {server.transport === 'stdio' ? <>
          <label>{t('mcpCommand')} {index + 1}<input required value={server.command} onChange={(event) => { update(index, { ...server, command: event.target.value }) }} /></label>
          <label>{t('mcpArgs')} {index + 1}<textarea rows={3} value={server.args.join('\n')} onChange={(event) => { update(index, { ...server, args: event.target.value === '' ? [] : event.target.value.split('\n') }) }} /><small>{t('mcpArgsHint')}</small></label>
        </> : <label>{t('mcpUrl')} {index + 1}<input required type="url" pattern="[hH][tT][tT][pP][sS]?://.*" value={server.url} onChange={(event) => { update(index, { ...server, url: event.target.value }) }} /></label>}
        <h4>{t(server.transport === 'stdio' ? 'mcpEnvironment' : 'mcpHeaders')}</h4>
        {variables.map((variable, variableIndex) => <div className={css.variables} key={variableIndex}>
          <label>{t('variableName')} {index + 1}.{variableIndex + 1}<input required value={variable.name} onChange={(event) => {
            setVariables(variables.map((item, i) => i === variableIndex ? { ...item, name: event.target.value } : item))
          }} /></label>
          <label>{t('variableValue')} {index + 1}.{variableIndex + 1}<input type="password" autoComplete="off" value={variable.value} onChange={(event) => {
            setVariables(variables.map((item, i) => i === variableIndex ? { ...item, value: event.target.value } : item))
          }} /></label>
          <Button variant="outline" onClick={() => { setVariables(variables.filter((_, i) => i !== variableIndex)) }}>{t('removeVariable')} {index + 1}.{variableIndex + 1}</Button>
        </div>)}
        <div className={css.actions}>
          <Button variant="outline" onClick={() => { setVariables([...variables, { name: '', value: '' }]) }}>{t('addVariable')} {index + 1}</Button>
          <Button variant="outline" onClick={() => { change(servers.filter((_, i) => i !== index)) }}>{t('removeServer')} {index + 1}</Button>
        </div>
      </fieldset>
    })}
    <Button variant="outline" onClick={() => { change([...servers, { name: '', transport: 'stdio', command: '', args: [], env: [] }]) }}>{t('addServer')}</Button>
  </section>
}
