/** Native modal dialogs for remote connections and executable profiles. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { RuntimesSectionInjected } from './RuntimesSection.tsx'
import type { RuntimesSettingsState, RuntimeProfile } from './store.ts'
import { messageOf } from './store.ts'
import type { RuntimesKey } from './locales.ts'
import styles from './RuntimesSection.module.css'

/** Each dialog owns an explicit selected profile or machine identity. */
export type RuntimeDialogState =
  | { kind: 'profiles' }
  | { kind: 'edit'; id: string | null; profile: RuntimeProfile }
  | { kind: 'delete'; id: string; name: string }
  | { kind: 'connect' }
  | { kind: 'connected'; name: string }
  | { kind: 'disconnect'; url: string; name: string }

/**
 * Render one native modal, whose focus and Escape behavior are browser-owned.
 * @param props - selected action, committed directory, callbacks, and localized copy.
 * @returns one modal dialog.
 */
export function RuntimeDialogs({
  dialog,
  state,
  injected,
  onChange,
  onClose,
}: {
  dialog: RuntimeDialogState
  state: RuntimesSettingsState
  injected: InjectFace<RuntimesSectionInjected>
  onChange: (dialog: RuntimeDialogState) => void
  onClose: () => void
}): ReactNode {
  const { t } = injected
  const title: RuntimesKey =
    dialog.kind === 'profiles'
      ? 'manageRuntimes'
      : dialog.kind === 'edit'
        ? dialog.id === null
          ? 'addRuntime'
          : 'editRuntime'
        : dialog.kind === 'delete'
          ? 'deleteRuntime'
          : dialog.kind === 'disconnect'
            ? 'disconnect'
            : dialog.kind === 'connected'
              ? 'connected'
              : 'connectRemote'
  return (
    <Dialog title={t(title)} close={t('close')} onClose={onClose}>
      {dialog.kind === 'profiles' ? (
        <>
          <p className={styles['intro']}>{t('profilesDescription')}</p>
          <button
            type="button"
            className={styles['secondaryButton']}
            disabled={state.saving || !state.writable}
            onClick={() => {
              onChange({
                kind: 'edit',
                id: null,
                profile: { name: '', command: 'cursor-agent', args: [], enabled: true },
              })
            }}
          >
            {t('addRuntime')}
          </button>
          <div className={styles['profileList']}>
            {Object.entries(state.profiles).map(([id, profile]) => (
              <div key={id} className={styles['profileRow']}>
                <div>
                  <strong>{profile.name}</strong>
                  <code>{id}</code>
                  <span>{profile.enabled ? t('enabled') : t('disabled')}</span>
                </div>
                <div className={styles['actions']}>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    onClick={() => {
                      onChange({ kind: 'edit', id, profile })
                    }}
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    onClick={() => {
                      onChange({ kind: 'delete', id, name: profile.name })
                    }}
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            ))}
            {Object.keys(state.profiles).length === 0 ? (
              <p className={styles['empty']}>{t('noCustomRuntimes')}</p>
            ) : null}
          </div>
          <h3>{t('builtinRuntimes')}</h3>
          {state.rows
            .filter(row => state.profiles[row.provider] === undefined)
            .map(row => (
              <div className={styles['profileRow']} key={row.provider}>
                <span>{row.displayName}</span>
                <span className={styles['tagBuiltin']}>{t('tagBuiltin')}</span>
              </div>
            ))}
        </>
      ) : dialog.kind === 'edit' ? (
        <ProfileForm
          key={dialog.id ?? 'new'}
          dialog={dialog}
          existingIds={Object.keys(state.profiles)}
          injected={injected}
          onSaved={() => {
            onChange({ kind: 'profiles' })
          }}
          onCancel={() => {
            onChange({ kind: 'profiles' })
          }}
        />
      ) : dialog.kind === 'connect' ? (
        <ConnectForm
          injected={injected}
          onConnected={(name) => {
            onChange({ kind: 'connected', name })
          }}
        />
      ) : dialog.kind === 'connected' ? (
        <>
          <p role="status">{t('connectionSuccess').replace('{name}', dialog.name)}</p>
          <button type="button" className={styles['secondaryButton']} onClick={onClose}>
            {t('done')}
          </button>
        </>
      ) : (
        <Removal dialog={dialog} injected={injected} onDone={onClose} onCancel={onClose} />
      )}
    </Dialog>
  )
}

function Dialog({
  title,
  close,
  onClose,
  children,
}: {
  title: string
  close: string
  onClose: () => void
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    dialog.showModal()
    return () => {
      dialog.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={styles['dialog']}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles['dialogHeader']}>
        <h2 className={styles['title']}>{title}</h2>
        <button type="button" className={styles['closeButton']} aria-label={close} title={close} onClick={onClose}>
          <span aria-hidden="true"><IconCloseOutline16 /></span>
        </button>
      </div>
      <div className={styles['dialogBody']}>{children}</div>
    </dialog>
  )
}

