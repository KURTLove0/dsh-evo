/** HTTP-origin policy and bounded response consumption for authenticated machine requests. */
import { RemoteWorkFault } from './protocol.ts'
/**
 * Accept a canonical HTTPS origin, or a numeric loopback HTTP origin for a local secured tunnel.
 * @param input - deployment-selected origin, without credentials or URL suffixes.
 * @returns canonical origin; unsupported transports reject before credential resolution.
 */
export function remoteOrigin(input: string): string {
  const url = new URL(input)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new RemoteWorkFault('invalid-request')
  return url.origin
}
/**
 * Read complete response bytes, cancelling the reader on overflow or decoding failure.
 * @param response - authenticated fetch response.
 * @param maximum - complete UTF-8 body byte cap.
 * @returns parsed untrusted JSON; missing, malformed, or oversized bodies reject.
 */
export async function readReply(response: Response, maximum: number): Promise<unknown> {
  if (response.body === null) throw new RemoteWorkFault('unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximum) throw new RemoteWorkFault('limit')
      chunks.push(next.value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown
  } finally { try { await reader.cancel() } finally { reader.releaseLock() } }
}
