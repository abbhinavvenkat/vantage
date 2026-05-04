/**
 * Re-score the live portfolio's decisions using the latest rule library and
 * the FIFO-aware buildSymbolStates (so HDFC/LTI/AMARAJABAT ghost symbols are
 * dropped; re-run after any decision schema change.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';
import { loadLatestRuleLibrary } from '@/lib/codex/library';
import { runDecisions } from '@/lib/decisions/run';
import {
  STALWART_DISPLAY_ACTIONS,
  STALWART_DISPLAY_LABEL,
  toDisplayAction,
} from '@/lib/decisions/displayAction';
import type { RuleAction } from '@/lib/codex/synthesize';

async function main(): Promise<void> {
  const portfolioName = process.argv[2] ?? process.env.PORTFOLIO_NAME ?? '';
  const dbPath = resolve('./data/app.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const ps = db.select().from(portfolios).all();
  const target = ps.find((p) => p.name.toLowerCase() === portfolioName.toLowerCase()) ?? ps[0];
  if (!target) {
    console.error('No portfolio found.');
    process.exit(1);
  }

  const lib = loadLatestRuleLibrary();
  if (!lib) {
    console.error('No rule library found. Run codex pipeline first.');
    process.exit(1);
  }

  console.log(`Re-scoring ${target.name} (${target.id}) against v${lib.version}…`);
  const result = runDecisions(db, target.id, lib);

  console.log(`\nInserted ${result.inserted} rows (rule-library v${result.ruleLibraryVersion}).`);
  console.log(`Symbols scored: ${result.perSymbol.length}\n`);

  // Action breakdown.
  const actionCounts: Record<string, number> = {};
  for (const r of result.perSymbol) {
    actionCounts[r.action] = (actionCounts[r.action] ?? 0) + 1;
  }
  console.log('Action breakdown (granular):');
  for (const [a, n] of Object.entries(actionCounts).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${a.padEnd(12)} ${n}`);
  }

  // Collapsed 4-action display breakdown (matches the UI vocabulary).
  const displayCounts: Record<string, number> = {
    add_more: 0,
    retain: 0,
    sell_partial: 0,
    sell_full: 0,
  };
  for (const r of result.perSymbol) {
    const da = toDisplayAction(r.action as RuleAction);
    displayCounts[da] = (displayCounts[da] ?? 0) + 1;
  }
  console.log('\nAction breakdown (display vocab):');
  for (const a of STALWART_DISPLAY_ACTIONS) {
    console.log(`  ${STALWART_DISPLAY_LABEL[a].padEnd(14)} ${displayCounts[a] ?? 0}`);
  }

  console.log('\nGhost-symbol check:');
  const ghosts = ['HDFC', 'LTI', 'AMARAJABAT'].filter((g) =>
    result.perSymbol.some((r) => r.symbol === g),
  );
  if (ghosts.length === 0) {
    console.log('  ✓ no HDFC/LTI/AMARAJABAT ghosts in this snapshot');
  } else {
    console.log(`  ✗ still seeing ghosts: ${ghosts.join(', ')}`);
  }

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
