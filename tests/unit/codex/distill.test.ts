import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { distillInvestor, totalEntries } from '@/lib/codex/distill';

let workDir: string;

const FIXTURE_MD = `---
title: "Fixture letter"
source_url: https://example.com/letters/fixture
kind: annual_letter
year: 2024
---

<a id="p-1"></a>

We never invest outside our circle of competence — only buy what you understand. This is the most important lesson we have learned across decades of investing.

<a id="p-2"></a>

Our valuation framework is anchored in discounted cash flow and owner earnings, not relative multiples. Intrinsic value is what we measure against.

<a id="p-3"></a>

We bought Coca-Cola in 1988 because we understood the moat — the durable competitive advantage of an iconic global brand and distribution.

<a id="p-4"></a>

When promoter pledge rises sharply, that is a red flag we never ignore. Auditor resignation is another accounting red flag we will exit on.
`;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'codex-distill-'));
  const slugDir = join(workDir, 'fixture-investor');
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(join(slugDir, 'letter1.md'), FIXTURE_MD, 'utf-8');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('distillInvestor', () => {
  it('produces a JSON shape matching codex-rule-schema', () => {
    const d = distillInvestor('fixture-investor', 'Fixture Investor', workDir);

    expect(d.investor_slug).toBe('fixture-investor');
    expect(d.investor_name).toBe('Fixture Investor');
    expect(d.version).toBe('0.1.0');
    expect(typeof d.generated_at).toBe('string');

    // Each bucket exists and is an array.
    for (const k of [
      'principles',
      'mental_models',
      'valuation_methods',
      'position_sizing_rules',
      'buy_triggers',
      'add_triggers',
      'trim_triggers',
      'exit_triggers',
      'red_flags',
      'case_studies',
    ] as const) {
      expect(Array.isArray(d[k])).toBe(true);
    }

    // Circle-of-competence + intrinsic value should land somewhere.
    expect(totalEntries(d)).toBeGreaterThan(0);

    // Every entry must have source_url + quote + page_or_anchor citations.
    for (const e of d.principles) {
      expect(e.source_url).toMatch(/^https?:\/\//);
      expect(e.quote.length).toBeGreaterThan(0);
      expect(e.page_or_anchor).toMatch(/^p-\d+$/);
    }
    // Red flag should have caught promoter pledge / auditor.
    expect(d.red_flags.length).toBeGreaterThan(0);
    // Coca-Cola case study should land.
    expect(d.case_studies.some((c) => /coca/i.test(c.company))).toBe(true);
  });
});
