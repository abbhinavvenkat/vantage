import { describe, expect, it, beforeEach } from 'vitest';

import { FACTORS, _resetCachesForTest, loadSectorTam } from '@/lib/compounder/factors';
import type { Fundamentals } from '@/lib/decisions/growthForecast';
import type { FiredRule } from '@/lib/decisions/score';

beforeEach(() => {
  _resetCachesForTest();
});

function fired(
  action: FiredRule['action'],
  weight: number,
  tags: string[],
): FiredRule & { tags: string[] } {
  return {
    ruleId: `r.${action}.${tags[0]}`,
    action,
    weight,
    baseWeight: weight,
    styleScale: 1,
    tags,
  };
}

const compounderFund: Fundamentals = {
  symbol: 'ACME',
  annual: {
    FY2020: {
      sales_cr: 100,
      ebitda_cr: 25,
      pat_cr: 15,
      roce_pct: 25,
      equity_bv_cr: 80,
      cfo_cr: 14,
      debt_to_equity: 0.1,
    },
    FY2021: {
      sales_cr: 120,
      ebitda_cr: 31,
      pat_cr: 19,
      roce_pct: 27,
      equity_bv_cr: 92,
      cfo_cr: 17,
      debt_to_equity: 0.1,
    },
    FY2022: {
      sales_cr: 145,
      ebitda_cr: 38,
      pat_cr: 23,
      roce_pct: 28,
      equity_bv_cr: 108,
      cfo_cr: 20,
      debt_to_equity: 0.1,
    },
    FY2023: {
      sales_cr: 173,
      ebitda_cr: 47,
      pat_cr: 29,
      roce_pct: 30,
      equity_bv_cr: 128,
      cfo_cr: 25,
      debt_to_equity: 0.05,
    },
    FY2024: {
      sales_cr: 207,
      ebitda_cr: 58,
      pat_cr: 36,
      roce_pct: 32,
      equity_bv_cr: 150,
      cfo_cr: 31,
      debt_to_equity: 0.05,
    },
    FY2025: {
      sales_cr: 248,
      ebitda_cr: 70,
      pat_cr: 45,
      roce_pct: 33,
      equity_bv_cr: 175,
      cfo_cr: 38,
      debt_to_equity: 0.05,
    },
  },
  current: { pe: 35, price: 1000, market_cap_cr: 27000 },
};

const brokenFund: Fundamentals = {
  symbol: 'BROKEN',
  annual: {
    FY2020: {
      sales_cr: 100,
      ebitda_cr: 8,
      pat_cr: 5,
      roce_pct: 7,
      equity_bv_cr: 80,
      cfo_cr: 1,
      debt_to_equity: 1.5,
    },
    FY2021: {
      sales_cr: 102,
      ebitda_cr: 7,
      pat_cr: 4,
      roce_pct: 6,
      equity_bv_cr: 95,
      cfo_cr: 0,
      debt_to_equity: 1.6,
    },
    FY2022: {
      sales_cr: 99,
      ebitda_cr: 5,
      pat_cr: 3,
      roce_pct: 5,
      equity_bv_cr: 110,
      cfo_cr: -2,
      debt_to_equity: 1.7,
    },
    FY2023: {
      sales_cr: 95,
      ebitda_cr: 3,
      pat_cr: 2,
      roce_pct: 4,
      equity_bv_cr: 125,
      cfo_cr: -3,
      debt_to_equity: 1.8,
    },
    FY2024: {
      sales_cr: 92,
      ebitda_cr: 2,
      pat_cr: 1,
      roce_pct: 3,
      equity_bv_cr: 140,
      cfo_cr: -5,
      debt_to_equity: 2.0,
    },
    FY2025: {
      sales_cr: 90,
      ebitda_cr: 1,
      pat_cr: 1,
      roce_pct: 2,
      equity_bv_cr: 155,
      cfo_cr: -6,
      debt_to_equity: 2.1,
    },
  },
  current: { pe: 80, price: 100 },
};

function getFactor(id: string) {
  const f = FACTORS.find((x) => x.id === id);
  if (!f) throw new Error(`factor ${id} not found`);
  return f;
}

describe('factor: tam', () => {
  it('passes for a large-TAM sector', () => {
    const v = getFactor('tam').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: null,
      firedRules: [],
    });
    expect(v.status).toBe('pass');
    expect(v.score).toBe(1.0);
  });
  it('fails for a saturated sector', () => {
    const v = getFactor('tam').evaluator({
      symbol: 'X',
      sector: 'Telecommunication',
      fundamentals: null,
      firedRules: [],
    });
    expect(v.status).toBe('fail');
  });
  it('returns unknown for an unmapped sector', () => {
    const v = getFactor('tam').evaluator({
      symbol: 'X',
      sector: 'Unmapped Sector',
      fundamentals: null,
      firedRules: [],
    });
    expect(v.status).toBe('unknown');
  });
});

describe('factor: execution', () => {
  it('passes for a 15%+ compounder', () => {
    const v = getFactor('execution').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    expect(v.status).toBe('pass');
  });
  it('fails for shrinking sales/PAT', () => {
    const v = getFactor('execution').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: brokenFund,
      firedRules: [],
    });
    expect(v.status).toBe('fail');
  });
  it('returns unknown when fundamentals missing', () => {
    const v = getFactor('execution').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: null,
      firedRules: [],
    });
    expect(v.status).toBe('unknown');
  });
});