function ProfileForm({
  dialog,
  existingIds,
  injected,
  onSaved,
  onCancel,
}: {
  dialog: Extract<RuntimeDialogState, { kind: 'edit' }>
  existingIds: string[]
  injected: InjectFace<RuntimesSectionInjected>
  onSaved: () => void
  onCancel: () => void
}): ReactNode {
  const { t, saveProfile } = injected
  const [name, setName] = useState(dialog.profile.name)
  const [id, setId] = useState(dialog.id ?? 'runtime-')
  const [command, setCommand] = useState(dialog.profile.command)
  const [args, setArgs] = useState(JSON.stringify(dialog.profile.args))
  const [enabled, setEnabled] = useState(dialog.profile.enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className={styles['form']}
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        let parsed: string[]
        try {
          const value: unknown = JSON.parse(args)
          if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new Error(t('invalidArgs'))
          parsed = value as string[]
          if (dialog.id === null && existingIds.includes(id)) throw new Error(t('duplicateId'))
          if (!/^runtime-[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(t('invalidId'))
          if (!name.trim() || !command.trim()) throw new Error(t('requiredFields'))
        } catch (cause) {
          setError(messageOf(cause))
          return
        }
        setBusy(true)
        void saveProfile(id, { name: name.trim(), command: command.trim(), args: parsed, enabled }).then(
          onSaved,
          (cause: unknown) => {
            setError(messageOf(cause))
            setBusy(false)
          },
        )
      }}
    >
      <p className={styles['intro']}>{t('cursorProtocol')}</p>
      <label>
        {t('runtimeName')}
        <input
          autoFocus
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          disabled={busy}
        />
      </label>
      <label>
        {t('runtimeId')}
        <input
          required
          value={id}
          onChange={(event) => {
            setId(event.target.value)
          }}
          disabled={busy || dialog.id !== null}
          pattern="runtime-[a-z0-9][a-z0-9-]*"
        />
      </label>
      <label>
        {t('colCommand')}
        <input
          required
          value={command}
          onChange={(event) => {
            setCommand(event.target.value)
          }}
          disabled={busy}
        />
      </label>
      <label>
        {t('arguments')}
        <textarea
          value={args}
          onChange={(event) => {
            setArgs(event.target.value)
          }}
          disabled={busy}
        />
      </label>
      <p className={styles['intro']}>{t('argumentsHint')}</p>
      <label className={styles['checkbox']}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked)
          }}
          disabled={busy}
        />
        {t('enabled')}
      </label>
      {error ? (
        <p className={styles['error']} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles['actions']}>
        <button type="button" className={styles['secondaryButton']} disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </button>
        <button className={styles['primaryButton']} type="submit" disabled={busy}>
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </form>
  )
}

function ConnectForm({
  injected,
  onConnected,
}: {
  injected: InjectFace<RuntimesSectionInjected>
  onConnected: (name: string) => void
}): ReactNode {
  const { t, connect } = injected
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className={styles['form']}
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setError(null)
        void connect(name.trim(), url.trim()).then(
          () => {
            onConnected(name.trim())
          },
          (cause: unknown) => {
            setError(messageOf(cause))
            setBusy(false)
          },
        )
      }}
    >
      <p className={styles['intro']}>{t('connectDescription')}</p>
      <ol className={styles['instructions']}>
        <li>
          {t('connectStep1')} <code>dsh web</code>
        </li>
        <li>{t('connectStep2')}</li>
        <li>{t('connectStep3')}</li>
      </ol>
      <label>
        {t('machineName')}
        <input
          autoFocus
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          disabled={busy}
        />
      </label>
      <label>
        {t('machineUrl')}
        <input
          required
          type="url"
          placeholder="http://127.0.0.1:4096"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
          }}
          disabled={busy}
        />
      </label>
      {error ? (
        <p className={styles['error']} role="alert">
          {error}
        </p>
      ) : null}
      <button className={styles['primaryButton']} type="submit" disabled={busy}>
        {busy ? t('connecting') : t('connect')}
      </button>
    </form>
  )
}

function Removal({
  dialog,
  injected,
  onDone,
  onCancel,
}: {
  dialog: Extract<RuntimeDialogState, { kind: 'delete' | 'disconnect' }>
  injected: InjectFace<RuntimesSectionInjected>
  onDone: () => void
  onCancel: () => void
}): ReactNode {
  const { t, remove } = injected
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className={styles['form']}>
      <p>
        {t(dialog.kind === 'delete' ? 'deleteDescription' : 'disconnectDescription').replace('{name}', dialog.name)}
      </p>
      {error ? (
        <p className={styles['error']} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles['actions']}>
        <button type="button" className={styles['secondaryButton']} disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void remove(
              dialog.kind === 'delete' ? 'profiles' : 'peers',
              dialog.kind === 'delete' ? dialog.id : dialog.url,
            ).then(onDone, (cause: unknown) => {
              setError(messageOf(cause))
              setBusy(false)
            })
          }}
        >
          {busy ? t('saving') : t(dialog.kind === 'delete' ? 'delete' : 'disconnect')}
        </button>
      </div>
    </div>
  )
}
