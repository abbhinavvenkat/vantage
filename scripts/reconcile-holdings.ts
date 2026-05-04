/**
 * Reconcile our FIFO holdings against Zerodha's authoritative holdings statement.
 * Reads the holdings XLSX and the user's tradebooks; reports diffs row-by-row.
 *
 * Output columns:
 *   symbol | zerodha_qty | our_qty | qty_diff | zerodha_avg | our_avg | avg_diff
 */

import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { zerodhaParser } from '@/lib/parsers/zerodha';
import type { NormalizedTrade } from '@/lib/parsers/types';
import { detectIntradayPairs } from '@/lib/analytics/intradayDetect';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { netSameDayIntraday } from '@/lib/analytics/fifo';
import type { CorporateAction } from '@/lib/analytics/fifo';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { applyBonus, applySplit } from '@/lib/analytics/corporateActions';

const TRADEBOOK_DIR = resolve(process.env.TRADEBOOK_DIR ?? './Zerodha Data');
const HOLDINGS_FILE = resolve(process.env.HOLDINGS_FILE ?? `${TRADEBOOK_DIR}/holdings.xlsx`);

type ZerodhaHolding = {
  symbol: string;
  isin: string;
  qty: number;
  avgPrice: number;
  closePrice: number;
  unrealized: number;
};

function readZerodhaHoldings(): {
  invested: number;
  present: number;
  unrealized: number;
  rows: ZerodhaHolding[];
} {
  const wb = XLSX.read(readFileSync(HOLDINGS_FILE), { type: 'buffer', cellDates: false });
  const ws = wb.Sheets['Equity']!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
  // Find summary lines
  let invested = 0,
    present = 0,
    unrealized = 0;
  let headerIdx = -1;
  for (let i = 0; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    if (r[0] === 'Invested Value') invested = Number(r[1]);
    if (r[0] === 'Present Value') present = Number(r[1]);
    if (r[0] === 'Unrealized P&L') unrealized = Number(r[1]);
    if (r[0] === 'Symbol') headerIdx = i;
  }
  const rows: ZerodhaHolding[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    if (typeof r[0] !== 'string' || !r[0]) continue;
    rows.push({
      symbol: r[0],
      isin: String(r[1] ?? ''),
      qty: Number(r[3]),
      avgPrice: Number(r[8]),
      closePrice: Number(r[9]),
      unrealized: Number(r[10]),
    });
  }
  return { invested, present, unrealized, rows };
}

function loadAllTrades(): NormalizedTrade[] {
  const files = readdirSync(TRADEBOOK_DIR)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && f.toLowerCase().startsWith('tradebook'))
    .sort();
  const all: NormalizedTrade[] = [];
  for (const f of files) {
    const bytes = readFileSync(resolve(TRADEBOOK_DIR, f));
    if (!zerodhaParser.detect({ name: f, bytes })) continue;
    const parsed = zerodhaParser.parse({ name: f, bytes });
    all.push(...parsed);
  }
  return all;
}

function fifoOpenLotsBySymbol(
  trades: NormalizedTrade[],
  corpActions: CorporateAction[],
): Map<string, { qty: number; cost: number }> {
  // Apply same-day netting per symbol then run a per-symbol FIFO that tolerates oversells (skip).
  // Apply corporate actions (bonus/split) at their ex-dates BEFORE sells are matched.
  const netted = netSameDayIntraday(trades);
  const bySymbol = new Map<string, NormalizedTrade[]>();
  for (const t of netted) {
    const a = bySymbol.get(t.symbol) ?? [];
    a.push(t);
    bySymbol.set(t.symbol, a);
  }
  const actionsBySymbol = new Map<string, CorporateAction[]>();
  for (const a of corpActions) {
    const arr = actionsBySymbol.get(a.symbol) ?? [];
    arr.push(a);
    actionsBySymbol.set(a.symbol, arr);
  }
  for (const arr of actionsBySymbol.values()) {
    arr.sort((x, y) => x.exDate.localeCompare(y.exDate));
  }

  const out = new Map<string, { qty: number; cost: number }>();
  for (const [symbol, ts] of bySymbol) {
    const sorted = [...ts].sort((a, b) =>
      a.tradeDate !== b.tradeDate
        ? a.tradeDate.localeCompare(b.tradeDate)
        : a.rawRowIdx - b.rawRowIdx,
    );
    const pendingActions = [...(actionsBySymbol.get(symbol) ?? [])];
    let lots: { qty: number; costPerShare: number; date: string }[] = [];
    const flushActionsUpTo = (date: string): void => {
      while (pendingActions.length > 0 && pendingActions[0]!.exDate <= date) {
        const action = pendingActions.shift()!;
        if (action.type === 'split') lots = applySplit(lots, action.ratio, action.exDate);
        else lots = applyBonus(lots, action.ratio, action.exDate);
      }
    };
    let oversold = false;
    for (const t of sorted) {
      flushActionsUpTo(t.tradeDate);
      if (t.side === 'buy') {
        lots.push({ qty: t.qty, costPerShare: t.price, date: t.tradeDate });
      } else {
        let rem = t.qty;
        while (rem > 0 && lots.length > 0) {
          const head = lots[0]!;
          const used = Math.min(head.qty, rem);
          head.qty -= used;
          rem -= used;
          if (head.qty === 0) lots.shift();
        }
        if (rem > 0) {
          oversold = true;
          break;
        }
      }
    }
    // Flush remaining actions (post last trade)
    while (pendingActions.length > 0) {
      const action = pendingActions.shift()!;
      if (action.type === 'split') lots = applySplit(lots, action.ratio, action.exDate);
      else lots = applyBonus(lots, action.ratio, action.exDate);
    }
    if (oversold) {
      out.set(symbol, { qty: -1, cost: -1 });
      continue;
    }
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    const cost = lots.reduce((s, l) => s + l.qty * l.costPerShare, 0);
    if (qty > 0) out.set(symbol, { qty, cost });
  }
  return out;
}

