/**
 * Seed/sync a watchlist into the live app.db portfolio.
 * Idempotent — safe to re-run; existing entries are updated, missing ones created.
 *
 * Usage:
 *   PORTFOLIO_NAME=MyPortfolio npx tsx scripts/seed-watchlist.ts
 *   npx tsx scripts/seed-watchlist.ts <portfolioName>
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, and } from 'drizzle-orm';

import * as schema from '@/lib/db/schema';
import { portfolios, watchlist } from '@/lib/db/schema';

type Entry = {
  symbol: string;
  thesis: string;
  // For ranges, we store the midpoint of the strong-buy range as targetBuyPrice
  // and the midpoint of the fair-entry range as a soft target. Conviction reflects
  // how actionable each idea is right now.
  fairEntryLow: number;
  fairEntryHigh: number;
  strongBuyLow: number;
  strongBuyHigh: number;
  conviction: 'high' | 'medium' | 'low';
};

const ENTRIES: Entry[] = [
  {
    symbol: 'CUMMINSIND',
    thesis: 'Cummins India — global energy tailwind; buy in tranches. Yahoo: CUMMINSIND.NS',
    fairEntryLow: 4000,
    fairEntryHigh: 4400,
    strongBuyLow: 3500,
    strongBuyHigh: 3800,
    conviction: 'medium',
  },
  {
    symbol: 'DATAPATT',
    thesis: 'Data Patterns — tiny float; buy on defence budget dips. Yahoo: DATAPATT.NS',
    fairEntryLow: 3300,
    fairEntryHigh: 3700,
    strongBuyLow: 2600,
    strongBuyHigh: 2900,
    conviction: 'medium',
  },
  {
    symbol: 'DIVISLAB',
    thesis: "Divi's Labs — CDMO capacity from FY28; previously held +97%. Yahoo: DIVISLAB.NS",
    fairEntryLow: 4800,
    fairEntryHigh: 5300,
    strongBuyLow: 4200,
    strongBuyHigh: 4600,
    conviction: 'high',
  },
  {
    symbol: 'POLYCAB',
    thesis: 'Polycab India — most actionable; fair entry near CMP. Yahoo: POLYCAB.NS',
    fairEntryLow: 7200,
    fairEntryHigh: 8000,
    strongBuyLow: 6000,
    strongBuyHigh: 6800,
    conviction: 'high',
  },
  {
    symbol: 'TRENT',
    thesis: 'Trent — already in buy zone; Zudio runway ~7 years. Yahoo: TRENT.NS',
    fairEntryLow: 3700,
    fairEntryHigh: 4400,
    strongBuyLow: 3200,
    strongBuyHigh: 3700,
    conviction: 'high',
  },
  {
    symbol: 'DIXON',
    thesis:
      'Dixon Technologies — EMS leader; PLI + Apple/Samsung; 30%+ growth; entry zones estimated. Yahoo: DIXON.NS',
    fairEntryLow: 13000,
    fairEntryHigh: 15500,
    strongBuyLow: 10500,
    strongBuyHigh: 12500,
    conviction: 'medium',
  },
  {
    symbol: 'PERSISTENT',
    thesis:
      'Persistent Systems — top IT midcap; previously sold at +41%; want back on correction; entry zones estimated. Yahoo: PERSISTENT.NS',
    fairEntryLow: 4800,
    fairEntryHigh: 5500,
    strongBuyLow: 3800,
    strongBuyHigh: 4500,
    conviction: 'medium',
  },
  {
    symbol: 'KPITTECH',
    thesis:
      'KPIT Technologies — pure-play automotive SDV/EV software; only listed Indian auto-tech IT co; entry zones estimated. Yahoo: KPITTECH.NS',
    fairEntryLow: 1200,
    fairEntryHigh: 1500,
    strongBuyLow: 950,
    strongBuyHigh: 1150,
    conviction: 'medium',
  },
  {
    symbol: 'COFORGE',
    thesis:
      'Coforge — high-growth BFSI/insurance IT midcap; 22%+ EPS CAGR; entry zones estimated. Yahoo: COFORGE.NS',
    fairEntryLow: 6500,
    fairEntryHigh: 7800,
    strongBuyLow: 5200,
    strongBuyHigh: 6200,
    conviction: 'medium',
  },
];

async function main(): Promise<void> {
  const portfolioName = process.argv[2] ?? process.env.PORTFOLIO_NAME ?? '';
  const dbUrl = process.env.DATABASE_URL ?? 'file:./data/app.db';
  const dbPath = dbUrl.startsWith('file:') ? resolve(dbUrl.slice(5)) : resolve(dbUrl);
  if (!existsSync(dbPath)) throw new Error(`app.db not found: ${dbPath}`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const all = db.select().from(portfolios).all();
  const target = all.find((p) => p.name.toLowerCase() === portfolioName.toLowerCase());
  if (!target) {
    console.error(
      `Portfolio "${portfolioName}" not found. Available: ${all.map((p) => p.name).join(', ')}`,
    );
    process.exit(1);
  }

  console.log(`Seeding watchlist for "${target.name}" (${target.id})`);

  const now = Date.now();
  let created = 0;
  let updated = 0;
  for (const e of ENTRIES) {
    const targetBuyPrice = (e.strongBuyLow + e.strongBuyHigh) / 2;
    const targetSellPrice = (e.fairEntryLow + e.fairEntryHigh) / 2;
    const existing = db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.portfolioId, target.id), eq(watchlist.symbol, e.symbol)))
      .get();
    if (existing) {
      db.update(watchlist)
        .set({
          thesis: e.thesis,
          targetBuyPrice,
          targetSellPrice,
          conviction: e.conviction,
          updatedAt: now,
        })
        .where(eq(watchlist.id, existing.id))
        .run();
      updated++;
      console.log(
        `  ✓ updated ${e.symbol.padEnd(12)} buy@₹${targetBuyPrice} sell@₹${targetSellPrice} ${e.conviction}`,
      );
    } else {
      db.insert(watchlist)
        .values({
          portfolioId: target.id,
          symbol: e.symbol,
          thesis: e.thesis,
          targetBuyPrice,
          targetSellPrice,
          conviction: e.conviction,
        })
        .run();
      created++;
      console.log(
        `  + created ${e.symbol.padEnd(12)} buy@₹${targetBuyPrice} sell@₹${targetSellPrice} ${e.conviction}`,
      );
    }
  }
  console.log(`\nDone: ${created} created, ${updated} updated, ${ENTRIES.length} total`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
