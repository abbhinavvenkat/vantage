import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { bulkImportEvents, type NewEventInput } from '@/lib/db/queries/events';
import { EventsFileSchema, SymbolSchema } from '@/lib/validation/events';

type Db = BetterSQLite3Database<typeof schema>;

export type ImportResult = {
  inserted: number;
  skipped: number;
  filesScanned: number;
  filesParsed: number;
  errors: Array<{ file: string; reason: string }>;
};

/**
 * Scans `data/events/<symbol>.json` and bulk-imports each file's events into the
 * given portfolio. Idempotent on (portfolioId, symbol, eventType, eventDate, title).
 */
export function importEventsFromFiles(
  db: Db,
  portfolioId: string,
  baseDir: string = resolve(process.cwd(), 'data/events'),
): ImportResult {
  const result: ImportResult = {
    inserted: 0,
    skipped: 0,
    filesScanned: 0,
    filesParsed: 0,
    errors: [],
  };
  if (!existsSync(baseDir)) return result;

  const files = readdirSync(baseDir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    result.filesScanned += 1;
    const filePath = resolve(baseDir, f);
    const symbolRaw = f.replace(/\.json$/, '');
    const symbolParsed = SymbolSchema.safeParse(symbolRaw);
    if (!symbolParsed.success) {
      result.errors.push({ file: f, reason: 'invalid_symbol' });
      continue;
    }
    const symbol = symbolParsed.data;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      result.errors.push({ file: f, reason: `parse_error: ${(err as Error).message}` });
      continue;
    }
    const parsed = EventsFileSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push({ file: f, reason: 'schema_invalid' });
      continue;
    }
    result.filesParsed += 1;

    const rows: NewEventInput[] = parsed.data.events.map((e) => ({
      symbol,
      eventType: e.eventType,
      eventDate: e.eventDate,
      title: e.title,
      notes: e.notes ?? null,
      source: 'file',
    }));
    const r = bulkImportEvents(db, portfolioId, rows);
    result.inserted += r.inserted;
    result.skipped += r.skipped;
  }
  return result;
}
