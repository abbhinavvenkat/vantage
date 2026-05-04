import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ARSummarySchema,
  ManagementAccountabilitySchema,
  ManifestSchema,
  buildSkillInvocation,
  loadARSummaries,
  loadConcallDigests,
  loadLatestFilingsTriage,
  loadLatestManagementAccountability,
  loadManifest,
  loadSymbolResearch,
  suggestNextFQ,
  suggestNextFY,
} from '@/lib/research/loadOutputs';

let root: string;

beforeAll(() => {
  root = mkdtempSync(resolve(tmpdir(), 'stock-platform-research-'));

  // Manifest for ACME
  mkdirSync(resolve(root, 'sources/ACME-EQ'), { recursive: true });
  writeFileSync(
    resolve(root, 'sources/ACME-EQ/manifest.json'),
    JSON.stringify({
      symbol: 'ACME-EQ',
      isin: 'INE000A01001',
      fetched_at: '2026-04-01T00:00:00Z',
      sources: [
        {
          type: 'annual_report',
          fy: 'FY25',
          title: 'Annual Report FY25',
          url: 'https://example.com/ar25.pdf',
          source: 'ir',
          local_path: 'data/sources/ACME-EQ/ar25.pdf',
        },
        {
          type: 'concall_transcript',
          fq: 'Q3-FY26',
          title: 'Q3 FY26 Earnings Call',
          url: 'https://example.com/q3.txt',
        },
      ],
      warnings: [{ url: 'https://x.com', reason: '404' }],
    }),
  );

  // AR summaries (two years)
  mkdirSync(resolve(root, 'research/ACME-EQ/annual-report-summarize'), { recursive: true });
  writeFileSync(
    resolve(root, 'research/ACME-EQ/annual-report-summarize/FY24.json'),
    JSON.stringify({
      symbol: 'ACME-EQ',
      fy: 'FY24',
      generated_at: '2025-06-01T00:00:00Z',
      business_model_md: 'Sells widgets.',
      red_flags: ['related party txns'],
      key_numbers: { revenue: 1000, ebitda_margin: 0.22 },
      checklist_results: [{ item: 'ROCE>15%', pass: true, evidence: '...' }],
    }),
  );
  writeFileSync(
    resolve(root, 'research/ACME-EQ/annual-report-summarize/FY25.json'),
    JSON.stringify({
      symbol: 'ACME-EQ',
      fy: 'FY25',
      generated_at: '2026-04-15T00:00:00Z',
      business_model_md: 'Sells widgets, expands gizmos.',
      key_numbers: { revenue: 1200 },
    }),
  );
  // malformed - should be filtered out
  writeFileSync(
    resolve(root, 'research/ACME-EQ/annual-report-summarize/garbage.json'),
    '{not json',
  );

  // Concall digests (two)
  mkdirSync(resolve(root, 'research/ACME-EQ/earnings-call-digest'), { recursive: true });
  writeFileSync(
    resolve(root, 'research/ACME-EQ/earnings-call-digest/Q2-FY26.json'),
    JSON.stringify({
      symbol: 'ACME-EQ',
      fq: 'Q2-FY26',
      guidance: { revenue_growth_yoy: 0.18, qualitative: 'cautious' },
      kpi_deltas: [{ kpi: 'order_book', value: '500cr', delta: '+10%' }],
    }),
  );
  writeFileSync(
    resolve(root, 'research/ACME-EQ/earnings-call-digest/Q3-FY26.json'),
    JSON.stringify({
      symbol: 'ACME-EQ',
      fq: 'Q3-FY26',
      guidance: { revenue_growth_yoy: 0.2 },
    }),
  );

  // Filings triage - two batches; assert newest wins
  mkdirSync(resolve(root, 'research/ACME-EQ/filings-triage'), { recursive: true });
  const oldPath = resolve(root, 'research/ACME-EQ/filings-triage/old.json');
  writeFileSync(
    oldPath,
    JSON.stringify({
      symbol: 'ACME-EQ',
      batch_id: 'old',
      scanned_at: '2026-01-01T00:00:00Z',
      filings: [
        {
          url: 'https://x.com/a',
          title: 'Old',
          triage: 'skim',
        },
      ],
    }),
  );
  // make old genuinely older
  const past = new Date(Date.now() - 1000 * 60 * 60).getTime() / 1000;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').utimesSync(oldPath, past, past);

  writeFileSync(
    resolve(root, 'research/ACME-EQ/filings-triage/new.json'),
    JSON.stringify({
      symbol: 'ACME-EQ',
      batch_id: 'new',
      scanned_at: '2026-04-30T00:00:00Z',
      filings: [
        {
          url: 'https://x.com/b',
          title: 'New filing',
          triage: 'read_now',
          summary_one_line: 'Big news',
        },
      ],
    }),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadOutputs - schemas', () => {
  it('ManagementAccountabilitySchema validates a complete object', () => {
    const ok = ManagementAccountabilitySchema.safeParse({
      symbol: 'ACME-EQ',
      generated_at: '2026-05-04T10:00:00.000Z',
      quarters: [
        {
          fq: 'Q3-FY26',
          guidance_vs_actuals: [
            { item: 'Revenue growth', prev_guidance: '18%', actual: '16%', verdict: 'missed' },
          ],
          drift_signals: ['Tone softened'],
          tone_delta: -1,
          verdict: 'partial',
        },
      ],
      consistency_score: 0.5,
      red_flags: ['Consecutive misses'],
      thesis_impact_md: 'Thesis weakened.',
    });
    expect(ok.success).toBe(true);
  });

  it('ManagementAccountabilitySchema rejects invalid verdict', () => {
    const bad = ManagementAccountabilitySchema.safeParse({
      symbol: 'X',
      generated_at: '2026-05-04T10:00:00.000Z',
      quarters: [{ fq: 'Q1-FY26', verdict: 'unknown', consistency_score: 0.5 }],
      consistency_score: 1.5,
    });
    expect(bad.success).toBe(false);
  });

  it('Manifest schema rejects missing required fields', () => {
    const bad = ManifestSchema.safeParse({ symbol: 'X', sources: [] });
    expect(bad.success).toBe(false);
  });

  it('Manifest schema accepts a complete object', () => {
    const ok = ManifestSchema.safeParse({
      symbol: 'X',
      fetched_at: '2026-01-01T00:00:00Z',
      sources: [],
    });
    expect(ok.success).toBe(true);
  });

  it('AR summary defaults arrays / strings', () => {
    const ok = ARSummarySchema.safeParse({
      symbol: 'X',
      fy: 'FY25',
      generated_at: '2026-01-01T00:00:00Z',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.red_flags).toEqual([]);
      expect(ok.data.business_model_md).toBe('');
    }
  });
});

describe('loadOutputs - filesystem readers', () => {
  it('loads manifest', () => {
    const m = loadManifest('ACME-EQ', root);
    expect(m).not.toBeNull();
    expect(m!.symbol).toBe('ACME-EQ');
    expect(m!.sources).toHaveLength(2);
    expect(m!.warnings).toHaveLength(1);
  });

  it('returns null when no manifest', () => {
    expect(loadManifest('NOPE-EQ', root)).toBeNull();
  });

  it('loads AR summaries newest-FY first, ignores garbage', () => {
    const ar = loadARSummaries('ACME-EQ', root);
    expect(ar.map((a) => a.fy)).toEqual(['FY25', 'FY24']);
  });

  it('loads concall digests newest-FQ first', () => {
    const digests = loadConcallDigests('ACME-EQ', root);
    expect(digests.map((d) => d.fq)).toEqual(['Q3-FY26', 'Q2-FY26']);
  });

  it('loads newest filings triage', () => {
    const triage = loadLatestFilingsTriage('ACME-EQ', root);
    expect(triage).not.toBeNull();
    expect(triage!.batch_id).toBe('new');
    expect(triage!.filings[0]?.triage).toBe('read_now');
  });

  it('loadSymbolResearch returns full bundle including managementAccountability', () => {
    const b = loadSymbolResearch('ACME-EQ', root);
    expect(b.manifest).not.toBeNull();
    expect(b.arSummaries).toHaveLength(2);
    expect(b.concallDigests).toHaveLength(2);
    expect(b.filingsTriage).not.toBeNull();
    // no accountability file written yet → null
    expect(b.managementAccountability).toBeNull();
  });

  it('loadLatestManagementAccountability returns null when no file', () => {
    expect(loadLatestManagementAccountability('NOPE-EQ', root)).toBeNull();
  });

  it('loads latest management accountability file', () => {
    const payload = {
      symbol: 'ACME-EQ',
      generated_at: '2026-05-04T10:00:00.000Z',
      quarters: [
        {
          fq: 'Q3-FY26',
          guidance_vs_actuals: [
            { item: 'Revenue growth', prev_guidance: '18%', actual: '16%', verdict: 'missed' },
          ],
          drift_signals: ['Removed mention of large deal wins'],
          tone_delta: -1,
          verdict: 'partial',
        },
      ],
      consistency_score: 0.5,
      red_flags: ['Two consecutive misses'],
      thesis_impact_md: 'Thesis weakened.',
    };
    mkdirSync(resolve(root, 'research/ACME-EQ/management-accountability'), { recursive: true });
    writeFileSync(
      resolve(root, 'research/ACME-EQ/management-accountability/2026-05-04T10-00-00.json'),
      JSON.stringify(payload),
    );

    const result = loadLatestManagementAccountability('ACME-EQ', root);
    expect(result).not.toBeNull();
    expect(result!.consistency_score).toBe(0.5);
    expect(result!.quarters).toHaveLength(1);
    expect(result!.quarters[0]!.verdict).toBe('partial');
    expect(result!.red_flags).toEqual(['Two consecutive misses']);
  });
});

describe('skill invocation helpers', () => {
  it('builds invocation string', () => {
    expect(buildSkillInvocation('company-research-fetch', { symbol: 'BEL' })).toBe(
      '/company-research-fetch symbol=BEL',
    );
  });

  it('suggestNextFY increments by one', () => {
    expect(suggestNextFY([])).toBe('FY25');
    expect(
      suggestNextFY([
        {
          symbol: 'X',
          fy: 'FY25',
          generated_at: '',
          business_model_md: '',
          revenue_mix: [],
          growth_drivers_md: '',
          risks_md: '',
          capital_allocation_md: '',
          management_quality_md: '',
          red_flags: [],
          key_numbers: {},
          checklist_results: [],
        },
      ]),
    ).toBe('FY26');
  });

  it('suggestNextFQ rolls Q4 to Q1 next FY', () => {
    expect(suggestNextFQ([])).toBe('Q1-FY26');
    expect(
      suggestNextFQ([
        {
          symbol: 'X',
          fq: 'Q3-FY26',
          guidance: {},
          kpi_deltas: [],
          analyst_question_themes: [],
          management_tone: {},
          thesis_impact_md: '',
        },
      ]),
    ).toBe('Q4-FY26');
    expect(
      suggestNextFQ([
        {
          symbol: 'X',
          fq: 'Q4-FY26',
          guidance: {},
          kpi_deltas: [],
          analyst_question_themes: [],
          management_tone: {},
          thesis_impact_md: '',
        },
      ]),
    ).toBe('Q1-FY27');
  });
});
