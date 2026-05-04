import { describe, it, expect } from 'vitest';
import { computeHHI, dailyReturns, beta, portfolioBeta } from '@/lib/analytics/risk';

describe('computeHHI', () => {
  it('returns 1 for a single-position (100%) portfolio', () => {
    expect(computeHHI([1])).toBeCloseTo(1, 6);
  });

  it('returns 0.5 for two equal-weight positions', () => {
    expect(computeHHI([0.5, 0.5])).toBeCloseTo(0.5, 6);
  });

  it('returns 1/n for n equal-weight positions', () => {
    const w = [0.25, 0.25, 0.25, 0.25];
    expect(computeHHI(w)).toBeCloseTo(0.25, 6);
  });

  it('matches a hand-computed sum of squares', () => {
    // 0.6^2 + 0.3^2 + 0.1^2 = 0.36 + 0.09 + 0.01 = 0.46
    expect(computeHHI([0.6, 0.3, 0.1])).toBeCloseTo(0.46, 6);
  });

  it('returns 0 for an empty input', () => {
    expect(computeHHI([])).toBe(0);
  });
});

describe('dailyReturns', () => {
  it('computes simple returns P_t/P_{t-1} - 1', () => {
    const r = dailyReturns([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 6);
    expect(r[1]).toBeCloseTo(-0.1, 6);
  });

  it('returns empty for fewer than 2 points', () => {
    expect(dailyReturns([100])).toEqual([]);
    expect(dailyReturns([])).toEqual([]);
  });
});

describe('beta', () => {
  it('returns 1.0 for a perfectly correlated symbol equal to nifty', () => {
    // 80 paired daily closes, identical series.
    const nifty: number[] = [];
    let v = 1000;
    for (let i = 0; i < 80; i++) {
      v = v * (1 + (i % 5 === 0 ? 0.01 : -0.005));
      nifty.push(v);
    }
    const sym = [...nifty];
    expect(beta(sym, nifty)).toBeCloseTo(1, 6);
  });

  it('returns ~2.0 when the symbol is twice the nifty return each day', () => {
    const nifty: number[] = [1000];
    const sym: number[] = [1000];
    for (let i = 1; i < 80; i++) {
      const rNifty = i % 5 === 0 ? 0.01 : -0.005;
      const prevN = nifty[i - 1]!;
      const prevS = sym[i - 1]!;
      nifty.push(prevN * (1 + rNifty));
      sym.push(prevS * (1 + 2 * rNifty));
    }
    const b = beta(sym, nifty);
    expect(b).not.toBeNull();
    expect(b!).toBeCloseTo(2, 4);
  });

  it('returns ~0 for an uncorrelated (orthogonal-shaped) symbol', () => {
    // Nifty oscillates +/-1% on a 4-day cycle; symbol is flat (zero daily returns).
    const nifty: number[] = [1000];
    const sym: number[] = [1000];
    for (let i = 1; i < 80; i++) {
      const rNifty = i % 4 < 2 ? 0.01 : -0.01;
      nifty.push(nifty[i - 1]! * (1 + rNifty));
      sym.push(1000); // no movement → zero variance, zero covariance
    }
    const b = beta(sym, nifty);
    // sym has zero variance → cov(sym,nifty)=0 → beta=0
    expect(b).toBeCloseTo(0, 6);
  });

  it('returns null when fewer than 60 paired observations are available', () => {
    const arr = Array.from({ length: 40 }, (_, i) => 1000 + i);
    expect(beta(arr, arr)).toBeNull();
  });

  it('returns null when nifty has zero variance (degenerate)', () => {
    const flat = Array.from({ length: 80 }, () => 1000);
    const sym = Array.from({ length: 80 }, (_, i) => 1000 + i);
    expect(beta(sym, flat)).toBeNull();
  });
});

describe('portfolioBeta', () => {
  it('returns weighted average of per-symbol betas', () => {
    // 50% weight beta=1, 50% weight beta=2 → 1.5
    const positions = [
      { symbol: 'A', marketValue: 100 },
      { symbol: 'B', marketValue: 100 },
    ];
    const betas = new Map<string, number | null>([
      ['A', 1],
      ['B', 2],
    ]);
    expect(portfolioBeta(positions, betas)).toBeCloseTo(1.5, 6);
  });

  it('renormalises after dropping null-beta symbols', () => {
    // C has no beta — drop it. Remaining: 100+100 = 200 → A=0.5, B=0.5 → beta = 1.5
    const positions = [
      { symbol: 'A', marketValue: 100 },
      { symbol: 'B', marketValue: 100 },
      { symbol: 'C', marketValue: 200 },
    ];
    const betas = new Map<string, number | null>([
      ['A', 1],
      ['B', 2],
      ['C', null],
    ]);
    expect(portfolioBeta(positions, betas)).toBeCloseTo(1.5, 6);
  });

  it('returns null when every symbol has null beta', () => {
    const positions = [{ symbol: 'A', marketValue: 100 }];
    const betas = new Map<string, number | null>([['A', null]]);
    expect(portfolioBeta(positions, betas)).toBeNull();
  });

  it('returns null when total covered marketValue is zero', () => {
    expect(portfolioBeta([], new Map())).toBeNull();
  });
});
