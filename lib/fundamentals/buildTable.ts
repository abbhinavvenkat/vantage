/**
 * Build the per-symbol Fundamentals table rendered on the Decisions page.
 *
 * Pure function: takes a `Fundamentals` blob (already loaded from
 * `data/codex/backtests/fundamentals/<symbol>.json` via
 * `lib/decisions/growthForecast.ts#loadFundamentals`) and returns one row per
 * metric in METRIC_IDS with latest value, 3-year average, 5-year CAGR (where
 * meaningful), verdict colour, and the matching stalwart commentary.
 *
 * No I/O. No external API. Renders identically on the server and in tests.
 */

import type { AnnualRow, Fundamentals } from '@/lib/decisions/growthForecast';
import { classifyMetric, METRIC_IDS, METRIC_THRESHOLDS, type MetricId } from './thresholds';
import { pickCommentary, type CommentaryEntry } from './stalwartCommentary';

export type FundamentalsRow = {
  metricId: MetricId;
  label: string;
  unit: string;
  /** the headline single number rendered in the "Latest" column */
  latest: number | null;
  /** what the table actually shows for "3y avg" — may be null if not enough data */
  threeYearAvg: number | null;
  /** 5y CAGR as a decimal — null if not enough data or metric is a ratio */
  fiveYearCagr: number | null;
  /** verdict colour, computed against the metric's threshold map */
  verdict: 'green' | 'amber' | 'red' | 'unknown';
  /** commentary entry shown inline; clicking opens the full list */
  commentary: CommentaryEntry | null;
};

export type FundamentalsTable = {
  symbol: string | null;
  rows: FundamentalsRow[];
};

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function years(annual: Record<string, AnnualRow>): string[] {
  return Object.keys(annual).sort();
}

function avg(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter(isNum);
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function cagr(start: number | null | undefined, end: number | null | undefined, n: number) {
  if (!isNum(start) || !isNum(end) || start <= 0 || end <= 0 || n <= 0) return null;
  return Math.pow(end / start, 1 / n) - 1;
}

/**
 * Compute the table rows for a symbol. Pass `null` for unknown symbols and
 * every row will be rendered with verdict='unknown'.
 */
export function buildFundamentalsTable(fund: Fundamentals | null): FundamentalsTable {
  const rows: FundamentalsRow[] = [];

  // For all-unknown shortcut.
  if (!fund || !fund.annual) {
    for (const id of METRIC_IDS) {
      const t = METRIC_THRESHOLDS[id];
      rows.push({
        metricId: id,
        label: t.label,
        unit: t.unit,
        latest: null,
        threeYearAvg: null,
        fiveYearCagr: null,
        verdict: 'unknown',
        commentary: pickCommentary(id, 'unknown'),
      });
    }
    return { symbol: fund?.symbol ?? null, rows };
  }

  const ks = years(fund.annual);
  const last = ks.length ? fund.annual[ks[ks.length - 1]!] : undefined;
  const last3 = ks.slice(-3).map((k) => fund.annual[k]!);
  const earliestForCagr = ks.length >= 6 ? fund.annual[ks[ks.length - 6]!]! : fund.annual[ks[0]!]!;
  const cagrSpan = ks.length >= 6 ? 5 : Math.max(1, ks.length - 1);

  function buildRow(
    id: MetricId,
    latest: number | null,
    avg3: number | null,
    cagr5: number | null,
  ): FundamentalsRow {
    const t = METRIC_THRESHOLDS[id];
    // Verdict basis: for growth metrics (revenue, pat) we judge on 5y CAGR; for
    // ratios we judge on the latest value; for unit='cr' yet no CAGR (ratios
    // like fcf_to_pat, dividend_yield) we judge on latest.
    let basisValue: number | null;
    if (id === 'revenue' || id === 'pat') basisValue = cagr5;
    else basisValue = latest;
    const c = classifyMetric(id, basisValue);
    return {
      metricId: id,
      label: t.label,
      unit: t.unit,
      latest,
      threeYearAvg: avg3,
      fiveYearCagr: cagr5,
      verdict: c.verdict,
      commentary: pickCommentary(id, c.verdict),
    };
  }

  // Revenue.
  {
    const latest = last?.sales_cr ?? null;
    const avg3 = avg(last3.map((r) => r.sales_cr));
    const cagr5 = cagr(earliestForCagr.sales_cr ?? null, last?.sales_cr ?? null, cagrSpan);
    rows.push(buildRow('revenue', latest, avg3, cagr5));
  }
  // PAT.
  {
    const latest = last?.pat_cr ?? null;
    const avg3 = avg(last3.map((r) => r.pat_cr));
    const cagr5 = cagr(earliestForCagr.pat_cr ?? null, last?.pat_cr ?? null, cagrSpan);
    rows.push(buildRow('pat', latest, avg3, cagr5));
  }
  // ROCE %.
  {
    const latest = last?.roce_pct ?? null;
    const avg3 = avg(last3.map((r) => r.roce_pct));
    rows.push(buildRow('roce', latest, avg3, null));
  }
  // ROE %.
  {
    const latest = last?.roe_pct ?? null;
    const avg3 = avg(last3.map((r) => r.roe_pct));
    rows.push(buildRow('roe', latest, avg3, null));
  }
  // EBITDA margin (ratio derived from ebitda_cr / sales_cr).
  {
    function margin(r: AnnualRow): number | null {
      if (!isNum(r.ebitda_cr) || !isNum(r.sales_cr) || r.sales_cr <= 0) return null;
      return r.ebitda_cr / r.sales_cr;
    }
    const latest = last ? margin(last) : null;
    const avg3 = avg(last3.map((r) => margin(r)));
    rows.push(buildRow('ebitda_margin', latest, avg3, null));
  }
  // Debt/Equity (latest).
  {
    const latest = last?.debt_to_equity ?? null;
    const avg3 = avg(last3.map((r) => r.debt_to_equity));
    rows.push(buildRow('debt_to_equity', latest, avg3, null));
  }
  // FCF/PAT (CFO + capex_cr) / PAT. capex is signed negative in the source.
  {
    function fcfRatio(r: AnnualRow): number | null {
      if (!isNum(r.cfo_cr) || !isNum(r.pat_cr) || r.pat_cr <= 0) return null;
      const capex = isNum(r.capex_cr) ? r.capex_cr : 0;
      // capex is typically stored negative; CFO + capex = FCF.
      const fcf = r.cfo_cr + (capex < 0 ? capex : -Math.abs(capex));
      return fcf / r.pat_cr;
    }
    const latest = last ? fcfRatio(last) : null;
    const avg3 = avg(last3.map((r) => fcfRatio(r)));
    rows.push(buildRow('fcf_to_pat', latest, avg3, null));
  }
  // PE (current).
  {
    const latest = fund.current?.pe ?? null;
    rows.push(buildRow('pe', latest, null, null));
  }
  // PB (price / book value per share).
  {
    let pb: number | null = null;
    const price = fund.current?.price;
    const bv = fund.current?.book_value_per_share;
    if (isNum(price) && isNum(bv) && bv > 0) pb = price / bv;
    rows.push(buildRow('pb', pb, null, null));
  }
  // Dividend yield — not present in fundamentals JSON; surface as unknown.
  {
    rows.push(buildRow('dividend_yield', null, null, null));
  }

  return { symbol: fund.symbol ?? null, rows };
}
