import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { synthesizeFromCorpus, type CorpusInputs } from '@/lib/codex/synthesizeFromCorpus';

function profile(slug: string, name: string, body: string) {
  return `---\nslug: ${slug}\nname: ${name}\nstyle_tags: [quality, compounder]\nactive_period: "1980-present"\nprimary_geo: "India"\naum_or_track_record: "n/a"\nlast_updated: "2026-05-03"\n---\n\n# ${name}\n\n${body}\n`;
}

describe('synthesizeFromCorpus', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'corpus-syn-'));
    const stalwartsDir = join(tmp, 'stalwarts');
    mkdirSync(stalwartsDir, { recursive: true });

    writeFileSync(
      join(stalwartsDir, 'buffett.md'),
      profile(
        'buffett',
        'Warren Buffett',
        [
          '## Snapshot\nPatient compounder.',
          '## Core Principles\n- Quality over cheapness — wonderful business at fair price. [(2023 letter)](https://example.com/buf-23)',
          '## Buy Triggers\n- Durable moat at fair valuation. [(2023 letter)](https://example.com/buf-23)\n- ROCE > 15% sustained.',
          '## Add Triggers\n- Drawdown of 20% on a quality compounder while thesis intact.',
          '## Trim / Exit Triggers\n- Thesis broken or management quality deteriorates.',
          '## Red Flags / Avoid List\n- Promoter pledge or auditor resignation. [(2024 letter)](https://example.com/buf-24)',
          '## Valuation Approach\n- DCF / owner earnings; max P/E ~30 for compounders.',
        ].join('\n\n'),
      ),
    );
    writeFileSync(
      join(stalwartsDir, 'agrawal.md'),
      profile(
        'agrawal',
        'Raamdeo Agrawal',
        [
          '## Snapshot\nQGLP framework.',
          '## Core Principles\n- QGLP non-negotiable; ROCE > 15% with PAT growth >= 15%.',
          '## Buy Triggers\n- PEG < 1; quality compounder at fair price; ROCE > 15%.',
          '## Add Triggers\n- Bruised Blue Chip 50% below 5-year high; thesis intact.',
          '## Trim / Exit Triggers\n- ROCE structurally below 12% for 3+ years.',
          '## Red Flags / Avoid List\n- Promoter pledge above 20%; related-party transactions; high leverage.',
        ].join('\n\n'),
      ),
    );
    writeFileSync(
      join(stalwartsDir, 'marks.md'),
      profile(
        'marks',
        'Howard Marks',
        [
          '## Snapshot\nCycles and second-level thinking.',
          '## Core Principles\n- Cycles are inevitable; volatility is not risk; permanent loss is risk.',
          '## Buy Triggers\n- Buy at maximum pessimism, drawdown beyond 40%, cycle trough.',
          '## Trim / Exit Triggers\n- Trim or sell at extreme overvaluation; froth and bubble signs.',
        ].join('\n\n'),
      ),
    );

    const consensus = `# Consensus\n\n## 1. The Convergent Core\n\n### 1.1 Management Integrity\nInvestors in full agreement (20+): Buffett, Agrawal, Marks, Mukherjea\n\n### 1.4 ROIC / ROCE Above Cost of Capital\nInvestors in full agreement (20+): Buffett, Agrawal, Marks\n\n## 5. The Universal Red Flags\n| Red Flag | Cited By | India Relevance |\n| Promoter pledge | Buffett, Agrawal, Marks | High |\n| Related-party transactions | Agrawal, Marks | High |\n\n## 6. The Universal Buy Signals\n| ROCE > 15% sustained | Buffett, Agrawal, Marks | gate |\n| Drawdown of 20-30% in quality | Buffett, Agrawal, Marks | tactical |\n`;
    writeFileSync(join(tmp, 'consensus.md'), consensus, 'utf-8');

    const summary = {
      run_at: '2026-05-03T00:00:00Z',
      decision_dates: ['2016-01-04', '2020-01-02', '2023-01-02', '2026-05-03'],
      frameworks: {
        agrawal: { xirr: 0.156, benchmark_vs_nifty50_xirr_delta: 0.038 },
        greenblatt: { xirr: 0.226, benchmark_vs_nifty50_xirr_delta: 0.107 },
        lynch: { xirr: 0.21, benchmark_vs_nifty50_xirr_delta: 0.091 },
      },
    };
    writeFileSync(join(tmp, 'summary.json'), JSON.stringify(summary), 'utf-8');
  });

  function buildInputs(): CorpusInputs {
    return {
      stalwartsRoot: join(tmp, 'stalwarts'),
      consensusPath: join(tmp, 'consensus.md'),
      backtestSummaryPath: join(tmp, 'summary.json'),
    };
  }

  it('emits a versioned library with rules across action types', () => {
    const lib = synthesizeFromCorpus(buildInputs(), '0.2.0');
    expect(lib.version).toBe('0.2.0');
    expect(lib.rules.length).toBeGreaterThanOrEqual(4);
    const actions = new Set(lib.rules.map((r) => r.action));
    expect(actions.has('fresh_buy') || actions.has('add')).toBe(true);
    expect(actions.has('exit')).toBe(true);
  });

  it('weights consensus + backtest, supporting investors are aggregated', () => {
    const lib = synthesizeFromCorpus(buildInputs(), '0.2.0');
    // The "promoter pledge" red-flag rule should have all 3 investors
    const pledge = lib.rules.find(
      (r) => r.action === 'exit' && /pledge|leverage/i.test(r.statement),
    );
    expect(pledge).toBeTruthy();
    expect(pledge!.supporting_investors.length).toBeGreaterThanOrEqual(2);
    expect(pledge!.weight).toBeGreaterThan(0);
    expect(pledge!.weight).toBeLessThanOrEqual(1);
  });

  it('emits a _meta block with stats', () => {
    const lib = synthesizeFromCorpus(buildInputs(), '0.2.0');
    expect(lib._meta).toBeDefined();
    expect(lib._meta!.investors_processed).toBeGreaterThanOrEqual(3);
    expect(lib._meta!.rules_by_action).toBeDefined();
    expect(Array.isArray(lib._meta!.top_rules_by_weight)).toBe(true);
  });
});
