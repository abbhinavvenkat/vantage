import { describe, it, expect } from 'vitest';

import { slugify } from '@/components/ui/Section';

describe('Section.slugify', () => {
  it('lower-cases and dasherises plain titles', () => {
    expect(slugify('Snapshot')).toBe('snapshot');
    expect(slugify('Position context')).toBe('position-context');
  });

  it('collapses runs of non-alphanumerics into a single dash', () => {
    expect(slugify('Vs Nifty 50')).toBe('vs-nifty-50');
    expect(slugify('Fundamentals + Stalwart Commentary')).toBe('fundamentals-stalwart-commentary');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('--hello--')).toBe('hello');
    expect(slugify('  Trade history  ')).toBe('trade-history');
  });

  it('handles roman / unicode-ish input safely', () => {
    expect(slugify('I. Snapshot')).toBe('i-snapshot');
  });
});
