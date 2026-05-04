import { describe, expect, it } from 'vitest';

import { fmtInr, fmtPct, fmtSignedInr, lastDayOfMonth } from '@/lib/pdf/format';

describe('pdf/format', () => {
  describe('fmtInr', () => {
    it('formats Cr', () => {
      expect(fmtInr(2_50_00_000)).toBe('Rs 2.50Cr');
    });
    it('formats Lakh', () => {
      expect(fmtInr(1_50_000)).toBe('Rs 1.50L');
    });
    it('formats raw rupees below 1L', () => {
      expect(fmtInr(12_345)).toBe('Rs 12,345');
    });
    it('handles negatives', () => {
      expect(fmtInr(-1_50_000)).toBe('-Rs 1.50L');
    });
  });

  describe('fmtSignedInr', () => {
    it('prefixes positive', () => {
      expect(fmtSignedInr(1234)).toBe('+Rs 1,234');
    });
    it('handles zero as positive sign', () => {
      expect(fmtSignedInr(0)).toBe('+Rs 0');
    });
    it('keeps negative', () => {
      expect(fmtSignedInr(-1234)).toBe('-Rs 1,234');
    });
  });

  describe('fmtPct', () => {
    it('formats null as em dash', () => {
      expect(fmtPct(null)).toBe('—');
    });
    it('formats decimal rate as %', () => {
      expect(fmtPct(0.1234)).toBe('+12.34%');
    });
    it('keeps negative sign', () => {
      expect(fmtPct(-0.05)).toBe('-5.00%');
    });
  });

  describe('lastDayOfMonth', () => {
    it('returns last day of Jan 2025', () => {
      expect(lastDayOfMonth('2025-01-15')).toBe('2025-01-31');
    });
    it('returns last day of Feb 2024 (leap)', () => {
      expect(lastDayOfMonth('2024-02-10')).toBe('2024-02-29');
    });
    it('returns last day of Feb 2025 (non-leap)', () => {
      expect(lastDayOfMonth('2025-02-10')).toBe('2025-02-28');
    });
    it('returns same date when already last day', () => {
      expect(lastDayOfMonth('2025-04-30')).toBe('2025-04-30');
    });
  });
});
