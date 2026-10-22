/** Bearers stay in Host memory and headers; each operation observes current credential values. */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { RemoteWorkFault } from './protocol.ts'
/**
 * Resolve a nonempty, header-safe bearer without returning source-provider diagnostics.
 * @param ctx - credential owner.
 * @param reference - configured environment-style credential reference.
 * @returns the current secret; missing or invalid configuration rejects without its value.
 */
export async function resolveBearer(ctx: Context, reference: string): Promise<string> {
  const resolved = await ctx.credentials.resolve(credentialRef(reference))
  if (resolved === undefined || !/^[A-Za-z0-9._~+/-]{32,}=*$/.test(resolved.value)) throw new RemoteWorkFault('unavailable')
  return resolved.value
}
/**
 * Resolve current authentication hashes and reject duplicate configured secrets.
 * @param ctx - credential owner.
 * @param principals - configured principal references.
 * @returns principal-qualified hashes, without retaining resolved bearer strings.
 */
export async function resolvePrincipalHashes<T extends { id: string; credentialRef: string }>(
  ctx: Context, principals: readonly T[],
): Promise<{ principal: T; hash: Buffer }[]> {
  const values = await Promise.all(principals.map(async principal => ({ principal,
    hash: createHash('sha256').update(await resolveBearer(ctx, principal.credentialRef)).digest() })))
  if (new Set(values.map(value => value.hash.toString('hex'))).size !== values.length) throw new RemoteWorkFault('unavailable')
  return values
}
/**
 * Authenticate against every configured principal and reject ambiguous rotated values.
 * @param ctx - credential owner.
 * @param principals - explicitly configured principal/reference pairs.
 * @param authorization - raw machine Authorization header.
 * @returns the single authenticated principal; malformed or unmatched bearers reject before body parsing.
 */
export async function authenticate<T extends { id: string; credentialRef: string }>(
  ctx: Context, principals: readonly T[], authorization: string | undefined,
): Promise<T> {
  if (authorization === undefined || !/^[Bb][Ee][Aa][Rr][Ee][Rr] [A-Za-z0-9._~+/-]{32,}=*$/.test(authorization))
    throw new RemoteWorkFault('denied')
  const candidate = createHash('sha256').update(authorization.slice(7)).digest()
  const values = await resolvePrincipalHashes(ctx, principals)
  const [matched] = values.filter(value => timingSafeEqual(value.hash, candidate))
  if (matched === undefined) throw new RemoteWorkFault('denied')
  return matched.principal
}
