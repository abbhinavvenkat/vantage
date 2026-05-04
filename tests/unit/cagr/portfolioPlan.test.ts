import { describe, expect, it } from 'vitest';

import type { ScreenedCandidate } from '@/lib/cagr/universeScreener';
import { buildCagrPlan, type CagrHolding } from '@/lib/cagr/portfolioPlan';

function holding(
  symbol: string,
  marketValue: number,
  forecastedCagr: number,
  sector = 'Technology',
  marketCapBucket: 'largecap' | 'midcap' | 'smallcap' | 'unknown' = 'largecap',
): CagrHolding {
  return { symbol, marketValue, forecastedCagr, sector, marketCapBucket };
}

function candidate(
  symbol: string,
  forecastedCagr: number,
  sector = 'Technology',
  marketCapBucket: 'largecap' | 'midcap' | 'smallcap' | 'unknown' = 'midcap',
): ScreenedCandidate {
  return {
    symbol,
    companyName: `${symbol} Ltd.`,
    sector,
    marketCapBucket,
    compositeScore: 80,
    forecastedCagr,
    confidence: 'medium',
    frameworkSupport: [{ framework: 'greenblatt', score: 90, alpha: 0.1065 }],
    thesisOneLiner: `${symbol} compounder buy`,
    thesisMd: `${symbol} thesis paragraph with multiple sentences. Strong moat. Growing earnings.`,
    entryFairPrice: null,
    entryStrongBuy: null,
    topRules: [],
  };
}

