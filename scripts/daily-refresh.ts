/**
 * Daily refresh — fetch EOD prices for every portfolio's open positions plus the
 * Nifty 50 trailing-year series. Writes a per-day log under data/logs/.
 *
 * Designed to be invoked by launchd (see scripts/launchd/) but also runnable ad-hoc:
 *
 *   npx tsx scripts/daily-refresh.ts
 *
 * Idempotent: re-running on the same day re-upserts prices_eod (no duplicates) and
 * appends a new line to the day's log file.
 */
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { listPortfolios } from '@/lib/db/queries/portfolios';
import { upsertPrices } from '@/lib/db/queries/prices';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import type { NormalizedTrade } from '@/lib/parsers/types';
import { getNifty50SeriesCached } from '@/lib/pricing/nifty50';
import { fetchEodQuotes } from '@/lib/pricing/yahoo';

type Db = BetterSQLite3Database<typeof schema>;

export type DailyRefreshOptions = {
  /** Absolute path to sqlite DB file. Defaults to project-root data/app.db. */
  dbPath?: string;
  /** Absolute path to log dir. Defaults to project-root data/logs. */
  logsDir?: string;
  /** ISO yyyy-mm-dd; defaults to today (UTC). Used to name the log file and Nifty range. */
  today?: string;
};

export type DailyRefreshResult = {
  exitCode: number;
  portfoliosRefreshed: number;
  totalSymbolsRefreshed: number;
  totalSymbolsFailed: number;
  niftyPoints: number;
  logFile: string;
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function openSqlite(dbPath: string): { sqlite: Database.Database; db: Db } {
  ensureDir(dirname(dbPath));
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

function tradesToNormalized(rows: Trade[]): NormalizedTrade[] {
  // Same shape mapping as app/api/prices/refresh/route.ts; delivery-only.
  const delivery = rows.filter((t) => t.isIntradayPairId === null);
  return delivery.map((t, i) => ({
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side as 'buy' | 'sell',
    qty: t.qty,
    price: t.price,
    currency: t.currency as 'INR' | 'USD',
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? i,
  }));
}

export async function runDailyRefresh(opts: DailyRefreshOptions = {}): Promise<DailyRefreshResult> {
  const projectRoot = process.cwd();
  const today = opts.today ?? isoToday();
  const dbPath = opts.dbPath ?? resolve(projectRoot, 'data/app.db');
  const logsDir = opts.logsDir ?? resolve(projectRoot, 'data/logs');
  ensureDir(logsDir);

  const logFile = resolve(logsDir, `daily-refresh-${today}.log`);
  // Append-mode logging — multiple runs per day stay in one file.
  if (!existsSync(logFile)) writeFileSync(logFile, '', 'utf8');
  const log = (line: string): void => {
    const stamped = `[${new Date().toISOString()}] ${line}\n`;
    appendFileSync(logFile, stamped, 'utf8');
    process.stdout.write(stamped);
  };

  log(`daily-refresh start db=${dbPath} today=${today}`);

  const { sqlite, db } = openSqlite(dbPath);

  let portfoliosRefreshed = 0;
  let totalSymbolsRefreshed = 0;
  let totalSymbolsFailed = 0;
  let niftyPoints = 0;

  try {
    const portfolios = listPortfolios(db);
    log(`portfolios=${portfolios.length}`);

    for (const pf of portfolios) {
      const trades = getTradesForPortfolio(db, pf.id);
      const normalized = tradesToNormalized(trades);
      const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
      const symbols = positions.map((p) => p.symbol);

      if (symbols.length === 0) {
        log(`portfolio=${pf.name} id=${pf.id} symbols=0 (skipped)`);
        continue;
      }

      try {
        const quotes = await fetchEodQuotes(symbols);
        const fetched = [...quotes.values()];
        upsertPrices(db, fetched);
        const failed = symbols.filter((s) => !quotes.has(s));
        totalSymbolsRefreshed += fetched.length;
        totalSymbolsFailed += failed.length;
        if (fetched.length > 0) portfoliosRefreshed++;
        log(
          `portfolio=${pf.name} id=${pf.id} symbols=${symbols.length} refreshed=${fetched.length} failed=${failed.length}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`portfolio=${pf.name} id=${pf.id} ERROR ${msg}`);
      }
    }

    // Refresh Nifty 50 trailing-year series (cached writer at data/prices/nifty50.json).
    try {
      const end = today;
      const start = (() => {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const series = await getNifty50SeriesCached(start, end, 0);
      niftyPoints = series.size;
      log(`Nifty 50 series start=${start} end=${end} points=${niftyPoints}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Nifty 50 ERROR ${msg}`);
    }
  } finally {
    try {
      sqlite.close();
    } catch {
      /* ignore */
    }
  }

  log(
    `daily-refresh done portfolios_refreshed=${portfoliosRefreshed} ` +
      `total_symbols_refreshed=${totalSymbolsRefreshed} ` +
      `total_symbols_failed=${totalSymbolsFailed} ` +
      `nifty_points=${niftyPoints}`,
  );

  const exitCode = portfoliosRefreshed > 0 || totalSymbolsRefreshed > 0 ? 0 : 1;
  return {
    exitCode,
    portfoliosRefreshed,
    totalSymbolsRefreshed,
    totalSymbolsFailed,
    niftyPoints,
    logFile,
  };
}

// CLI entrypoint
const isMain = (() => {
  try {
    const argvFile = process.argv[1] ? resolve(process.argv[1]) : '';
    return argvFile.endsWith('daily-refresh.ts') || argvFile.endsWith('daily-refresh.js');
  } catch {
    return false;
  }
})();

if (isMain) {
  runDailyRefresh()
    .then((r) => {
      process.exit(r.exitCode);
    })
    .catch((err) => {
      // Last-resort logging — runDailyRefresh already writes its own errors.
      // eslint-disable-next-line no-console
      console.error('[daily-refresh] fatal', err);
      process.exit(2);
    });
}
