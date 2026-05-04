import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { importBatch, type ImportBatchResult } from '@/lib/db/queries/filings';
import { FilingsTriageBatch, normalizeFilingType } from '@/lib/validation/filings';

type Db = BetterSQLite3Database<typeof schema>;

export type ImportFilingsOptions = {
  /** Project-relative or absolute root directory containing `<symbol>/filings-triage/*.json`. */
  researchDir?: string;
};

export type ImportFilingsReport = ImportBatchResult & {
  filesScanned: number;
  filesParsed: number;
  filesInvalid: number;
  invalidPaths: string[];
};

function defaultResearchDir(): string {
  return resolve(process.cwd(), 'data', 'research');
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  // dir layout: data/research/<symbol>/filings-triage/<batch-id>.json
  const symbolDirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const sd of symbolDirs) {
    const triageDir = resolve(dir, sd.name, 'filings-triage');
    if (!existsSync(triageDir)) continue;
    const stat = statSync(triageDir);
    if (!stat.isDirectory()) continue;
    const files = readdirSync(triageDir, { withFileTypes: true });
    for (const f of files) {
      if (f.isFile() && f.name.endsWith('.json')) {
        out.push(resolve(triageDir, f.name));
      }
    }
  }
  return out;
}

/**
 * Scans `data/research/<symbol>/filings-triage/*.json`, validates each against
 * the `filings-triage` schema in `.claude/rules/research-output-schema.md`,
 * and upserts into `filings` for the given portfolio.
 *
 * Idempotent on (portfolioId, url). Never makes network calls.
 */
export function importFilings(
  db: Db,
  portfolioId: string,
  options: ImportFilingsOptions = {},
): ImportFilingsReport {
  const root = options.researchDir ?? defaultResearchDir();
  const files = listJsonFiles(root);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let filesParsed = 0;
  let filesInvalid = 0;
  const invalidPaths: string[] = [];

  for (const filePath of files) {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      filesInvalid += 1;
      invalidPaths.push(filePath);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      filesInvalid += 1;
      invalidPaths.push(filePath);
      continue;
    }
    const valid = FilingsTriageBatch.safeParse(parsed);
    if (!valid.success) {
      filesInvalid += 1;
      invalidPaths.push(filePath);
      continue;
    }
    filesParsed += 1;

    const items = valid.data.filings.map((f) => ({
      symbol: valid.data.symbol,
      url: f.url,
      title: f.title,
      filingType: normalizeFilingType(f.type),
      triage: f.triage ?? null,
      summaryOneLine: f.summary_one_line ?? null,
      publishedAt: f.published_at ?? null,
    }));

    const result = importBatch(db, portfolioId, items);
    inserted += result.inserted;
    updated += result.updated;
    skipped += result.skipped;
  }

  return {
    inserted,
    updated,
    skipped,
    filesScanned: files.length,
    filesParsed,
    filesInvalid,
    invalidPaths,
  };
}
