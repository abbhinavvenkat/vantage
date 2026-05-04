import { describe, expect, it } from 'vitest';

import { IdeaCandidateSchema, IdeaGenerateFile } from '@/lib/validation/ideaGenerate';

describe('IdeaCandidateSchema', () => {
  it('uppercases symbol and accepts a fully-formed candidate', () => {
    const out = IdeaCandidateSchema.parse({
      symbol: 'hindunilvr',
      name: 'Hindustan Unilever',
      thesis_md: 'FMCG compounding leader; rural revival ahead.',
      key_ratios: { pe: 52, roce: 0.78, div_yield: 0.018 },
      entry_zones: { fair: 2400, strong_buy: 2150 },
      conviction: 'high',
      risk: 'low',
      matching_codex_rules: ['rule.fmcg.rural-revival-buy'],
    });
    expect(out.symbol).toBe('HINDUNILVR');
    expect(out.conviction).toBe('high');
    expect(out.matching_codex_rules).toEqual(['rule.fmcg.rural-revival-buy']);
  });

  it('defaults matching_codex_rules and entry_zones when omitted', () => {
    const out = IdeaCandidateSchema.parse({
      symbol: 'ACME-EQ',
      name: 'Acme',
      thesis_md: 'thesis',
      conviction: 'medium',
      risk: 'medium',
    });
    expect(out.matching_codex_rules).toEqual([]);
  });
});

describe('IdeaGenerateFile (invalid edge cases)', () => {
  it('rejects when portfolio_id is missing', () => {
    const r = IdeaGenerateFile.safeParse({
      run_at: '2026-05-03T00:00:00Z',
      gaps_identified: [],
      candidates: [
        {
          symbol: 'ACME',
          name: 'Acme',
          thesis_md: 't',
          conviction: 'low',
          risk: 'low',
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects when conviction is outside the enum', () => {
    const r = IdeaGenerateFile.safeParse({
      portfolio_id: 'pf-1',
      run_at: '2026-05-03T00:00:00Z',
      candidates: [
        {
          symbol: 'ACME',
          name: 'Acme',
          thesis_md: 't',
          conviction: 'maybe',
          risk: 'low',
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects when candidates array is empty', () => {
    const r = IdeaGenerateFile.safeParse({
      portfolio_id: 'pf-1',
      run_at: '2026-05-03T00:00:00Z',
      candidates: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects when symbol fails the safe-symbol regex', () => {
    const r = IdeaGenerateFile.safeParse({
      portfolio_id: 'pf-1',
      run_at: '2026-05-03T00:00:00Z',
      candidates: [
        {
          symbol: '../etc/passwd',
          name: 'evil',
          thesis_md: 't',
          conviction: 'high',
          risk: 'low',
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});
