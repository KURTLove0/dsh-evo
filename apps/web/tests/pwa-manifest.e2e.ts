import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'KL Agent Console',
    short_name: 'KL Agent',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/logo.png',
      sizes: '1254x1254',
      type: 'image/png',
      purpose: 'any',
    }],
  })
})

it('ships the repository logo as the page and installation icon', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="icon" type="image/png" href="/logo.png" />')
  const logo = await readFile(join(DIST_ROOT, 'logo.png'))
  const source = await readFile(new URL('../../../logo.png', import.meta.url))
  expect(logo.equals(source)).toBe(true)
})
