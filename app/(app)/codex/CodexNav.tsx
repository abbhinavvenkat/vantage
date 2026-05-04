'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function CodexNav() {
  const pathname = usePathname();
  const tabs = [
    { href: '/codex', label: 'Consensus' },
    { href: '/codex/backtest', label: 'Historical Simulation' },
  ];
  return (
    <div className="mt-4 flex gap-1 border-b border-[var(--color-border)] pb-0">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
              (active
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]')
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
