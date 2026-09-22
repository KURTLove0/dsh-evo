/**
 * One-shot guided-prompt sender: the header action's only write path. A click
 * never touches the runtime directly — it sends one user message into the
 * session, and the model drives the matching business_workflow_* tool, so the
 * durable card, the session log, and replay all keep their existing semantics.
 */
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Send one text prompt into a session.
 * @param sessionId - target session.
 * @param text - the full guided prompt (already locale-rendered by the caller).
 * @returns host acceptance; `false` when the session scope is gone or the host rejects.
 */
export type PromptSender = (sessionId: SessionId, text: string) => Promise<boolean>

/**
 * Bind the sender to the sessions service.
 * @param sessions - the two resolution members the sender needs (narrowed for tests).
 * @returns the bound sender.
 */
export function createPromptSender(sessions: Pick<ISessions, 'scope' | 'sessionOf'>): PromptSender {
  return async (sessionId, text) => {
    const scope = sessions.scope(sessionId)
    const face = scope === undefined ? undefined : sessions.sessionOf(scope)
    if (face === undefined) return false
    const result = await face.prompt([{ type: 'text', text }], 'queue')
    return result.ok
  }
}
