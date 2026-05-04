import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { and, asc, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { candidates, type ConvictionLevel, type RiskLevel } from '@/lib/db/schema';
import { IdeaGenerateFile, type IdeaGenerateFileT } from '@/lib/validation/ideaGenerate';

type Db = BetterSQLite3Database<typeof schema>;

export type CandidateRow = typeof candidates.$inferSelect;

export type ListCandidatesOptions = {
  /** When provided, filter by exact runId; otherwise the latest run is selected. */
  runId?: string;
};

export type RunSummary = {
  runId: string;
  runAt: string;
  count: number;
};

/**
 * Distinct (runId, runAt) tuples for a portfolio, newest first by runAt then runId.
 */
export function listCandidateRuns(db: Db, portfolioId: string): RunSummary[] {
  const rows = db
    .select({
      runId: candidates.runId,
      runAt: candidates.runAt,
    })
    .from(candidates)
    .where(eq(candidates.portfolioId, portfolioId))
    .all();
  const grouped = new Map<string, RunSummary>();
  for (const r of rows) {
    const cur = grouped.get(r.runId);
    if (cur) {
      cur.count += 1;
    } else {
      grouped.set(r.runId, { runId: r.runId, runAt: r.runAt, count: 1 });
    }
  }
  return [...grouped.values()].sort((a, b) => {
    if (a.runAt === b.runAt) return a.runId < b.runId ? 1 : -1;
    return a.runAt < b.runAt ? 1 : -1;
  });
}

/**
 * List candidates for a portfolio. By default returns the latest run (by runAt
 * lexicographic, fall back to runId). Pass `runId` to filter to a specific run.
 */
export function listCandidates(
  db: Db,
  portfolioId: string,
  options: ListCandidatesOptions = {},
): CandidateRow[] {
  let runId = options.runId;
  if (!runId) {
    const runs = listCandidateRuns(db, portfolioId);
    if (runs.length === 0) return [];
    runId = runs[0]!.runId;
  }
  return db
    .select()
    .from(candidates)
    .where(and(eq(candidates.portfolioId, portfolioId), eq(candidates.runId, runId)))
    .orderBy(desc(candidates.convictionLevel), asc(candidates.symbol))
    .all();
}

export function getCandidate(db: Db, portfolioId: string, id: string): CandidateRow | null {
  const row = db
    .select()
    .from(candidates)
    .where(and(eq(candidates.portfolioId, portfolioId), eq(candidates.id, id)))
    .get();
  return row ?? null;
}

export type UpsertCandidateInput = {
  runId: string;
  symbol: string;
  name: string;
  thesisMd: string;
  convictionLevel: ConvictionLevel;
  riskLevel: RiskLevel;
  keyRatiosJson: string;
  entryFair: number | null;
  entryStrong: number | null;
  matchingCodexRulesJson: string;
  runAt: string;
};

export type UpsertCandidatesResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

/**
 * Idempotent upsert on (portfolioId, runId, symbol).
 */
export function upsertCandidates(
  db: Db,
  portfolioId: string,
  items: UpsertCandidateInput[],
): UpsertCandidatesResult {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    if (!item.runId || !item.symbol || !item.name) {
      skipped += 1;
      continue;
    }
    const existing = db
      .select()
      .from(candidates)
      .where(
        and(
          eq(candidates.portfolioId, portfolioId),
          eq(candidates.runId, item.runId),
          eq(candidates.symbol, item.symbol),
        ),
      )
      .get();
    if (existing) {
      db.update(candidates)
        .set({
          name: item.name,
          thesisMd: item.thesisMd,
          convictionLevel: item.convictionLevel,
          riskLevel: item.riskLevel,
          keyRatiosJson: item.keyRatiosJson,
          entryFair: item.entryFair,
          entryStrong: item.entryStrong,
          matchingCodexRulesJson: item.matchingCodexRulesJson,
          runAt: item.runAt,
        })
        .where(eq(candidates.id, existing.id))
        .run();
      updated += 1;
    } else {
      db.insert(candidates)
        .values({
          portfolioId,
          runId: item.runId,
          symbol: item.symbol,
          name: item.name,
          thesisMd: item.thesisMd,
          convictionLevel: item.convictionLevel,
          riskLevel: item.riskLevel,
          keyRatiosJson: item.keyRatiosJson,
          entryFair: item.entryFair,
          entryStrong: item.entryStrong,
          matchingCodexRulesJson: item.matchingCodexRulesJson,
          runAt: item.runAt,
        })
        .run();
      inserted += 1;
    }
  }
  return { inserted, updated, skipped };
}

export type ImportCandidatesOptions = {
  /** Project-relative or absolute root containing `_portfolio/<portfolioId>/idea-generate/*.json`. */
  researchDir?: string;
};

export type ImportCandidatesReport = UpsertCandidatesResult & {
  filesScanned: number;
  filesParsed: number;
  filesInvalid: number;
  invalidPaths: string[];
};

function defaultResearchDir(): string {
  return resolve(process.cwd(), 'data', 'research');
}

function listIdeaFiles(researchDir: string, portfolioId: string): string[] {
  // Layout: data/research/_portfolio/<portfolioId>/idea-generate/<run-id>.json
  const dir = resolve(researchDir, '_portfolio', portfolioId, 'idea-generate');
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.json'))
    .map((f) => resolve(dir, f.name));
}

function toUpsertItems(file: IdeaGenerateFileT, runId: string): UpsertCandidateInput[] {
  return file.candidates.map((c) => ({
    runId,
    symbol: c.symbol,
    name: c.name,
    thesisMd: c.thesis_md,
    convictionLevel: c.conviction,
    riskLevel: c.risk,
    keyRatiosJson: JSON.stringify(c.key_ratios ?? {}),
    entryFair: c.entry_zones?.fair ?? null,
    entryStrong: c.entry_zones?.strong_buy ?? null,
    matchingCodexRulesJson: JSON.stringify(c.matching_codex_rules ?? []),
    runAt: file.run_at,
  }));
}

/**
 * Scans `data/research/_portfolio/<portfolioId>/idea-generate/*.json`, validates
 * each file against {@link IdeaGenerateFile}, and upserts its candidates with
 * `runId = basename without .json`. Idempotent on `(portfolioId, runId, symbol)`.
 *
 * Skips files whose `portfolio_id` doesn't match the requested portfolio (prevents
 * cross-portfolio leakage if a JSON was misplaced).
 */
export function importCandidatesFromFiles(
  db: Db,
  portfolioId: string,
  options: ImportCandidatesOptions = {},
): ImportCandidatesReport {
  const root = options.researchDir ?? defaultResearchDir();
  const files = listIdeaFiles(root, portfolioId);

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
    const valid = IdeaGenerateFile.safeParse(parsed);
    if (!valid.success) {
      filesInvalid += 1;
      invalidPaths.push(filePath);
      continue;
    }
    if (valid.data.portfolio_id !== portfolioId) {
      filesInvalid += 1;
      invalidPaths.push(filePath);
      continue;
    }
    filesParsed += 1;

    const runId = basename(filePath).replace(/\.json$/i, '');
    const items = toUpsertItems(valid.data, runId);
    const r = upsertCandidates(db, portfolioId, items);
    inserted += r.inserted;
    updated += r.updated;
    skipped += r.skipped;
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
