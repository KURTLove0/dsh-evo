/**
 * Sidebar-seat plumbing. The sidebar entry must work with and without an open
 * session: with one, prompts go straight in; without one, one guided prompt is
 * staged and flushed into whatever session the New Session start surfaces. The
 * maybe-conversation feed follows the current session's snapshot through a
 * two-level subscription over the sessions provide projection.
 */
import type { ConversationSnapshot, ISessions, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptSender } from './prompt-sender.ts'

/** The one workspaces member the starter needs (a New Session start). */
export interface WorkflowStarterWorkspaces {
  /** Reuse-or-create the blank session and open it. */
  startSession(workspaceId?: WorkspaceId): void
}

/**
 * Start-one-workflow delivery. `start` resolves to acceptance: with a current
 * session that is the host's answer; without one it means the prompt is staged
 * and will be sent as soon as the started session surfaces.
 */
export interface WorkflowStarter {
  /** Deliver one guided prompt now, or stage it across a New Session start. */
  readonly start: (text: string) => Promise<boolean>
  /** Flush the staged prompt once a current session exists; the caller wires this to the session-list feed. */
  readonly flush: () => void
  /** The staged prompt text, for UI hints; undefined when nothing is waiting. */
  readonly staged: () => string | undefined
}

/**
 * Bind the starter to the sessions list and the workspaces action.
 * @param sessions - the list feed (current selection authority).
 * @param workspaces - New Session start.
 * @param sendPrompt - the bound direct sender.
 * @returns the starter.
 */
export function createWorkflowStarter(
  sessions: Pick<ISessions, 'list'>,
  workspaces: WorkflowStarterWorkspaces,
  sendPrompt: PromptSender,
): WorkflowStarter {
  let staged: string | undefined
  return {
    start(text) {
      const current = sessions.list.getSnapshot().current
      if (current !== undefined) return sendPrompt(current, text)
      staged = text
      workspaces.startSession()
      return Promise.resolve(true)
    },
    flush() {
      const current = sessions.list.getSnapshot().current
      if (staged === undefined || current === undefined) return
      const text = staged
      staged = undefined
      void sendPrompt(current, text)
    },
    staged: () => staged,
  }
}

/**
 * Follow the current session's conversation snapshot as one flat feed: the
 * outer projection publishes selection changes, the inner per-session source
 * publishes the conversation itself, and re-subscribing across a selection
 * change is handled here so consumers bind one hook.
 * @param sessions - the current-session provide projection.
 * @returns snapshot feed; `undefined` while no session is current.
 */
export function createMaybeConversation(
  sessions: Pick<ISessions, 'currentProvideInfo'>,
): HostObservable<ConversationSnapshot | undefined> {
  const provideInfo = sessions.currentProvideInfo
  const sourceOf = (): HostObservable<unknown> | undefined => provideInfo.getSnapshot().hooks['session']
  return {
    subscribe(fn) {
      let innerSource: HostObservable<unknown> | undefined
      let inner: (() => void) | undefined
      const reattach = (): void => {
        const next = sourceOf()
        if (next === innerSource) return
        inner?.()
        innerSource = next
        inner = next?.subscribe(fn)
      }
      const outer = provideInfo.subscribe(() => {
        reattach()
        fn()
      })
      reattach()
      return () => {
        outer()
        inner?.()
      }
    },
    getSnapshot: () => sourceOf()?.getSnapshot() as ConversationSnapshot | undefined,
  }
}
