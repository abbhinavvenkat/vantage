import { describe, it, expect } from 'vitest';

import {
  classifyMetric,
  METRIC_IDS,
  METRIC_THRESHOLDS,
  type MetricId,
  type Verdict,
} from '@/lib/fundamentals/thresholds';

describe('classifyMetric', () => {
  it('returns "unknown" when value is null/undefined/NaN', () => {
    expect(classifyMetric('roce', null).verdict).toBe('unknown');
    expect(classifyMetric('roce', undefined).verdict).toBe('unknown');
    expect(classifyMetric('roce', Number.NaN).verdict).toBe('unknown');
  });

  it('classifies ROCE >= 18% as green, 12-18% as amber, < 12% as red', () => {
    expect(classifyMetric('roce', 25).verdict).toBe('green');
    expect(classifyMetric('roce', 18).verdict).toBe('green');
    expect(classifyMetric('roce', 15).verdict).toBe('amber');
    expect(classifyMetric('roce', 12).verdict).toBe('amber');
    expect(classifyMetric('roce', 8).verdict).toBe('red');
  });

  it('classifies ROE >= 15% as green, 10-15% as amber, < 10% as red', () => {
    expect(classifyMetric('roe', 22).verdict).toBe('green');
    expect(classifyMetric('roe', 12).verdict).toBe('amber');
    expect(classifyMetric('roe', 5).verdict).toBe('red');
  });

  it('classifies revenue and PAT growth bands correctly', () => {
    // 5y CAGR thresholds: green >= 0.10, amber 0.05-0.10, red < 0.05.
    expect(classifyMetric('revenue', 0.18).verdict).toBe('green');
    expect(classifyMetric('revenue', 0.07).verdict).toBe('amber');
    expect(classifyMetric('revenue', 0.02).verdict).toBe('red');
    expect(classifyMetric('pat', 0.2).verdict).toBe('green');
    expect(classifyMetric('pat', -0.05).verdict).toBe('red');
  });

  it('classifies Debt/Equity as inverse: low is green', () => {
    expect(classifyMetric('debt_to_equity', 0.1).verdict).toBe('green');
    expect(classifyMetric('debt_to_equity', 0.5).verdict).toBe('green');
    expect(classifyMetric('debt_to_equity', 1.0).verdict).toBe('amber');
    expect(classifyMetric('debt_to_equity', 2.5).verdict).toBe('red');
  });

  it('classifies FCF/PAT: green >= 0.7, amber 0.4-0.7, red < 0.4', () => {
    expect(classifyMetric('fcf_to_pat', 0.9).verdict).toBe('green');
    expect(classifyMetric('fcf_to_pat', 0.5).verdict).toBe('amber');
    expect(classifyMetric('fcf_to_pat', 0.2).verdict).toBe('red');
  });

  it('classifies P/E inversely: cheap is green, very expensive is red', () => {
    // Defaults: green <= 22, amber 22-35, red > 35.
    expect(classifyMetric('pe', 18).verdict).toBe('green');
    expect(classifyMetric('pe', 30).verdict).toBe('amber');
    expect(classifyMetric('pe', 60).verdict).toBe('red');
  });

  it('classifies P/B: green <= 3, amber 3-6, red > 6', () => {
    expect(classifyMetric('pb', 1.5).verdict).toBe('green');
    expect(classifyMetric('pb', 4.0).verdict).toBe('amber');
    expect(classifyMetric('pb', 10).verdict).toBe('red');
  });

  it('classifies dividend yield as informational; >= 1.5% green, 0.5-1.5% amber, <0.5% red', () => {
    // Dividend yield is mildly value-positive in this scheme.
    expect(classifyMetric('dividend_yield', 0.025).verdict).toBe('green');
    expect(classifyMetric('dividend_yield', 0.01).verdict).toBe('amber');
    expect(classifyMetric('dividend_yield', 0.001).verdict).toBe('red');
  });

  it('classifies EBITDA margin: green >= 0.20, amber 0.10-0.20, red < 0.10', () => {
    expect(classifyMetric('ebitda_margin', 0.3).verdict).toBe('green');
    expect(classifyMetric('ebitda_margin', 0.15).verdict).toBe('amber');
    expect(classifyMetric('ebitda_margin', 0.05).verdict).toBe('red');
  });

  it('returns a numeric value back so the UI can render it', () => {
    const r = classifyMetric('roce', 25);
    expect(r.verdict).toBe('green');
    expect(r.value).toBe(25);
  });

  it('exposes a metric registry covering all 10 published metrics', () => {
    const expected: MetricId[] = [
      'revenue',
      'pat',
      'roce',
      'roe',
      'ebitda_margin',
      'debt_to_equity',
      'fcf_to_pat',
      'pe',
      'pb',
      'dividend_yield',
    ];
    expect(METRIC_IDS).toEqual(expected);
    for (const id of expected) {
      expect(METRIC_THRESHOLDS[id]).toBeDefined();
      expect(METRIC_THRESHOLDS[id].label).toBeTruthy();
      expect(typeof METRIC_THRESHOLDS[id].direction).toBe('string');
    }
  });

  it('every Verdict is one of the expected union members', () => {
    const allowed: Verdict[] = ['green', 'amber', 'red', 'unknown'];
    for (const id of METRIC_IDS) {
      const r = classifyMetric(id, 10);
      expect(allowed).toContain(r.verdict);
    }
  });
});
