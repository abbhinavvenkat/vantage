'use client';

import { useEffect, useRef, useState } from 'react';

import { Monitor, Moon, Sun } from '@/components/ui/Icons';
import {
  isThemePref,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePref,
} from '@/lib/theme';

const OPTIONS: Array<{ value: ThemePref; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

function applyTheme(pref: ThemePref): ResolvedTheme {
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = resolveTheme(pref, prefersDark);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Hydrate from storage and keep in sync with system preference when "system".
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemePref = isThemePref(stored) ? stored : 'system';
    setPref(initial);
    setResolved(applyTheme(initial));
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(applyTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function choose(next: ThemePref) {
    setPref(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setResolved(applyTheme(next));
    setOpen(false);
  }

  const ButtonIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Toggle theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card-hover)]"
      >
        <ButtonIcon size={15} />
      </button>
      {open ? (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 z-40 mt-1.5 min-w-[140px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-elevated)] p-1 shadow-[var(--shadow-md)]"
        >
          {OPTIONS.map(({ value, label, Icon }) => {
            const active = pref === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(value)}
                className={
                  'flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm transition-colors ' +
                  (active
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
                }
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
