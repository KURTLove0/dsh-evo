/** Strict immutable file-registration decoding; no execution state is owned here. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { decodeArtifact } from './bytes.ts'
import type { ArtifactVersion, ArtifactRequestId, WorkArtifactId } from './types.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
/** Each stored version retains its own request receipt and exact captured bytes. */
export interface StoredArtifactVersion extends ArtifactVersion { content: string; requestId: ArtifactRequestId; intentHash: string }
/** Registration identity and workspace remain fixed while immutable captures accumulate. */
export interface StoredArtifact {
  id: WorkArtifactId
  workspaceId: WorkspaceId
  workspacePath: string
  path: string
  versions: StoredArtifactVersion[]
}
const id = z.string().min(1), positive = z.number().int().positive()
const ref = z.discriminatedUnion('kind', [z.object({ kind: z.literal('agent'), id }).strict(), z.object({ kind: z.literal('workflow'), id }).strict()])
const source = z.object({ ref, name: z.string(), workspaceId: id, sessionId: id,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'waiting', 'stopping', 'succeeded']) }).strict()
const origin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current-file'), source }).strict(),
  z.object({ kind: z.literal('accepted-review'), source, reviewRevision: positive, deliveryVersion: id, reviewedAt: z.number() }).strict(),
])
const version = z.object({ version: positive, capturedAt: z.number(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(), encoding: z.enum(['utf-8', 'base64']), content: z.string(), origin,
  requestId: id, intentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const record = z.object({ id, workspaceId: id, workspacePath: id, path: id, versions: z.array(version).min(1) }).strict()
  .superRefine((value, context) => {
    for (const [index, capture] of value.versions.entries()) {
      if (capture.version !== index + 1 || capture.origin.source.workspaceId !== value.workspaceId)
        context.addIssue({ code: 'custom', message: 'Artifact version order or workspace provenance is inconsistent.' })
      try { decodeArtifact(capture) }
      catch (error) { context.addIssue({ code: 'custom', message: String(error) }) }
    }
    if (new Set(value.versions.map(capture => capture.requestId)).size !== value.versions.length)
      context.addIssue({ code: 'custom', message: 'Artifact registration request IDs repeat.' })
  }) as unknown as z.ZodType<StoredArtifact>
/** Independent explicit file manifests; durable reviews remain owned by Work Center. */
export const artifactDomain = defineDomain({ name: 'work_artifacts', version: 1,
  tables: { artifacts: domainTable<WorkArtifactId, StoredArtifact>(record) } })
