/**
 * Per-symbol audit: prints Compounder verdict, Valuation factor verdict,
 * Stalwart action, and Final action side-by-side so we can sanity-check the
 * core principle:
 *
 *   "Structurally sound + cheap        → buy"
 *   "Structurally sound + expensive    → wait / retain"
 *   "Structurally weak  + cheap        → cautious enter (cycle play)"
 *   "Structurally weak  + expensive    → avoid / sell"
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { getTradesForPortfolio } from '@/lib/db/queries/trades';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { latestDecisionsByPortfolio } from '@/lib/db/queries/decisions';
import { computeCompounderProfile } from '@/lib/compounder/score';
import { loadFundamentals } from '@/lib/decisions/growthForecast';
import { getSector } from '@/lib/sectors/map';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import { synthesize } from '@/lib/synthesis/finalRecommendation';
import {
  toDisplayAction,
  finalToDisplayAction,
  STALWART_DISPLAY_LABEL,
} from '@/lib/decisions/displayAction';
import type { RuleAction } from '@/lib/codex/synthesize';
import type { NormalizedTrade } from '@/lib/parsers/types';

async function main(): Promise<void> {
  const portfolioName = process.argv[2] ?? process.env.PORTFOLIO_NAME ?? '';
  const sqlite = new Database(resolve('./data/app.db'));
  const db = drizzle(sqlite, { schema });

  const ps = db.select().from(portfolios).all();
  const target = ps.find((p) => p.name.toLowerCase() === portfolioName.toLowerCase()) ?? ps[0];
  if (!target) {
    console.error('No portfolio found.');
    process.exit(1);
  }

  // Build held + watchlist symbol set.
  const allTrades = getTradesForPortfolio(db, target.id);
  const delivery = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = delivery.map((t, i) => ({
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side as 'buy' | 'sell',
    qty: t.qty,
    price: t.price,
    currency: t.currency === 'USD' ? 'USD' : 'INR',
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? i,
  }));
  const heldSymbols = new Set(
    computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS)
      .filter((p) => p.qty > 0)
      .map((p) => p.symbol),
  );
  const watchSymbols = new Set(listWatchlist(db, target.id).map((w) => w.symbol));

  const decisions = latestDecisionsByPortfolio(db, target.id);
  const today = new Date().toISOString().slice(0, 10);

  console.log(
    `\n${'Sym'.padEnd(12)} ${'St'.padEnd(4)} ${'PE'.padStart(5)} ${'PEG'.padStart(5)} ${'P/Sec'.padStart(6)} ${'P/5yMd'.padStart(7)} ${'10yPct'.padStart(7)}  ${'Compounder'.padEnd(18)} ${'Val'.padEnd(8)} ${'Stalwart'.padEnd(10)} ${'Final'.padEnd(10)}  Verdict on call`,
  );
  console.log('─'.repeat(150));

  type Row = {
    sym: string;
    state: string;
    pe: number | null;
    peg: number | null;
    sectorRatio: number | null;
    own5yRatio: number | null;
    pct10y: number | null;
    classification: string;
    valStatus: string;
    stalwart: string;
    final: string;
    judgment: string;
  };

  const rows: Row[] = [];

  for (const d of decisions) {
    const sym = d.symbol;
    const fund = loadFundamentals(sym);
    const sector = getSector(sym);
    const v = buildValuationContext({
      db,
      symbol: sym,
      fund,
      sectorMedian: getSectorMedian(sector),
      endDate: today,
    });
    const profile = computeCompounderProfile({
      symbol: sym,
      sector,
      fundamentals: fund,
      firedRules: [],
      valuation: {
        pe: v.pe,
        peg: v.peg,
        peVsSectorMedian: v.peVsSectorMedian,
        peSectorMedian: v.peSectorMedian,
        pe5yMedian: v.pe5yMedian,
        pe10yPercentile: v.pe10yPercentile,
        earningsYieldMinusGsec: v.earningsYieldMinusGsec,
      },
    });
    const valFactor = profile.factors.find((f) => f.factor.id === 'valuation');
    const valStatus = valFactor?.verdict.status ?? 'unknown';
    const isHeld = heldSymbols.has(sym);
    const isWatch = watchSymbols.has(sym);
    const own5yRatio =
      v.pe !== null && v.pe5yMedian !== null && v.pe5yMedian > 0 ? v.pe / v.pe5yMedian : null;

    // Synthesize Final action
    const stalwartAction = d.action as RuleAction;
    const final = synthesize({
      symbol: sym,
      isHolding: isHeld,
      isWatchlist: isWatch,
      positionPct: null,
      sectorWeight: null,
      totalSymbols: heldSymbols.size,
      stalwartAction: stalwartAction as
        | 'fresh_buy'
        | 'add'
        | 'hold'
        | 'trim_25'
        | 'trim_50'
        | 'exit',
      stalwartScore: d.score,
      compounderClass: profile.classification as
        | '7-9x candidate'
        | 'solid compounder'
        | 'mediocre'
        | 'broken'
        | null,
      compounderWeightedScore: profile.weightedScore,
      cagrAction: null,
      cagrForecast: null,
      thesisVerdict: null,
      growthYearFive: null,
      growthConfidence: null,
      valuation: {
        pe: v.pe,
        peg: v.peg,
        peVsSectorMedian: v.peVsSectorMedian,
        peSectorMedian: v.peSectorMedian,
        pe5yMedian: v.pe5yMedian,
        pe10yPercentile: v.pe10yPercentile,
      },
    });

    // Verdict
    const goodQuality =
      profile.classification === '7-9x candidate' || profile.classification === 'solid compounder';
    const cheapVal = valStatus === 'pass';
    const expensiveVal = valStatus === 'fail';
    let judgment = '✓ ok';
    const finalDA = finalToDisplayAction(final.action, { held: isHeld });
    const stalwartDA = toDisplayAction(stalwartAction, { held: isHeld });
    if (goodQuality && cheapVal && finalDA !== 'add_more') {
      judgment = '⚠ quality+cheap should be Add More, got ' + STALWART_DISPLAY_LABEL[finalDA];
    } else if (goodQuality && expensiveVal && finalDA === 'add_more') {
      judgment = '⚠ quality+EXPENSIVE rated Add More — overpaying for quality';
    } else if (!goodQuality && finalDA === 'add_more') {
      judgment = '⚠ structurally weak rated Add More';
    }

    rows.push({
      sym,
      state: isHeld ? 'HELD' : isWatch ? 'WATCH' : '—',
      pe: v.pe,
      peg: v.peg,
      sectorRatio: v.peVsSectorMedian,
      own5yRatio,
      pct10y: v.pe10yPercentile,
      classification: profile.classification,
      valStatus,
      stalwart: STALWART_DISPLAY_LABEL[stalwartDA],
      final: STALWART_DISPLAY_LABEL[finalDA],
      judgment,
    });
  }

  // Sort: held first by classification quality, then watch
  rows.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'HELD' ? -1 : 1;
    const order = ['7-9x candidate', 'solid compounder', 'mediocre', 'broken'];
    return order.indexOf(a.classification) - order.indexOf(b.classification);
  });

  for (const r of rows) {
    const peStr = r.pe?.toFixed(1) ?? '—';
    const pegStr = r.peg?.toFixed(2) ?? '—';
    const secStr = r.sectorRatio?.toFixed(2) ?? '—';
    const ownStr = r.own5yRatio?.toFixed(2) ?? '—';
    const pctStr = r.pct10y !== null ? (r.pct10y * 100).toFixed(0) + '%' : '—';
    console.log(
      `${r.sym.padEnd(12)} ${r.state.padEnd(4)} ${peStr.padStart(5)} ${pegStr.padStart(5)} ${secStr.padStart(6)} ${ownStr.padStart(7)} ${pctStr.padStart(7)}  ${r.classification.padEnd(18)} ${r.valStatus.padEnd(8)} ${r.stalwart.padEnd(10)} ${r.final.padEnd(10)}  ${r.judgment}`,
    );
  }

  // Summary
  const flagged = rows.filter((r) => r.judgment !== '✓ ok');
  console.log('\n──────────  Calls flagged for review  ──────────');
  if (flagged.length === 0) {
    console.log('All calls internally consistent.');
  } else {
    for (const r of flagged) console.log(`  ${r.sym}  ${r.judgment}`);
  }

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