describe('factor: roce', () => {
  it('passes when ROCE >= 18%', () => {
    const v = getFactor('roce').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    expect(v.status).toBe('pass');
  });
  it('fails when ROCE < 12%', () => {
    const v = getFactor('roce').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: brokenFund,
      firedRules: [],
    });
    expect(v.status).toBe('fail');
  });
  it('returns unknown when ROCE not reported (banks)', () => {
    const noRoce: Fundamentals = {
      symbol: 'BANK',
      annual: {
        FY2023: { sales_cr: 100, pat_cr: 20, roce_pct: null, equity_bv_cr: 50 },
        FY2024: { sales_cr: 110, pat_cr: 22, roce_pct: null, equity_bv_cr: 55 },
        FY2025: { sales_cr: 120, pat_cr: 24, roce_pct: null, equity_bv_cr: 60 },
      },
      current: {},
    };
    const v = getFactor('roce').evaluator({
      symbol: 'BANK',
      sector: 'Financial Services',
      fundamentals: noRoce,
      firedRules: [],
    });
    expect(v.status).toBe('unknown');
  });
});

describe('factor: moat', () => {
  it('passes when a quality/moat rule fired', () => {
    const v = getFactor('moat').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: null,
      firedRules: [fired('hold', 0.7, ['quality', 'compounder'])],
    });
    expect(v.status).toBe('pass');
  });
  it('partial when high EBITDA margin sustained', () => {
    const v = getFactor('moat').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    expect(v.status).toBe('partial');
  });
  it('unknown when no rule fired and margin low', () => {
    const v = getFactor('moat').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: brokenFund,
      firedRules: [],
    });
    expect(v.status).toBe('unknown');
  });
});

describe('factor: management', () => {
  it('fails when red-flag exit rule fired', () => {
    const v = getFactor('management').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [fired('exit', 0.8, ['red_flag', 'governance'])],
    });
    expect(v.status).toBe('fail');
  });
  it('partial when D/E low and no fired rule', () => {
    const v = getFactor('management').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    expect(v.status).toBe('partial');
  });
});

describe('factor: pricing_power', () => {
  it('passes when EBITDA margin expanded materially', () => {
    const v = getFactor('pricing_power').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    expect(v.status).toBe('pass');
  });
  it('fails when margin compressed', () => {
    const v = getFactor('pricing_power').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: brokenFund,
      firedRules: [],
    });
    expect(v.status).toBe('fail');
  });
});

describe('factor: reinvestment', () => {
  it('passes when PAT growth >= ROCE * 0.5', () => {
    const v = getFactor('reinvestment').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    // ACME: PAT CAGR ~24.5% over 5y; ROCE avg ~30% → target 15%. 24.5 >= 15 → pass.
    expect(v.status).toBe('pass');
  });
});

describe('factor: fcf_conversion', () => {
  it('passes when CFO/PAT >= 0.7 over 3y', () => {
    const v = getFactor('fcf_conversion').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    expect(v.status).toBe('pass');
  });
  it('returns unknown for negative CFO (financial leverage growth)', () => {
    const v = getFactor('fcf_conversion').evaluator({
      symbol: 'X',
      sector: 'Financial Services',
      fundamentals: brokenFund,
      firedRules: [],
    });
    expect(v.status).toBe('unknown');
  });
});

describe('factor: capital_alloc', () => {
  it('passes when PAT compounds as fast as book value', () => {
    const v = getFactor('capital_alloc').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [],
    });
    expect(v.status).toBe('pass');
  });
  it('fails when book value vastly outpaces earnings (dilution)', () => {
    const v = getFactor('capital_alloc').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: brokenFund,
      firedRules: [],
    });
    expect(v.status).toBe('fail');
  });
});

describe('factor: cyclicality', () => {
  it('passes for non-cyclical sector', () => {
    const v = getFactor('cyclicality').evaluator({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: null,
      firedRules: [],
    });
    expect(v.status).toBe('pass');
  });
  it('partial for soft-cyclical', () => {
    const v = getFactor('cyclicality').evaluator({
      symbol: 'X',
      sector: 'Auto Ancillary',
      fundamentals: null,
      firedRules: [],
    });
    expect(v.status).toBe('partial');
  });
  it('fails for hard-cyclical', () => {
    const v = getFactor('cyclicality').evaluator({
      symbol: 'X',
      sector: 'Realty',
      fundamentals: null,
      firedRules: [],
    });
    expect(v.status).toBe('fail');
  });
});

describe('FACTORS registry', () => {
  it('has exactly 12 factors', () => {
    expect(FACTORS.length).toBe(12);
  });
  it('weights sum to 1.0', () => {
    const s = FACTORS.reduce((a, f) => a + f.weight, 0);
    expect(s).toBeCloseTo(1.0, 3);
  });
  it('every factor has a citation', () => {
    for (const f of FACTORS) expect(f.citation).toMatch(/\.(md|json)/);
  });
});

describe('sector_tam ref loads', () => {
  it('loads with at least Software Services tier', () => {
    const ref = loadSectorTam();
    expect(ref.tiers['Software Services']?.tier).toBe('large');
  });
});
