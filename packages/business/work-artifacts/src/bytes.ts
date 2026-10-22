/** Exact byte encoding and digest checks shared by capture and durable decoding. */
import { createHash } from 'node:crypto'
/** Inert payload stored for one bounded regular file. */
export interface ArtifactBytes { sha256: string; bytes: number; encoding: 'utf-8' | 'base64'; content: string }
/**
 * Encode regular UTF-8 as inert text and every other file as exact base64.
 * @param bytes - complete bounded file bytes.
 * @returns digest, length, encoding, and retained content.
 */
export function encodeArtifact(bytes: Uint8Array): ArtifactBytes {
  const base = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch {
    // Invalid UTF-8 retains its original binary bytes.
    return { ...base, encoding: 'base64', content: Buffer.from(bytes).toString('base64') }
  }
  return text.includes('\0') ? { ...base, encoding: 'base64', content: Buffer.from(bytes).toString('base64') }
    : { ...base, encoding: 'utf-8', content: text }
}
/**
 * Decode retained content while asserting its encoding, length, and digest agree.
 * @param snapshot - stored or source-owned captured byte evidence.
 * @returns exact original bytes; inconsistent evidence rejects.
 */
export function decodeArtifact(snapshot: ArtifactBytes): Uint8Array {
  const bytes = Buffer.from(snapshot.content, snapshot.encoding === 'utf-8' ? 'utf8' : 'base64')
  const encoded = encodeArtifact(bytes)
  if (encoded.encoding !== snapshot.encoding || encoded.content !== snapshot.content
    || encoded.bytes !== snapshot.bytes || encoded.sha256 !== snapshot.sha256)
    throw new Error('Captured artifact content, encoding, length, or digest is inconsistent.')
  return bytes
}
