import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { screenUniverse } from '@/lib/cagr/universeScreener';

function makeFixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'cagr-screen-'));
  const fundamentals = join(root, 'fundamentals');
  const results = join(root, 'results');
  mkdirSync(fundamentals, { recursive: true });
  mkdirSync(results, { recursive: true });

  writeFileSync(
    join(root, 'universe.csv'),
    [
      'symbol,company_name,sector,industry',
      'WIN,Winner Ltd.,Technology,Software',
      'AVG,Average Ltd.,Banking,Financial Services',
      'LOSER,Loser Ltd.,Industrials,Capital Goods',
    ].join('\n') + '\n',
  );

  // WIN: high-quality compounder, 5y revenue/PAT >25%, healthy ROCE, low PE
  writeFileSync(
    join(fundamentals, 'WIN.json'),
    JSON.stringify({
      symbol: 'WIN',
      annual: {
        FY2020: { sales_cr: 100, pat_cr: 18, roce_pct: 32, debt_to_equity: 0.05, equity_bv_cr: 60 },
        FY2021: { sales_cr: 130, pat_cr: 25, roce_pct: 33, debt_to_equity: 0.05, equity_bv_cr: 75 },
        FY2022: { sales_cr: 170, pat_cr: 35, roce_pct: 34, debt_to_equity: 0.04, equity_bv_cr: 95 },
        FY2023: {
          sales_cr: 220,
          pat_cr: 50,
          roce_pct: 35,
          debt_to_equity: 0.03,
          equity_bv_cr: 130,
        },
        FY2024: {
          sales_cr: 285,
          pat_cr: 70,
          roce_pct: 36,
          debt_to_equity: 0.03,
          equity_bv_cr: 175,
        },
        FY2025: {
          sales_cr: 370,
          pat_cr: 95,
          roce_pct: 37,
          debt_to_equity: 0.02,
          equity_bv_cr: 230,
        },
      },
      current: { pe: 22, price: 1500, market_cap_cr: 14250, book_value_per_share: 230 },
    }),
  );

  // AVG: middling growth ~12%, mediocre ROCE, mid PE
  writeFileSync(
    join(fundamentals, 'AVG.json'),
    JSON.stringify({
      symbol: 'AVG',
      annual: {
        FY2020: {
          sales_cr: 1000,
          pat_cr: 90,
          roce_pct: 14,
          debt_to_equity: 0.4,
          equity_bv_cr: 600,
        },
        FY2021: {
          sales_cr: 1100,
          pat_cr: 100,
          roce_pct: 14,
          debt_to_equity: 0.4,
          equity_bv_cr: 660,
        },
        FY2022: {
          sales_cr: 1220,
          pat_cr: 110,
          roce_pct: 13,
          debt_to_equity: 0.45,
          equity_bv_cr: 720,
        },
        FY2023: {
          sales_cr: 1350,
          pat_cr: 120,
          roce_pct: 13,
          debt_to_equity: 0.45,
          equity_bv_cr: 780,
        },
        FY2024: {
          sales_cr: 1490,
          pat_cr: 130,
          roce_pct: 12,
          debt_to_equity: 0.5,
          equity_bv_cr: 850,
        },
        FY2025: {
          sales_cr: 1640,
          pat_cr: 145,
          roce_pct: 12,
          debt_to_equity: 0.5,
          equity_bv_cr: 920,
        },
      },
      current: { pe: 18, price: 800, market_cap_cr: 2700, book_value_per_share: 600 },
    }),
  );

  // LOSER: declining margins, very low ROCE, high PE
  writeFileSync(
    join(fundamentals, 'LOSER.json'),
    JSON.stringify({
      symbol: 'LOSER',
      annual: {
        FY2020: { sales_cr: 500, pat_cr: 40, roce_pct: 8, debt_to_equity: 0.9, equity_bv_cr: 400 },
        FY2021: { sales_cr: 510, pat_cr: 38, roce_pct: 7, debt_to_equity: 1.0, equity_bv_cr: 420 },
        FY2022: { sales_cr: 520, pat_cr: 32, roce_pct: 6, debt_to_equity: 1.1, equity_bv_cr: 430 },
        FY2023: { sales_cr: 510, pat_cr: 25, roce_pct: 5, debt_to_equity: 1.2, equity_bv_cr: 440 },
        FY2024: { sales_cr: 505, pat_cr: 18, roce_pct: 4, debt_to_equity: 1.3, equity_bv_cr: 450 },
        FY2025: { sales_cr: 500, pat_cr: 12, roce_pct: 3, debt_to_equity: 1.5, equity_bv_cr: 460 },
      },
      current: { pe: 80, price: 200, market_cap_cr: 250, book_value_per_share: 460 },
    }),
  );

  // Empty results dir is fine — screener tolerates missing per-framework picks.
  return root;
}

describe('screenUniverse', () => {
  it('ranks high-quality high-growth names above low-growth names', () => {
    const root = makeFixture();
    try {
      const out = screenUniverse({
        targetCagrPct: 22,
        horizonYears: 10,
        universeRoot: root,
        fundamentalsRoot: join(root, 'fundamentals'),
        backtestResultsRoot: join(root, 'results'),
      });

      // WIN should be first; LOSER should be filtered out.
      expect(out.length).toBeGreaterThan(0);
      expect(out[0]!.symbol).toBe('WIN');
      const symbols = out.map((c) => c.symbol);
      expect(symbols).not.toContain('LOSER');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('attaches forecastedCagr, frameworkSupport, marketCapBucket, thesis', () => {
    const root = makeFixture();
    try {
      const out = screenUniverse({
        targetCagrPct: 20,
        horizonYears: 10,
        universeRoot: root,
        fundamentalsRoot: join(root, 'fundamentals'),
        backtestResultsRoot: join(root, 'results'),
      });
      const win = out.find((c) => c.symbol === 'WIN');
      expect(win).toBeDefined();
      expect(win!.forecastedCagr).toBeGreaterThan(0.18);
      expect(win!.compositeScore).toBeGreaterThan(0);
      expect(win!.frameworkSupport.length).toBeGreaterThanOrEqual(1);
      expect(['largecap', 'midcap', 'smallcap', 'unknown']).toContain(win!.marketCapBucket);
      expect(win!.thesisOneLiner.length).toBeGreaterThan(0);
      expect(win!.thesisMd.length).toBeGreaterThan(20);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns empty array gracefully when universe missing', () => {
    const out = screenUniverse({
      targetCagrPct: 22,
      horizonYears: 10,
      universeRoot: '/nonexistent-path-cagr-test',
      fundamentalsRoot: '/nonexistent-path-cagr-test/fundamentals',
      backtestResultsRoot: '/nonexistent-path-cagr-test/results',
    });
    expect(out).toEqual([]);
  });
});
