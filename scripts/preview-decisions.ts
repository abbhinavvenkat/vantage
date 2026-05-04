/**
 * Preview growth forecasts + top fired rules for selected user holdings.
 * Runs the v0.2 library against a real DB; prints a compact report.
 *
 *   npx tsx scripts/preview-decisions.ts BAJAJ-AUTO BEL HDFCBANK DIVISLAB IEX
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { loadLatestRuleLibrary } from '@/lib/codex/library';
import { forecastGrowth, loadFundamentals } from '@/lib/decisions/growthForecast';
import { scoreSymbol, type SymbolState, defaultStyleWeights } from '@/lib/decisions/score';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { getLatestPrices, getSymbolStats } from '@/lib/db/queries/prices';
import { portfolios } from '@/lib/db/schema';

function fmt(x: number): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
}

function main() {
  const want = process.argv.slice(2);
  if (want.length === 0) {
    console.error('Usage: tsx scripts/preview-decisions.ts SYM1 SYM2 ...');
    process.exit(1);
  }
  const sqlite = new Database('data/app.db');
  const db = drizzle(sqlite, { schema });
  const lib = loadLatestRuleLibrary();
  if (!lib) throw new Error('No rule library found');

  const pfs = db.select().from(portfolios).all();
  const pf = pfs.find((p) => p.name === (process.env.PORTFOLIO_NAME ?? '')) ?? pfs[0];
  if (!pf)
    throw new Error('No portfolios found — run npm run seed:sample or create one via the UI');

  const holdings = computeHoldings(db, pf.id).filter((h) => h.netQty > 0);
  const today = new Date().toISOString().slice(0, 10);
  const latest = getLatestPrices(
    db,
    holdings.map((h) => h.symbol),
  );
  const stats = getSymbolStats(
    db,
    holdings.map((h) => h.symbol),
    today,
  );
  const styleWeights = defaultStyleWeights(lib);

  for (const sym of want) {
    const h = holdings.find((x) => x.symbol === sym);
    const price = latest.get(sym)?.close;
    const st = stats.get(sym) ?? { high52w: null, low52w: null, avgVolume30d: null };
    const fund = loadFundamentals(sym);
    let pe: number | undefined;
    let roce5y: number | undefined;
    let revenueCagr5y: number | undefined;
    if (fund) {
      pe = typeof fund.current?.pe === 'number' ? fund.current.pe : undefined;
      const ys = Object.keys(fund.annual).sort();
      const last5 = ys.slice(-5);
      const roces = last5
        .map((y) => fund.annual[y]?.roce_pct)
        .filter((v): v is number => typeof v === 'number');
      if (roces.length > 0) roce5y = roces.reduce((a, b) => a + b, 0) / roces.length / 100;
      if (ys.length >= 6) {
        const lastY = fund.annual[ys[ys.length - 1]!];
        const five = fund.annual[ys[ys.length - 6]!];
        if (
          lastY &&
          five &&
          typeof lastY.sales_cr === 'number' &&
          typeof five.sales_cr === 'number' &&
          five.sales_cr > 0
        ) {
          revenueCagr5y = Math.pow(lastY.sales_cr / five.sales_cr, 1 / 5) - 1;
        }
      }
    }
    const state: SymbolState = {
      symbol: sym,
      netQty: h?.netQty ?? 0,
      currentPrice: price,
      high52w: st.high52w ?? undefined,
      low52w: st.low52w ?? undefined,
      thesisIntact: true,
      pe,
      roce5y,
      revenueCagr5y,
    };
    const r = scoreSymbol(state, lib, styleWeights);
    const g = forecastGrowth({
      symbol: sym,
      fundamentals: fund,
      firedRules: r.fired.map((f) => ({ ...f, tags: f.tags ?? [] })),
      currentPrice: price,
      priceHistory: [],
    });

    console.log(`\n=== ${sym} ===`);
    console.log(
      `  action: ${r.action}  score: ${r.score.toFixed(2)}  pe: ${pe ?? '—'}  ROCE5y: ${roce5y ? (roce5y * 100).toFixed(0) + '%' : '—'}  rev5y: ${revenueCagr5y ? (revenueCagr5y * 100).toFixed(0) + '%' : '—'}`,
    );
    console.log(
      `  growth: 1y ${fmt(g.yearOne)} · 3y ${fmt(g.yearThree)} · 5y ${fmt(g.yearFive)} (conf ${g.confidence})`,
    );
    console.log(`  basis: ${g.basis.join(' | ')}`);
    console.log(`  top fired rules:`);
    for (const f of r.fired.slice(0, 3)) {
      console.log(
        `    - ${f.ruleId}  weight ${f.weight.toFixed(2)}  (${(f.tags ?? []).join('/') || 'no tags'})`,
      );
    }
  }

  sqlite.close();
}

main();