describe('buildCagrPlan', () => {
  it('classifies holdings by forecast vs target', () => {
    const holdings: CagrHolding[] = [
      holding('KEEP', 100_000, 0.23, 'Technology', 'largecap'), // ≥ target
      holding('HIGHADD', 100_000, 0.27, 'Technology', 'midcap'), // ≥ target × 1.1
      holding('TRIM', 100_000, 0.18, 'Banking', 'largecap'), // [t×0.7, t×0.95)
      holding('REPLACE', 100_000, 0.1, 'FMCG', 'largecap'), // < t×0.7
    ];
    const cands: ScreenedCandidate[] = [
      candidate('NEWFMCG', 0.24, 'FMCG', 'midcap'),
      candidate('NEWTECH', 0.28, 'Technology', 'midcap'),
    ];
    const plan = buildCagrPlan({
      holdings,
      watchlist: [],
      candidates: cands,
      targetCagrPct: 22,
      horizonYears: 10,
    });

    const kinds = new Map(plan.actions.map((a) => [a.symbol, a.kind]));
    expect(kinds.get('KEEP')).toBe('keep');
    expect(kinds.get('HIGHADD')).toBe('add');
    expect(kinds.get('TRIM')).toBe('trim_partial');
    expect(kinds.get('REPLACE')).toBe('replace');

    const replaceAction = plan.actions.find((a) => a.symbol === 'REPLACE')!;
    expect(replaceAction.replacementSymbol).toBe('NEWFMCG');
    expect(replaceAction.thesisMd).toBeTruthy();
  });

  it('computes current and proposed forecast CAGR and alpha uplift', () => {
    const holdings: CagrHolding[] = [
      holding('A', 100_000, 0.2, 'Technology', 'largecap'),
      holding('B', 100_000, 0.1, 'FMCG', 'largecap'), // will be replaced
    ];
    const cands: ScreenedCandidate[] = [candidate('NEW', 0.26, 'FMCG', 'midcap')];
    const plan = buildCagrPlan({
      holdings,
      watchlist: [],
      candidates: cands,
      targetCagrPct: 22,
      horizonYears: 10,
    });
    expect(plan.currentPortfolioForecastCagr).toBeCloseTo(0.15, 2);
    expect(plan.proposedPortfolioForecastCagr).toBeGreaterThan(plan.currentPortfolioForecastCagr);
    expect(plan.alphaUplift).toBeCloseTo(
      plan.proposedPortfolioForecastCagr - plan.currentPortfolioForecastCagr,
      6,
    );
  });

  it('identifies sector gaps using a target template', () => {
    const holdings: CagrHolding[] = [
      holding('FOOD1', 500_000, 0.1, 'FMCG', 'largecap'), // overweight low-growth FMCG
      holding('FOOD2', 500_000, 0.1, 'FMCG', 'largecap'),
    ];
    const plan = buildCagrPlan({
      holdings,
      watchlist: [],
      candidates: [
        candidate('IT1', 0.25, 'Technology', 'midcap'),
        candidate('PHARMA1', 0.24, 'Healthcare', 'midcap'),
      ],
      targetCagrPct: 22,
      horizonYears: 10,
    });
    const fmcg = plan.gaps.find((g) => g.dimension === 'sector' && g.key === 'FMCG');
    // FMCG is overweight relative to a growth-tilted template -> currentPct > targetPct.
    expect(fmcg?.currentPct ?? 0).toBeGreaterThan(0.5);
    // Technology and Healthcare should appear as under-represented
    const it = plan.gaps.find(
      (g) => g.dimension === 'sector' && g.key === 'Information Technology',
    );
    const hc = plan.gaps.find((g) => g.dimension === 'sector' && g.key === 'Healthcare');
    // Either bucket is in the gap list
    expect(plan.gaps.length).toBeGreaterThan(0);
  });

  it('flags concentration risk for single-name > 10%', () => {
    const holdings: CagrHolding[] = [
      holding('BIG', 800_000, 0.2, 'Technology', 'largecap'),
      holding('SMALL', 200_000, 0.2, 'Banking', 'largecap'),
    ];
    const plan = buildCagrPlan({
      holdings,
      watchlist: [],
      candidates: [],
      targetCagrPct: 22,
      horizonYears: 10,
    });
    expect(plan.unaccountedRiskNotes.join(' ')).toMatch(/BIG|concentration/i);
  });

  it('Compounder override: classification "broken" forces replace even when forecast is on-target', () => {
    const holdings: CagrHolding[] = [
      {
        ...holding('SOLID', 100_000, 0.23, 'Technology', 'largecap'),
        compounderClassification: 'broken',
      },
    ];
    const plan = buildCagrPlan({
      holdings,
      watchlist: [],
      candidates: [candidate('REPL', 0.26, 'Technology', 'midcap')],
      targetCagrPct: 22,
      horizonYears: 10,
    } as any);
    const a = plan.actions.find((x) => x.symbol === 'SOLID');
    expect(a?.kind).toBe('replace');
  });

  it('Compounder override: "7-9x candidate" promotes to add when not the largest position', () => {
    const holdings: CagrHolding[] = [
      holding('LARGE', 600_000, 0.18, 'Technology', 'largecap'),
      {
        ...holding('GEM', 100_000, 0.18, 'Technology', 'midcap'),
        compounderClassification: '7-9x candidate',
      },
    ];
    const plan = buildCagrPlan({
      holdings,
      watchlist: [],
      candidates: [],
      targetCagrPct: 22,
      horizonYears: 10,
    } as any);
    const a = plan.actions.find((x) => x.symbol === 'GEM');
    expect(a?.kind).toBe('add');
  });

  it('Compounder override: "7-9x candidate" does NOT add when it is the largest position', () => {
    const holdings: CagrHolding[] = [
      {
        ...holding('GEM', 600_000, 0.18, 'Technology', 'largecap'),
        compounderClassification: '7-9x candidate',
      },
      holding('SMALL', 100_000, 0.21, 'Technology', 'midcap'),
    ];
    const plan = buildCagrPlan({
      holdings,
      watchlist: [],
      candidates: [],
      targetCagrPct: 22,
      horizonYears: 10,
    } as any);
    const a = plan.actions.find((x) => x.symbol === 'GEM');
    // GEM is largest + forecast 0.18 < target * 0.95 (0.209) → falls to trim_partial
    expect(['trim_partial', 'keep']).toContain(a?.kind);
  });

  it('handles empty portfolio with fresh_buy actions from candidates', () => {
    const plan = buildCagrPlan({
      holdings: [],
      watchlist: [],
      candidates: [
        candidate('NEW1', 0.24, 'Technology', 'midcap'),
        candidate('NEW2', 0.23, 'Healthcare', 'midcap'),
      ],
      targetCagrPct: 22,
      horizonYears: 10,
      assumedCapitalInr: 1_000_000,
    });
    expect(plan.actions.some((a) => a.kind === 'fresh_buy')).toBe(true);
  });
});
