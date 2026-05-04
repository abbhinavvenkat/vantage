import { describe, it, expect } from 'vitest';

import {
  STALWART_COMMENTARY,
  pickCommentary,
  type CommentaryEntry,
} from '@/lib/fundamentals/stalwartCommentary';
import { METRIC_IDS } from '@/lib/fundamentals/thresholds';

describe('STALWART_COMMENTARY registry', () => {
  it('covers every metric in METRIC_IDS', () => {
    for (const id of METRIC_IDS) {
      const entries = STALWART_COMMENTARY[id];
      expect(entries, `metric ${id} should have commentary`).toBeDefined();
      expect(entries.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every entry has a real quote, source URL, and intent', () => {
    const intents: CommentaryEntry['intent'][] = ['threshold_pass', 'threshold_fail', 'general'];
    for (const id of METRIC_IDS) {
      for (const e of STALWART_COMMENTARY[id]) {
        expect(e.quote.length).toBeGreaterThan(20);
        expect(e.quote).not.toMatch(/lorem|placeholder/i);
        expect(e.source_url).toMatch(/^https?:\/\//);
        expect(intents).toContain(e.intent);
        expect(e.investor.length).toBeGreaterThan(0);
      }
    }
  });

  it('total registry has at least 30 hand-curated entries', () => {
    const total = METRIC_IDS.reduce((s, id) => s + STALWART_COMMENTARY[id].length, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it('every metric has at least one threshold_pass and one threshold_fail entry', () => {
    for (const id of METRIC_IDS) {
      const entries = STALWART_COMMENTARY[id];
      expect(
        entries.some((e) => e.intent === 'threshold_pass'),
        `metric ${id} needs a threshold_pass quote`,
      ).toBe(true);
      expect(
        entries.some((e) => e.intent === 'threshold_fail'),
        `metric ${id} needs a threshold_fail quote`,
      ).toBe(true);
    }
  });
});

describe('pickCommentary', () => {
  it('returns a threshold_pass quote when verdict is green', () => {
    const r = pickCommentary('roce', 'green');
    expect(r).not.toBeNull();
    expect(r!.intent).toBe('threshold_pass');
  });

  it('returns a threshold_fail quote when verdict is red', () => {
    const r = pickCommentary('debt_to_equity', 'red');
    expect(r).not.toBeNull();
    expect(r!.intent).toBe('threshold_fail');
  });

  it('falls back to general or any quote when verdict is amber/unknown', () => {
    const r = pickCommentary('pe', 'amber');
    expect(r).not.toBeNull();
    expect(r!.quote.length).toBeGreaterThan(0);
    const u = pickCommentary('roe', 'unknown');
    // amber/unknown should still return SOMETHING so the table cell is never blank.
    expect(u).not.toBeNull();
  });
});
