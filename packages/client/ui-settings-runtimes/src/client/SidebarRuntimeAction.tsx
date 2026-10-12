/** Sidebar access to the same live model-runtime view used by Settings. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronRightOutline14, IconCloseOutline16, IconRefreshOutline16, IconRuntimeOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RuntimesSection, type RuntimesSectionProps } from './RuntimesSection.tsx'
import css from './SidebarRuntimeAction.module.css'

/** Props assembled by the sidebar action slot. */
export type SidebarRuntimeActionProps = PropsRuntime<'sidebar.session.action'> & RuntimesSectionProps

/**
 * Render a sidebar module entry and its read-only runtime panel.
 * @param props - sidebar width and the shared runtime controller.
 * @returns the trigger and, while open, the portaled panel.
 */
export function SidebarRuntimeAction({ wide, controller, useSnapshot, t }: SidebarRuntimeActionProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const width = panelRef.current?.offsetWidth ?? 0
      const height = panelRef.current?.offsetHeight ?? 0
      const left = width > 0
        ? Math.min(Math.max(rect.right + 8, 8), window.innerWidth - width - 8)
        : rect.right + 8
      const top = height > 0
        ? Math.min(Math.max(rect.top, 8), window.innerHeight - height - 8)
        : rect.top
      setPosition({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const panel = panelRef.current
    const observer = panel !== null && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(place)
      : null
    if (panel !== null) observer?.observe(panel)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss) }
  }, [open])

  if (controller === undefined || useSnapshot === undefined || t === undefined) return null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={css.trigger}
      aria-label={t('nav')}
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      <IconRuntimeOutline16 size={wide ? 16 : 18} />
      {wide ? <span className={css.triggerLabel}>{t('nav')}</span> : null}
      {wide ? <IconChevronRightOutline14 className={css.chevron} size={14} /> : null}
    </button>
  )

  return (
    <div ref={rootRef} className={wide ? css.root : `${css.root} ${css.rail}`} onKeyDown={onKeyDown}>
      {wide ? trigger : <Tooltip label={t('nav')} delayMs={500}>{trigger}</Tooltip>}
      {open ? createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          role="dialog"
          aria-label={t('title')}
          style={position === null ? { visibility: 'hidden' } : position}
        >
          <div className={css.panelActions}>
            <button type="button" aria-label={t('refresh')} onClick={() => { void controller?.load() }}>
              <IconRefreshOutline16 size={16} />
            </button>
            <button type="button" aria-label={t('close')} onClick={() => { setOpen(false); triggerRef.current?.focus() }}>
              <IconCloseOutline16 size={16} />
            </button>
          </div>
          <RuntimesSection controller={controller} useSnapshot={useSnapshot} t={t} />
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
