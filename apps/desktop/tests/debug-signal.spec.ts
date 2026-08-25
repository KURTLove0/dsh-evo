import { spawn } from 'node:child_process'
import { describe, it } from 'vitest'

async function probe(sig: 'SIGTERM' | 'SIGINT' | 'SIGUSR2', delayMs: number): Promise<string> {
  const child = spawn(process.execPath, ['-e', `process.on(${JSON.stringify(sig)}, () => { process.stderr.write('H\\n'); process.exit(0) }); process.stdout.write('R')`])
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let err = ''
  child.stderr.on('data', (c: string) => { err += c })
  await new Promise<string>((r) => { child.stdout.once('data', r) })
  if (delayMs > 0) await new Promise<void>((r) => { setTimeout(r, delayMs) })
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((r) => { child.once('close', (c, s) => { r([c, s]) }) })
  child.kill(sig)
  const [code, signal] = await closed
  return `sig=${sig} delay=${delayMs} -> code=${String(code)} signal=${String(signal)} handlerRan=${err.includes('H')}`
}

describe('signal matrix', () => {
  it('probes signals and delays', async () => {
    console.log(await probe('SIGTERM', 0))
    console.log(await probe('SIGTERM', 800))
    console.log(await probe('SIGINT', 0))
    console.log(await probe('SIGUSR2', 0))
  }, 30_000)
})