function main(): void {
  const zerodha = readZerodhaHoldings();
  const trades = loadAllTrades();
  // Apply our existing alias map then compute FIFO open lots
  const aliased = applySymbolAliases(trades);
  const { delivery } = detectIntradayPairs(aliased);
  const ourLots = fifoOpenLotsBySymbol(delivery, KNOWN_CORPORATE_ACTIONS);

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(' RECONCILIATION: Our FIFO vs Zerodha holdings statement (2026-04-30)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`  Zerodha invested:    ₹${zerodha.invested.toLocaleString('en-IN')}`);
  console.log(`  Zerodha present:     ₹${zerodha.present.toLocaleString('en-IN')}`);
  console.log(`  Zerodha unrealized:  ₹${zerodha.unrealized.toLocaleString('en-IN')}`);
  console.log(`  Zerodha rows:        ${zerodha.rows.length}`);
  console.log('');

  console.log(
    `${'SYMBOL'.padEnd(14)} ${'Z_QTY'.padStart(8)} ${'OUR_QTY'.padStart(10)} ${'QTY_DIFF'.padStart(10)} ${'Z_AVG'.padStart(10)} ${'OUR_AVG'.padStart(10)} ${'AVG_DIFF%'.padStart(10)}  NOTE`,
  );

  let totalZInvested = 0;
  let totalOurCost = 0;
  let bigDiffs = 0;

  // Map MON100-E to MON100 for comparison
  const symMap: Record<string, string> = { 'MON100-E': 'MON100' };

  for (const z of zerodha.rows) {
    const ourSymbol = symMap[z.symbol] ?? z.symbol;
    const ours = ourLots.get(ourSymbol);
    const zInvested = z.qty * z.avgPrice;
    totalZInvested += zInvested;

    if (!ours) {
      console.log(
        `${z.symbol.padEnd(14)} ${String(z.qty).padStart(8)} ${'(missing)'.padStart(10)} ${''.padStart(10)} ${z.avgPrice.toFixed(2).padStart(10)} ${''.padStart(10)} ${''.padStart(10)}  symbol absent in our FIFO`,
      );
      bigDiffs++;
      continue;
    }
    if (ours.qty < 0) {
      console.log(
        `${z.symbol.padEnd(14)} ${String(z.qty).padStart(8)} ${'(oversold)'.padStart(10)} ${''.padStart(10)} ${z.avgPrice.toFixed(2).padStart(10)} ${''.padStart(10)} ${''.padStart(10)}  FIFO oversold`,
      );
      bigDiffs++;
      continue;
    }
    const qtyDiff = ours.qty - z.qty;
    const ourAvg = ours.qty > 0 ? ours.cost / ours.qty : 0;
    const avgDiffPct = z.avgPrice > 0 ? ((ourAvg - z.avgPrice) / z.avgPrice) * 100 : 0;
    totalOurCost += ours.cost;

    let note = '';
    if (Math.abs(qtyDiff) > 0.001) {
      note = qtyDiff > 0 ? 'over by qty (we have more)' : 'under by qty (we have less)';
      bigDiffs++;
    } else if (Math.abs(avgDiffPct) > 1) {
      note = 'avg-cost mismatch';
      bigDiffs++;
    }
    console.log(
      `${z.symbol.padEnd(14)} ${String(z.qty).padStart(8)} ${ours.qty.toFixed(2).padStart(10)} ${qtyDiff.toFixed(2).padStart(10)} ${z.avgPrice.toFixed(2).padStart(10)} ${ourAvg.toFixed(2).padStart(10)} ${avgDiffPct.toFixed(2).padStart(10)}  ${note}`,
    );
  }

  // Symbols in our FIFO but NOT in Zerodha holdings (should be 0 if our FIFO is correct — these are phantom holdings)
  const zSymbols = new Set(zerodha.rows.map((z) => symMap[z.symbol] ?? z.symbol));
  const phantom: string[] = [];
  for (const [s, lot] of ourLots) {
    if (!zSymbols.has(s) && lot.qty > 0) phantom.push(`${s}(${lot.qty})`);
  }
  if (phantom.length > 0) {
    console.log(`\n  ✗ Phantom holdings (in our FIFO, not in Zerodha): ${phantom.join(', ')}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(
    `  Zerodha invested total: ₹${totalZInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  Our FIFO invested:      ₹${totalOurCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  Diff:                   ₹${(totalOurCost - totalZInvested).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  );
  console.log(`  Symbols with diffs:     ${bigDiffs} / ${zerodha.rows.length}`);
}

main();
