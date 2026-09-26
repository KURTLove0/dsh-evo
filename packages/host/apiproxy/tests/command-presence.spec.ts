/**
 * commandPresent: PATH-resolver dispatch by platform, direct executable-bit
 * checks for commands naming a path, and the real-host answers the llm
 * provider listing relies on.
 */

import { describe, expect, it } from 'vitest'
import { commandPresent } from '../src/command-presence.ts'

describe('commandPresent', () => {
  it('resolves a bare name through which on POSIX and where on Windows', () => {
    const calls: string[] = []
    const spawn = ((command: string, args: readonly string[]) => {
      calls.push(`${command} ${args.join(' ')}`)
      return { status: 0 }
    }) as never
    expect(commandPresent('claude', { spawn })).toBe(true)
    expect(commandPresent('claude', { platform: 'win32', spawn })).toBe(true)
    expect(calls).toEqual(['which claude', 'where claude'])
  })

  it('answers false when the PATH resolver finds nothing', () => {
    const spawn = (() => ({ status: 1 })) as never
    expect(commandPresent('nope', { spawn })).toBe(false)
  })

  it('checks a command naming a path for the executable bit directly', () => {
    const seen: string[] = []
    const access = ((path: string) => { seen.push(path) }) as never
    expect(commandPresent('/opt/claude/bin/claude', { access })).toBe(true)
    expect(commandPresent('C:\\Tools\\codex.cmd', { access })).toBe(true)
    expect(seen).toEqual(['/opt/claude/bin/claude', 'C:\\Tools\\codex.cmd'])
  })

  it('answers false when the named path is missing or not executable', () => {
    const access = (() => { throw new Error('ENOENT') }) as never
    expect(commandPresent('/opt/claude/bin/claude', { access })).toBe(false)
  })

  it('probes the real host: node on PATH, the running binary by path, and a miss', () => {
    expect(commandPresent('node')).toBe(true)
    expect(commandPresent(process.execPath)).toBe(true)
    expect(commandPresent('dsh-absolutely-not-a-command-x7q9')).toBe(false)
  })
})
