import { describe, expect, it } from 'vitest';

import {
  CONVICTIONS,
  ConvictionSchema,
  CreateWatchlistBody,
  isValidConviction,
} from '@/lib/validation/watchlist';

describe('conviction validator', () => {
  it('exports the canonical set of values', () => {
    expect(CONVICTIONS).toEqual(['high', 'medium', 'low']);
  });

  it('accepts each canonical value', () => {
    for (const v of CONVICTIONS) {
      expect(isValidConviction(v)).toBe(true);
      expect(ConvictionSchema.safeParse(v).success).toBe(true);
    }
  });

  it.each(['HIGH', 'Medium', 'urgent', '', null, undefined, 1, 'lo'])(
    'rejects invalid value %p',
    (bad) => {
      expect(isValidConviction(bad)).toBe(false);
      expect(ConvictionSchema.safeParse(bad).success).toBe(false);
    },
  );

  it('CreateWatchlistBody defaults conviction to undefined when omitted', () => {
    const r = CreateWatchlistBody.safeParse({ symbol: 'ACME' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.conviction).toBeUndefined();
      expect(r.data.symbol).toBe('ACME');
    }
  });

  it('CreateWatchlistBody rejects invalid conviction', () => {
    const r = CreateWatchlistBody.safeParse({ symbol: 'ACME', conviction: 'urgent' });
    expect(r.success).toBe(false);
  });

  it('CreateWatchlistBody uppercases and trims symbol', () => {
    const r = CreateWatchlistBody.safeParse({ symbol: '  acme-eq  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.symbol).toBe('ACME-EQ');
  });
});
