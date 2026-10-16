// @vitest-environment jsdom
/** The sidebar configuration module nav: title, ledger-driven module rows, and open requests. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfigNav } from '../src/client/ConfigNav.tsx'
import type { ConfigNavProps } from '../src/client/ConfigNav.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type Row = { id: string; order: number; label: string }

const DEFAULT_ROWS: Row[] = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'models', order: 10, label: 'Models' },
  { id: 'runtimes', order: 15, label: 'Runtimes page' },
  { id: 'stats', order: 15, label: 'Statistics page' },
]

function mount({
  wide = true,
  rows = DEFAULT_ROWS,
  request = vi.fn(),
}: { wide?: boolean; rows?: Row[]; request?: (section: string) => void } = {}) {
  const current = rows
  const useSections = ((select: (s: Row[]) => Row[]) => select(current)) as never
  const unusedHook = (() => { throw new Error('unused by ConfigNav') }) as never
  const props: ConfigNavProps = {
    wide,
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    useSections,
    request,
    t: key => en[key],
  }
  const view = render(<ConfigNav {...props} />)
  return { view, request }
}

describe('ConfigNav', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = { wide: true } as ConfigNavProps
    render(<ConfigNav {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('renders the group title over the three module rows', () => {
    mount()
    // The title names the group; the module rows carry the sections' labels
    // (runtimes/stats from their registrants, Settings from the shell).
    expect(screen.getByRole('navigation', { name: en['sidebar.group'] })).toBeTruthy()
    expect(screen.getByText(en['sidebar.group'])).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Runtimes page' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Statistics page' })).toBeTruthy()
    expect(screen.getByRole('button', { name: en['sidebar.settings'] })).toBeTruthy()
  })

  it('requests the section each module row stands for', () => {
    const request = vi.fn()
    mount({ request })
    fireEvent.click(screen.getByRole('button', { name: 'Runtimes page' }))
    expect(request).toHaveBeenCalledWith('runtimes')
    fireEvent.click(screen.getByRole('button', { name: 'Statistics page' }))
    expect(request).toHaveBeenCalledWith('stats')
    // The Settings row stands for the first section the shell does not claim.
    fireEvent.click(screen.getByRole('button', { name: en['sidebar.settings'] }))
    expect(request).toHaveBeenCalledWith('general')
  })

  it('drops a module row whose section is not on the ledger, and the whole nav when none is', () => {
    mount({
      rows: [
        { id: 'general', order: 0, label: 'General' },
        { id: 'stats', order: 15, label: 'Statistics page' },
      ],
    })
    expect(screen.queryByRole('button', { name: 'Runtimes page' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Statistics page' })).toBeTruthy()

    const view = mount({ rows: [] })
    expect(view.view.container.textContent).toBe('')
  })

  it('drops the labels in the rail state, keeping icon-only rows', () => {
    mount({ wide: false })
    expect(screen.queryByText(en['sidebar.group'])).toBeNull()
    expect(screen.queryByText('Runtimes page')).toBeNull()
    // The rows stay clickable as icon circles with their tooltips.
    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.querySelector('svg')).not.toBeNull()
  })
})
