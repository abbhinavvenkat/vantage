import { describe, it, expect } from 'vitest';

import { isThemePref, resolveTheme } from '@/lib/theme';

describe('resolveTheme', () => {
  it('returns explicit light preference regardless of system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('returns explicit dark preference regardless of system', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('falls back to system preference when stored is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('falls back to system preference when stored is null/undefined', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
  });
});

describe('isThemePref', () => {
  it('accepts the three valid values', () => {
    expect(isThemePref('light')).toBe(true);
    expect(isThemePref('dark')).toBe(true);
    expect(isThemePref('system')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isThemePref('')).toBe(false);
    expect(isThemePref('Dark')).toBe(false);
    expect(isThemePref(null)).toBe(false);
    expect(isThemePref(undefined)).toBe(false);
    expect(isThemePref(42)).toBe(false);
    expect(isThemePref({})).toBe(false);
  });
});
