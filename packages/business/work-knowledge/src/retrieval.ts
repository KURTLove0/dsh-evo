/** Literal line retrieval over a disposable SQLite FTS5 index, with short-query scanning. */
import type { StoredKnowledgeSource, StoredKnowledgeVersion } from './schema.ts'
import type { KnowledgeSearchResult } from './types.ts'
/** Already-authorized immutable capture selected by the provider. */
export interface SearchCapture { source: StoredKnowledgeSource; capture: StoredKnowledgeVersion }
/**
 * Build an in-memory derivative from already-authorized captures; close it before returning.
 * @param sources - current enabled, readable sources from one selected workspace.
 * @param query - nonempty lowercase literal query, bounded by the caller.
 * @param limit - positive explicit hit count.
 * @returns complete retained lines and whether another matching line exists.
 */
export async function retrieveLines(sources: SearchCapture[], query: string, limit: number): Promise<Pick<KnowledgeSearchResult, 'hits' | 'more'>> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE VIRTUAL TABLE lines USING fts5(source UNINDEXED, line UNINDEXED, text, tokenize="trigram case_sensitive 1")')
    const put = db.prepare('INSERT INTO lines(source, line, text) VALUES (?, ?, ?)')
    for (const { source, capture } of sources) {
      for (const [line, text] of capture.text.split('\n').entries()) put.run(source.id, line + 1, text.toLowerCase())
    }
    const rows = Array.from(query).length < 3
      ? db.prepare('SELECT source, line FROM lines WHERE instr(text, ?) > 0 ORDER BY source, CAST(line AS INTEGER) LIMIT ?').all(query, limit + 1)
      : db.prepare('SELECT source, line FROM lines WHERE lines MATCH ? ORDER BY source, CAST(line AS INTEGER) LIMIT ?').all(`"${query.replaceAll('"', '""')}"`, limit + 1)
    const byId = new Map(sources.map(value => [value.source.id as string, value]))
    return { more: rows.length > limit, hits: rows.slice(0, limit).map((row) => {
      const { source, capture } = byId.get(row.source as string) as SearchCapture, line = Number(row.line)
      return { citation: { sourceId: source.id, version: capture.version, textSha256: capture.textSha256,
        startLine: line, endLine: line }, path: source.path, text: capture.text.split('\n')[line - 1] as string }
    }) }
  } finally { db.close() }
}
