import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { candidates, portfolios, users, watchlist } from '@/lib/db/schema';
import {
  importCandidatesFromFiles,
  listCandidateRuns,
  listCandidates,
} from '@/lib/db/queries/candidates';
import { addWatchlistEntry, listWatchlist } from '@/lib/db/queries/watchlist';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let researchDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let otherPortfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-candidates-'));
  const dbPath = resolve(tmpDir, 'test.db');
  researchDir = resolve(tmpDir, 'research');
  mkdirSync(researchDir, { recursive: true });
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });
});

afterAll(() => {
  try {
    sqlite.close();
  } catch {
    /* ignore */
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  sqlite.exec('DELETE FROM candidates;');
  sqlite.exec('DELETE FROM watchlist;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  const pf2 = db.insert(portfolios).values({ name: 'Secondary' }).returning().get();
  portfolioId = pf.id;
  otherPortfolioId = pf2.id;

  rmSync(researchDir, { recursive: true, force: true });
  mkdirSync(researchDir, { recursive: true });
});

function writeRun(pfId: string, runId: string, body: unknown): string {
  const dir = resolve(researchDir, '_portfolio', pfId, 'idea-generate');
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, `${runId}.json`);
  writeFileSync(filePath, JSON.stringify(body));
  return filePath;
}

describe('importCandidatesFromFiles (filesystem reader)', () => {
  it('reads valid idea-generate JSON, validates, and upserts candidates', () => {
    writeRun(portfolioId, 'run-2026-05-03-1200', {
      portfolio_id: portfolioId,
      run_at: '2026-05-03T12:00:00Z',
      gaps_identified: ['FMCG <1% weight', 'no large-cap private bank ex-HDFC'],
      candidates: [
        {
          symbol: 'HINDUNILVR',
          name: 'Hindustan Unilever',
          thesis_md: 'FMCG compounding leader.',
          key_ratios: { pe: 52, roce: 0.78, div_yield: 0.018 },
          entry_zones: { fair: 2400, strong_buy: 2150 },
          conviction: 'high',
          risk: 'low',
          matching_codex_rules: ['rule.fmcg.rural-revival-buy'],
        },
        {
          symbol: 'ICICIBANK',
          name: 'ICICI Bank',
          thesis_md: 'Best-in-class large private bank.',
          key_ratios: { pe: 18, roa: 0.022 },
          entry_zones: { fair: 1100 },
          conviction: 'medium',
          risk: 'medium',
          matching_codex_rules: [],
        },
      ],
    });

    const r = importCandidatesFromFiles(db, portfolioId, { researchDir });
    expect(r.filesScanned).toBe(1);
    expect(r.filesParsed).toBe(1);
    expect(r.filesInvalid).toBe(0);
    expect(r.inserted).toBe(2);
    expect(r.updated).toBe(0);

    const list = listCandidates(db, portfolioId);
    expect(list).toHaveLength(2);
    const hul = list.find((c) => c.symbol === 'HINDUNILVR');
    expect(hul).toBeDefined();
    expect(hul!.runId).toBe('run-2026-05-03-1200');
    expect(hul!.entryFair).toBe(2400);
    expect(hul!.entryStrong).toBe(2150);
    expect(JSON.parse(hul!.matchingCodexRulesJson)).toEqual(['rule.fmcg.rural-revival-buy']);
    expect(JSON.parse(hul!.keyRatiosJson)).toEqual({ pe: 52, roce: 0.78, div_yield: 0.018 });
  });

  it('is idempotent on (portfolioId, runId, symbol) — re-import updates, no duplicates', () => {
    writeRun(portfolioId, 'r1', {
      portfolio_id: portfolioId,
      run_at: '2026-05-03T12:00:00Z',
      gaps_identified: [],
      candidates: [
        {
          symbol: 'ACME-EQ',
          name: 'Acme',
          thesis_md: 'first thesis',
          conviction: 'medium',
          risk: 'medium',
        },
      ],
    });

    const r1 = importCandidatesFromFiles(db, portfolioId, { researchDir });
    expect(r1.inserted).toBe(1);
    expect(listCandidates(db, portfolioId)).toHaveLength(1);

    // Rewrite same run with updated thesis.
    writeRun(portfolioId, 'r1', {
      portfolio_id: portfolioId,
      run_at: '2026-05-03T12:00:00Z',
      gaps_identified: [],
      candidates: [
        {
          symbol: 'ACME-EQ',
          name: 'Acme Co',
          thesis_md: 'second thesis',
          conviction: 'high',
          risk: 'low',
        },
      ],
    });
    const r2 = importCandidatesFromFiles(db, portfolioId, { researchDir });
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(1);

    const rows = listCandidates(db, portfolioId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.thesisMd).toBe('second thesis');
    expect(rows[0]!.convictionLevel).toBe('high');
  });

  it('keeps multiple runs separately and listCandidates picks the latest by runAt', () => {
    writeRun(portfolioId, 'old-run', {
      portfolio_id: portfolioId,
      run_at: '2026-04-01T00:00:00Z',
      gaps_identified: [],
      candidates: [
        {
          symbol: 'OLDCO',
          name: 'Old Co',
          thesis_md: 'old',
          conviction: 'low',
          risk: 'high',
        },
      ],
    });
    writeRun(portfolioId, 'new-run', {
      portfolio_id: portfolioId,
      run_at: '2026-05-01T00:00:00Z',
      gaps_identified: [],
      candidates: [
        {
          symbol: 'NEWCO',
          name: 'New Co',
          thesis_md: 'new',
          conviction: 'high',
          risk: 'low',
        },
      ],
    });

    importCandidatesFromFiles(db, portfolioId, { researchDir });

    const runs = listCandidateRuns(db, portfolioId);
    expect(runs.map((r) => r.runId)).toEqual(['new-run', 'old-run']);

    const latest = listCandidates(db, portfolioId);
    expect(latest.map((c) => c.symbol)).toEqual(['NEWCO']);

    const old = listCandidates(db, portfolioId, { runId: 'old-run' });
    expect(old.map((c) => c.symbol)).toEqual(['OLDCO']);
  });

  it('rejects schema-invalid + cross-portfolio JSON', () => {
    // Schema-invalid (missing candidates).
    writeRun(portfolioId, 'broken', { portfolio_id: portfolioId, run_at: '2026-05-03' });
    // Cross-portfolio: file under our dir says it's for someone else.
    writeRun(portfolioId, 'foreign', {
      portfolio_id: otherPortfolioId,
      run_at: '2026-05-03T00:00:00Z',
      gaps_identified: [],
      candidates: [{ symbol: 'X', name: 'X', thesis_md: 't', conviction: 'low', risk: 'low' }],
    });

    const r = importCandidatesFromFiles(db, portfolioId, { researchDir });
    expect(r.filesScanned).toBe(2);
    expect(r.filesParsed).toBe(0);
    expect(r.filesInvalid).toBe(2);
    expect(r.inserted).toBe(0);
    expect(listCandidates(db, portfolioId)).toHaveLength(0);
  });

  it('returns zero counts when researchDir does not exist', () => {
    const r = importCandidatesFromFiles(db, portfolioId, {
      researchDir: resolve(tmpDir, 'nonexistent'),
    });
    expect(r.filesScanned).toBe(0);
    expect(r.inserted).toBe(0);
  });

  it('is portfolio-scoped — does not leak across portfolios', () => {
    writeRun(portfolioId, 'r1', {
      portfolio_id: portfolioId,
      run_at: '2026-05-03T00:00:00Z',
      gaps_identified: [],
      candidates: [{ symbol: 'AAA', name: 'A', thesis_md: 't', conviction: 'high', risk: 'low' }],
    });
    writeRun(otherPortfolioId, 'r1', {
      portfolio_id: otherPortfolioId,
      run_at: '2026-05-03T00:00:00Z',
      gaps_identified: [],
      candidates: [{ symbol: 'BBB', name: 'B', thesis_md: 't', conviction: 'high', risk: 'low' }],
    });

    importCandidatesFromFiles(db, portfolioId, { researchDir });
    importCandidatesFromFiles(db, otherPortfolioId, { researchDir });

    expect(listCandidates(db, portfolioId).map((c) => c.symbol)).toEqual(['AAA']);
    expect(listCandidates(db, otherPortfolioId).map((c) => c.symbol)).toEqual(['BBB']);
  });
});

describe('promote-to-watchlist flow', () => {
  it('a candidate can be promoted into the watchlist with thesis + targets', () => {
    writeRun(portfolioId, 'r1', {
      portfolio_id: portfolioId,
      run_at: '2026-05-03T00:00:00Z',
      gaps_identified: [],
      candidates: [
        {
          symbol: 'HINDUNILVR',
          name: 'Hindustan Unilever',
          thesis_md: 'FMCG compounder',
          entry_zones: { fair: 2400, strong_buy: 2150 },
          conviction: 'high',
          risk: 'low',
        },
      ],
    });
    importCandidatesFromFiles(db, portfolioId, { researchDir });

    const [cand] = listCandidates(db, portfolioId);
    expect(cand).toBeDefined();

    const entry = addWatchlistEntry(db, portfolioId, {
      symbol: cand!.symbol,
      thesis: cand!.thesisMd,
      targetBuyPrice: cand!.entryFair,
      targetSellPrice: null,
      conviction: cand!.convictionLevel,
    });
    expect(entry.symbol).toBe('HINDUNILVR');
    expect(entry.thesis).toBe('FMCG compounder');
    expect(entry.targetBuyPrice).toBe(2400);
    expect(entry.conviction).toBe('high');

    const list = listWatchlist(db, portfolioId);
    expect(list).toHaveLength(1);
  });

  it('candidates table is foreign-keyed to portfolios — cascade delete works', () => {
    writeRun(portfolioId, 'r1', {
      portfolio_id: portfolioId,
      run_at: '2026-05-03T00:00:00Z',
      gaps_identified: [],
      candidates: [{ symbol: 'AAA', name: 'A', thesis_md: 't', conviction: 'high', risk: 'low' }],
    });
    importCandidatesFromFiles(db, portfolioId, { researchDir });
    expect(listCandidates(db, portfolioId)).toHaveLength(1);

    sqlite.exec(`DELETE FROM portfolios WHERE id = '${portfolioId}';`);
    const after = db.select().from(candidates).all();
    expect(after).toHaveLength(0);
    const wl = db.select().from(watchlist).all();
    expect(wl).toHaveLength(0);
  });
});
