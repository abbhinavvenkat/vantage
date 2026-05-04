/**
 * Codex pipeline orchestrator.
 *
 * Runs:
 *   extract  → data/codex/extracted/<slug>/*.md
 *   distill  → data/codex/distilled/<slug>.json
 *   synth    → data/codex/synthesized/v0.1.0.json
 *   backtest → data/codex/backtests/v0.1.0/<rule>.json
 *
 * Each step is best-effort: failures are logged and the next step still runs
 * with whatever artefacts succeeded.
 *
 * Usage:
 *   tsx scripts/run-codex-pipeline.ts            # full pipeline
 *   tsx scripts/run-codex-pipeline.ts --skip-extract
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { extractInvestor } from '@/lib/codex/extract';
import { distillInvestor, totalEntries, writeDistilled } from '@/lib/codex/distill';
import {
  loadAllDistilled,
  synthesizeFromDistilled,
  writeRuleLibrary,
} from '@/lib/codex/synthesize';
import {
  backtestLibrary,
  writeBacktests,
  type BacktestTrade,
  type PriceSeries,
} from '@/lib/codex/backtest';
import { db } from '@/lib/db/client';
import { trades, accounts, pricesEod } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const RAW_ROOT = 'data/codex/raw';
const EXTRACTED_ROOT = 'data/codex/extracted';
const DISTILLED_ROOT = 'data/codex/distilled';
const SYNTH_VERSION = '0.1.0';

// Slug -> human name. Mirror of .claude/rules/codex-investors.yml priority-1 set.
const INVESTORS: Array<{ slug: string; name: string }> = [
  { slug: 'buffett', name: 'Warren Buffett' },
  { slug: 'agrawal', name: 'Raamdeo Agrawal' },
  { slug: 'marks', name: 'Howard Marks' },
  { slug: 'damodaran', name: 'Aswath Damodaran' },
  { slug: 'shankar-nath', name: 'Shankar Nath' },
];

// Minimum total distilled entries an investor must produce to be admitted to v0.1.
const MIN_ENTRIES_FOR_ADMISSION = 5;

type PipelineSummary = {
  extracted: Record<string, { docs: number; warnings: string[] }>;
  distilled: Record<string, { entries: number; bytes: number; admitted: boolean }>;
  synthesized: { rules: number; topByWeight: Array<{ id: string; weight: number }> };
  backtests: { count: number; ruleVersion: string };
};

async function runExtract(): Promise<PipelineSummary['extracted']> {
  const out: PipelineSummary['extracted'] = {};
  for (const inv of INVESTORS) {
    const rawDir = join(RAW_ROOT, inv.slug);
    if (!existsSync(rawDir)) {
      console.warn(`[extract] skip ${inv.slug}: ${rawDir} missing`);
      out[inv.slug] = { docs: 0, warnings: ['raw missing'] };
      continue;
    }
    try {
      const r = await extractInvestor(inv.slug, RAW_ROOT, EXTRACTED_ROOT);
      console.log(`[extract] ${inv.slug}: ${r.n} docs (${r.warnings.length} warnings)`);
      out[inv.slug] = { docs: r.n, warnings: r.warnings };
    } catch (err) {
      console.error(`[extract] ${inv.slug} FAILED: ${(err as Error).message}`);
      out[inv.slug] = { docs: 0, warnings: [(err as Error).message] };
    }
  }
  return out;
}

function runDistill(): PipelineSummary['distilled'] {
  const out: PipelineSummary['distilled'] = {};
  for (const inv of INVESTORS) {
    try {
      const distilled = distillInvestor(inv.slug, inv.name, EXTRACTED_ROOT);
      const entries = totalEntries(distilled);
      const admitted = entries >= MIN_ENTRIES_FOR_ADMISSION;
      if (!admitted) {
        console.warn(`[distill] ${inv.slug}: only ${entries} entries — skipping admission to v0.1`);
        out[inv.slug] = { entries, bytes: 0, admitted: false };
        continue;
      }
      const path = writeDistilled(distilled, DISTILLED_ROOT);
      const bytes = statSync(path).size;
      console.log(`[distill] ${inv.slug}: ${entries} entries, ${bytes} bytes -> ${path}`);
      out[inv.slug] = { entries, bytes, admitted: true };
    } catch (err) {
      console.error(`[distill] ${inv.slug} FAILED: ${(err as Error).message}`);
      out[inv.slug] = { entries: 0, bytes: 0, admitted: false };
    }
  }
  return out;
}

function runSynthesize(): PipelineSummary['synthesized'] {
  const investors = loadAllDistilled(DISTILLED_ROOT);
  if (investors.length === 0) {
    console.warn('[synth] no distilled investors found, skipping');
    return { rules: 0, topByWeight: [] };
  }
  const lib = synthesizeFromDistilled(investors, SYNTH_VERSION);
  const path = writeRuleLibrary(lib);
  console.log(`[synth] ${lib.rules.length} rules from ${investors.length} investor(s) -> ${path}`);
  const top = [...lib.rules]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((r) => ({ id: r.id, weight: r.weight }));
  return { rules: lib.rules.length, topByWeight: top };
}

function loadTradesFromDb(): { trades: BacktestTrade[]; symbols: Set<string> } {
  const rows = db
    .select({
      symbol: trades.symbol,
      side: trades.side,
      tradeDate: trades.tradeDate,
      price: trades.price,
    })
    .from(trades)
    .innerJoin(accounts, eq(accounts.id, trades.accountId))
    .all();
  const symbols = new Set<string>();
  const out: BacktestTrade[] = rows.map((r) => {
    symbols.add(r.symbol);
    return { symbol: r.symbol, side: r.side as 'buy' | 'sell', date: r.tradeDate, price: r.price };
  });
  return { trades: out.sort((a, b) => a.date.localeCompare(b.date)), symbols };
}

function loadPriceSeries(symbols: Set<string>): PriceSeries {
  const series: PriceSeries = new Map();
  if (symbols.size === 0) return series;
  const rows = db
    .select({ symbol: pricesEod.symbol, date: pricesEod.date, close: pricesEod.close })
    .from(pricesEod)
    .all();
  for (const r of rows) {
    if (!symbols.has(r.symbol) || r.close == null) continue;
    let arr = series.get(r.symbol);
    if (!arr) {
      arr = [];
      series.set(r.symbol, arr);
    }
    arr.push({ date: r.date, close: r.close });
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return series;
}

function loadBenchmark(): { date: string; close: number }[] {
  // Try a handful of common Nifty 50 ticker spellings. Fallback: empty -> backtests
  // produce 0-outcome results, which is acceptable for v0.1.
  const candidates = ['^NSEI', 'NIFTY50', 'NIFTY 50', 'NIFTY'];
  for (const sym of candidates) {
    const rows = db
      .select({ date: pricesEod.date, close: pricesEod.close })
      .from(pricesEod)
      .where(eq(pricesEod.symbol, sym))
      .all();
    const filtered = rows
      .filter((r): r is { date: string; close: number } => r.close != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (filtered.length > 0) {
      console.log(`[backtest] using benchmark ${sym} (${filtered.length} bars)`);
      return filtered;
    }
  }
  console.warn('[backtest] no Nifty benchmark found in prices_eod — outcomes will be empty');
  return [];
}

function runBacktest(): PipelineSummary['backtests'] {
  const libPath = resolve('data/codex/synthesized', `v${SYNTH_VERSION}.json`);
  if (!existsSync(libPath)) {
    console.warn('[backtest] no rule library on disk, skipping');
    return { count: 0, ruleVersion: SYNTH_VERSION };
  }
  const lib = JSON.parse(readFileSync(libPath, 'utf-8')) as ReturnType<
    typeof synthesizeFromDistilled
  >;
  const { trades: bts, symbols } = loadTradesFromDb();
  console.log(`[backtest] tradebook: ${bts.length} trades across ${symbols.size} symbols`);
  if (bts.length === 0) {
    console.warn('[backtest] no trades in DB — emitting empty backtest results');
  }
  const prices = loadPriceSeries(symbols);
  const benchmark = loadBenchmark();
  const results = backtestLibrary(lib, bts, prices, benchmark, 365);
  const dir = writeBacktests(results, SYNTH_VERSION);
  console.log(`[backtest] wrote ${results.length} results -> ${dir}`);
  return { count: results.length, ruleVersion: SYNTH_VERSION };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const summary: Partial<PipelineSummary> = {};

  if (!args.has('--skip-extract')) {
    summary.extracted = await runExtract();
  } else {
    console.log('[pipeline] --skip-extract set');
    summary.extracted = {};
  }

  summary.distilled = runDistill();
  summary.synthesized = runSynthesize();
  summary.backtests = runBacktest();

  console.log('\n=== PIPELINE SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  // Sanity: print top 5 again to stdout.
  if (summary.synthesized && summary.synthesized.topByWeight.length > 0) {
    console.log('\nTop rules by weight:');
    for (const r of summary.synthesized.topByWeight) {
      console.log(`  ${r.weight.toFixed(3)}  ${r.id}`);
    }
  }
}

main().catch((err) => {
  console.error('[pipeline] fatal:', err);
  process.exit(1);
});
