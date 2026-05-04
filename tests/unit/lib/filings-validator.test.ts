import { describe, expect, it } from 'vitest';

import {
  FilingTriageSchema,
  FilingTypeSchema,
  FilingsTriageBatch,
  isValidFilingTriage,
  isValidFilingType,
  normalizeFilingType,
  PatchFilingBody,
} from '@/lib/validation/filings';

describe('filings triage validator', () => {
  it('accepts each canonical triage value', () => {
    for (const v of ['read_now', 'skim', 'ignore'] as const) {
      expect(isValidFilingTriage(v)).toBe(true);
      expect(FilingTriageSchema.safeParse(v).success).toBe(true);
    }
  });

  it.each(['READ_NOW', 'urgent', '', null, undefined, 1, 'skim ', 'read'])(
    'rejects invalid triage value %p',
    (bad) => {
      expect(isValidFilingTriage(bad)).toBe(false);
      expect(FilingTriageSchema.safeParse(bad).success).toBe(false);
    },
  );

  it('accepts each canonical filing type', () => {
    for (const v of [
      'annual_report',
      'quarterly_results',
      'announcement',
      'investor_presentation',
      'other',
    ] as const) {
      expect(isValidFilingType(v)).toBe(true);
      expect(FilingTypeSchema.safeParse(v).success).toBe(true);
    }
  });

  it('normalizes loose filing-type strings to enum', () => {
    expect(normalizeFilingType('Annual Report')).toBe('annual_report');
    expect(normalizeFilingType('annual_report')).toBe('annual_report');
    expect(normalizeFilingType('Quarterly Results')).toBe('quarterly_results');
    expect(normalizeFilingType('Q1 results')).toBe('quarterly_results');
    expect(normalizeFilingType('Investor Presentation')).toBe('investor_presentation');
    expect(normalizeFilingType('press release')).toBe('announcement');
    expect(normalizeFilingType('disclosure')).toBe('other');
    expect(normalizeFilingType(null)).toBe('other');
    expect(normalizeFilingType(undefined)).toBe('other');
  });

  it('FilingsTriageBatch parses a minimal valid skill output', () => {
    const r = FilingsTriageBatch.safeParse({
      symbol: 'ACME-EQ',
      batch_id: 'batch-1',
      scanned_at: '2026-05-03T10:00:00Z',
      filings: [
        {
          url: 'https://example.com/ar.pdf',
          title: 'Annual Report FY25',
          type: 'annual_report',
          triage: 'read_now',
          summary_one_line: 'Revenue up 18% YoY',
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('FilingsTriageBatch rejects when filings entry is missing url/title', () => {
    const r = FilingsTriageBatch.safeParse({
      symbol: 'ACME',
      batch_id: 'b1',
      filings: [{ url: 'not-a-url', title: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('FilingsTriageBatch allows missing optional triage and accepts unknown type strings (handled by normalizer)', () => {
    const r = FilingsTriageBatch.safeParse({
      symbol: 'ACME',
      batch_id: 'b1',
      filings: [{ url: 'https://example.com/x', title: 'something', type: 'press release' }],
    });
    expect(r.success).toBe(true);
  });

  it('PatchFilingBody requires isRead', () => {
    expect(PatchFilingBody.safeParse({}).success).toBe(false);
    expect(PatchFilingBody.safeParse({ isRead: true }).success).toBe(true);
    expect(PatchFilingBody.safeParse({ isRead: false }).success).toBe(true);
    expect(PatchFilingBody.safeParse({ isRead: 'yes' }).success).toBe(false);
  });
});
