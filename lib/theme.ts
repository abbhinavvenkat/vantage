export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'stock-platform.theme';

export function isThemePref(v: unknown): v is ThemePref {
  return v === 'light' || v === 'dark' || v === 'system';
}

/** Resolve the stored preference + system preference into a concrete theme. */
export function resolveTheme(
  stored: ThemePref | null | undefined,
  prefersDark: boolean,
): ResolvedTheme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}
