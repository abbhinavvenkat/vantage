import { describe, it, expect } from 'vitest';

import { synthesizeFromDistilled } from '@/lib/codex/synthesize';
import type { DistilledInvestor, DistilledEntry } from '@/lib/codex/distill';

function entry(id: string, statement: string, quote: string): DistilledEntry {
  return {
    id,
    statement,
    quote,
    source_url: 'https://example.com/letter',
    page_or_anchor: 'p-1',
    confidence: 'high',
    applicability_tags: ['all-markets'],
  };
}

function blankInvestor(slug: string, name: string): DistilledInvestor {
  return {
    investor_slug: slug,
    investor_name: name,
    version: '0.1.0',
    generated_at: '2026-05-03T00:00:00Z',
    principles: [],
    mental_models: [],
    valuation_methods: [],
    position_sizing_rules: [],
    buy_triggers: [],
    add_triggers: [],
    trim_triggers: [],
    exit_triggers: [],
    red_flags: [],
    case_studies: [],
  };
}

describe('synthesizeFromDistilled', () => {
  it('aggregates supporting investors per rule and bumps weight on convergence', () => {
    const buffett = blankInvestor('buffett', 'Warren Buffett');
    buffett.principles.push(
      entry(
        'buffett.principles.1',
        'Stay within your circle of competence.',
        'Only invest within your circle of competence — what you can truly understand.',
      ),
    );
    buffett.principles.push(
      entry(
        'buffett.principles.2',
        'Buy with margin of safety.',
        'A margin of safety is the bedrock of intelligent investing.',
      ),
    );

    const marks = blankInvestor('marks', 'Howard Marks');
    marks.principles.push(
      entry(
        'marks.principles.1',
        'Use second-level thinking; markets are about cycles.',
        'Second-level thinking is required to outperform; cycles always come around.',
      ),
    );
    marks.principles.push(
      entry(
        'marks.principles.2',
        'Buy with a margin of safety.',
        'Margin of safety is what separates investing from speculation.',
      ),
    );

    const lib = synthesizeFromDistilled([buffett, marks], '0.1.0');

    expect(lib.version).toBe('0.1.0');
    expect(lib.rules.length).toBeGreaterThan(0);

    const mos = lib.rules.find((r) => r.id === 'rule.universal.margin-of-safety');
    expect(mos).toBeDefined();
    expect(mos!.supporting_investors.map((s) => s.investor).sort()).toEqual(['buffett', 'marks']);
    expect(mos!.evidence_strength).toBe('moderate'); // 2 investors -> moderate
    expect(mos!.weight).toBeGreaterThan(0.5);
    expect(mos!.citations.length).toBeGreaterThanOrEqual(2);
  });
});
