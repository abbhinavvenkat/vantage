/**
 * One-shot script: print the full perAction breakdown + every fired rule
 * for a single symbol so we can explain why a symbol resolves to a given
 * action.
 *
 *   PATH=/opt/miniconda3/envs/stock-platform/bin:$PATH \
 *     npx tsx scripts/explain-decision.ts POLYCAB
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { loadLatestRuleLibrary } from '@/lib/codex/library';
import { loadFundamentals } from '@/lib/decisions/growthForecast';
import { scoreSymbol, type SymbolState, defaultStyleWeights } from '@/lib/decisions/score';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { getLatestPrices, getSymbolStats } from '@/lib/db/queries/prices';
import { portfolios } from '@/lib/db/schema';
import { toDisplayAction } from '@/lib/decisions/displayAction';
import type { RuleAction } from '@/lib/codex/synthesize';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import { getSector } from '@/lib/sectors/map';

function main() {
  const sym = process.argv[2];
  if (!sym) {
    console.error('Usage: tsx scripts/explain-decision.ts SYMBOL');
    process.exit(1);
  }
  const sqlite = new Database('data/app.db');
  const db = drizzle(sqlite, { schema });
  const lib = loadLatestRuleLibrary();
  if (!lib) throw new Error('No rule library found');

  const pfs = db.select().from(portfolios).all();
  const pf = pfs.find((p) => p.name === (process.env.PORTFOLIO_NAME ?? '')) ?? pfs[0];
  if (!pf) throw new Error('No portfolio');

  const holdings = computeHoldings(db, pf.id).filter((h) => h.netQty > 0);
  const today = new Date().toISOString().slice(0, 10);
  const latest = getLatestPrices(db, [sym]);
  const stats = getSymbolStats(db, [sym], today);
  const styleWeights = defaultStyleWeights(lib);
  const h = holdings.find((x) => x.symbol === sym);

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

  const price = latest.get(sym)?.close;
  const st = stats.get(sym) ?? { high52w: null, low52w: null, avgVolume30d: null };
  const sectorMedian = getSectorMedian(getSector(sym));
  const valctx = buildValuationContext({
    db,
    symbol: sym,
    fund,
    sectorMedian,
    endDate: today,
  });
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
    pb: valctx.pb ?? undefined,
    peg: valctx.peg ?? undefined,
    peVsSectorMedian: valctx.peVsSectorMedian ?? undefined,
    pe5yMedian: valctx.pe5yMedian ?? undefined,
    pe10yPercentile: valctx.pe10yPercentile ?? undefined,
    earningsYieldMinusGsec: valctx.earningsYieldMinusGsec ?? undefined,
  };
  const r = scoreSymbol(state, lib, styleWeights);

  console.log(`\n=== ${sym} ===`);
  console.log(`  held qty: ${state.netQty}  price: ${price ?? '—'}  high52w: ${st.high52w ?? '—'}`);
  console.log(
    `  pe: ${pe ?? '—'}  roce5y: ${roce5y ? (roce5y * 100).toFixed(0) + '%' : '—'}  revCagr5y: ${revenueCagr5y ? (revenueCagr5y * 100).toFixed(0) + '%' : '—'}`,
  );
  console.log(
    `  valuation: PEG=${valctx.peg?.toFixed(2) ?? '—'}  PE/sectorMed=${valctx.peVsSectorMedian?.toFixed(2) ?? '—'} (sec=${valctx.peSectorMedian ?? '—'})  PE5y_med=${valctx.pe5yMedian?.toFixed(1) ?? '—'}  PE10y_pctile=${valctx.pe10yPercentile?.toFixed(2) ?? '—'}  Eyield-Gsec=${valctx.earningsYieldMinusGsec != null ? (valctx.earningsYieldMinusGsec * 100).toFixed(2) + '%' : '—'}`,
  );
  console.log(
    `  WINNER:  ${r.action}  →  display: ${toDisplayAction(r.action)}  (score ${r.score.toFixed(3)})`,
  );
  console.log(`\n  perAction (raw, before fold):`);
  for (const [a, v] of Object.entries(r.perAction)) {
    console.log(`    ${a.padEnd(10)} ${v.toFixed(3)}`);
  }
  const buyMore = r.perAction.add + r.perAction.fresh_buy;
  console.log(`    [add+fresh_buy fold] ${buyMore.toFixed(3)}  ← compared against hold`);

  console.log(`\n  Fired rules (${r.fired.length}):`);
  const byAction: Record<string, typeof r.fired> = {};
  for (const f of r.fired) {
    (byAction[f.action] ??= []).push(f);
  }
  for (const a of ['fresh_buy', 'add', 'hold', 'trim_25', 'trim_50', 'exit'] as RuleAction[]) {
    const list = byAction[a] ?? [];
    if (list.length === 0) continue;
    const sum = list.reduce((s, f) => s + f.weight, 0);
    console.log(`\n    [${a}] ${list.length} rules · sum ${sum.toFixed(3)}`);
    for (const f of list) {
      console.log(
        `      ${f.weight.toFixed(2).padStart(5)}  ${f.ruleId}  (style ${f.styleScale.toFixed(2)})  ${(f.tags ?? []).join('/') || '—'}`,
      );
    }
  }

  sqlite.close();
}

main();
